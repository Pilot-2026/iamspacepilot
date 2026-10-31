import { arenaRadius, boundaryHit } from './arena';
import { botThink, makeBrain } from './bot';
import {
  BOLT_RADIUS,
  COUNTDOWN_TICKS,
  DT,
  FLIGHT,
  GLIDER_HIT_RADIUS,
  HASH_CELL,
  QUERY_RADIUS,
  SAMPLE_TICKS,
  SELF_SKIP,
  SELF_SLIP_SKIP,
  TICK_RATE,
  WALL_HALF,
  WING_PROBE,
} from './config';
import { integrateGlider, tailPoint, type Glider } from './glider';
import { LEVELS, type LevelSpec } from './levels';
import { AXIS_LEFT, AXIS_UP, Quat, TWO_PI, V3, dcos, dsin } from './math';
import { Rng } from './rng';
import { SEG_SHIFT, SpatialHash, Trail, quadCorners, segQuad, segSegDistSq, segmentBounds, wallDistSq } from './trail';
import { NEUTRAL_INPUT, type CrashInfo, type Difficulty, type LevelId, type Phase, type PilotInput, type SimEvent } from './types';

export interface PilotSetup {
  name: string;
  isBot: boolean;
  assist: boolean;
  skill: Difficulty;
}

export interface WorldSetup {
  level: LevelId;
  seed: number;
  pilots: PilotSetup[];
}

export const RING_RADIUS = 7;

export interface Ring {
  active: boolean;
  readonly c: V3;
  readonly n: V3;
  respawnTick: number;
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
  /** Events of the last step. */
  readonly events: SimEvent[] = [];
  readonly hash = new SpatialHash(HASH_CELL);
  tick = 0;
  flyTicks = 0;
  phase: Phase = 'countdown';
  winner = -1;
  /** Tick on which the round ended, -1 while it is still running. */
  overTick = -1;

  private nextBoltFly = 4 * TICK_RATE;
  private boltSeq = 0;
  private shrinkAnnounced = false;
  private readonly cand = new Set<number>();
  private readonly corners = new Float64Array(12);
  private readonly bounds = new Float64Array(6);

