import { COUNTDOWN_TICKS, TICK_RATE } from './config';
import type { Difficulty, LevelId, PilotInput } from './types';
import { World, type WorldSetup } from './world';

export const BOT_NAMES = ['Vega', 'Orion', 'Lumen', 'Nova', 'Polaris', 'Zirrus', 'Skyla'];

/** Everything needed to recreate a solo round exactly. */
export interface SoloSetup {
  level: LevelId;
  seed: number;
  bots: number;
  difficulty: Difficulty;
  /** The player's auto-horizon setting. */
  assist: boolean;
}

export function soloWorldSetup(s: SoloSetup, callsign: string): WorldSetup {
  const pilots: WorldSetup['pilots'] = [{ name: callsign, isBot: false, assist: s.assist, skill: s.difficulty }];
  for (let i = 0; i < s.bots; i++) {
    pilots.push({ name: BOT_NAMES[i % BOT_NAMES.length], isBot: true, assist: true, skill: s.difficulty });
  }
  return { level: s.level, seed: s.seed, pilots };
}

export const DIFFICULTY_FACTOR: Record<Difficulty, number> = { rookie: 1, pilot: 1.5, ace: 2 };

export const POINTS = {
  perSecond: 10,
  perPilotOutlasted: 100,
  perCutoff: 250,
  perRing: 50,
  win: 500,
} as const;

export interface SoloScore {
  score: number;
  /** Seconds in the air after the start. */
  time: number;
  won: boolean;
  place: number;
  pilots: number;
  /** Pilots that went down before you. */
  outlasted: number;
  /** Pilots that crashed into your wall. */
  cutoffs: number;
  rings: number;
  factor: number;
}

/** The player's result is final once they crashed or the round is over. */
export function playerFinished(w: World, player: number): boolean {
  return !w.gliders[player].alive || w.phase === 'over';
}

/** Score of a finished solo round. Same world, same score: on every device and on the server. */
export function soloScore(w: World, player: number, difficulty: Difficulty): SoloScore {
  const g = w.gliders[player];
  const won = g.alive && w.winner === player;
  const endTick = g.alive ? (w.overTick >= 0 ? w.overTick : w.tick) : g.crashTick;
  const time = Math.max(0, endTick - COUNTDOWN_TICKS) / TICK_RATE;
  const pilots = w.gliders.length;
  const place = won ? 1 : g.place || w.aliveCount() + 1;
  const outlasted = Math.max(0, pilots - place);
  let cutoffs = 0;
  for (const o of w.gliders) {
    if (o.id === player || !o.crash || o.crash.kind !== 'wall' || o.crash.by !== player) continue;
    if (o.crashTick <= endTick) cutoffs++;
  }
  const factor = DIFFICULTY_FACTOR[difficulty];
  const base =
    time * POINTS.perSecond +
    outlasted * POINTS.perPilotOutlasted +
    cutoffs * POINTS.perCutoff +
    g.rings * POINTS.perRing +
    (won ? POINTS.win : 0);
  return { score: Math.round(base * factor), time, won, place, pilots, outlasted, cutoffs, rings: g.rings, factor };
}

/**
 * Replays a recorded solo round with the given inputs, one per tick from the very
 * first tick. Returns the result and the number of ticks used, or null when the
 * inputs end before the player's round is over.
 */
export function replaySolo(setup: SoloSetup, inputs: readonly PilotInput[]): { result: SoloScore; ticks: number } | null {
  const w = new World(soloWorldSetup(setup, 'replay'));
  for (let i = 0; i < inputs.length; i++) {
    w.step([inputs[i]]);
    if (playerFinished(w, 0)) return { result: soloScore(w, 0, setup.difficulty), ticks: i + 1 };
  }
  return null;
}
