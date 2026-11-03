import { TAPER_MIN, TAPER_TICKS, WALL_HALF } from './config';
import { clamp, type V3 } from './math';

/** Segment ids pack the wall owner and the segment index into one number. */
export const SEG_SHIFT = 65536;

/** What a wall piece is: a normal wall, a glass tube (bonus) or a giant wall with holes (bonus). */
export const WALL_PLAIN = 0;
export const WALL_TUBE = 1;
export const WALL_HOLES = 2;
export const isWallKind = (k: unknown): k is number => k === WALL_PLAIN || k === WALL_TUBE || k === WALL_HOLES;

/** Glass tube: radius around the line the glider flew (m). Hollow and open at both ends. */
export const TUBE_RADIUS = 3.4;
/** Giant wall: five times as high as a normal wall... */
export const GIANT_HALF = WALL_HALF * 5;
/** ...with a round hole every HOLE_SPACING metres along it, HOLE_RADIUS wide, up to HOLE_RANGE above or below the middle. */
export const HOLE_SPACING = 17;
export const HOLE_RADIUS = 5.6;
export const HOLE_RANGE = 10;
/** Height of hole n above the middle of the wall at full height (the same on every device and in the shader). */
export function holeHeight(n: number): number {
  return HOLE_RANGE * Math.sin(n * 2.1);
}

/**
 * The light wall of one glider: a list of samples. Segment i connects
 * sample i and sample i + 1 and spans +-h along the stored up vectors. A new
 * sample starts narrow and grows to its full half height h (see halfAt).
 */
export class Trail {
  readonly px: number[] = [];
  readonly py: number[] = [];
  readonly pz: number[] = [];
  readonly ux: number[] = [];
  readonly uy: number[] = [];
  readonly uz: number[] = [];
  readonly tick: number[] = [];
  /** Full half height of each sample (the radius for a glass tube). */
  readonly h: number[] = [];
  /** WALL_PLAIN, WALL_TUBE or WALL_HOLES. */
  readonly kind: number[] = [];
  /** Distance along the wall from its first sample (m): where the holes are. */
  readonly len: number[] = [];

  get count(): number {
    return this.px.length;
  }

  add(p: V3, u: V3, tick: number, h: number, kind = WALL_PLAIN): void {
    const n = this.px.length;
    this.len.push(n ? this.len[n - 1] + Math.hypot(p.x - this.px[n - 1], p.y - this.py[n - 1], p.z - this.pz[n - 1]) : 0);
    this.kind.push(kind);
    this.h.push(h);
    this.px.push(p.x);
    this.py.push(p.y);
    this.pz.push(p.z);
    this.ux.push(u.x);
    this.uy.push(u.y);
    this.uz.push(u.z);
    this.tick.push(tick);
  }
}

/** Grid of buckets so collision checks only look at nearby wall segments. */
export class SpatialHash {
  private readonly cells = new Map<number, number[]>();

  constructor(private readonly size: number) {}

  private cell(v: number): number {
    const c = Math.floor(v / this.size);
    return c < -511 ? -511 : c > 511 ? 511 : c;
  }

  private static key(ix: number, iy: number, iz: number): number {
    return ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
  }

  insert(id: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const ax = this.cell(x0),
      ay = this.cell(y0),
      az = this.cell(z0);
    const bx = this.cell(x1),
      by = this.cell(y1),
      bz = this.cell(z1);
    for (let ix = ax; ix <= bx; ix++) {
      for (let iy = ay; iy <= by; iy++) {
        for (let iz = az; iz <= bz; iz++) {
          const k = SpatialHash.key(ix, iy, iz);
          let arr = this.cells.get(k);
          if (!arr) {
            arr = [];
            this.cells.set(k, arr);
          }
          arr.push(id);
        }
      }
    }
  }

