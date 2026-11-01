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
  /**
   * A waterfall pours from the obstacle down to the floor: offset from the
   * centre (x, z) and its radius. Only for the eye and the ears: flying
   * through it is harmless and just splashes.
   */
  readonly fall?: { dx: number; dz: number; r: number };
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

/**
 * The obstacles of each level, by level id: only a few, mostly glass, some
 * glass and rock, a few with waterfalls. The arenas are about 200 m across
 * their radius, so they leave plenty of room.
 */
export const LEVEL_OBSTACLES: Readonly<Record<string, readonly ObstacleDef[]>> = {
  // Glass islands with rock bellies and waterfalls, and a glass whale circling high above.
  'cloud-sea': [
    { shape: { kind: 'sphere', r: 13 }, at: [0, 46, 0], bob: [4, 10], look: 'island', fall: { dx: 8, dz: 4, r: 3.2 } },
    { shape: { kind: 'sphere', r: 9 }, at: [-74, -6, 84], bob: [3, 8], look: 'island', fall: { dx: -5, dz: 5, r: 2.4 } },
    // The whale always faces the way it swims: its axis turns with its orbit.
    { shape: { kind: 'capsule', r: 5, half: 12, axis: [0, 0, 1] }, at: [140, 78, 0], orbit: 0.07, spin: 0.07, look: 'whale' },
  ],
  // Two glass thunder spires beside the eye of the storm.
  'storm-eye': ring(2, 82, 10, 0.5).map((at) => ({ shape: { kind: 'capsule' as const, r: 4, half: 44, axis: [0, 1, 0] as [number, number, number] }, at, look: 'spire' })),
  // Leaning ice crystals and a rock with a frozen glass top that still drips.
  'frost-heights': [
    { shape: { kind: 'capsule', r: 5, half: 22, axis: [0.35, 1, 0.15] }, at: [44, 14, 24], look: 'crystal' },
    { shape: { kind: 'capsule', r: 4.5, half: 18, axis: [-0.3, 1, 0.4] }, at: [-40, -2, -34], look: 'crystal' },
    { shape: { kind: 'sphere', r: 11 }, at: [-20, 48, 60], bob: [3, 12], look: 'geode', fall: { dx: 6, dz: -5, r: 2.6 } },
  ],
  // One big glass turbine ring: fly through it, not into it.
  'jet-stream': [{ shape: { kind: 'torus', R: 28, r: 2.6, axis: [1, 0, 0] }, at: [0, 10, 0], spin: 0.18, look: 'turbine' }],
  // A glass arch of light rising out of the floor, and a geode with a waterfall.
  aurora: [
    { shape: { kind: 'torus', R: 62, r: 3.2, axis: [1, 0, 0] }, at: [0, -70, 0], look: 'arch' },
    { shape: { kind: 'sphere', r: 10 }, at: [96, 34, -70], bob: [3, 11], look: 'geode', fall: { dx: -6, dz: 3, r: 2.6 } },
  ],
  // A glass space station with a turning ring, and a satellite going round.
  orbit: [
    { shape: { kind: 'capsule', r: 6, half: 13, axis: [0, 1, 0] }, at: [0, 46, 0], look: 'hub' },
    { shape: { kind: 'torus', R: 28, r: 2, axis: [0, 1, 0] }, at: [0, 46, 0], spin: 0.08, look: 'station' },
    { shape: { kind: 'sphere', r: 4.5 }, at: [78, -4, 0], orbit: 0.12, look: 'satellite' },
  ],
  // Drifting rocks with glass crystals growing out of them.
  'moon-shadow': [
    { shape: { kind: 'sphere', r: 10 }, at: [66, 10, 0], orbit: 0.05, bob: [4, 13], look: 'asteroid' },
    { shape: { kind: 'sphere', r: 7 }, at: [-52, 40, 30], orbit: 0.07, bob: [3, 9], look: 'asteroid' },
    { shape: { kind: 'sphere', r: 8 }, at: [-10, -24, -78], orbit: -0.06, bob: [3, 11], look: 'asteroid' },
  ],
  // Three glass gates on a circle: fly through the middle.
  'ring-world': ring(3, 74, 22, 0.3).map((at) => ({
    shape: { kind: 'torus' as const, R: 18, r: 2.2, axis: [-at[2] / 74, 0, at[0] / 74] as [number, number, number] },
    at,
    look: 'gate',
  })),
  // Glass bubbles with glowing rock hearts, circling at different heights.
  nebula: [
    { shape: { kind: 'sphere', r: 8 }, at: [56, 0, 0], orbit: 0.14, bob: [4, 8], look: 'orb' },
    { shape: { kind: 'sphere', r: 7 }, at: [-50, 40, 0], orbit: -0.11, bob: [4, 10], look: 'orb' },
  ],
  // Glass beams turning above and below the core.
  'lattice-core': [
    { shape: { kind: 'capsule', r: 2.6, half: 40, axis: [1, 0, 0] }, at: [0, 40, 0], spin: 0.12, look: 'beam' },
    { shape: { kind: 'capsule', r: 2.6, half: 40, axis: [0, 0, 1] }, at: [0, -40, 0], spin: -0.09, look: 'beam' },
  ],
};

/** What to call them in crash messages. */
export const OBSTACLE_NAMES: Readonly<Record<string, string>> = {
  island: 'a glass island',
  whale: 'the glass whale',
  spire: 'a glass spire',
  crystal: 'an ice crystal',
  geode: 'a glass rock',
  turbine: 'the glass turbine',
  arch: 'the arch of light',
  hub: 'the space station',
  station: 'the station ring',
  satellite: 'a satellite',
  asteroid: 'an asteroid',
  gate: 'a glass gate',
  orb: 'a glass orb',
  beam: 'a glass beam',
};
