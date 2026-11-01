import { arenaRadius, boundaryHit } from './arena';
import { botThink, makeBrain } from './bot';
import {
  BOLT_RADIUS,
  COUNTDOWN_TICKS,
  DT,
  FLIGHT,
  GLIDER_HIT_RADIUS,
  GUN,
  HASH_CELL,
  QUERY_RADIUS,
  SAMPLE_TICKS,
  SELF_SKIP,
  SELF_SLIP_SKIP,
  SHOT_KEY,
  TAPER_TICKS,
  TICK_RATE,
  WALL_HALF,
  WING_PROBE,
} from './config';
import { integrateGlider, tailPoint, type Glider } from './glider';
import { LEVELS, type LevelSpec } from './levels';
import { LEVEL_OBSTACLES, Obstacle } from './obstacles';
import { BIG_WALL, POWERS, POWER_ORDER, RAPID_INTERVAL, SEEKER_CONE, SEEKER_HOMING, ringHash, type PowerId } from './powerups';
import { JAM_TICKS, SHIPS, SHOCKWAVE_RADIUS, type ShipId, type SpecialKind } from './ships';
import { AXIS_FWD, AXIS_LEFT, AXIS_UP, Quat, TWO_PI, V3, dcos, dsin } from './math';
import { Rng } from './rng';
import { SEG_SHIFT, SpatialHash, Trail, quadCorners, segQuad, segSegDistSq, segmentBounds, wallDistSq } from './trail';
import { NEUTRAL_INPUT, type CrashInfo, type Difficulty, type LevelId, type Phase, type PilotInput, type SimEvent } from './types';

export interface PilotSetup {
  name: string;
  isBot: boolean;
  assist: boolean;
  skill: Difficulty;
  /** Online: this glider is flown by another device. */
  remote?: boolean;
  /** Team number in team games. */
  team?: number;
  /** Ship model, Trident if not given. */
  ship?: ShipId;
}

export interface WorldSetup {
  level: LevelId;
  seed: number;
  pilots: PilotSetup[];
  /** Online game: lightning from its own random stream so every device sees the same bolts; each device decides about its own gliders. */
  online?: boolean;
  /** Team game: your team's walls do not hurt you, the last team flying wins. */
  teams?: boolean;
}

/** State of a remote glider as sent over the network. */
export interface RemoteState {
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  speed: number;
  energy: number;
  boosting: boolean;
}

export const RING_RADIUS = 7;

export interface Ring {
  active: boolean;
  readonly c: V3;
  readonly n: V3;
  respawnTick: number;
  /** How often this ring was placed so far: position and power-up follow from it. */
  count: number;
  /** The power-up this ring gives. */
  power: PowerId;
}

/** A ship closer than this to an obstacle's surface crashes into it. */
export const OBSTACLE_HIT = 1.1;

/** Ticks until a used ring appears again somewhere else. */
const RING_RESPAWN = 8 * TICK_RATE;
/** After the shield took a wall, walls cannot hurt the ship for this many ticks. */
const SHIELD_GHOST = 30;
/** Fan of the Trident Burst and of the triple shot (radians to the side). */
const BURST_FAN = [-0.24, -0.12, 0, 0.12, 0.24];
const TRIPLE_FAN = [-0.12, 0, 0.12];

/** A shot from a glider's gun. */
export interface Shot {
  /** owner * SHOT_KEY + number: the same on every device. */
  readonly key: number;
  readonly owner: number;
  readonly p: V3;
  readonly pPrev: V3;
  /** Unit direction. */
  readonly d: V3;
  readonly born: number;
  /** m/s. */
  readonly speed: number;
  /** Seeker shot: turns much harder towards its target. */
  readonly seek: boolean;
  alive: boolean;
}

export interface Bolt {
  readonly id: number;
  readonly x: number[];
  readonly y: number[];
  readonly z: number[];
  readonly warnTick: number;
  readonly strikeTick: number;
  readonly endTick: number;
}

const tmpA = new V3();
const tmpB = new V3();
const tmpNear = new V3();

/** Share of the gap to the latest network position a remote glider closes each tick. */
const REMOTE_BLEND = 0.18;
/** Further off than this, a remote glider jumps straight to its network position. */
const REMOTE_SNAP = 15;

/** Latest network state of a remote glider, flown on straight between updates. */
interface NetTarget {
  readonly p: V3;
  readonly q: Quat;
}

/**
 * The whole game state. step() advances it by exactly one tick (1/60 s).
 * Same setup + same inputs = same result on every device.
 */
export class World {
  readonly spec: LevelSpec;
  readonly rng: Rng;
  readonly gliders: Glider[] = [];
  readonly trails: Trail[] = [];
  readonly rings: Ring[] = [];
  readonly bolts: Bolt[] = [];
  readonly shots: Shot[] = [];
  /** Deadly shapes inside the arena (islands, crystals, rings ...). */
  readonly obstacles: Obstacle[] = [];
  /** Events of the last step. */
  readonly events: SimEvent[] = [];
  /** Online: events from the network, handed out with the next step. */
  private readonly queued: SimEvent[] = [];
  readonly hash = new SpatialHash(HASH_CELL);
  tick = 0;
  flyTicks = 0;
  phase: Phase = 'countdown';
  winner = -1;
  /** Winning team in team games, -1 otherwise. */
  winnerTeam = -1;
  readonly online: boolean;
  readonly teams: boolean;
  readonly seed: number;
  private readonly boltRng: Rng;
  /** Tick on which the round ended, -1 while it is still running. */
  overTick = -1;

