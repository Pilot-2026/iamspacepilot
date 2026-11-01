import type { LevelId } from './types';

export interface ArenaSpec {
  /** dome: a sphere around the origin. cylinder: a vertical tube around the y axis. */
  kind: 'dome' | 'cylinder';
  radius: number;
  minRadius: number;
  floorY: number;
  ceilY: number;
  /** Seconds after the start when the arena begins to shrink. */
  shrinkStart: number;
  /** Seconds after the start when the arena reaches its smallest size. */
  shrinkEnd: number;
}

export interface LevelSpec {
  id: LevelId;
  /** 1 to 10, the order in which levels unlock. */
  index: number;
  name: string;
  altitude: string;
  /** Used in crash messages: "fell into ...". */
  floorName: string;
  /** Short label for the HUD distance warning. */
  floorLabel: string;
  arena: ArenaSpec;
  /** Boost rings floating in the arena. */
  rings: number;
  /** Rising air in the middle of the arena. */
  updraft: { radius: number; strength: number } | null;
  /** Lightning strikes that leave a deadly bolt for a few seconds. */
  lightning: boolean;
  /** Constant wind that pushes every glider, in metres per second. */
  wind: { x: number; z: number } | null;
  /** A deadly core in the centre that pulls gliders in. */
  core: { radius: number; pull: number; reach: number } | null;
}

/** All arenas are twice the size they were designed at: more room to fly. */
const SCALE = 2;

const dome = (radius: number, minRadius: number, floorY: number): ArenaSpec => ({
  kind: 'dome',
  radius: radius * SCALE,
  minRadius: minRadius * SCALE,
  floorY: floorY * SCALE,
  ceilY: 1e9,
  shrinkStart: 30,
  shrinkEnd: 90,
});

const tube = (radius: number, minRadius: number, floorY: number, ceilY: number): ArenaSpec => ({
  kind: 'cylinder',
  radius: radius * SCALE,
  minRadius: minRadius * SCALE,
  floorY: floorY * SCALE,
  ceilY: ceilY * SCALE,
  shrinkStart: 30,
  shrinkEnd: 90,
});

const base = { rings: 0, updraft: null, lightning: false, wind: null, core: null };

export const LEVELS: Record<LevelId, LevelSpec> = {
  'cloud-sea': {
    ...base,
    id: 'cloud-sea',
    index: 1,
    name: 'Cloud Sea',
    altitude: '3 km',
    floorName: 'the cloud sea',
    floorLabel: 'Cloud sea',
    arena: dome(110, 45, -40),
    rings: 8,
  },
  'storm-eye': {
    ...base,
    id: 'storm-eye',
    index: 2,
    name: 'Storm Eye',
    altitude: '12 km',
    floorName: 'the storm',
    floorLabel: 'Storm floor',
    arena: tube(100, 45, -55, 70),
    updraft: { radius: 36, strength: 9 },
    lightning: true,
  },
  'frost-heights': {
    ...base,
    id: 'frost-heights',
    index: 3,
    name: 'Frost Heights',
    altitude: '20 km',
    floorName: 'the cloud deck',
    floorLabel: 'Cloud deck',
    arena: dome(108, 44, -36),
    rings: 9,
  },
  'jet-stream': {
    ...base,
    id: 'jet-stream',
    index: 4,
    name: 'Jet Stream',
    altitude: '35 km',
    floorName: 'the lower air',
    floorLabel: 'Low air',
    arena: tube(115, 48, -40, 50),
    rings: 5,
    wind: { x: 5, z: 0 },
  },
  aurora: {
    ...base,
    id: 'aurora',
    index: 5,
    name: 'Aurora',
    altitude: '110 km',
    floorName: 'the atmosphere',
    floorLabel: 'Atmosphere',
    arena: tube(110, 45, -35, 45),
    rings: 6,
  },
  orbit: {
    ...base,
    id: 'orbit',
    index: 6,
    name: 'Orbit',
    altitude: '400 km',
    floorName: 'the atmosphere',
    floorLabel: 'Atmosphere',
    arena: dome(105, 45, -45),
    rings: 6,
  },
  'moon-shadow': {
    ...base,
    id: 'moon-shadow',
    index: 7,
    name: 'Moon Shadow',
    altitude: '384,000 km',
    floorName: 'the moon',
    floorLabel: 'Moon',
    arena: dome(100, 42, -30),
    rings: 5,
  },
  'ring-world': {
    ...base,
    id: 'ring-world',
    index: 8,
    name: 'Ring World',
    altitude: '1.4 bn km',
    floorName: 'the rings',
    floorLabel: 'Rings',
    arena: tube(118, 48, -36, 48),
    rings: 9,
  },
  nebula: {
    ...base,
    id: 'nebula',
    index: 9,
    name: 'Nebula',
    altitude: '1,300 light years',
    floorName: 'the nebula floor',
    floorLabel: 'Nebula floor',
    arena: dome(110, 45, -50),
    lightning: true,
  },
  'lattice-core': {
    ...base,
    id: 'lattice-core',
    index: 10,
    name: 'Lattice Core',
    altitude: 'Deep space',
    floorName: 'the lattice',
    floorLabel: 'Lattice',
    arena: dome(95, 42, -70),
    core: { radius: 9, pull: 7, reach: 120 },
  },
};

export const LEVEL_ORDER: LevelId[] = [
  'cloud-sea',
  'storm-eye',
  'frost-heights',
  'jet-stream',
  'aurora',
  'orbit',
  'moon-shadow',
  'ring-world',
  'nebula',
  'lattice-core',
];

/** The level after this one, or null after the last. */
export function nextLevel(id: LevelId): LevelId | null {
  const i = LEVEL_ORDER.indexOf(id);
  return i >= 0 && i < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[i + 1] : null;
}
