import { rayExit } from './arena';
import { AXIS_FWD, V3, clamp } from './math';
import type { Difficulty, PilotInput } from './types';
import type { World } from './world';

export interface BotBrain {
  /** Ticks between decisions. */
  interval: number;
  offset: number;
  /** How far ahead the bot looks for walls. */
  look: number;
  /** 0 = only survives, 1 = hunts and cuts off other pilots. */
  aggression: number;
  /** Random wobble in decisions. */
  noise: number;
  /** Fires when a pilot is within this cone in front (cos of the half angle)... */
  aimCos: number;
  /** ...with this chance per decision. */
  fireRate: number;
  /** Lets the gun cool below this heat before firing again. */
  heatLimit: number;
  readonly input: PilotInput;
}

const SKILL: Record<Difficulty, { interval: number; look: number; aggression: number; noise: number; aimCos: number; fireRate: number; heatLimit: number }> = {
  rookie: { interval: 9, look: 28, aggression: 0.15, noise: 1.0, aimCos: 0.93, fireRate: 0.35, heatLimit: 0.45 },
  pilot: { interval: 6, look: 36, aggression: 0.4, noise: 0.5, aimCos: 0.9, fireRate: 0.55, heatLimit: 0.6 },
  ace: { interval: 4, look: 44, aggression: 0.75, noise: 0.2, aimCos: 0.88, fireRate: 0.75, heatLimit: 0.75 },
};

/** Bots hold fire for the first seconds of a round. */
const BOT_FIRE_AFTER = 5;
/** Bots only shoot at pilots closer than this. */
const BOT_FIRE_RANGE = 110;

export function makeBrain(skill: Difficulty, index: number): BotBrain {
  const s = SKILL[skill];
  return {
    interval: s.interval,
    offset: index % s.interval,
    look: s.look,
    aggression: s.aggression,
    noise: s.noise,
    aimCos: s.aimCos,
    fireRate: s.fireRate,
    heatLimit: s.heatLimit,
    input: { steerX: 0, steerY: 0, roll: 0, boost: false, fire: false, special: false },
  };
}

// Candidate directions in the glider's local frame (+X = left, +Y = up, +Z = forward).
const C30 = 0.8660254037844386;
const S30 = 0.5;
const DG = 0.35355339059327373;
const DIRS: readonly V3[] = [
  new V3(0, 0, 1),
  new V3(S30, 0, C30),
  new V3(-S30, 0, C30),
  new V3(0, S30, C30),
  new V3(0, -S30, C30),
  new V3(DG, DG, C30),
  new V3(-DG, DG, C30),
  new V3(DG, -DG, C30),
  new V3(-DG, -DG, C30),
  new V3(C30, 0, S30),
  new V3(-C30, 0, S30),
  new V3(0, C30, S30),
  new V3(0, -C30, S30),
];

const d = new V3();
const aim = new V3();
const loc = new V3();
const tf = new V3();

