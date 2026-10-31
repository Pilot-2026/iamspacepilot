/**
 * Deterministic math for the simulation core.
 *
 * The core only uses +, -, *, /, Math.sqrt and Math.floor. These give
 * bit-identical results in every browser and in Node. Math.sin, Math.cos and
 * similar functions may differ slightly between JavaScript engines, so the core
 * never calls them. This keeps online matches in sync and lets the server
 * replay a recorded flight later to verify a record.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

/** Sine with a fixed polynomial. Error is below 1e-9 for any input. */
export function dsin(x: number): number {
  x = x - TWO_PI * Math.floor((x + PI) / TWO_PI);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-0.16666666666666666 +
          x2 *
            (0.008333333333333333 +
              x2 *
                (-0.0001984126984126984 +
                  x2 * (0.0000027557319223985893 + x2 * (-2.505210838544172e-8 + x2 * 1.6059043836821613e-10))))))
  );
}

export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class V3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: V3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone(): V3 {
    return new V3(this.x, this.y, this.z);
  }

  add(v: V3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: V3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  addScaled(v: V3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  dot(v: V3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /** this = a x b */
  cross(a: V3, b: V3): this {
    const x = a.y * b.z - a.z * b.y;
    const y = a.z * b.x - a.x * b.z;
    const z = a.x * b.y - a.y * b.x;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): this {
    const l = this.length();
    if (l > 1e-12) {
      this.x /= l;
      this.y /= l;
      this.z /= l;
    }
    return this;
  }

  distSq(v: V3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
}

export class Quat {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
    public w = 1,
  ) {}

  copy(q: Quat): this {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;
    return this;
  }

  identity(): this {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.w = 1;
    return this;
  }

  /** Axis must be a unit vector. */
  setAxisAngle(ax: number, ay: number, az: number, angle: number): this {
    const h = angle * 0.5;
    const s = dsin(h);
    this.x = ax * s;
    this.y = ay * s;
    this.z = az * s;
    this.w = dcos(h);
    return this;
  }

  /** this = this * q (q is applied in the local frame of this). */
  multiply(q: Quat): this {
    const ax = this.x,
      ay = this.y,
      az = this.z,
      aw = this.w;
    const bx = q.x,
      by = q.y,
      bz = q.z,
      bw = q.w;
    this.x = aw * bx + ax * bw + ay * bz - az * by;
    this.y = aw * by - ax * bz + ay * bw + az * bx;
    this.z = aw * bz + ax * by - ay * bx + az * bw;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }

  normalize(): this {
    let l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    if (l < 1e-12) return this.identity();
    l = 1 / l;
    this.x *= l;
    this.y *= l;
    this.z *= l;
    this.w *= l;
    return this;
  }

  /** out = rotate v by this quaternion. */
  rotate(v: V3, out: V3): V3 {
    const x = v.x,
      y = v.y,
      z = v.z;
    const qx = this.x,
      qy = this.y,
      qz = this.z,
      qw = this.w;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return out;
  }

  /** out = rotate v by the inverse of this quaternion (world to local). */
  rotateInverse(v: V3, out: V3): V3 {
    const qx = -this.x,
      qy = -this.y,
      qz = -this.z,
      qw = this.w;
    const x = v.x,
      y = v.y,
      z = v.z;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return out;
  }

  /** Builds the rotation whose local x, y, z axes are the given unit vectors. */
  setFromBasis(xa: V3, ya: V3, za: V3): this {
    const m11 = xa.x,
      m12 = ya.x,
      m13 = za.x;
    const m21 = xa.y,
      m22 = ya.y,
      m23 = za.y;
    const m31 = xa.z,
      m32 = ya.z,
      m33 = za.z;
    const trace = m11 + m22 + m33;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      this.w = 0.25 / s;
      this.x = (m32 - m23) * s;
      this.y = (m13 - m31) * s;
      this.z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
      this.w = (m32 - m23) / s;
      this.x = 0.25 * s;
      this.y = (m12 + m21) / s;
      this.z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
      this.w = (m13 - m31) / s;
      this.x = (m12 + m21) / s;
      this.y = 0.25 * s;
      this.z = (m23 + m32) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
      this.w = (m21 - m12) / s;
      this.x = (m13 + m31) / s;
      this.y = (m23 + m32) / s;
      this.z = 0.25 * s;
    }
    return this;
  }
}

/**
 * Local axes of a glider: forward is +Z, up is +Y, so +X points to the
 * pilot's LEFT. Right is -X.
 */
export const AXIS_FWD: Readonly<V3> = new V3(0, 0, 1);
export const AXIS_UP: Readonly<V3> = new V3(0, 1, 0);
export const AXIS_LEFT: Readonly<V3> = new V3(1, 0, 0);
export const WORLD_UP: Readonly<V3> = new V3(0, 1, 0);
