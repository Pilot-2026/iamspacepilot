import { CORE_VERSION, MAX_ONLINE_PILOTS, NET_PROTOCOL } from '../core/config';
import { LEVELS } from '../core/levels';
import { isPower, type PowerId } from '../core/powerups';
import { SHIP_ORDER, isShip, type ShipId, type SpecialKind } from '../core/ships';
import { BOT_NAMES } from '../core/solo';
import type { CrashInfo, CrashKind, Difficulty, LevelId, PilotInput } from '../core/types';
import { World, type WorldSetup } from '../core/world';

/**
 * Online game logic, independent of LiveKit and the screen, so it can be
 * tested with a fake network.
 *
 * Every glider is flown by exactly one device: each player flies their own,
 * the host also flies the bots. Every device sends the state and new wall
 * samples of the gliders it flies about 20 times a second and reports their
 * crashes. The host (the pilot who joined first) starts rounds, decides when
 * a round is over and starts the next one.
 */

/** Network protocol and simulation rules together: only equal versions can play together. */
export const GAME_VERSION = `${NET_PROTOCOL}.${CORE_VERSION}`;
export const MAX_PILOTS = MAX_ONLINE_PILOTS;
export const NEXT_ROUND_MS = 8000;

export type Mode = 'ffa' | 'teams';

export interface NetPilot {
  identity: string;
  name: string;
  bot: boolean;
  team: number;
  ship: ShipId;
}

const SPECIALS: readonly SpecialKind[] = ['burst', 'afterburner', 'phase', 'shockwave'];

export type Msg =
  | { t: 'hello'; v: string; name: string; ship: ShipId }
  /** A pilot picked another ship for the next round. */
  | { t: 'pick'; ship: ShipId }
  /** nextIn: milliseconds until the host starts the next round, 0 if not planned. */
  | { t: 'lobby'; level: LevelId; mode: Mode; bots: number; difficulty: Difficulty; round: number; flying: boolean; nextIn: number }
  | { t: 'start'; round: number; level: LevelId; mode: Mode; seed: number; difficulty: Difficulty; pilots: NetPilot[] }
  | { t: 's'; r: number; g: number[]; w: number[] }
  | { t: 'c'; r: number; id: number; k: CrashKind; by: number }
  /** Glider id fired shot k from p in direction d; s = 1 for a seeker shot. */
  | { t: 'f'; r: number; id: number; k: number; p: number[]; d: number[]; s: number }
  /** Shot k of glider by hit glider id, which has hull hits left; sh = 1 when its shield took it. */
  | { t: 'h'; r: number; id: number; by: number; k: number; hull: number; sh: number }
  /** Glider id used its special at p. */
  | { t: 'x'; r: number; id: number; k: SpecialKind; p: number[] }
  /** Glider id flew through ring k (placed for the n-th time) and got power-up pw. */
  | { t: 'g'; r: number; id: number; k: number; n: number; pw: PowerId }
  | { t: 'end'; r: number; winner: number; team: number; places: number[] };

export interface Peer {
  identity: string;
  name: string;
  joinedAt: number;
}

/** What the match needs from the network. */
export interface Transport {
  readonly self: string;
  peers(): Peer[];
  send(msg: Msg): void;
}

export interface MatchSettings {
  level: LevelId;
  mode: Mode;
  bots: number;
  difficulty: Difficulty;
}

export interface RoundResult {
  round: number;
  winner: number;
  team: number;
  places: number[];
  pilots: NetPilot[];
  local: number;
}

export interface MatchCallbacks {
  /** Players, host or settings changed. */
  onLobby(): void;
  onRoundStart(world: World, local: number): void;
  onRoundEnd(result: RoundResult): void;
  onCrash(id: number, crash: CrashInfo): void;
  /** Another device runs a different game version. */
  onVersionMismatch(name: string): void;
}