/** Picks a new steering input for bot i. Called every few ticks. */
export function botThink(w: World, i: number): void {
  const g = w.gliders[i];
  const b = g.brain;
  if (!b) return;
  const arena = w.spec.arena;
  const R = w.radius();
  const p = g.p;

  // Nearest opponent: aim a little ahead of it to cut it off.
  let hasAim = false;
  let aimDist = 1e9;
  let bestD2 = 80 * 80;
  let target = -1;
  // No hunting in the first seconds: everyone needs room to spread out first.
  const huntAllowed = w.flyTime > 6;
  for (const o of w.gliders) {
    if (!huntAllowed) break;
    if (o.id === i || !o.alive) continue;
    if (w.teams && o.team === g.team) continue;
    const d2 = o.p.distSq(p);
    if (d2 >= bestD2) continue;
    // Never chase a pilot from behind: that means flying straight into its wall.
    o.q.rotate(AXIS_FWD, tf);
    const ahead = (p.x - o.p.x) * tf.x + (p.y - o.p.y) * tf.y + (p.z - o.p.z) * tf.z;
    if (ahead < -4) continue;
    bestD2 = d2;
    target = o.id;
  }
  if (target >= 0) {
    const o = w.gliders[target];
    o.q.rotate(AXIS_FWD, tf);
    const lead = 10 + 16 * b.aggression + 0.3 * Math.sqrt(bestD2);
    aim.set(o.p.x + tf.x * lead - p.x, o.p.y + tf.y * lead - p.y, o.p.z + tf.z * lead - p.z);
    aimDist = aim.length();
    if (aimDist > 1e-6) {
      aim.scale(1 / aimDist);
      hasAim = true;
    }
  }
  // Nobody to hunt: go for a bonus ring in front, if no other pilot is closer to it.
  let ringAim = false;
  if (!hasAim && huntAllowed) {
    g.qb.rotate(DIRS[0], tf);
    let best2 = 70 * 70;
    for (const ring of w.rings) {
      if (!ring.active) continue;
      const rx = ring.c.x - p.x;
      const ry = ring.c.y - p.y;
      const rz = ring.c.z - p.z;
      const d2 = rx * rx + ry * ry + rz * rz;
      if (d2 >= best2 || rx * tf.x + ry * tf.y + rz * tf.z < 0) continue;
      let closer = false;
      for (const o of w.gliders) {
        if (o.id !== i && o.alive && o.p.distSq(ring.c) < d2) {
          closer = true;
          break;
        }
      }
      if (closer) continue;
      best2 = d2;
      aim.set(rx, ry, rz);
    }
    if (best2 < 70 * 70) {
      aimDist = Math.sqrt(best2);
      aim.scale(1 / aimDist);
      hasAim = true;
      ringAim = true;
    }
  }

  const midY = (arena.floorY + Math.min(arena.ceilY, R * 0.45)) * 0.5;
  const horiz = Math.sqrt(p.x * p.x + p.z * p.z);
  const outer = horiz > R * 0.55 ? (horiz - R * 0.55) / R / horiz : 0;

  // Forward first: if the way ahead is short, the bot only thinks about escaping.
  g.qb.rotate(DIRS[0], d);
  const fwdFree = freeDistance(w, i, R, b.look);
  const danger = fwdFree < b.look * 0.6;

  let best = -1e9;
  let bestK = 0;
  for (let k = 0; k < DIRS.length; k++) {
    const ld = DIRS[k];
    g.qb.rotate(ld, d);
    const free = k === 0 ? fwdFree : freeDistance(w, i, R, b.look);
    let score = free * (danger ? 1.6 : 1);
    if (free >= b.look) score += 4;
    score -= (1 - ld.z) * (danger ? 2 : 5);
    if (hasAim && !danger) score += (ringAim ? 8 : b.aggression * 14) * d.dot(aim);
    // Stay well clear of floor and ceiling: a full turn needs about 18 m.
    const fy = p.y + d.y * 20;
    if (fy < arena.floorY + 16) score -= 20;
    if (fy > arena.ceilY - 14) score -= 20;
    // Prefer a comfortable altitude band and drift back towards the middle.
    score -= Math.abs(fy - midY) * 0.06;
    if (outer > 0) score -= outer * (p.x * d.x + p.z * d.z) * 0.05;
    score += (w.rng.next() - 0.5) * b.noise * 3;
    if (score > best) {
      best = score;
      bestK = k;
    }
  }

  let toAim = false;
  if (hasAim && !danger && aimDist < 70) {
    const len = Math.min(aimDist, b.look);
    const free = w.probe(i, p, aim, len);
    const exit = rayExit(arena, R, p.x, p.y, p.z, aim.x, aim.y, aim.z);
    if (free >= len - 0.5 && exit > 14 && w.rng.next() < b.aggression + 0.2) toAim = true;
  }
  if (toAim) g.qb.rotateInverse(aim, loc);
  else loc.copy(DIRS[bestK]);

  const inp = b.input;
  if (loc.z < 0) {
    inp.steerX = loc.x > 0 ? -1 : 1;
    inp.steerY = clamp(loc.y * 2, -1, 1);
  } else {
    inp.steerX = clamp(-loc.x * 2.4, -1, 1);
    inp.steerY = clamp(loc.y * 2.4, -1, 1);
  }
  inp.roll = 0;
  inp.boost = fwdFree >= b.look - 1 && g.energy > 0.3 && (toAim ? aimDist < 60 : g.energy > 0.92);
  inp.fire = wantsToFire(w, i, b);
  inp.special = wantsSpecial(w, i, b, fwdFree, toAim ? aimDist : 1e9);
}