  private nextBoltFly = 4 * TICK_RATE;
  private boltSeq = 0;
  private shrinkAnnounced = false;
  private readonly net: (NetTarget | null)[] = [];
  private readonly cand = new Set<number>();
  private readonly corners = new Float64Array(12);
  private readonly bounds = new Float64Array(6);

  constructor(setup: WorldSetup) {
    this.spec = LEVELS[setup.level];
    this.seed = setup.seed >>> 0;
    this.rng = new Rng(setup.seed);
    this.boltRng = new Rng((setup.seed ^ 0x5bd1e995) >>> 0);
    this.online = !!setup.online;
    this.teams = !!setup.teams;
    const n = setup.pilots.length;
    const rs = this.spec.arena.radius * 0.55;
    const left = new V3();
    const up = new V3();
    const f = new V3();
    setup.pilots.forEach((ps, i) => {
      const th = (TWO_PI * i) / n + 0.35;
      const c = dcos(th);
      const s = dsin(th);
      const p = new V3(c * rs, 6 + (i % 3) * 6, s * rs);
      // Start along the circle (counter-clockwise), slightly inwards. Tangent
      // paths never cross another glider's fresh wall in the first seconds.
      f.set(-s - c * 0.12, 0, c - s * 0.12).normalize();
      left.cross(AXIS_UP, f).normalize();
      up.cross(f, left).normalize();
      const q = new Quat().setFromBasis(left, up, f);
      const ship = SHIPS[ps.ship ?? 'trident'] ?? SHIPS.trident;
      this.gliders.push({
        id: i,
        name: ps.name,
        isBot: ps.isBot,
        assist: ps.assist,
        remote: !!ps.remote,
        team: this.teams ? (ps.team ?? 0) : -1,
        alive: true,
        p,
        pPrev: p.clone(),
        qb: new Quat().copy(q),
        q: new Quat().copy(q),
        bank: 0,
        speed: 24,
        energy: 0.6,
        boosting: false,
        crashTick: -1,
        crash: null,
        place: 0,
        rings: 0,
        hull: ship.hull,
        heat: 0,
        overheated: false,
        lastShot: -1000,
        shots: 0,
        hits: 0,
        ship,
        specialReady: 0,
        specialUntil: -1,
        power: null,
        powerUntil: -1,
        shield: false,
        ghostUntil: -1,
        jamUntil: -1,
        mods: { turn: 1, roll: 1, cruise: 1, boost: 1, drain: 1, slip: 1, forceBoost: false },
        wallDist: 1e9,
        near: new V3(),
        hasNear: false,
        brain: ps.isBot && !ps.remote ? makeBrain(ps.skill, i) : null,
        input: { steerX: 0, steerY: 0, roll: 0, boost: false, fire: false, special: false },
      });
      this.trails.push(new Trail());
    });
    for (const def of LEVEL_OBSTACLES[setup.level] ?? []) this.obstacles.push(new Obstacle(def));
    for (let k = 0; k < this.spec.rings; k++) {
      const ring: Ring = { active: true, c: new V3(), n: new V3(1, 0, 0), respawnTick: 0, count: 0, power: 'repair' };
      this.placeRing(ring, k);
      this.rings.push(ring);
    }
  }

  get flyTime(): number {
    return this.flyTicks / TICK_RATE;
  }

  radius(): number {
    return arenaRadius(this.spec.arena, this.flyTime);
  }

  aliveCount(): number {
    let n = 0;
    for (const g of this.gliders) if (g.alive) n++;
    return n;
  }

  /** Advances the world by one tick. inputs[i] is used for human pilot i. */
  step(inputs: ReadonlyArray<PilotInput | undefined>): void {
    this.events.length = 0;
    for (const o of this.obstacles) o.update(this.tick);
    if (this.queued.length) {
      this.events.push(...this.queued);
      this.queued.length = 0;
    }
    if (this.phase === 'countdown') {
      if (this.tick % TICK_RATE === 0) this.events.push({ type: 'count', n: 3 - this.tick / TICK_RATE });
      this.tick++;
      if (this.tick >= COUNTDOWN_TICKS) {
        this.phase = 'flying';
        this.events.push({ type: 'go' });
      }
      return;
    }

    const spec = this.spec;
    if (!this.shrinkAnnounced && this.flyTime >= spec.arena.shrinkStart) {
      this.shrinkAnnounced = true;
      this.events.push({ type: 'shrink' });
    }
    const R = this.radius();
    const gl = this.gliders;

    for (const g of gl) {
      if (g.alive && g.brain && (this.flyTicks + g.brain.offset) % g.brain.interval === 0) botThink(this, g.id);
    }

    for (const g of gl) {
      if (g.power && g.powerUntil >= 0 && this.tick >= g.powerUntil) {
        if (g.power === 'shield') g.shield = false;
        g.power = null;
      }
    }

    for (const g of gl) {
      if (!g.alive) continue;
      if (g.remote) {
        this.flyRemote(g);
        continue;
      }
      const inp = g.brain ? g.brain.input : (inputs[g.id] ?? NEUTRAL_INPUT);
      if (inp.special) this.useSpecial(g);
      this.updateMods(g);
      integrateGlider(g, inp);
      this.gun(g, !!inp.fire);
      const up = spec.updraft;
      if (up) {
        const d2 = g.p.x * g.p.x + g.p.z * g.p.z;
        if (d2 < up.radius * up.radius) g.p.y += up.strength * DT * (1 - Math.sqrt(d2) / up.radius);
      }
      const wind = spec.wind;
      if (wind) {
        g.p.x += wind.x * DT;
        g.p.z += wind.z * DT;
      }
      const core = spec.core;
      if (core) {
        // The core pulls harder the closer you get.
        const d = g.p.length();
        if (d > 1e-6 && d < core.reach) g.p.addScaled(g.p, (-core.pull * DT * (1 - d / core.reach)) / d);
      }
    }

    if (this.flyTicks % SAMPLE_TICKS === 0) {
      for (const g of gl) if (g.alive && !g.remote) this.addSample(g);
    }

    if (spec.lightning) this.updateBolts(R);

    const pending: { id: number; crash: CrashInfo }[] = [];
    for (const g of gl) {
      if (!g.alive || g.remote) continue;
      const c = this.collide(g, R);
      if (c) pending.push({ id: g.id, crash: c });
    }
    this.updateShots(R, pending);
    const hit2 = GLIDER_HIT_RADIUS * GLIDER_HIT_RADIUS;
    for (let i = 0; i < gl.length; i++) {
      const a = gl[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < gl.length; j++) {
        const b = gl[j];
        if (!b.alive || a.p.distSq(b.p) > hit2) continue;
        if (this.teams && a.team === b.team) continue;
        if (this.phasing(a) || this.phasing(b)) continue;
        // Each device only decides about the gliders it flies itself.
        if (!a.remote && !pending.some((x) => x.id === a.id)) pending.push({ id: a.id, crash: { kind: 'collision', by: b.id, seg: -1 } });
        if (!b.remote && !pending.some((x) => x.id === b.id)) pending.push({ id: b.id, crash: { kind: 'collision', by: a.id, seg: -1 } });
      }
    }
    if (pending.length) this.applyCrashes(pending);

    this.updateRings();

    if (this.phase === 'flying' && gl.length > 1 && this.roundDecided()) this.endRound();

    this.flyTicks++;
    this.tick++;
  }

