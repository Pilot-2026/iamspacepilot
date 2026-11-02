import { describe, expect, it } from 'vitest';
import { GUN } from '../src/core/config';
import { Quat, V3 } from '../src/core/math';
import type { CrashInfo, PilotInput } from '../src/core/types';
import type { World } from '../src/core/world';
import { boardRows } from '../src/online/board';
import type { RadioEntry } from '../src/online/livekit';
import { MicGesture } from '../src/ui/mic';
import { nextLevel } from '../src/core/levels';
import { ARENA_GAP_MS, GAME_VERSION, NEXT_ROUND_MS, OnlineMatch, type MatchSettings, type Msg, type Peer, type RoundResult, type Transport } from '../src/online/match';

/** In-memory network: every message is JSON encoded like on the real wire and delivered on deliver(). */
class FakeNet {
  readonly nodes = new Map<string, Node>();
  time = 0;
  private seq = 0;

  join(identity: string, settings: Partial<MatchSettings> = {}): Node {
    const node = new Node(this, { identity, name: identity, joinedAt: ++this.seq });
    node.match = new OnlineMatch(
      node,
      { name: identity, assist: true, ship: 'trident' },
      { level: 'cloud-sea', mode: 'ffa', bots: 2, difficulty: 'rookie', ...settings },
      node.callbacks(),
      () => this.time,
    );
    this.nodes.set(identity, node);
    for (const n of this.nodes.values()) if (n !== node && n.started) n.match.peersChanged();
    node.match.start();
    node.started = true;
    return node;
  }

  leave(identity: string): void {
    this.nodes.delete(identity);
    for (const n of this.nodes.values()) n.match.peersChanged();
  }

  peers(): Peer[] {
    return [...this.nodes.values()].map((n) => n.peer);
  }

  /** Delivers queued messages until the network is quiet. */
  deliver(): void {
    for (let guard = 0; guard < 50; guard++) {
      let any = false;
      for (const n of this.nodes.values()) {
        const inbox = n.inbox.splice(0);
        for (const { from, data } of inbox) {
          any = true;
          n.bytes += data.length;
          n.match.receive(from, JSON.parse(data) as Msg);
        }
      }
      if (!any) return;
    }
  }
}

class Node implements Transport {
  match!: OnlineMatch;
  started = false;
  readonly inbox: { from: string; data: string }[] = [];
  bytes = 0;
  maxMessage = 0;
  rounds: World[] = [];
  results: RoundResult[] = [];
  crashes: { id: number; crash: CrashInfo }[] = [];
  mismatch: string[] = [];
  swaps: { id: number; ship: string }[] = [];
  arenas: { name: string; level: string }[] = [];
  lobbies = 0;

  constructor(
    private readonly net: FakeNet,
    readonly peer: Peer,
  ) {}

  get self(): string {
    return this.peer.identity;
  }

  peers(): Peer[] {
    return this.net.peers();
  }

  send(msg: Msg): void {
    const data = JSON.stringify(msg);
    this.maxMessage = Math.max(this.maxMessage, data.length);
    for (const n of this.net.nodes.values()) if (n !== this) n.inbox.push({ from: this.self, data });
  }

  callbacks() {
    return {
      onLobby: () => void this.lobbies++,
      onRoundStart: (w: World) => void this.rounds.push(w),
      onRoundEnd: (r: RoundResult) => void this.results.push(r),
      onCrash: (id: number, crash: CrashInfo) => void this.crashes.push({ id, crash }),
      onVersionMismatch: (name: string) => void this.mismatch.push(name),
      onShipSwap: (id: number, ship: string) => void this.swaps.push({ id, ship }),
      onArena: (name: string, level: string) => void this.arenas.push({ name, level }),
    };
  }
}

const GENTLE: PilotInput = { steerX: 0.35, steerY: 0, roll: 0, boost: false };