/** Uses the ship's special ability when it helps. */
function wantsSpecial(w: World, i: number, b: BotBrain, fwdFree: number, huntDist: number): boolean {
  const g = w.gliders[i];
  if (w.flyTime < 5 || w.tick < g.specialReady) return false;
  switch (g.ship.special.kind) {
    case 'phase':
      // About to hit a wall: phase through it.
      return fwdFree < 10 && w.rng.next() < 0.5 + b.aggression * 0.5;
    case 'afterburner':
      return huntDist < 80 && w.rng.next() < b.aggression;
    case 'burst':
    case 'shockwave': {
      const range = g.ship.special.kind === 'burst' ? 55 : 35;
      g.q.rotate(AXIS_FWD, tf);
      for (const o of w.gliders) {
        if (o.id === i || !o.alive || (w.teams && o.team === g.team)) continue;
        const rx = o.p.x - g.p.x;
        const ry = o.p.y - g.p.y;
        const rz = o.p.z - g.p.z;
        const d2 = rx * rx + ry * ry + rz * rz;
        if (d2 > range * range) continue;
        if (g.ship.special.kind === 'burst') {
          const along = rx * tf.x + ry * tf.y + rz * tf.z;
          if (along <= 0 || along * along < 0.9 * d2) continue;
        }
        return w.rng.next() < 0.3 + b.aggression * 0.5;
      }
      return false;
    }
  }
}

/** Fires at a pilot in front, now and then, without letting the gun overheat. */
function wantsToFire(w: World, i: number, b: BotBrain): boolean {
  const g = w.gliders[i];
  if (w.flyTime < BOT_FIRE_AFTER || g.overheated || g.heat > b.heatLimit) return false;
  g.q.rotate(AXIS_FWD, tf);
  const range2 = BOT_FIRE_RANGE * BOT_FIRE_RANGE;
  for (const o of w.gliders) {
    if (o.id === i || !o.alive || (w.teams && o.team === g.team)) continue;
    const rx = o.p.x - g.p.x;
    const ry = o.p.y - g.p.y;
    const rz = o.p.z - g.p.z;
    const d2 = rx * rx + ry * ry + rz * rz;
    if (d2 > range2 || d2 < 1) continue;
    const along = rx * tf.x + ry * tf.y + rz * tf.z;
    if (along <= 0 || along * along < b.aimCos * b.aimCos * d2) continue;
    return w.rng.next() < b.fireRate;
  }
  return false;
}

/** Free distance along the direction stored in d, limited by walls, bolts, gliders and the arena. */
function freeDistance(w: World, i: number, R: number, look: number): number {
  const p = w.gliders[i].p;
  let free = w.probe(i, p, d, look);
  const exit = rayExit(w.spec.arena, R, p.x, p.y, p.z, d.x, d.y, d.z) - 6;
  if (exit < free) free = exit < 0 ? 0 : exit;
  // The deadly core counts as an obstacle with a safety margin.
  const core = w.spec.core;
  if (core) {
    const rr = core.radius + 10;
    const b = p.x * d.x + p.y * d.y + p.z * d.z;
    const c = p.x * p.x + p.y * p.y + p.z * p.z - rr * rr;
    const disc = b * b - c;
    if (disc > 0) {
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < free) free = t;
    }
  }
  // Other gliders count as obstacles too, so bots do not fly into each other.
  for (const o of w.gliders) {
    if (o.id === i || !o.alive) continue;
    const rx = o.p.x - p.x;
    const ry = o.p.y - p.y;
    const rz = o.p.z - p.z;
    const t = rx * d.x + ry * d.y + rz * d.z;
    if (t <= 0 || t >= free) continue;
    const off2 = rx * rx + ry * ry + rz * rz - t * t;
    if (off2 < 16) free = t;
  }
  return free;
}