  query(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: Set<number>): void {
    const ax = this.cell(x0),
      ay = this.cell(y0),
      az = this.cell(z0);
    const bx = this.cell(x1),
      by = this.cell(y1),
      bz = this.cell(z1);
    for (let ix = ax; ix <= bx; ix++) {
      for (let iy = ay; iy <= by; iy++) {
        for (let iz = az; iz <= bz; iz++) {
          const arr = this.cells.get(SpatialHash.key(ix, iy, iz));
          if (!arr) continue;
          for (let n = 0; n < arr.length; n++) out.add(arr[n]);
        }
      }
    }
  }
}

/** Half height of sample k at the given tick: narrow when new, full height after TAPER_TICKS. */
export function halfAt(tr: Trail, k: number, tick: number): number {
  const age = tick - tr.tick[k];
  if (age >= TAPER_TICKS) return tr.h[k];
  const a = age > 0 ? age : 0;
  return tr.h[k] * (TAPER_MIN + ((1 - TAPER_MIN) * a) / TAPER_TICKS);
}

/** Half height of the flat wall at sample k: a glass tube has none. */
export function wallHalfAt(tr: Trail, k: number, tick: number): number {
  return tr.kind[k] === WALL_TUBE ? 0 : halfAt(tr, k, tick);
}

/** Segment i is a glass tube from end to end. */
export function isTubeSeg(tr: Trail, i: number): boolean {
  return tr.kind[i] === WALL_TUBE && tr.kind[i + 1] === WALL_TUBE;
}

/** Segment i belongs to a giant wall with holes. */
export function hasHoles(tr: Trail, i: number): boolean {
  return tr.kind[i] === WALL_HOLES || tr.kind[i + 1] === WALL_HOLES;
}

/**
 * Glass tube segment i: how far the point is outside the tube's skin (negative
 * inside, in metres), or Infinity when the point is not alongside this segment.
 * Inner segments reach a little into their neighbours so a crossing at a joint
 * is not missed; the first and last segment of a tube end flat: open ends.
 */
export function tubeSide(tr: Trail, i: number, x: number, y: number, z: number, tick: number, near?: V3): number {
  const j = i + 1;
  const ax = tr.px[i],
    ay = tr.py[i],
    az = tr.pz[i];
  const ex = tr.px[j] - ax,
    ey = tr.py[j] - ay,
    ez = tr.pz[j] - az;
  const len2 = ex * ex + ey * ey + ez * ez;
  if (len2 < 1e-9) return Infinity;
  const t = ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / len2;
  const lo = i > 0 && tr.kind[i - 1] === WALL_TUBE ? -0.2 : 0;
  const hi = j + 1 < tr.count && tr.kind[j + 1] === WALL_TUBE ? 1.2 : 1;
  if (t < lo || t > hi) return Infinity;
  const cx = ax + ex * t,
    cy = ay + ey * t,
    cz = az + ez * t;
  const ri = halfAt(tr, i, tick);
  const r = ri + (halfAt(tr, j, tick) - ri) * (t < 0 ? 0 : t > 1 ? 1 : t);
  const dx = x - cx,
    dy = y - cy,
    dz = z - cz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (near) {
    if (d > 1e-6) near.set(cx + (dx / d) * r, cy + (dy / d) * r, cz + (dz / d) * r);
    else near.set(cx, cy, cz);
  }
  return d - r;
}

/**
 * Path o + d * t (t in [0, 1]) against glass tube segment i: t where it
 * crosses the tube's skin (from outside in or from inside out), or -1.
 */
export function segTube(tr: Trail, i: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tick: number): number {
  const f0 = tubeSide(tr, i, ox, oy, oz, tick);
  const f1 = tubeSide(tr, i, ox + dx, oy + dy, oz + dz, tick);
  if (!Number.isFinite(f0) || !Number.isFinite(f1)) return -1;
  if ((f0 > 0 && f1 > 0) || (f0 < 0 && f1 < 0)) return -1;
  if (f0 === f1) return 0;
  return f0 / (f0 - f1);
}