/** Steps every device once per tick; the network delivers every `lag` ticks. */
function fly(net: FakeNet, ticks: number, input: (n: Node, t: number) => PilotInput = () => GENTLE, lag = 2): void {
  for (let t = 0; t < ticks; t++) {
    for (const n of net.nodes.values()) n.match.step(input(n, t));
    net.time += 1000 / 60;
    for (const n of net.nodes.values()) n.match.update();
    if (t % lag === 0) net.deliver();
  }
  net.deliver();
}

describe('online match', () => {
  it('elects the first pilot as host and shares the lobby', () => {
    const net = new FakeNet();
    const a = net.join('Alpha', { level: 'orbit', bots: 3 });
    const b = net.join('Bravo');
    net.deliver();
    expect(a.match.isHost).toBe(true);
    expect(b.match.isHost).toBe(false);
    expect(b.match.hostIdentity).toBe('Alpha');
    expect(b.match.settings.level).toBe('orbit');
    expect(b.match.settings.bots).toBe(3);
    expect(b.match.hostName()).toBe('Alpha');
  });

  it('starts the same round on every device and keeps remote gliders in sync', () => {
    const net = new FakeNet();
    const a = net.join('Alpha');
    const b = net.join('Bravo');
    net.deliver();
    a.match.startRound();
    net.deliver();
    const wa = a.match.world!;
    const wb = b.match.world!;
    expect(wb).toBeTruthy();
    expect(b.match.pilots.map((p) => p.name)).toEqual(a.match.pilots.map((p) => p.name));
    expect(a.match.local).toBe(0);
    expect(b.match.local).toBe(1);
    expect(wa.gliders.map((g) => g.remote)).toEqual([false, true, false, false]);
    expect(wb.gliders.map((g) => g.remote)).toEqual([true, false, true, true]);

    fly(net, 180 + 120, (n, t) => ({ steerX: n === a ? 0.3 : -0.25, steerY: Math.sin(t * 0.03) * 0.2, roll: 0, boost: false }));
    for (let i = 0; i < 4; i++) {
      if (!wa.gliders[i].alive || !wb.gliders[i].alive) continue;
      // Remote copies follow the real glider closely.
      const owner = i === 1 ? wb : wa;
      const copy = i === 1 ? wa : wb;
      expect(Math.sqrt(owner.gliders[i].p.distSq(copy.gliders[i].p))).toBeLessThan(3);
      // Walls arrive complete and identical (to the millimetre).
      const to = owner.trails[i];
      const tc = copy.trails[i];
      expect(to.count - tc.count).toBeLessThanOrEqual(2);
      for (let k = 0; k < tc.count; k++) {
        expect(Math.abs(tc.px[k] - to.px[k])).toBeLessThan(0.002);
        expect(Math.abs(tc.uy[k] - to.uy[k])).toBeLessThan(0.002);
      }
    }
    // Messages stay far below the LiveKit data packet limit.
    expect(a.maxMessage).toBeLessThan(4000);
    expect(b.maxMessage).toBeLessThan(4000);
  });

  it('lets a pilot alone in a game fly on until they crash', () => {
    const net = new FakeNet();
    const a = net.join('Alpha', { bots: 0, difficulty: 'pilot' });
    net.deliver();
    a.match.startRound();
    net.deliver();
    // Ten seconds of calm flying: no winner, the round goes on.
    fly(net, 180 + 600);
    expect(a.results).toHaveLength(0);
    expect(a.match.world!.gliders[0].alive).toBe(true);
    // Diving into the floor ends it.
    for (let k = 0; k < 40 && a.results.length === 0; k++) fly(net, 300, () => ({ steerX: 0, steerY: -1, roll: 0, boost: true }));
    expect(a.results).toHaveLength(1);
  });

  it('reports crashes to everyone, ends the round on the host and starts the next one', () => {
    const net = new FakeNet();
    // Normal speed: at Rookie pace the dive below would only loop.
    const a = net.join('Alpha', { bots: 1, difficulty: 'pilot' });
    const b = net.join('Bravo');
    net.deliver();
    a.match.startRound();
    net.deliver();
    // Bravo dives into the sea of clouds.
    fly(net, 180 + 600, (n) => (n === b ? { steerX: 0, steerY: -1, roll: 0, boost: true } : GENTLE));
    const wa = a.match.world!;
    expect(b.match.world!.gliders[1].alive).toBe(false);
    expect(wa.gliders[1].alive).toBe(false);
    expect(wa.gliders[1].crash?.kind).toBe(b.match.world!.gliders[1].crash?.kind);
    expect(a.crashes.some((c) => c.id === 1)).toBe(true);

    // Alpha flies on until the round is over (bot down, or Alpha down).
    for (let k = 0; k < 40 && a.results.length === 0; k++) fly(net, 300, () => ({ steerX: 0, steerY: -1, roll: 0, boost: false }));
    expect(a.results).toHaveLength(1);
    expect(b.results).toHaveLength(1);
    expect(b.results[0].places).toEqual(a.results[0].places);
    expect(b.results[0].winner).toBe(a.results[0].winner);
    expect(a.match.flying).toBe(false);
    expect(b.match.secondsToNext()).toBeGreaterThan(0);

    // The host starts round 2 by itself after the break.
    net.time += NEXT_ROUND_MS + 10;
    a.match.update();
    net.deliver();
    expect(a.match.round).toBe(2);
    expect(b.match.round).toBe(2);
    expect(b.rounds).toHaveLength(2);
    expect(b.match.flying).toBe(true);
  });

  it('lets a pilot who joins during a round fly the next one', () => {
    const net = new FakeNet();
    const a = net.join('Alpha', { bots: 1 });
    net.deliver();
    a.match.startRound();
    fly(net, 60);
    const c = net.join('Charlie');
    net.deliver();
    expect(c.match.world).toBeNull();
    expect(c.match.round).toBe(1);
    // Ignores state of a round it is not part of.
    fly(net, 60);
    expect(c.match.world).toBeNull();
    a.match.startRound();
    net.deliver();
    expect(c.match.local).toBe(1);
    expect(c.match.pilots.map((p) => p.bot)).toEqual([false, false, true]);
  });

  it('hands the game to the next pilot when the host leaves', () => {
    const net = new FakeNet();
    const a = net.join('Alpha', { bots: 2 });
    const b = net.join('Bravo');
    const c = net.join('Charlie');
    net.deliver();
    a.match.startRound();
    net.deliver();
    fly(net, 180 + 60);
    net.leave('Alpha');
    net.deliver();
    expect(b.match.isHost).toBe(true);
    expect(c.match.hostIdentity).toBe('Bravo');
    const wb = b.match.world!;
    const wc = c.match.world!;
    // Alpha's glider drops out on every device.
    expect(wb.gliders[0].alive).toBe(false);
    expect(wb.gliders[0].crash?.kind).toBe('left');
    expect(wc.gliders[0].alive).toBe(false);
    // Bravo flies the bots now; Charlie still sees them move.
    expect(wb.gliders[3].remote).toBe(false);
    expect(wb.gliders[3].brain).not.toBeNull();
    const before = wc.gliders[3].p.clone();
    fly(net, 60);
    if (wc.gliders[3].alive) expect(Math.sqrt(before.distSq(wc.gliders[3].p))).toBeGreaterThan(5);
    // And Bravo now ends rounds and starts new ones.
    for (let k = 0; k < 40 && b.results.length === 0; k++) fly(net, 300, () => ({ steerX: 0, steerY: -1, roll: 0, boost: false }));
    expect(b.results).toHaveLength(1);
    expect(c.results).toHaveLength(1);
    net.time += NEXT_ROUND_MS + 10;
    b.match.update();
    net.deliver();
    expect(c.match.round).toBe(2);
    expect(c.match.pilots.map((p) => p.name).slice(0, 2)).toEqual(['Bravo', 'Charlie']);
  });

  it('plays team games: teammates share walls, teams alternate', () => {
    const net = new FakeNet();
    const a = net.join('Alpha', { mode: 'teams', bots: 2 });
    const b = net.join('Bravo');
    net.deliver();
    a.match.startRound();
    net.deliver();
    expect(b.match.pilots.map((p) => p.team)).toEqual([0, 1, 0, 1]);
    const wb = b.match.world!;
    expect(wb.teams).toBe(true);
    expect(wb.gliders.map((g) => g.team)).toEqual([0, 1, 0, 1]);
  });

  it('ignores crash and position reports from devices that do not fly that glider', () => {
    const net = new FakeNet();
    const a = net.join('Alpha', { bots: 1 });
    const b = net.join('Bravo');
    net.join('Charlie');
    net.deliver();
    a.match.startRound();
    net.deliver();
    fly(net, 200);
    const wa = a.match.world!;
    // Charlie claims that Bravo crashed, and that the bot is somewhere else.
    a.match.receive('Charlie', { t: 'c', r: 1, id: 1, k: 'wall', by: 2 });
    a.match.receive('Charlie', { t: 's', r: 1, g: [3, 0, 0, 0, 0, 0, 0, 1, 24, 0.5, 0], w: [] });
    expect(wa.gliders[1].alive).toBe(true);
    expect(Math.abs(wa.gliders[3].p.x) + Math.abs(wa.gliders[3].p.z)).toBeGreaterThan(5);
    // Garbage numbers are dropped as a whole.
    b.match.receive('Alpha', { t: 's', r: 1, g: [0, NaN, 0, 0, 0, 0, 0, 1, 24, 0.5, 0], w: [] } as Msg);
    expect(Number.isFinite(b.match.world!.gliders[0].p.x)).toBe(true);
    // A crash report for a glider that does not exist changes nothing.
    a.match.receive('Bravo', { t: 'c', r: 1, id: 9, k: 'wall', by: 0 });
    expect(wa.aliveCount()).toBe(4);
  });

  it('drops a pilot out of the round on request and tells everyone', () => {
    const net = new FakeNet();
    const a = net.join('Alpha', { bots: 1 });
    const b = net.join('Bravo');
    net.deliver();
    a.match.startRound();
    net.deliver();
    fly(net, 200);
    b.match.dropOut();
    net.deliver();
    expect(b.match.world!.gliders[1].alive).toBe(false);
    expect(a.match.world!.gliders[1].alive).toBe(false);
    expect(a.match.world!.gliders[1].crash?.kind).toBe('left');
  });

  it('gives a team game cut short to the team with more gliders in the air', () => {
    const net = new FakeNet();
    const a = net.join('Alpha', { mode: 'teams', bots: 3 });
    net.deliver();
    a.match.startRound();
    fly(net, 200);
    const w = a.match.world!;
    // Alpha (team 0) drops out: no person flies, the round ends at once.
    a.match.dropOut();
    fly(net, 2);
    expect(a.results).toHaveLength(1);
    const alive = w.gliders.filter((g) => g.alive);
    const t0 = alive.filter((g) => g.team === 0).length;
    const t1 = alive.filter((g) => g.team === 1).length;
    expect(a.results[0].team).toBe(t0 > t1 ? 0 : t1 > t0 ? 1 : -1);
  });

  it('shows shots on every device; the device of the target decides hits and shoot-downs', () => {
    const net = new FakeNet();
    const a = net.join('Alpha', { bots: 0 });
    const b = net.join('Bravo');
    net.deliver();
    a.match.startRound();
    net.deliver();
    fly(net, 180);
    // Each device puts its own glider on the line: Alpha behind Bravo, both flying +Z.
    const put = (w: World, i: number, z: number) => {
      const g = w.gliders[i];
      g.p.set(0, 0, z);
      g.pPrev.set(0, 0, z);
      g.qb.copy(new Quat());
      g.q.copy(new Quat());
      g.bank = 0;
    };
    put(a.match.world!, 0, -30);
    put(b.match.world!, 1, 20);
    // Random round seeds place bonus rings anywhere: keep them out of the line of fire.
    for (const w of [a.match.world!, b.match.world!]) {
      for (const r of w.rings) {
        r.active = false;
        r.respawnTick = 1e9;
      }
    }
    const straight: PilotInput = { steerX: 0, steerY: 0, roll: 0, boost: false };
    fly(net, 6, () => straight, 1);
    // Only Bravo's device may report hits on Bravo's glider.
    a.match.receive('Mallory', { t: 'h', r: 1, id: 1, by: 0, k: 5, hull: 0, sh: 0 });
    expect(a.match.world!.gliders[1].hull).toBe(GUN.hull);
    let seen = 0;
    for (let k = 0; k < 3; k++) {
      fly(net, 1, (n) => (n === a ? { ...straight, fire: true } : straight), 1);
      for (let t = 0; t < 14; t++) {
        fly(net, 1, () => straight, 1);
        seen += b.match.world!.events.filter((e) => e.type === 'shot' && e.id === 0).length;
      }
    }
    fly(net, 90, () => straight, 1);
    expect(seen).toBe(3);
    const wa = a.match.world!;
    const wb = b.match.world!;
    expect(wb.gliders[1].crash).toMatchObject({ kind: 'shot', by: 0 });
    expect(wa.gliders[1].alive).toBe(false);
    expect(wa.gliders[1].crash).toMatchObject({ kind: 'shot', by: 0 });
    expect(wa.gliders[0].hits).toBe(GUN.hull);
  });

  it('flies the ship each pilot picked; specials and ring bonuses reach everyone', () => {
    const net = new FakeNet();
    const a = net.join('Alpha', { bots: 0 });
    const b = net.join('Bravo');
    net.deliver();
    b.match.setShip('halo');
    net.deliver();
    expect(a.match.shipOf('Bravo')).toBe('halo');
    a.match.startRound();
    net.deliver();
    const wa = a.match.world!;
    const wb = b.match.world!;
    expect(wa.gliders[1].ship.id).toBe('halo');
    expect(wb.gliders[1].ship.id).toBe('halo');
    expect(wb.gliders[0].ship.id).toBe('trident');
    // Rings are placed the same way on both devices.
    expect(wb.rings.map((r) => [r.c.x, r.c.z, r.power])).toEqual(wa.rings.map((r) => [r.c.x, r.c.z, r.power]));
    fly(net, 180);
    // Bravo phases: Alpha's device knows.
    fly(net, 1, (n) => (n === b ? { steerX: 0, steerY: 0, roll: 0, boost: false, special: true } : GENTLE), 1);
    net.deliver();
    expect(wa.phasing(wa.gliders[1])).toBe(true);
    // Bravo flies through a ring on its own device: Alpha sees the ring taken and Bravo powered up.
    const put = wb.gliders[1];
    const ringB = wb.rings[0];
    put.q.rotate(new V3(0, 0, 1), ringB.n);
    ringB.c.copy(put.p).addScaled(ringB.n, 3);
    wa.rings[0].c.copy(ringB.c);
    wa.rings[0].n.copy(ringB.n);
    fly(net, 20, () => ({ steerX: 0, steerY: 0, roll: 0, boost: false }), 1);
    net.deliver();
    expect(wb.rings[0].active).toBe(false);
    expect(wa.rings[0].active).toBe(false);
    expect(wa.gliders[1].rings).toBe(1);
    const power = wb.gliders[1].power;
    if (power) expect(wa.gliders[1].power).toBe(power);
  });

  it('warns about pilots on another game version', () => {
    const net = new FakeNet();
    const a = net.join('Alpha');
    net.deliver();
    a.match.receive('Zulu', { t: 'hello', v: 'p0.core-1', name: 'Zulu', ship: 'manta' });
    expect(a.mismatch).toEqual(['Zulu']);
    a.match.receive('Yankee', { t: 'hello', v: GAME_VERSION, name: 'Yankee', ship: 'halo' });
    expect(a.mismatch).toEqual(['Zulu']);
  });

  it('only accepts round control from the host', () => {
    const net = new FakeNet();
    const a = net.join('Alpha');
    const b = net.join('Bravo');
    net.deliver();
    a.match.receive('Bravo', {
      t: 'start',
      round: 5,
      level: 'nebula',
      mode: 'ffa',
      seed: 1,
      difficulty: 'ace',
      pilots: [{ identity: 'Bravo', name: 'Bravo', bot: false, team: -1, ship: 'trident' }],
    });
    expect(a.match.world).toBeNull();
    b.match.setSettings({ level: 'nebula' });
    net.deliver();
    expect(a.match.settings.level).toBe('cloud-sea');
  });
});

