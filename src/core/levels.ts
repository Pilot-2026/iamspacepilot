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
  name: string;
  altitude: string;
  floorName: string;
  arena: ArenaSpec;
  /** Boost rings floating in the arena. */
  rings: number;
  /** Rising air in the middle of the arena. */
  updraft: { radius: number; strength: number } | null;
  /** Lightning strikes that leave a deadly bolt for a few seconds. */
  lightning: boolean;
}

export const LEVELS: Record<LevelId, LevelSpec> = {
  'cloud-sea': {
    id: 'cloud-sea',
    name: 'Cloud Sea',
    altitude: '3 km',
    floorName: 'the cloud sea',
    arena: {
      kind: 'dome',
      radius: 110,
      minRadius: 45,
      floorY: -40,
      ceilY: 1e9,
      shrinkStart: 30,
      shrinkEnd: 90,
    },
    rings: 5,
    updraft: null,
    lightning: false,
  },
  'storm-eye': {
    id: 'storm-eye',
    name: 'Storm Eye',
    altitude: '12 km',
    floorName: 'the storm',
    arena: {
      kind: 'cylinder',
      radius: 100,
      minRadius: 45,
      floorY: -55,
      ceilY: 70,
      shrinkStart: 30,
      shrinkEnd: 90,
    },
    rings: 0,
    updraft: { radius: 18, strength: 9 },
    lightning: true,
  },
};

export const LEVEL_ORDER: LevelId[] = ['cloud-sea', 'storm-eye'];
