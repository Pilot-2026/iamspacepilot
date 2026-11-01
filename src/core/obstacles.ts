import { dcos, dsin, TWO_PI, V3 } from './math';

/**
 * Obstacles inside the arena: simple shapes (sphere, capsule, ring) that can
 * orbit the arena centre, bob up and down and turn. Their position only
 * depends on the tick, so every device sees them in the same place.
 * Flying into one is deadly; shots fizzle on them.
 */

export type ObstacleShape =
  | { kind: 'sphere'; r: number }
  /** A rod from centre - axis * half to centre + axis * half, r thick. */
  | { kind: 'capsule'; r: number; half: number; axis: [number, number, number] }
  /** A ring of radius R around the axis, r thick. */
  | { kind: 'torus'; R: number; r: number; axis: [number, number, number] };

export interface ObstacleDef {
  readonly shape: ObstacleShape;
  /** Centre at tick 0. */
  readonly at: [number, number, number];
  /** Orbit around the vertical axis through the arena centre, radians per second. */
  readonly orbit?: number;
  /** Up-and-down motion: amplitude in metres and period in seconds. */
  readonly bob?: [number, number];
  /** The shape's axis turns around the vertical, radians per second. */
  readonly spin?: number;
  /** How the renderer draws it. */
  readonly look: string;
}

export class Obstacle {
  /** Centre now. */
  readonly c = new V3();
  /** Unit axis now (capsules and rings). */
  readonly a = new V3(0, 1, 0);
  private readonly a0: V3;

  constructor(readonly def: ObstacleDef) {
    const s = def.shape;
    const ax = s.kind === 'sphere' ? [0, 1, 0] : s.axis;
    this.a0 = new V3(ax[0], ax[1], ax[2]).normalize();
    this.update(0);
  }

  /** Moves the obstacle to where it is at this tick. */
  update(tick: number): void {
    const t = tick / 60;
    const d = this.def;
    let [x, y, z] = d.at;
    if (d.orbit) {
      const ang = d.orbit * t;
      const c = dcos(ang);
      const s = dsin(ang);
      const nx = x * c - z * s;
      z = x * s + z * c;
      x = nx;
    }
    if (d.bob) y += d.bob[0] * dsin((TWO_PI * t) / d.bob[1]);
    this.c.set(x, y, z);
    if (d.spin) {
      const ang = d.spin * t;
      const c = dcos(ang);
      const s = dsin(ang);
      this.a.set(this.a0.x * c - this.a0.z * s, this.a0.y, this.a0.x * s + this.a0.z * c);
    } else {
      this.a.copy(this.a0);
    }
  }

  /** Distance from point (px, py, pz) to the surface; negative inside. */
  dist(px: number, py: number, pz: number): number {
    const qx = px - this.c.x;
    const qy = py - this.c.y;
    const qz = pz - this.c.z;
    const s = this.def.shape;
    if (s.kind === 'sphere') return Math.sqrt(qx * qx + qy * qy + qz * qz) - s.r;
    const a = this.a;
    const h = qx * a.x + qy * a.y + qz * a.z;
    if (s.kind === 'capsule') {
      const k = h < -s.half ? -s.half : h > s.half ? s.half : h;
      const dx = qx - a.x * k;
      const dy = qy - a.y * k;
      const dz = qz - a.z * k;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - s.r;
    }
    const rx = qx - a.x * h;
    const ry = qy - a.y * h;
    const rz = qz - a.z * h;
    const radial = Math.sqrt(rx * rx + ry * ry + rz * rz) - s.R;
    return Math.sqrt(radial * radial + h * h) - s.r;
  }

  /** Bounding radius around the centre. */
  get reach(): number {
    const s = this.def.shape;
    return s.kind === 'sphere' ? s.r : s.kind === 'capsule' ? s.half + s.r : s.R + s.r;
  }
}

const ring = (n: number, radius: number, y: number, phase = 0): [number, number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = phase + (TWO_PI * i) / n;
    return [dcos(a) * radius, y, dsin(a) * radius];
  });