describe('pilot board', () => {
  const radio = (identity: string, local = false, speaking = false): RadioEntry => ({ identity, name: identity, local, speaking, muted: false, live: speaking });

  it('lists everybody in the round with points, most first, then the pilots waiting', () => {
    const net = new FakeNet();
    const a = net.join('Alpha', { bots: 1, difficulty: 'pilot' });
    const b = net.join('Bravo');
    net.deliver();
    a.match.startRound();
    net.deliver();
    // Bravo dives into the sea of clouds, Alpha and the bot fly on.
    fly(net, 180 + 600, (n) => (n === b ? { steerX: 0, steerY: -1, roll: 0, boost: true } : GENTLE));
    const m = a.match;
    const wins = new Map([['Bravo', 2]]);
    const room = [radio('Alpha', true), radio('Bravo', false, true), radio('Charlie')];
    const rows = boardRows(m.world, m.pilots, m.local, m.roundDifficulty, wins, room, true);
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(['Alpha', 'Bravo', 'Charlie']));
    expect(rows).toHaveLength(4);
    const flying = rows.filter((r) => r.glider >= 0);
    for (let i = 1; i < flying.length; i++) expect(flying[i - 1].points!).toBeGreaterThanOrEqual(flying[i].points!);
    const alpha = rows.find((r) => r.name === 'Alpha')!;
    const bravo = rows.find((r) => r.name === 'Bravo')!;
    const bot = rows.find((r) => r.bot)!;
    // The round is random (seed, bot ships): Alpha may have crashed too; the board says so.
    expect(alpha).toMatchObject({ you: true, talking: true, down: !m.world!.gliders[0].alive, wins: 0 });
    expect(alpha.points!).toBeGreaterThan(0);
    expect(bravo).toMatchObject({ you: false, talking: true, down: true, wins: 2 });
    expect(bot.wins).toBe(-1);
    // Charlie joined during the round and waits for the next one, at the end of the list.
    expect(rows[rows.length - 1]).toMatchObject({ name: 'Charlie', glider: -1, points: null });
    // A pilot who left during the round stays on the board, marked.
    const left = boardRows(m.world, m.pilots, m.local, m.roundDifficulty, wins, [radio('Alpha', true)], false);
    expect(left.find((r) => r.name === 'Bravo')).toMatchObject({ gone: true });
    expect(left.find((r) => r.name === 'Alpha')).toMatchObject({ talking: false });
  });

  it('shows the room before the first round', () => {
    const rows = boardRows(null, [], -1, 'pilot', new Map(), [radio('Alpha', true), radio('Bravo')], false);
    expect(rows.map((r) => [r.name, r.points, r.you])).toEqual([
      ['Alpha', null, true],
      ['Bravo', null, false],
    ]);
  });
});

