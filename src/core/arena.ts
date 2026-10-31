import type { ArenaSpec } from './levels';
import type { CrashKind } from './types';
import type { V3 } from './math';

/** Current arena radius. It stays put, then shrinks linearly to minRadius. */
export function arenaRadius(a: ArenaSpec, flyTime: number): number {
  if (flyTime <= a.shrinkStart) return a.radius;
  if (flyTime >= a.shrinkEnd) return a.minRadius;
  const k = (flyTime - a.shrinkStart) / (a.shrinkEnd - a.shrinkStart);
  return a.radius + (a.minRadius - a.radius) * k;
}

export function boundaryHit(a: ArenaSpec, r: number, p: V3): CrashKind | null {
  if (p.y < a.floorY) return 'floor';
  if (p.y > a.ceilY) return 'ceiling';
  const d2 = a.kind === 'dome' ? p.x * p.x + p.y * p.y + p.z * p.z : p.x * p.x + p.z * p.z;
  if (d2 > r * r) return 'shield';
  return null;
}

/** Distance from p to the nearest arena boundary (floor, ceiling or shield). */
export function boundaryDistance(a: ArenaSpec, r: number, p: V3): number {
  let d = p.y - a.floorY;
  const c = a.ceilY - p.y;
  if (c < d) d = c;
  const rr = a.kind === 'dome' ? Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) : Math.sqrt(p.x * p.x + p.z * p.z);
  if (r - rr < d) d = r - rr;
  return d;
}

/** How far a ray from p along the unit direction d travels before it leaves the arena. */
export function rayExit(
  a: ArenaSpec,
  r: number,
  px: number,
  py: number,
  pz: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  let t = 1e9;
  if (dy < -1e-6) {
    const tf = (a.floorY - py) / dy;
    if (tf < t) t = tf;
  } else if (dy > 1e-6) {
    const tc = (a.ceilY - py) / dy;
    if (tc < t) t = tc;
  }
  if (a.kind === 'dome') {
    const b = px * dx + py * dy + pz * dz;
    const c = px * px + py * py + pz * pz - r * r;
    const disc = b * b - c;
    if (disc > 0) {
      const te = -b + Math.sqrt(disc);
      if (te < t) t = te;
    } else {
      t = 0;
    }
  } else {
    const A = dx * dx + dz * dz;
    if (A > 1e-9) {
      const B = px * dx + pz * dz;
      const C = px * px + pz * pz - r * r;
      const disc = B * B - A * C;
      if (disc > 0) {
        const te = (-B + Math.sqrt(disc)) / A;
        if (te < t) t = te;
      } else {
        t = 0;
      }
    }
  }
  return t < 0 ? 0 : t;
}