const CRASH_KINDS: readonly CrashKind[] = ['wall', 'shield', 'floor', 'ceiling', 'collision', 'lightning', 'core', 'shot', 'left'];
const finiteList = (a: unknown): a is number[] => Array.isArray(a) && a.every((v) => typeof v === 'number' && Number.isFinite(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

export class OnlineMatch {
  settings: MatchSettings;
  round = 0;
  /** This device flies in a running round. */
  flying = false;
  /** The host says a round is running (also when this device is not part of it). */
  private hostFlying = false;
  world: World | null = null;
  pilots: NetPilot[] = [];
  /** Index of this device's glider in the current round, -1 when watching. */
  local = -1;
  hostIdentity = '';
  /** When the host starts the next round (ms on the local clock), 0 if not planned. */
  nextRoundAt = 0;
  private owned = new Set<number>();
  /** Ships the other pilots picked (host uses them for the next round). */
  private readonly ships = new Map<string, ShipId>();
  private sent = new Map<number, number>();
  private ticks = 0;
  private endSent = false;

  constructor(
    private readonly t: Transport,
    private readonly me: { name: string; assist: boolean; ship: ShipId },
    settings: MatchSettings,
    private readonly cb: MatchCallbacks,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.settings = { ...settings };
  }

  get isHost(): boolean {
    return this.hostIdentity === this.t.self;
  }

  /** A round is running in this game. */
  get running(): boolean {
    return this.flying || this.hostFlying;
  }

  /** The device that flies glider id: the pilot for people, the host for bots. */
  private ownerOf(id: number): string {
    const p = this.pilots[id];
    if (!p) return '';
    return p.bot ? this.hostIdentity : p.identity;
  }

  hostName(): string {
    return this.t.peers().find((p) => p.identity === this.hostIdentity)?.name ?? '';
  }

  /** Call once after connecting. */
  start(): void {
    this.electHost();
    this.t.send({ t: 'hello', v: GAME_VERSION, name: this.me.name, ship: this.me.ship });
    if (this.isHost) this.broadcastLobby();
    this.cb.onLobby();
  }

  /** Call when someone joins or leaves. */
  peersChanged(): void {
    const was = this.isHost;
    this.electHost();
    if (!was && this.isHost) this.becomeHost();
    this.dropLeavers();
    this.cb.onLobby();
  }

  /** Pilots who left during a round drop out of it. */
  private dropLeavers(): void {
    const w = this.world;
    if (!w || !this.flying) return;
    const here = new Set(this.t.peers().map((p) => p.identity));
    this.pilots.forEach((p, i) => {
      if (p.bot || here.has(p.identity) || this.owned.has(i) || !w.gliders[i].alive) return;
      const crash: CrashInfo = { kind: 'left', by: -1, seg: -1 };
      w.remoteCrash(i, crash);
      this.cb.onCrash(i, crash);
    });
  }

  private electHost(): void {
    const peers = this.t.peers().slice().sort((a, b) => a.joinedAt - b.joinedAt || a.identity.localeCompare(b.identity));
    this.hostIdentity = peers[0]?.identity ?? this.t.self;
  }

  /** The previous host left: take over the bots and the host duties. */
  private becomeHost(): void {
    const w = this.world;
    if (w && this.flying) {
      this.pilots.forEach((p, i) => {
        if (!p.bot) return;
        w.takeOverBot(i, this.settings.difficulty);
        this.owned.add(i);
        this.sent.set(i, w.trails[i].count);
      });
    }
    if (!this.flying && this.round > 0 && !this.nextRoundAt) this.nextRoundAt = this.clock() + NEXT_ROUND_MS;
    this.broadcastLobby();
  }

  /** This pilot's ship for the next round. */
  get ship(): ShipId {
    return this.me.ship;
  }

  /** Picks a ship for the next round and tells the others. */
  setShip(ship: ShipId): void {
    this.me.ship = ship;
    this.t.send({ t: 'pick', ship });
    this.cb.onLobby();
  }

  /** Ship a pilot picked for the next round, as far as this device knows. */
  shipOf(identity: string): ShipId {
    return identity === this.t.self ? this.me.ship : (this.ships.get(identity) ?? 'trident');
  }

  /** Host: change level, mode, bots or difficulty for the next round. */
  setSettings(patch: Partial<MatchSettings>): void {
    if (!this.isHost) return;
    this.settings = { ...this.settings, ...patch };
    this.broadcastLobby();
    this.cb.onLobby();
  }

  private broadcastLobby(): void {
    const s = this.settings;
    const nextIn = this.nextRoundAt ? Math.max(0, Math.round(this.nextRoundAt - this.clock())) : 0;
    this.hostFlying = this.flying;
    this.t.send({ t: 'lobby', level: s.level, mode: s.mode, bots: s.bots, difficulty: s.difficulty, round: this.round, flying: this.flying, nextIn });
  }

  /** Seconds until the next round starts, or -1 if none is planned. */
  secondsToNext(): number {
    return this.nextRoundAt ? Math.max(0, Math.ceil((this.nextRoundAt - this.clock()) / 1000)) : -1;
  }

  /** Host: start a round with everyone in the room plus bots. */
  startRound(): void {
    if (!this.isHost) return;
    const s = this.settings;
    const humans = this.t
      .peers()
      .slice()
      .sort((a, b) => a.joinedAt - b.joinedAt || a.identity.localeCompare(b.identity))
      .slice(0, MAX_PILOTS);
    const pilots: NetPilot[] = humans.map((p) => ({
      identity: p.identity,
      name: p.name,
      bot: false,
      team: -1,
      ship: p.identity === this.t.self ? this.me.ship : (this.ships.get(p.identity) ?? 'trident'),
    }));
    const bots = Math.max(0, Math.min(s.bots, MAX_PILOTS - pilots.length));
    for (let i = 0; i < bots; i++) {
      const ship = SHIP_ORDER[Math.floor(Math.random() * SHIP_ORDER.length)];
      pilots.push({ identity: `bot-${i}`, name: BOT_NAMES[i % BOT_NAMES.length], bot: true, team: -1, ship });
    }
    if (s.mode === 'teams') pilots.forEach((p, i) => (p.team = i % 2));
    const msg: Extract<Msg, { t: 'start' }> = {
      t: 'start',
      round: this.round + 1,
      level: s.level,
      mode: s.mode,
      seed: Math.floor(Math.random() * 0xffffffff) >>> 0,
      difficulty: s.difficulty,
      pilots,
    };
    this.nextRoundAt = 0;
    this.t.send(msg);
    this.beginRound(msg);
  }

  private beginRound(m: Extract<Msg, { t: 'start' }>): void {
    this.round = m.round;
    this.flying = true;
    this.endSent = false;
    this.nextRoundAt = 0;
    this.settings = { ...this.settings, level: m.level, mode: m.mode, difficulty: m.difficulty };
    this.pilots = m.pilots;
    this.local = m.pilots.findIndex((p) => !p.bot && p.identity === this.t.self);
    const host = this.isHost;
    const setup: WorldSetup = {
      level: m.level,
      seed: m.seed,
      online: true,
      teams: m.mode === 'teams',
      pilots: m.pilots.map((p, i) => ({
        name: p.name,
        isBot: p.bot,
        assist: i === this.local ? this.me.assist : true,
        skill: m.difficulty,
        remote: p.bot ? !host : i !== this.local,
        team: p.team,
        ship: isShip(p.ship) ? p.ship : 'trident',
      })),
    };
    this.world = new World(setup);
    this.owned = new Set();
    this.sent = new Map();
    if (this.local >= 0) this.owned.add(this.local);
    if (host) m.pilots.forEach((p, i) => p.bot && this.owned.add(i));
    for (const id of this.owned) this.sent.set(id, 0);
    this.ticks = 0;
    this.cb.onRoundStart(this.world, this.local);
  }

  /** One simulation tick (1/60 s). */
  step(input: PilotInput): void {
    const w = this.world;
    if (!w || !this.flying) return;
    const inputs: (PilotInput | undefined)[] = [];
    if (this.local >= 0) inputs[this.local] = input;
    w.step(inputs);
    for (const e of w.events) {
      if (e.type === 'shot' && this.owned.has(e.id)) {
        const shot = w.shots.find((x) => x.key === e.shot);
        if (shot) {
          this.t.send({
            t: 'f',
            r: this.round,
            id: e.id,
            k: e.shot,
            p: [r3(shot.p.x), r3(shot.p.y), r3(shot.p.z)],
            d: [r4(shot.d.x), r4(shot.d.y), r4(shot.d.z)],
            s: shot.seek ? 1 : 0,
          });
        }
      } else if (e.type === 'hit' && this.owned.has(e.id)) {
        this.t.send({ t: 'h', r: this.round, id: e.id, by: e.by, k: e.shot, hull: e.hull, sh: e.shield ? 1 : 0 });
      } else if (e.type === 'special' && this.owned.has(e.id)) {
        const g = w.gliders[e.id];
        this.t.send({ t: 'x', r: this.round, id: e.id, k: e.kind, p: [r3(g.p.x), r3(g.p.y), r3(g.p.z)] });
      } else if (e.type === 'power' && this.owned.has(e.id)) {
        this.t.send({ t: 'g', r: this.round, id: e.id, k: e.ring, n: e.n, pw: e.power });
      } else if (e.type === 'crash') {
        if (this.owned.has(e.id)) this.t.send({ t: 'c', r: this.round, id: e.id, k: e.crash.kind, by: e.crash.by });
        this.cb.onCrash(e.id, e.crash);
      }
    }
    this.ticks++;
    if (this.ticks % 3 === 0) this.sendState();
    if (this.isHost && !this.endSent && w.phase !== 'countdown') {
      const humanFlying = this.pilots.some((p, i) => !p.bot && w.gliders[i].alive);
      if (w.phase === 'over' || w.roundDecided() || !humanFlying) this.finishRound();
    }
  }

  /** This pilot stops flying in the current round, for example when the game goes to the background. */
  dropOut(): void {
    const w = this.world;
    if (!w || !this.flying || this.local < 0 || !w.gliders[this.local].alive) return;
    const crash: CrashInfo = { kind: 'left', by: -1, seg: -1 };
    w.remoteCrash(this.local, crash);
    this.t.send({ t: 'c', r: this.round, id: this.local, k: 'left', by: -1 });
    this.cb.onCrash(this.local, crash);
  }

  /** Call every frame, also between rounds: the host starts the next round on time. */
  update(): void {
    if (this.isHost && !this.flying && this.nextRoundAt && this.clock() >= this.nextRoundAt) this.startRound();
  }

  private sendState(): void {
    const w = this.world;
    if (!w) return;
    const g: number[] = [];
    const wl: number[] = [];
    for (const id of this.owned) {
      const gl = w.gliders[id];
      if (gl.alive) {
        g.push(id, r3(gl.p.x), r3(gl.p.y), r3(gl.p.z), r4(gl.q.x), r4(gl.q.y), r4(gl.q.z), r4(gl.q.w), r2(gl.speed), r2(gl.energy), gl.boosting ? 1 : 0);
      }
      const tr = w.trails[id];
      const from = this.sent.get(id) ?? 0;
      if (tr.count > from) {
        wl.push(id, from, tr.count - from);
        for (let k = from; k < tr.count; k++) wl.push(r3(tr.px[k]), r3(tr.py[k]), r3(tr.pz[k]), r3(tr.ux[k]), r3(tr.uy[k]), r3(tr.uz[k]), r2(tr.h[k]));
        this.sent.set(id, tr.count);
      }
    }
    if (g.length || wl.length) this.t.send({ t: 's', r: this.round, g, w: wl });
  }

  private finishRound(): void {
    const w = this.world;
    if (!w) return;
    this.endSent = true;
    w.endRound();
    const msg: Extract<Msg, { t: 'end' }> = {
      t: 'end',
      r: this.round,
      winner: w.winner,
      team: w.winnerTeam,
      places: w.gliders.map((g) => (g.alive ? 1 : g.place)),
    };
    this.t.send(msg);
    this.applyEnd(msg);
    this.nextRoundAt = this.clock() + NEXT_ROUND_MS;
    this.broadcastLobby();
  }

  private applyEnd(m: Extract<Msg, { t: 'end' }>): void {
    this.flying = false;
    this.cb.onRoundEnd({ round: m.r, winner: m.winner, team: m.team, places: m.places, pilots: this.pilots, local: this.local });
  }

  /** A message from another device. */
  receive(from: string, m: Msg): void {
    switch (m.t) {
      case 'hello':
        if (m.v !== GAME_VERSION) this.cb.onVersionMismatch(m.name);
        if (isShip(m.ship)) this.ships.set(from, m.ship);
        // Tell the newcomer which ship this pilot flies.
        this.t.send({ t: 'pick', ship: this.me.ship });
        if (this.isHost) this.broadcastLobby();
        this.cb.onLobby();
        break;
      case 'lobby':
        if (from !== this.hostIdentity || !LEVELS[m.level]) return;
        this.settings = { level: m.level, mode: m.mode, bots: m.bots, difficulty: m.difficulty };
        this.hostFlying = !!m.flying;
        if (!this.flying) {
          this.round = m.round;
          this.nextRoundAt = m.nextIn ? this.clock() + m.nextIn : 0;
        }
        this.cb.onLobby();
        break;
      case 'start':
        if (from !== this.hostIdentity || !LEVELS[m.level] || !Array.isArray(m.pilots)) return;
        if (m.pilots.length < 1 || m.pilots.length > MAX_PILOTS) return;
        this.beginRound(m);
        break;
      case 's': {
        const w = this.world;
        if (!w || m.r !== this.round || !finiteList(m.g) || !finiteList(m.w)) return;
        for (let o = 0; o + 10 < m.g.length; o += 11) {
          const id = m.g[o];
          if (this.owned.has(id) || this.ownerOf(id) !== from) continue;
          w.setRemoteState(id, {
            px: m.g[o + 1],
            py: m.g[o + 2],
            pz: m.g[o + 3],
            qx: m.g[o + 4],
            qy: m.g[o + 5],
            qz: m.g[o + 6],
            qw: m.g[o + 7],
            speed: m.g[o + 8],
            energy: m.g[o + 9],
            boosting: m.g[o + 10] === 1,
          });
        }
        let o = 0;
        while (o + 2 < m.w.length) {
          const id = m.w[o];
          const start = m.w[o + 1];
          const n = m.w[o + 2];
          if (!(n > 0)) break;
          const data = m.w.slice(o + 3, o + 3 + n * 7);
          if (!this.owned.has(id) && this.ownerOf(id) === from) w.addRemoteSamples(id, start, data);
          o += 3 + n * 7;
        }
        break;
      }
      case 'c': {
        const w = this.world;
        if (!w || m.r !== this.round || this.owned.has(m.id) || this.ownerOf(m.id) !== from) return;
        const by = Number.isInteger(m.by) && m.by >= 0 && m.by < w.gliders.length ? m.by : -1;
        let kind: CrashKind = CRASH_KINDS.includes(m.k) ? m.k : 'shield';
        if ((kind === 'wall' || kind === 'collision' || kind === 'shot') && by < 0) kind = 'shield';
        const crash: CrashInfo = { kind, by, seg: -1 };
        if (w.gliders[m.id]?.alive) {
          w.remoteCrash(m.id, crash);
          this.cb.onCrash(m.id, crash);
        }
        break;
      }
      case 'pick':
        if (isShip(m.ship) && this.ships.get(from) !== m.ship) {
          this.ships.set(from, m.ship);
          this.cb.onLobby();
        }
        break;
      case 'x': {
        const w = this.world;
        if (!w || m.r !== this.round || this.owned.has(m.id) || this.ownerOf(m.id) !== from) return;
        if (!SPECIALS.includes(m.k) || !finiteList(m.p) || m.p.length !== 3) return;
        w.remoteSpecial(m.id, m.k, m.p[0], m.p[1], m.p[2]);
        break;
      }
      case 'g': {
        const w = this.world;
        if (!w || m.r !== this.round || this.owned.has(m.id) || this.ownerOf(m.id) !== from) return;
        if (!Number.isInteger(m.k) || !Number.isInteger(m.n) || !isPower(m.pw)) return;
        w.remoteRing(m.id, m.k, m.n, m.pw);
        break;
      }
      case 'f': {
        const w = this.world;
        if (!w || m.r !== this.round || this.owned.has(m.id) || this.ownerOf(m.id) !== from) return;
        if (!finiteList(m.p) || !finiteList(m.d) || m.p.length !== 3 || m.d.length !== 3 || !Number.isInteger(m.k)) return;
        w.addRemoteShot(m.id, m.k, m.p[0], m.p[1], m.p[2], m.d[0], m.d[1], m.d[2], m.s === 1);
        break;
      }
      case 'h': {
        const w = this.world;
        if (!w || m.r !== this.round || this.owned.has(m.id) || this.ownerOf(m.id) !== from) return;
        if (!Number.isInteger(m.by) || !Number.isInteger(m.k) || !Number.isFinite(m.hull)) return;
        w.remoteHit(m.id, m.by, m.k, m.hull, m.sh === 1);
        break;
      }
      case 'end':
        if (from !== this.hostIdentity || m.r !== this.round || !finiteList(m.places)) return;
        this.applyEnd(m);
        break;
    }
  }
}