describe('radio microphone button', () => {
  it('talks while held and stops when let go', () => {
    const m = new MicGesture();
    m.down('touch', 0);
    expect(m.on).toBe(true);
    m.up('touch', 2000);
    expect(m.on).toBe(false);
    expect(m.latched).toBe(false);
  });

  it('stays open after three quick taps and closes with the next tap', () => {
    const m = new MicGesture();
    for (const t of [0, 300, 600]) {
      m.down('touch', t);
      m.up('touch', t + 120);
    }
    expect(m.latched).toBe(true);
    expect(m.on).toBe(true);
    // The closing tap still talks while it is down.
    m.down('touch', 3000);
    expect(m.on).toBe(true);
    m.up('touch', 3100);
    expect(m.on).toBe(false);
    // Two more taps do not open it again.
    for (const t of [3400, 3700]) {
      m.down('touch', t);
      m.up('touch', t + 100);
    }
    expect(m.latched).toBe(false);
  });

  it('needs the three taps close together and short', () => {
    const slow = new MicGesture();
    for (const t of [0, 900, 1800]) {
      slow.down('hud', t);
      slow.up('hud', t + 100);
    }
    expect(slow.latched).toBe(false);
    const long = new MicGesture();
    long.down('touch', 0);
    long.up('touch', 100);
    long.down('touch', 250);
    long.up('touch', 900);
    long.down('touch', 1000);
    long.up('touch', 1080);
    expect(long.latched).toBe(false);
  });

  it('counts the key and the buttons as one press, and keeps the latch in the background', () => {
    const m = new MicGesture();
    m.set('key', true, 0);
    m.down('touch', 50);
    m.set('key', false, 1000);
    expect(m.on).toBe(true);
    m.up('touch', 1500);
    expect(m.on).toBe(false);
    for (const t of [2000, 2200, 2400]) {
      m.set('key', true, t);
      m.set('key', true, t + 16);
      m.set('key', false, t + 90);
    }
    expect(m.latched).toBe(true);
    m.down('touch', 3000);
    m.release();
    expect(m.on).toBe(true);
    m.setLatched(false);
    expect(m.on).toBe(false);
  });
});