/** Giant wall segment i: whether the wall point x, y, z lies in one of its holes. Holes grow with the wall. */
export function inHole(tr: Trail, i: number, x: number, y: number, z: number, tick: number): boolean {
  const j = i + 1;
  const ax = tr.px[i],
    ay = tr.py[i],
    az = tr.pz[i];
  const ex = tr.px[j] - ax,
    ey = tr.py[j] - ay,
    ez = tr.pz[j] - az;
  const len2 = ex * ex + ey * ey + ez * ez;
  let t = len2 > 1e-12 ? ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / len2 : 0;
  t = clamp(t, 0, 1);
  const s = tr.len[i] + (tr.len[j] - tr.len[i]) * t;
  let ux = tr.ux[i] + (tr.ux[j] - tr.ux[i]) * t;
  let uy = tr.uy[i] + (tr.uy[j] - tr.uy[i]) * t;
  let uz = tr.uz[i] + (tr.uz[j] - tr.uz[i]) * t;
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const v = (x - ax - ex * t) * ux + (y - ay - ey * t) * uy + (z - az - ez * t) * uz;
  // Young pieces are still growing: the holes grow with them.
  const full = tr.h[i] + (tr.h[j] - tr.h[i]) * t;
  const hi = halfAt(tr, i, tick);
  const f = full > 0 ? (hi + (halfAt(tr, j, tick) - hi) * t) / full : 1;
  const n = Math.round(s / HOLE_SPACING);
  const ds = s - n * HOLE_SPACING;
  const dv = v - holeHeight(n) * f;
  const r = HOLE_RADIUS * f;
  return ds * ds + dv * dv < r * r;
}

/**
 * Writes the four corners of wall segment i at the given tick into c:
 * A = p_i + u_i h_i, B = p_i - u_i h_i, C = p_i+1 + u_i+1 h_i+1, D = p_i+1 - u_i+1 h_i+1.
 */
export function quadCorners(tr: Trail, i: number, c: Float64Array, tick: number, tubeAsWall = false): void {
  const j = i + 1;
  const hi = tubeAsWall ? halfAt(tr, i, tick) : wallHalfAt(tr, i, tick);
  const hj = tubeAsWall ? halfAt(tr, j, tick) : wallHalfAt(tr, j, tick);
  c[0] = tr.px[i] + tr.ux[i] * hi;
  c[1] = tr.py[i] + tr.uy[i] * hi;
  c[2] = tr.pz[i] + tr.uz[i] * hi;
  c[3] = tr.px[i] - tr.ux[i] * hi;
  c[4] = tr.py[i] - tr.uy[i] * hi;
  c[5] = tr.pz[i] - tr.uz[i] * hi;
  c[6] = tr.px[j] + tr.ux[j] * hj;
  c[7] = tr.py[j] + tr.uy[j] * hj;
  c[8] = tr.pz[j] + tr.uz[j] * hj;
  c[9] = tr.px[j] - tr.ux[j] * hj;
  c[10] = tr.py[j] - tr.uy[j] * hj;
  c[11] = tr.pz[j] - tr.uz[j] * hj;
}

/** Bounding box of segment i at full height, padded by m. Writes [minX, minY, minZ, maxX, maxY, maxZ]. */
export function segmentBounds(tr: Trail, i: number, m: number, out: Float64Array): void {
  const h = (tr.h[i] > tr.h[i + 1] ? tr.h[i] : tr.h[i + 1]) + m;
  const j = i + 1;
  out[0] = Math.min(tr.px[i], tr.px[j]) - h;
  out[1] = Math.min(tr.py[i], tr.py[j]) - h;
  out[2] = Math.min(tr.pz[i], tr.pz[j]) - h;
  out[3] = Math.max(tr.px[i], tr.px[j]) + h;
  out[4] = Math.max(tr.py[i], tr.py[j]) + h;
  out[5] = Math.max(tr.pz[i], tr.pz[j]) + h;
}

/**
 * Segment from o along d (o + d * t, t in [0, 1]) against triangle (a, b, k) whose
 * corners are stored in c at the given offsets. Returns t of the hit or -1.
 */
