import type { PowerId } from './powerups';
import type { SpecialKind } from './ships';

export type LevelId =
  | 'cloud-sea'
  | 'storm-eye'
  | 'frost-heights'
  | 'jet-stream'
  | 'aurora'
  | 'orbit'
  | 'moon-shadow'
  | 'ring-world'
  | 'nebula'
  | 'lattice-core';
export type Difficulty = 'rookie' | 'pilot' | 'ace';

/** What a pilot wants to do during one tick. All axes run from -1 to 1. */
export interface PilotInput {
  /** Positive turns right. */
  steerX: number;
  /** Positive lifts the nose. */
  steerY: number;
  /** Positive rolls right. */
  roll: number;
  boost: boolean;
  /** Fire the gun. Held down it keeps firing until the gun overheats. */
  fire?: boolean;
  /** Use the ship's special ability. */
  special?: boolean;
}

export const NEUTRAL_INPUT: Readonly<PilotInput> = { steerX: 0, steerY: 0, roll: 0, boost: false, fire: false, special: false };

/** 'shot': shot down by another glider. 'left': online pilot who left the game during the round. */
export type CrashKind = 'wall' | 'shield' | 'floor' | 'ceiling' | 'collision' | 'lightning' | 'core' | 'shot' | 'left';

export interface CrashInfo {
  kind: CrashKind;
  /** Owner of the wall or the other glider, -1 if nobody. */
  by: number;
  /** Wall segment that was hit, -1 if none. */
  seg: number;
}

export type SimEvent =
  | { type: 'count'; n: number }
  | { type: 'go' }
  | { type: 'crash'; id: number; crash: CrashInfo }
  | { type: 'ring'; id: number; ring: number }
  /** Glider id fired a shot. */
  | { type: 'shot'; id: number; shot: number }
  /** Glider id was hit by a shot of glider by; hull is what is left. shield: the shield took it. */
  | { type: 'hit'; id: number; by: number; shot: number; hull: number; shield: boolean }
  | { type: 'overheat'; id: number }
  /** Glider id used its special ability. */
  | { type: 'special'; id: number; kind: SpecialKind }
  /** Glider id flew through ring `ring` (placed for the n-th time) and got a power-up. */
  | { type: 'power'; id: number; power: PowerId; ring: number; n: number }
  /** The shield of glider id took a wall. */
  | { type: 'shield'; id: number }
  /** A shockwave jammed the gun of glider id. */
  | { type: 'jam'; id: number }
  | { type: 'bolt-warn'; bolt: number }
  | { type: 'bolt-strike'; bolt: number }
  | { type: 'shrink' }
  | { type: 'over'; winner: number };

export type Phase = 'countdown' | 'flying' | 'over';