describe('cheats online', () => {
  it('switches a glider to another ship in the running round, for everyone', () => {
    const net = new FakeNet();
    const a = net.join('Alpha', { bots: 1, difficulty: 'pilot' });
    const b = net.join('Bravo');
    net.deliver();
    a.match.startRound();
    net.deliver();
    fly(net, 200);
    const wa = a.match.world!;
    const wb = b.match.world!;
    const before = wb.gliders[1].p.clone();
    expect(b.match.swapShip('dragon')).toBe(true);
    net.deliver();
    // Same round, same place, new ship: no restart.
    expect(a.match.world).toBe(wa);
    expect(b.match.world).toBe(wb);
    expect(wb.gliders[1].ship.id).toBe('dragon');
    expect(wb.gliders[1].p.distSq(before)).toBeLessThan(1e-9);
    expect(wa.gliders[1].ship.id).toBe('dragon');
    expect(a.swaps).toEqual([{ id: 1, ship: 'dragon' }]);
    expect(a.match.pilots[1].ship).toBe('dragon');
    // It stays the ship for the next rounds.
    expect(b.match.ship).toBe('dragon');
    expect(a.match.shipOf('Bravo')).toBe('dragon');
    fly(net, 60);
    expect(wa.gliders[1].ship.id).toBe('dragon');
    // Nobody can switch someone else's glider.
    a.match.receive('Bravo', { t: 'ship', r: a.match.round, id: 0, ship: 'pig' });
    expect(wa.gliders[0].ship.id).not.toBe('pig');
  });

  it('moves everybody to the next arena, from the host or a guest', () => {
    const net = new FakeNet();
    const a = net.join('Alpha', { level: 'cloud-sea', bots: 1, difficulty: 'pilot' });
    const b = net.join('Bravo');
    net.deliver();
    a.match.startRound();
    net.deliver();
    fly(net, 240);
    const first = a.match.round;
    const next = nextLevel('cloud-sea')!;
    // A guest asks: the host starts a new round in the next arena right away.
    expect(b.match.nextArena()).toBe(next);
    net.deliver();
    expect(a.match.round).toBe(first + 1);
    expect(b.match.round).toBe(first + 1);
    expect(a.match.world!.spec.id).toBe(next);
    expect(b.match.world!.spec.id).toBe(next);
    expect(a.arenas).toEqual([{ name: 'Bravo', level: next }]);
    // The dropped round has no winner and counts for nobody.
    expect(a.results).toHaveLength(0);
    expect(b.results).toHaveLength(0);
    // Pressed twice at once: one arena further, not two.
    net.time += ARENA_GAP_MS + 10;
    a.match.nextArena();
    b.match.nextArena();
    net.deliver();
    const third = nextLevel(next)!;
    expect(a.match.world!.spec.id).toBe(third);
    expect(b.match.world!.spec.id).toBe(third);
    expect(a.match.round).toBe(first + 2);
    // The new round flies normally.
    fly(net, 240);
    expect(a.match.world!.gliders.some((g) => g.alive)).toBe(true);
  });
});
