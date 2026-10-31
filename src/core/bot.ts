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
  readonly input: PilotInput;
}

const SKILL: Record<Difficulty, { interval: number; look: number; aggression: number; noise: number }> = {
  rookie: { interval: 9, look: 28, aggression: 0.15, noise: 1.0 },
  pilot: { interval: 6, look: 36, aggression: 0.4, noise: 0.5 },
  ace: { interval: 4, look: 44, aggression: 0.75, noise: 0.2 },
};

export function makeBrain(skill: Difficulty, index: number): BotBrain {
  const s = SKILL[skill];
  return {
    interval: s.interval,
    offset: index % s.interval,
    look: s.look,
    aggression: s.aggression,
    noise: s.noise,
    input: { steerX: 0, steerY: 0, roll: 0, boost: false },
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
  for (const o of w.gliders) {
    if (o.id === i || !o.alive) continue;
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
    if (hasAim && !danger) score += b.aggression * 14 * d.dot(aim);
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
}

/** Free distance along the direction stored in d, limited by walls, bolts, gliders and the arena. */
function freeDistance(w: World, i: number, R: number, look: number): number {
  const p = w.gliders[i].p;
  let free = w.probe(i, p, d, look);
  const exit = rayExit(w.spec.arena, R, p.x, p.y, p.z, d.x, d.y, d.z) - 6;
  if (exit < free) free = exit < 0 ? 0 : exit;
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