export function segTri(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  c: Float64Array,
  a: number,
  b: number,
  k: number,
): number {
  const ax = c[a],
    ay = c[a + 1],
    az = c[a + 2];
  const e1x = c[b] - ax,
    e1y = c[b + 1] - ay,
    e1z = c[b + 2] - az;
  const e2x = c[k] - ax,
    e2y = c[k + 1] - ay,
    e2z = c[k + 2] - az;
  const px = dy * e2z - dz * e2y,
    py = dz * e2x - dx * e2z,
    pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-10 && det < 1e-10) return -1;
  const inv = 1 / det;
  const sx = ox - ax,
    sy = oy - ay,
    sz = oz - az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y,
    qy = sz * e1x - sx * e1z,
    qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t >= 0 && t <= 1 ? t : -1;
}

/** Segment against the wall quad stored in c (two triangles). Returns t of the first hit or -1. */
export function segQuad(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, c: Float64Array): number {
  const t1 = segTri(ox, oy, oz, dx, dy, dz, c, 0, 3, 6);
  const t2 = segTri(ox, oy, oz, dx, dy, dz, c, 3, 9, 6);
  if (t1 < 0) return t2;
  if (t2 < 0) return t1;
  return t1 < t2 ? t1 : t2;
}

/** Squared distance from p to wall segment i at the given tick. The closest wall point is written to near. */
export function wallDistSq(p: V3, tr: Trail, i: number, near: V3, tick: number): number {
  if (isTubeSeg(tr, i)) {
    const f = tubeSide(tr, i, p.x, p.y, p.z, tick, near);
    return Number.isFinite(f) ? f * f : 1e18;
  }
  const j = i + 1;
  const s0x = tr.px[i],
    s0y = tr.py[i],
    s0z = tr.pz[i];
  const ex = tr.px[j] - s0x,
    ey = tr.py[j] - s0y,
    ez = tr.pz[j] - s0z;
  const len2 = ex * ex + ey * ey + ez * ez;
  let t = len2 > 1e-12 ? ((p.x - s0x) * ex + (p.y - s0y) * ey + (p.z - s0z) * ez) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = s0x + ex * t,
    cy = s0y + ey * t,
    cz = s0z + ez * t;
  const ux = tr.ux[i] + (tr.ux[j] - tr.ux[i]) * t;
  const uy = tr.uy[i] + (tr.uy[j] - tr.uy[i]) * t;
  const uz = tr.uz[i] + (tr.uz[j] - tr.uz[i]) * t;
  const hi = wallHalfAt(tr, i, tick);
  const half = hi + (wallHalfAt(tr, j, tick) - hi) * t;
  const du = clamp((p.x - cx) * ux + (p.y - cy) * uy + (p.z - cz) * uz, -half, half);
  const nx = cx + ux * du,
    ny = cy + uy * du,
    nz = cz + uz * du;
  near.set(nx, ny, nz);
  const dx = p.x - nx,
    dy = p.y - ny,
    dz = p.z - nz;
  return dx * dx + dy * dy + dz * dz;
}

/** Squared distance between segment p1-q1 and segment p2-q2. */
export function segSegDistSq(
  p1x: number,
  p1y: number,
  p1z: number,
  q1x: number,
  q1y: number,
  q1z: number,
  p2x: number,
  p2y: number,
  p2z: number,
  q2x: number,
  q2y: number,
  q2z: number,
): number {
  const d1x = q1x - p1x,
    d1y = q1y - p1y,
    d1z = q1z - p1z;
  const d2x = q2x - p2x,
    d2y = q2y - p2y,
    d2z = q2z - p2z;
  const rx = p1x - p2x,
    ry = p1y - p2y,
    rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const EPS = 1e-12;
  let s = 0;
  let t = 0;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const dx = p1x + d1x * s - (p2x + d2x * t);
  const dy = p1y + d1y * s - (p2y + d2y * t);
  const dz = p1z + d1z * s - (p2z + d2z * t);
  return dx * dx + dy * dy + dz * dz;
}
