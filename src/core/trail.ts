import { TAPER_MIN, TAPER_TICKS } from './config';
import { clamp, type V3 } from './math';

/** Segment ids pack the wall owner and the segment index into one number. */
export const SEG_SHIFT = 65536;

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
  /** Full half height of each sample. */
  readonly h: number[] = [];

  get count(): number {
    return this.px.length;
  }

  add(p: V3, u: V3, tick: number, h: number): void {
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

/**
 * Writes the four corners of wall segment i at the given tick into c:
 * A = p_i + u_i h_i, B = p_i - u_i h_i, C = p_i+1 + u_i+1 h_i+1, D = p_i+1 - u_i+1 h_i+1.
 */
export function quadCorners(tr: Trail, i: number, c: Float64Array, tick: number): void {
  const j = i + 1;
  const hi = halfAt(tr, i, tick);
  const hj = halfAt(tr, j, tick);
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
  const hi = halfAt(tr, i, tick);
  const half = hi + (halfAt(tr, j, tick) - hi) * t;
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