  constructor(setup: WorldSetup) {
    this.spec = LEVELS[setup.level];
    this.rng = new Rng(setup.seed);
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
      this.gliders.push({
        id: i,
        name: ps.name,
        isBot: ps.isBot,
        assist: ps.assist,
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
        wallDist: 1e9,
        near: new V3(),
        hasNear: false,
        brain: ps.isBot ? makeBrain(ps.skill, i) : null,
        input: { steerX: 0, steerY: 0, roll: 0, boost: false },
      });
      this.trails.push(new Trail());
    });
    for (let k = 0; k < this.spec.rings; k++) {
      const ring: Ring = { active: true, c: new V3(), n: new V3(1, 0, 0), respawnTick: 0 };
      this.placeRing(ring);
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
      if (!g.alive) continue;
      const inp = g.brain ? g.brain.input : (inputs[g.id] ?? NEUTRAL_INPUT);
      integrateGlider(g, inp);
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
      for (const g of gl) if (g.alive) this.addSample(g);
    }

    if (spec.lightning) this.updateBolts(R);

    const pending: { id: number; crash: CrashInfo }[] = [];
    for (const g of gl) {
      if (!g.alive) continue;
      const c = this.collide(g, R);
      if (c) pending.push({ id: g.id, crash: c });
    }
    const hit2 = GLIDER_HIT_RADIUS * GLIDER_HIT_RADIUS;
    for (let i = 0; i < gl.length; i++) {
      const a = gl[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < gl.length; j++) {
        const b = gl[j];
        if (!b.alive || a.p.distSq(b.p) > hit2) continue;
        if (!pending.some((x) => x.id === a.id)) pending.push({ id: a.id, crash: { kind: 'collision', by: b.id, seg: -1 } });
        if (!pending.some((x) => x.id === b.id)) pending.push({ id: b.id, crash: { kind: 'collision', by: a.id, seg: -1 } });
      }
    }
    if (pending.length) this.applyCrashes(pending);

    this.updateRings();

    if (this.phase === 'flying' && gl.length > 1 && this.aliveCount() <= 1) {
      this.phase = 'over';
      this.overTick = this.tick;
      const w = gl.find((g) => g.alive);
      this.winner = w ? w.id : -1;
      if (w) w.place = 1;
      this.events.push({ type: 'over', winner: this.winner });
    }

    this.flyTicks++;
    this.tick++;
  }

  /** Distance along the unit direction d until a wall blocks the way (at most len). */
  probe(self: number, p: V3, d: V3, len: number): number {
    const ex = p.x + d.x * len;
    const ey = p.y + d.y * len;
    const ez = p.z + d.z * len;
    const m = WALL_HALF + 0.5;
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
      quadCorners(tr, seg, c);
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

  private addSample(g: Glider): void {
    const tr = this.trails[g.id];
    if (tr.count >= SEG_SHIFT - 1) return;
    tailPoint(g, tmpA);
    g.q.rotate(AXIS_UP, tmpB);
    tr.add(tmpA, tmpB, this.tick);
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
      quadCorners(tr, seg, c);
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
        const d2 = wallDistSq(p, tr, seg, tmpNear);
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
      const e = g.energy + FLIGHT.slipRegen * (1 - g.wallDist / FLIGHT.slipRange);
      g.energy = e > 1 ? 1 : e;
    }
    if (hitId >= 0) return { kind: 'wall', by: hitBy, seg: hitSeg };

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

  private placeRing(ring: Ring): void {
    const arena = this.spec.arena;
    const R = this.radius() * 0.62;
    const a = this.rng.range(0, TWO_PI);
    const r = Math.sqrt(this.rng.next()) * R;
    const top = Math.min(30, arena.ceilY - 15);
    const y = this.rng.range(arena.floorY + 18, top);
    ring.c.set(dcos(a) * r, y, dsin(a) * r);
    const b = this.rng.range(0, TWO_PI);
    ring.n.set(dcos(b), 0, dsin(b));
  }

  private updateRings(): void {
    const r2 = RING_RADIUS * RING_RADIUS;
    for (let k = 0; k < this.rings.length; k++) {
      const ring = this.rings[k];
      if (!ring.active) {
        if (this.tick >= ring.respawnTick) {
          this.placeRing(ring);
          ring.active = true;
        }
        continue;
      }
      const c = ring.c;
      const n = ring.n;
      for (const g of this.gliders) {
        if (!g.alive) continue;
        const sa = (g.pPrev.x - c.x) * n.x + (g.pPrev.y - c.y) * n.y + (g.pPrev.z - c.z) * n.z;
        const sb = (g.p.x - c.x) * n.x + (g.p.y - c.y) * n.y + (g.p.z - c.z) * n.z;
        if (!((sa <= 0 && sb > 0) || (sa >= 0 && sb < 0))) continue;
        const t = sa / (sa - sb);
        const ix = g.pPrev.x + (g.p.x - g.pPrev.x) * t - c.x;
        const iy = g.pPrev.y + (g.p.y - g.pPrev.y) * t - c.y;
        const iz = g.pPrev.z + (g.p.z - g.pPrev.z) * t - c.z;
        if (ix * ix + iy * iy + iz * iz > r2) continue;
        const e = g.energy + FLIGHT.ringBoost;
        g.energy = e > 1 ? 1 : e;
        g.rings++;
        ring.active = false;
        ring.respawnTick = this.tick + 8 * TICK_RATE;
        this.events.push({ type: 'ring', id: g.id, ring: k });
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
    this.nextBoltFly = this.flyTicks + 150 + this.rng.int(180);
    const arena = this.spec.arena;
    const a = this.rng.range(0, TWO_PI);
    const r = Math.sqrt(this.rng.next()) * R * 0.85;
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
      x += this.rng.range(-4, 4);
      z += this.rng.range(-4, 4);
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