/** The obstacles of each level, by level id. */
export const LEVEL_OBSTACLES: Readonly<Record<string, readonly ObstacleDef[]>> = {
  // Floating sky islands and a whale circling above the clouds.
  'cloud-sea': [
    { shape: { kind: 'sphere', r: 8 }, at: [0, 30, 0], bob: [3, 9], look: 'island' },
    { shape: { kind: 'sphere', r: 6.5 }, at: [26, -12, -22], bob: [2.5, 7], look: 'island' },
    { shape: { kind: 'sphere', r: 6 }, at: [-24, -6, 24], bob: [2, 11], look: 'island' },
    // The whale always faces the way it swims: its axis turns with its orbit.
    { shape: { kind: 'capsule', r: 4, half: 9, axis: [0, 0, 1] }, at: [72, 42, 0], orbit: 0.09, spin: 0.09, look: 'whale' },
  ],
  // Thunder spires around the eye of the storm.
  'storm-eye': ring(3, 34, 0, 0.5).map((at) => ({ shape: { kind: 'capsule' as const, r: 2.6, half: 24, axis: [0, 1, 0] as [number, number, number] }, at, look: 'spire' })),
  // Leaning ice crystals.
  'frost-heights': [
    { shape: { kind: 'capsule', r: 3, half: 13, axis: [0.35, 1, 0.15] }, at: [18, 6, 10], look: 'crystal' },
    { shape: { kind: 'capsule', r: 2.6, half: 11, axis: [-0.3, 1, 0.4] }, at: [-16, -4, -14], look: 'crystal' },
    { shape: { kind: 'capsule', r: 3.2, half: 15, axis: [0.2, 1, -0.45] }, at: [-6, 24, 22], look: 'crystal' },
    { shape: { kind: 'capsule', r: 2.4, half: 10, axis: [-0.5, 1, -0.2] }, at: [84, 4, -30], look: 'crystal' },
  ],
  // A stack of turning turbine rings: fly through them, not into them.
  'jet-stream': [
    { shape: { kind: 'torus', R: 15, r: 1.7, axis: [1, 0, 0] }, at: [0, 2, 0], spin: 0.22, look: 'turbine' },
    { shape: { kind: 'torus', R: 11, r: 1.5, axis: [0, 0, 1] }, at: [0, 33, 0], spin: -0.3, look: 'turbine' },
  ],
  // Two arches of light crossing over the middle.
  aurora: [
    { shape: { kind: 'torus', R: 31, r: 2, axis: [1, 0, 0] }, at: [0, -35, 0], look: 'arch' },
    { shape: { kind: 'torus', R: 31, r: 2, axis: [0, 0, 1] }, at: [0, -35, 0], look: 'arch' },
  ],
  // A space station with a ring, and a satellite going round.
  orbit: [
    { shape: { kind: 'capsule', r: 4, half: 9, axis: [0, 1, 0] }, at: [0, 22, 0], look: 'hub' },
    { shape: { kind: 'torus', R: 19, r: 1.4, axis: [0, 1, 0] }, at: [0, 22, 0], spin: 0.1, look: 'station' },
    { shape: { kind: 'sphere', r: 3.2 }, at: [31, -2, 0], orbit: 0.16, look: 'satellite' },
  ],
  // Drifting asteroids.
  'moon-shadow': [
    { shape: { kind: 'sphere', r: 6.5 }, at: [28, 4, 0], orbit: 0.06, bob: [3, 13], look: 'asteroid' },
    { shape: { kind: 'sphere', r: 4.5 }, at: [-22, 20, 12], orbit: 0.09, bob: [2, 9], look: 'asteroid' },
    { shape: { kind: 'sphere', r: 5.5 }, at: [-6, -12, -30], orbit: -0.07, bob: [2.5, 11], look: 'asteroid' },
    { shape: { kind: 'sphere', r: 3.8 }, at: [10, 30, 24], orbit: 0.11, look: 'asteroid' },
    { shape: { kind: 'sphere', r: 4 }, at: [0, -2, 0], bob: [5, 17], look: 'asteroid' },
  ],
  // Three gates on a circle: fly through the middle.
  'ring-world': ring(3, 30, 12, 0.3).map((at) => ({
    shape: { kind: 'torus' as const, R: 12, r: 1.6, axis: [-at[2] / 30, 0, at[0] / 30] as [number, number, number] },
    at,
    look: 'gate',
  })),
  // Plasma orbs circling at different heights and speeds.
  nebula: [
    { shape: { kind: 'sphere', r: 5 }, at: [22, 0, 0], orbit: 0.2, bob: [3, 8], look: 'orb' },
    { shape: { kind: 'sphere', r: 4.5 }, at: [-22, 16, 0], orbit: -0.16, bob: [3, 10], look: 'orb' },
    { shape: { kind: 'sphere', r: 4 }, at: [0, 32, 22], orbit: 0.12, bob: [2, 6], look: 'orb' },
  ],
  // Lattice beams turning above and below the core.
  'lattice-core': [
    { shape: { kind: 'capsule', r: 1.7, half: 21, axis: [1, 0, 0] }, at: [0, 16, 0], spin: 0.14, look: 'beam' },
    { shape: { kind: 'capsule', r: 1.7, half: 21, axis: [0, 0, 1] }, at: [0, -16, 0], spin: -0.11, look: 'beam' },
    { shape: { kind: 'capsule', r: 1.5, half: 17, axis: [1, 0, 1] }, at: [0, 32, 0], spin: 0.09, look: 'beam' },
  ],
};

/** What to call them in crash messages. */
export const OBSTACLE_NAMES: Readonly<Record<string, string>> = {
  island: 'a sky island',
  whale: 'the sky whale',
  spire: 'a thunder spire',
  crystal: 'an ice crystal',
  turbine: 'a turbine ring',
  arch: 'an arch of light',
  hub: 'the space station',
  station: 'the station ring',
  satellite: 'a satellite',
  asteroid: 'an asteroid',
  gate: 'a ring gate',
  orb: 'a plasma orb',
  beam: 'a lattice beam',
};
