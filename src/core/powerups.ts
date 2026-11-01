import { TICK_RATE } from './config';

/**
 * Bonus rings: flying through a ring gives boost and one of these power-ups.
 * Every ring shows its power-up by colour before you reach it.
 */

export type PowerId = 'triple' | 'bigwall' | 'shield' | 'rapid' | 'turbo' | 'seeker' | 'repair';

export interface PowerSpec {
  readonly id: PowerId;
  readonly name: string;
  readonly text: string;
  /** Ticks it lasts; 0 = instant. The shield lasts until it is used up or this runs out. */
  readonly duration: number;
  /** Colour of the ring and the HUD chip. */
  readonly color: number;
}

export const POWERS: Readonly<Record<PowerId, PowerSpec>> = {
  triple: { id: 'triple', name: 'Triple shot', text: 'Every shot is three.', duration: 12 * TICK_RATE, color: 0xff6a3d },
  bigwall: { id: 'bigwall', name: 'Big wall', text: 'Your wall grows almost twice as high.', duration: 12 * TICK_RATE, color: 0x7dffb0 },
  shield: { id: 'shield', name: 'Shield', text: 'Absorbs the next hit or the next wall.', duration: 20 * TICK_RATE, color: 0x5ad1ff },
  rapid: { id: 'rapid', name: 'Cool gun', text: 'Fires twice as fast and never overheats.', duration: 10 * TICK_RATE, color: 0xffd23d },
  turbo: { id: 'turbo', name: 'Turbo', text: 'Endless boost.', duration: 6 * TICK_RATE, color: 0xff4fd8 },
  seeker: { id: 'seeker', name: 'Seeker', text: 'Your shots hunt their targets.', duration: 12 * TICK_RATE, color: 0xb48cff },
  repair: { id: 'repair', name: 'Repair', text: 'Repairs one hit and fills the boost.', duration: 0, color: 0xffffff },
};

export const POWER_ORDER: readonly PowerId[] = ['triple', 'bigwall', 'shield', 'rapid', 'turbo', 'seeker', 'repair'];

export const isPower = (v: unknown): v is PowerId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(POWERS, v);

/** Mixes the round seed, the ring and how often it was placed into one number (same on every device). */
export function ringHash(seed: number, ring: number, n: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (ring + 1), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (n + 0x1234), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Big wall makes new wall pieces this much higher. */
export const BIG_WALL = 1.8;
/** Rapid fire: ticks between shots. */
export const RAPID_INTERVAL = 6;
/** Seeker shots turn this much harder, in a wider cone. */
export const SEEKER_HOMING = 3;
export const SEEKER_CONE = 0.6;