  /** True when only one pilot (or one team) is left. */
  roundDecided(): boolean {
    if (!this.teams) return this.aliveCount() <= 1;
    let team = -2;
    for (const g of this.gliders) {
      if (!g.alive) continue;
      if (team === -2) team = g.team;
      else if (g.team !== team) return false;
    }
    return true;
  }

  /** Ends the round now. The pilot (or team) still flying wins. */
  endRound(): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.overTick = this.tick;
    const alive = this.gliders.filter((g) => g.alive);
    if (this.teams) {
      // Usually one team is left. If the round is cut short, the team with more gliders in the air wins.
      const count = [0, 0];
      for (const g of alive) count[g.team & 1]++;
      this.winnerTeam = count[0] > count[1] ? 0 : count[1] > count[0] ? 1 : -1;
      this.winner = alive.length === 1 ? alive[0].id : -1;
      for (const g of alive) g.place = 1;
    } else {
      const w = alive.length === 1 ? alive[0] : null;
      this.winner = w ? w.id : -1;
      if (w) w.place = 1;
    }
    this.events.push({ type: 'over', winner: this.winner });
  }

  /** Online: latest position of a remote glider. The glider glides there over the next ticks. */
  setRemoteState(id: number, s: RemoteState): void {
    const g = this.gliders[id];
    if (!g || !g.remote || !g.alive) return;
    let t = this.net[id];
    if (!t) {
      t = { p: new V3(), q: new Quat() };
      this.net[id] = t;
    }
    t.p.set(s.px, s.py, s.pz);
    t.q.x = s.qx;
    t.q.y = s.qy;
    t.q.z = s.qz;
    t.q.w = s.qw;
    t.q.normalize();
    g.speed = s.speed;
    g.energy = s.energy;
    g.boosting = s.boosting;
    if (g.p.distSq(t.p) > REMOTE_SNAP * REMOTE_SNAP) {
      g.p.copy(t.p);
      g.pPrev.copy(t.p);
      g.q.copy(t.q);
      g.qb.copy(t.q);
    }
  }

  /** One tick of a glider flown by another device: fly on straight and close in on the network position. */
  private flyRemote(g: Glider): void {
    g.pPrev.copy(g.p);
    g.q.rotate(AXIS_FWD, tmpA);
    g.p.addScaled(tmpA, g.speed * DT);
    const t = this.net[g.id];
    if (t) {
      t.q.rotate(AXIS_FWD, tmpB);
      t.p.addScaled(tmpB, g.speed * DT);
      g.p.x += (t.p.x - g.p.x) * REMOTE_BLEND;
      g.p.y += (t.p.y - g.p.y) * REMOTE_BLEND;
      g.p.z += (t.p.z - g.p.z) * REMOTE_BLEND;
      const q = g.q;
      const sign = q.x * t.q.x + q.y * t.q.y + q.z * t.q.z + q.w * t.q.w < 0 ? -1 : 1;
      q.x += (t.q.x * sign - q.x) * REMOTE_BLEND * 1.5;
      q.y += (t.q.y * sign - q.y) * REMOTE_BLEND * 1.5;
      q.z += (t.q.z * sign - q.z) * REMOTE_BLEND * 1.5;
      q.w += (t.q.w * sign - q.w) * REMOTE_BLEND * 1.5;
      q.normalize();
    }
    g.qb.copy(g.q);
  }

  /**
   * Online: wall samples of a remote glider, as [x, y, z, ux, uy, uz, h] groups,
   * starting at sample index start. Samples that are already known are skipped.
   */
  addRemoteSamples(id: number, start: number, data: readonly number[]): void {
    const g = this.gliders[id];
    if (!g || !g.remote) return;
    const tr = this.trails[id];
    for (let k = 0; k * 7 + 6 < data.length; k++) {
      if (start + k < tr.count) continue;
      if (tr.count >= SEG_SHIFT - 1) return;
      const o = k * 7;
      tmpA.set(data[o], data[o + 1], data[o + 2]);
      tmpB.set(data[o + 3], data[o + 4], data[o + 5]);
      const h = data[o + 6];
      tr.add(tmpA, tmpB, this.tick, h > 0.5 && h < WALL_HALF * BIG_WALL + 0.01 ? h : WALL_HALF);
      const n = tr.count;
      if (n >= 2) {
        const seg = n - 2;
        const b = this.bounds;
        segmentBounds(tr, seg, 0.1, b);
        this.hash.insert(id * SEG_SHIFT + seg, b[0], b[1], b[2], b[3], b[4], b[5]);
      }
    }
  }

  /** Online: another device reports that one of its gliders crashed. */
  remoteCrash(id: number, crash: CrashInfo): void {
    const g = this.gliders[id];
    if (!g || !g.alive) return;
    this.applyCrashes([{ id, crash }]);
  }

  /** Online: a glider flown by another device fired a shot. */
  addRemoteShot(owner: number, key: number, px: number, py: number, pz: number, dx: number, dy: number, dz: number, seek: boolean): void {
    const g = this.gliders[owner];
    if (!g || !g.remote || this.shots.some((s) => s.key === key)) return;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(l > 0.5)) return;
    this.spawnShot(owner, key, px, py, pz, dx / l, dy / l, dz / l, seek);
    this.queued.push({ type: 'shot', id: owner, shot: key });
  }

  /** Online: the device that flies glider id reports that a shot hit it (or its shield). */
  remoteHit(id: number, by: number, key: number, hull: number, shield: boolean): void {
    const g = this.gliders[id];
    if (!g || !g.remote || !g.alive) return;
    for (const s of this.shots) if (s.key === key) s.alive = false;
    if (shield) {
      this.dropShield(g);
    } else {
      g.hull = hull < 0 ? 0 : hull > g.ship.hull ? g.ship.hull : hull;
    }
    const shooter = this.gliders[by];
    if (shooter && !shield) shooter.hits++;
    this.queued.push({ type: 'hit', id, by: shooter ? by : -1, shot: key, hull: g.hull, shield });
  }

  /** Online: a glider flown by another device used its special ability. */
  remoteSpecial(id: number, kind: SpecialKind, px: number, py: number, pz: number): void {
    const g = this.gliders[id];
    if (!g || !g.remote || !g.alive || g.ship.special.kind !== kind) return;
    const sp = g.ship.special;
    g.specialReady = this.tick + sp.cooldown;
    g.specialUntil = this.tick + sp.duration;
    if (kind === 'shockwave') this.shockwave(id, px, py, pz, this.queued);
    this.queued.push({ type: 'special', id, kind });
  }

  /** Online: a glider flown by another device flew through ring k (placed for the n-th time). */
  remoteRing(id: number, k: number, n: number, power: PowerId): void {
    const g = this.gliders[id];
    const ring = this.rings[k];
    if (!g || !g.remote || !ring) return;
    if (ring.active && ring.count === n) {
      ring.active = false;
      ring.respawnTick = this.tick + RING_RESPAWN;
    }
    if (!g.alive) return;
    g.rings++;
    this.applyPower(g, power);
    this.queued.push({ type: 'power', id, power, ring: k, n });
  }

  /**
   * Distance from (x, y, z) to the nearest obstacle surface (1e9 if none),
   * and which obstacle that is in nearestObstacle.
   */
  obstacleDist(x: number, y: number, z: number): number {
    let best = 1e9;
    let idx = -1;
    for (let k = 0; k < this.obstacles.length; k++) {
      const o = this.obstacles[k];
      const dx = x - o.c.x;
      const dy = y - o.c.y;
      const dz = z - o.c.z;
      const rough = Math.sqrt(dx * dx + dy * dy + dz * dz) - o.reach;
      if (rough >= best) continue;
      const d = o.dist(x, y, z);
      if (d < best) {
        best = d;
        idx = k;
      }
    }
    this.nearestObstacle = idx;
    return best;
  }

  /** Index of the obstacle found by the last obstacleDist call. */
  nearestObstacle = -1;

  /** How far along the unit direction d from p until within `margin` of an obstacle (at most len). */
  obstacleRay(p: V3, d: V3, len: number, margin: number): number {
    if (!this.obstacles.length) return len;
    let t = 0;
    for (let k = 0; k < 48 && t < len; k++) {
      const s = this.obstacleDist(p.x + d.x * t, p.y + d.y * t, p.z + d.z * t) - margin;
      if (s < 0.05) return t;
      t += s > 0.5 ? s : 0.5;
    }
    return len;
  }

  /** True while glider g phases through walls and shots (Halo special). */
  phasing(g: Glider): boolean {
    return g.ship.special.kind === 'phase' && this.tick < g.specialUntil;
  }

  /** Seconds until the special of glider g is ready again (0 = ready). */
  specialWait(g: Glider): number {
    return g.specialReady > this.tick ? (g.specialReady - this.tick) / TICK_RATE : 0;
  }

  /** Online: this device takes over a bot that another device flew until now. */
  takeOverBot(id: number, skill: Difficulty): void {
    const g = this.gliders[id];
    if (!g || !g.isBot || !g.remote) return;
    const t = this.net[id];
    if (t) {
      g.p.copy(t.p);
      g.q.copy(t.q);
    }
    g.qb.copy(g.q);
    g.bank = 0;
    this.net[id] = null;
    g.remote = false;
    g.brain = makeBrain(skill, id);
  }

  /** Distance along the unit direction d until a wall blocks the way (at most len). */
  probe(self: number, p: V3, d: V3, len: number): number {
    const ex = p.x + d.x * len;
    const ey = p.y + d.y * len;
    const ez = p.z + d.z * len;
    const m = WALL_HALF * BIG_WALL + 0.5;
    const cand = this.cand;
    cand.clear();
    this.hash.query(
      Math.min(p.x, ex) - m,
      Math.min(p.y, ey) - m,
      Math.min(p.z, ez) - m,
      Math.max(p.x, ex) + m,
      Math.max(p.y, ey) + m,
      Math.max(p.z, ez) + m,
      cand,
    );
    let best = 1;
    const c = this.corners;
    for (const id of cand) {
      const owner = (id / SEG_SHIFT) | 0;
      const seg = id - owner * SEG_SHIFT;
      const tr = this.trails[owner];
      if (owner === self && seg > tr.count - 2 - SELF_SKIP) continue;
      if (this.teams && this.gliders[owner].team === this.gliders[self].team) continue;
      // Plan with the full height: a young wall piece is still growing.
      quadCorners(tr, seg, c, this.tick + TAPER_TICKS);
      const t = segQuad(p.x, p.y, p.z, d.x * len, d.y * len, d.z * len, c);
      if (t >= 0 && t < best) best = t;
    }
    const keep = (BOLT_RADIUS + 2) * (BOLT_RADIUS + 2);
    for (const b of this.bolts) {
      if (this.tick > b.endTick) continue;
      for (let k = 0; k < b.x.length - 1; k++) {
        const d2 = segSegDistSq(p.x, p.y, p.z, ex, ey, ez, b.x[k], b.y[k], b.z[k], b.x[k + 1], b.y[k + 1], b.z[k + 1]);
        if (d2 < keep) {
          const t = ((b.x[k] - p.x) * d.x + (b.y[k] - p.y) * d.y + (b.z[k] - p.z) * d.z) / len;
          const tt = t < 0 ? 0 : t;
          if (tt < best) best = tt;
        }
      }
    }
    return best * len;
  }

  /** Flight factors for this tick: ship, afterburner and turbo. */
  private updateMods(g: Glider): void {
    const ship = g.ship;
    const m = g.mods;
    const burner = ship.special.kind === 'afterburner' && this.tick < g.specialUntil;
    m.turn = ship.turn * (burner ? 1.2 : 1);
    m.roll = ship.roll;
    m.cruise = ship.cruise;
    m.boost = ship.boost * (burner ? 1.3 : 1);
    m.forceBoost = burner;
    m.drain = g.power === 'turbo' ? 0 : 1;
    m.slip = ship.slip;
  }

  /** Uses the ship's special ability if it is ready. */
  private useSpecial(g: Glider): void {
    if (this.phase !== 'flying' || this.tick < g.specialReady) return;
    const sp = g.ship.special;
    g.specialReady = this.tick + sp.cooldown;
    g.specialUntil = this.tick + sp.duration;
    if (sp.kind === 'burst') this.fan(g, BURST_FAN, false);
    else if (sp.kind === 'shockwave') this.shockwave(g.id, g.p.x, g.p.y, g.p.z, this.events);
    this.events.push({ type: 'special', id: g.id, kind: sp.kind });
  }

  /**
   * Bulwark shockwave around (x, y, z): enemy shots there vanish, and the guns of
   * enemy gliders this device flies are jammed. Events go to out.
   */
  private shockwave(owner: number, x: number, y: number, z: number, out: SimEvent[]): void {
    const r2 = SHOCKWAVE_RADIUS * SHOCKWAVE_RADIUS;
    const team = this.gliders[owner].team;
    const enemy = (id: number) => id !== owner && !(this.teams && this.gliders[id].team === team);
    for (const s of this.shots) {
      if (!s.alive || !enemy(s.owner)) continue;
      const dx = s.p.x - x;
      const dy = s.p.y - y;
      const dz = s.p.z - z;
      if (dx * dx + dy * dy + dz * dz < r2) s.alive = false;
    }
    for (const g of this.gliders) {
      if (!g.alive || g.remote || !enemy(g.id)) continue;
      const dx = g.p.x - x;
      const dy = g.p.y - y;
      const dz = g.p.z - z;
      if (dx * dx + dy * dy + dz * dz >= r2) continue;
      g.jamUntil = this.tick + JAM_TICKS;
      g.heat = 1;
      g.overheated = true;
      out.push({ type: 'jam', id: g.id });
    }
  }

  /** Cools the gun and fires while the trigger is held. */
  private gun(g: Glider, fire: boolean): void {
    if (g.heat > 0) {
      g.heat -= GUN.cool * DT;
      if (g.heat < 0) g.heat = 0;
    }
    if (g.overheated && g.heat <= GUN.unlock && this.tick >= g.jamUntil) g.overheated = false;
    if (!fire || g.overheated || this.phase !== 'flying' || this.tick < g.jamUntil) return;
    const rapid = g.power === 'rapid';
    if (this.tick - g.lastShot < (rapid ? RAPID_INTERVAL : GUN.interval)) return;
    g.lastShot = this.tick;
    if (!rapid) {
      g.heat += GUN.heatPerShot * g.ship.heat;
      if (g.heat >= 1) {
        g.heat = 1;
        g.overheated = true;
        this.events.push({ type: 'overheat', id: g.id });
      }
    }
    this.fan(g, g.power === 'triple' ? TRIPLE_FAN : [0], g.power === 'seeker');
  }

  /** Fires one shot per angle (radians to the side) from the nose of g. */
  private fan(g: Glider, angles: readonly number[], seek: boolean): void {
    g.q.rotate(AXIS_FWD, tmpA);
    g.q.rotate(AXIS_LEFT, tmpB);
    const fx = tmpA.x;
    const fy = tmpA.y;
    const fz = tmpA.z;
    const lx = tmpB.x;
    const ly = tmpB.y;
    const lz = tmpB.z;
    for (const a of angles) {
      const c = a === 0 ? 1 : dcos(a);
      const sn = a === 0 ? 0 : dsin(a);
      const dx = fx * c - lx * sn;
      const dy = fy * c - ly * sn;
      const dz = fz * c - lz * sn;
      const key = g.id * SHOT_KEY + (g.shots++ % SHOT_KEY);
      this.spawnShot(g.id, key, g.p.x + fx * GUN.muzzle, g.p.y + fy * GUN.muzzle, g.p.z + fz * GUN.muzzle, dx, dy, dz, seek);
      this.events.push({ type: 'shot', id: g.id, shot: key });
    }
  }

  private spawnShot(owner: number, key: number, px: number, py: number, pz: number, dx: number, dy: number, dz: number, seek: boolean): void {
    const p = new V3(px, py, pz);
    const speed = GUN.speed * this.gliders[owner].ship.shotSpeed;
    this.shots.push({ key, owner, p, pPrev: p.clone(), d: new V3(dx, dy, dz), born: this.tick, speed, seek, alive: true });
  }

  /**
   * Moves the shots: they curve a little towards a glider in front of them,
   * fly through walls and fizzle at the arena shield. A device only decides
   * hits on the gliders it flies itself.
   */
  private updateShots(R: number, pending: { id: number; crash: CrashInfo }[]): void {
    const arena = this.spec.arena;
    const range2 = GUN.homingRange * GUN.homingRange;
    const hit2 = GUN.hitRadius * GUN.hitRadius;
    for (let k = this.shots.length - 1; k >= 0; k--) {
      const s = this.shots[k];
      if (!s.alive || this.tick - s.born > GUN.life) {
        this.shots.splice(k, 1);
        continue;
      }
      const ownerTeam = this.gliders[s.owner].team;
      let best = -1;
      let bestDot: number = s.seek ? SEEKER_CONE : GUN.homingCone;
      for (const g of this.gliders) {
        if (!g.alive || g.id === s.owner || (this.teams && g.team === ownerTeam)) continue;
        let rx = g.p.x - s.p.x;
        let ry = g.p.y - s.p.y;
        let rz = g.p.z - s.p.z;
        let d2 = rx * rx + ry * ry + rz * rz;
        if (d2 > range2 || d2 < 1e-6) continue;
        if (this.phasing(g)) continue;
        // Aim where the glider will be when the shot gets there.
        const lead = (Math.sqrt(d2) / s.speed) * g.speed;
        g.q.rotate(AXIS_FWD, tmpNear);
        rx += tmpNear.x * lead;
        ry += tmpNear.y * lead;
        rz += tmpNear.z * lead;
        d2 = rx * rx + ry * ry + rz * rz;
        if (d2 < 1e-6) continue;
        const inv = 1 / Math.sqrt(d2);
        const dot = (rx * s.d.x + ry * s.d.y + rz * s.d.z) * inv;
        if (dot > bestDot) {
          bestDot = dot;
          best = g.id;
          tmpB.set(rx * inv, ry * inv, rz * inv);
        }
      }
      if (best >= 0) {
        const k2 = s.seek ? GUN.homing * SEEKER_HOMING : GUN.homing;
        s.d.x += (tmpB.x - s.d.x) * k2;
        s.d.y += (tmpB.y - s.d.y) * k2;
        s.d.z += (tmpB.z - s.d.z) * k2;
        s.d.normalize();
      }
      s.pPrev.copy(s.p);
      s.p.addScaled(s.d, s.speed * DT);
      if (boundaryHit(arena, R, s.p) || (this.obstacles.length && this.obstacleDist(s.p.x, s.p.y, s.p.z) < 0)) {
        s.alive = false;
        continue;
      }
      // Closest approach of the shot's path in this tick to each glider it may hit.
      const ax = s.pPrev.x;
      const ay = s.pPrev.y;
      const az = s.pPrev.z;
      const bx = s.p.x - ax;
      const by = s.p.y - ay;
      const bz = s.p.z - az;
      const len2 = bx * bx + by * by + bz * bz;
      for (const g of this.gliders) {
        if (!g.alive || g.remote || g.id === s.owner || (this.teams && g.team === ownerTeam) || this.phasing(g)) continue;
        const px = g.p.x - ax;
        const py = g.p.y - ay;
        const pz = g.p.z - az;
        let t = len2 > 0 ? (px * bx + py * by + pz * bz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - bx * t;
        const dy = py - by * t;
        const dz = pz - bz * t;
        if (dx * dx + dy * dy + dz * dz > hit2) continue;
        s.alive = false;
        if (g.shield) {
          // The shield takes the hit and is gone.
          this.dropShield(g);
          this.events.push({ type: 'hit', id: g.id, by: s.owner, shot: s.key, hull: g.hull, shield: true });
          break;
        }
        g.hull--;
        g.energy = g.energy > GUN.energyHit ? g.energy - GUN.energyHit : 0;
        this.gliders[s.owner].hits++;
        this.events.push({ type: 'hit', id: g.id, by: s.owner, shot: s.key, hull: g.hull, shield: false });
        if (g.hull <= 0 && !pending.some((x) => x.id === g.id)) pending.push({ id: g.id, crash: { kind: 'shot', by: s.owner, seg: -1 } });
        break;
      }
    }
  }

  private addSample(g: Glider): void {
    const tr = this.trails[g.id];
    if (tr.count >= SEG_SHIFT - 1) return;
    tailPoint(g, tmpA);
    g.q.rotate(AXIS_UP, tmpB);
    tr.add(tmpA, tmpB, this.tick, g.power === 'bigwall' ? WALL_HALF * BIG_WALL : WALL_HALF);
    const n = tr.count;
    if (n >= 2) {
      const seg = n - 2;
      const b = this.bounds;
      segmentBounds(tr, seg, 0.1, b);
      this.hash.insert(g.id * SEG_SHIFT + seg, b[0], b[1], b[2], b[3], b[4], b[5]);
    }
  }

  private collide(g: Glider, R: number): CrashInfo | null {
    const p = g.p;
    const o = g.pPrev;
    g.q.rotate(AXIS_LEFT, tmpA);
    const wx = tmpA.x * WING_PROBE;
    const wy = tmpA.y * WING_PROBE;
    const wz = tmpA.z * WING_PROBE;
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    const dz = p.z - o.z;
    const r = QUERY_RADIUS;
    const cand = this.cand;
    cand.clear();
    this.hash.query(p.x - r, p.y - r, p.z - r, p.x + r, p.y + r, p.z + r, cand);
    const wallsHurt = !this.phasing(g) && this.tick >= g.ghostUntil;

    let hitT = 2;
    let hitBy = -1;
    let hitId = -1;
    let hitSeg = -1;
    let nearD2 = FLIGHT.slipRange * FLIGHT.slipRange;
    let hasNear = false;
    const c = this.corners;
    for (const id of cand) {
      const owner = (id / SEG_SHIFT) | 0;
      const seg = id - owner * SEG_SHIFT;
      const tr = this.trails[owner];
      const newest = tr.count - 2;
      const own = owner === g.id;
      if (own && seg > newest - SELF_SKIP) continue;
      // In team games your own team's walls let you through.
      if (this.teams && this.gliders[owner].team === g.team) continue;
      quadCorners(tr, seg, c, this.tick);
      let t = segQuad(o.x, o.y, o.z, dx, dy, dz, c);
      const t2 = segQuad(o.x + wx, o.y + wy, o.z + wz, dx, dy, dz, c);
      if (t2 >= 0 && (t < 0 || t2 < t)) t = t2;
      const t3 = segQuad(o.x - wx, o.y - wy, o.z - wz, dx, dy, dz, c);
      if (t3 >= 0 && (t < 0 || t3 < t)) t = t3;
      if (t >= 0 && (t < hitT || (t === hitT && id < hitId))) {
        hitT = t;
        hitBy = owner;
        hitId = id;
        hitSeg = seg;
      }
      if (!(own && seg > newest - SELF_SLIP_SKIP)) {
        const d2 = wallDistSq(p, tr, seg, tmpNear, this.tick);
        if (d2 < nearD2) {
          nearD2 = d2;
          g.near.copy(tmpNear);
          hasNear = true;
        }
      }
    }
    g.hasNear = hasNear;
    g.wallDist = hasNear ? Math.sqrt(nearD2) : 1e9;
    if (hasNear) {
      const e = g.energy + FLIGHT.slipRegen * g.mods.slip * (1 - g.wallDist / FLIGHT.slipRange);
      g.energy = e > 1 ? 1 : e;
    }
    if (hitId >= 0 && wallsHurt) {
      if (!g.shield) return { kind: 'wall', by: hitBy, seg: hitSeg };
      // The shield takes the wall: fly on, the wall cannot hurt you for a moment.
      this.dropShield(g);
      g.ghostUntil = this.tick + SHIELD_GHOST;
      this.events.push({ type: 'shield', id: g.id });
    }

    const br2 = BOLT_RADIUS * BOLT_RADIUS;
    for (const b of this.bolts) {
      if (this.tick < b.strikeTick || this.tick >= b.endTick) continue;
      for (let k = 0; k < b.x.length - 1; k++) {
        const d2 = segSegDistSq(o.x, o.y, o.z, p.x, p.y, p.z, b.x[k], b.y[k], b.z[k], b.x[k + 1], b.y[k + 1], b.z[k + 1]);
        if (d2 < br2) return { kind: 'lightning', by: -1, seg: -1 };
      }
    }

    const core = this.spec.core;
    if (core && p.lengthSq() < core.radius * core.radius) return { kind: 'core', by: -1, seg: -1 };

    if (this.obstacles.length && !this.phasing(g) && this.obstacleDist(p.x, p.y, p.z) < OBSTACLE_HIT) {
      return { kind: 'obstacle', by: -1, seg: this.nearestObstacle };
    }

    const kind = boundaryHit(this.spec.arena, R, p);
    return kind ? { kind, by: -1, seg: -1 } : null;
  }

  private applyCrashes(list: { id: number; crash: CrashInfo }[]): void {
    const place = this.aliveCount() - list.length + 1;
    for (const c of list) {
      const g = this.gliders[c.id];
      g.alive = false;
      g.crashTick = this.tick;
      g.crash = c.crash;
      g.place = place;
      g.boosting = false;
      this.events.push({ type: 'crash', id: c.id, crash: c.crash });
    }
  }

  /**
   * Places ring k for the ring.count-th time. Position and power-up only depend
   * on the seed, k and count, so every device places it the same way.
   */
  private placeRing(ring: Ring, k: number): void {
    const arena = this.spec.arena;
    const rng = new Rng(ringHash(this.seed, k, ring.count));
    const R = arena.minRadius * 0.85;
    const top = Math.min(30, arena.ceilY - 15);
    // A few tries to keep the ring clear of obstacles.
    for (let tries = 0; tries < 8; tries++) {
      const a = rng.range(0, TWO_PI);
      const r = Math.sqrt(rng.next()) * R;
      const y = rng.range(arena.floorY + 18, top);
      ring.c.set(dcos(a) * r, y, dsin(a) * r);
      if (this.obstacleDist(ring.c.x, ring.c.y, ring.c.z) > RING_RADIUS + 5) break;
    }
    const b = rng.range(0, TWO_PI);
    ring.n.set(dcos(b), 0, dsin(b));
    ring.power = POWER_ORDER[rng.int(POWER_ORDER.length)];
  }

  /** Gives glider g a power-up (repair is used at once, the others last a while). */
  private applyPower(g: Glider, power: PowerId): void {
    const e = g.energy + FLIGHT.ringBoost;
    g.energy = e > 1 ? 1 : e;
    if (power === 'repair') {
      if (g.hull < g.ship.hull) g.hull++;
      g.energy = 1;
      return;
    }
    if (g.power === 'shield' && power !== 'shield') g.shield = false;
    g.power = power;
    g.powerUntil = this.tick + POWERS[power].duration;
    if (power === 'shield') g.shield = true;
  }

  private dropShield(g: Glider): void {
    g.shield = false;
    if (g.power === 'shield') g.power = null;
  }

  private updateRings(): void {
    const r2 = RING_RADIUS * RING_RADIUS;
    for (let k = 0; k < this.rings.length; k++) {
      const ring = this.rings[k];
      if (!ring.active) {
        if (this.tick >= ring.respawnTick) {
          ring.count++;
          this.placeRing(ring, k);
          ring.active = true;
        }
        continue;
      }
      const c = ring.c;
      const n = ring.n;
      for (const g of this.gliders) {
        // Each device only decides about the gliders it flies itself.
        if (!g.alive || g.remote) continue;
        const sa = (g.pPrev.x - c.x) * n.x + (g.pPrev.y - c.y) * n.y + (g.pPrev.z - c.z) * n.z;
        const sb = (g.p.x - c.x) * n.x + (g.p.y - c.y) * n.y + (g.p.z - c.z) * n.z;
        if (!((sa <= 0 && sb > 0) || (sa >= 0 && sb < 0))) continue;
        const t = sa / (sa - sb);
        const ix = g.pPrev.x + (g.p.x - g.pPrev.x) * t - c.x;
        const iy = g.pPrev.y + (g.p.y - g.pPrev.y) * t - c.y;
        const iz = g.pPrev.z + (g.p.z - g.pPrev.z) * t - c.z;
        if (ix * ix + iy * iy + iz * iz > r2) continue;
        g.rings++;
        this.applyPower(g, ring.power);
        ring.active = false;
        ring.respawnTick = this.tick + RING_RESPAWN;
        this.events.push({ type: 'power', id: g.id, power: ring.power, ring: k, n: ring.count });
        break;
      }
    }
  }

  private updateBolts(R: number): void {
    for (let k = this.bolts.length - 1; k >= 0; k--) {
      if (this.tick >= this.bolts[k].endTick) this.bolts.splice(k, 1);
    }
    for (const b of this.bolts) {
      if (b.strikeTick === this.tick) this.events.push({ type: 'bolt-strike', bolt: b.id });
    }
    if (this.flyTicks < this.nextBoltFly) return;
    const rng = this.online ? this.boltRng : this.rng;
    this.nextBoltFly = this.flyTicks + 150 + rng.int(180);
    const arena = this.spec.arena;
    const a = rng.range(0, TWO_PI);
    const r = Math.sqrt(rng.next()) * R * 0.85;
    let x = dcos(a) * r;
    let z = dsin(a) * r;
    const top = arena.ceilY + 12;
    const bottom = arena.floorY - 6;
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const N = 9;
    for (let k = 0; k < N; k++) {
      xs.push(x);
      ys.push(top + ((bottom - top) * k) / (N - 1));
      zs.push(z);
      x += rng.range(-4, 4);
      z += rng.range(-4, 4);
    }
    const bolt: Bolt = {
      id: this.boltSeq++,
      x: xs,
      y: ys,
      z: zs,
      warnTick: this.tick,
      strikeTick: this.tick + 48,
      endTick: this.tick + 48 + 3 * TICK_RATE,
    };
    this.bolts.push(bolt);
    this.events.push({ type: 'bolt-warn', bolt: bolt.id });
  }

  /** Compact text fingerprint of the state, used by tests. */
  fingerprint(): string {
    return this.gliders
      .map((g) => `${g.alive ? 1 : 0}:${g.p.x},${g.p.y},${g.p.z}:${g.q.x},${g.q.y},${g.q.z},${g.q.w}:${g.energy}`)
      .join('|');
  }
}
