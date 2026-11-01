import { COUNTDOWN_TICKS, TICK_RATE } from './config';
import { botShip, type ShipId } from './ships';
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
  /** The player's ship. */
  ship: ShipId;
}

export function soloWorldSetup(s: SoloSetup, callsign: string): WorldSetup {
  const pilots: WorldSetup['pilots'] = [{ name: callsign, isBot: false, assist: s.assist, skill: s.difficulty, ship: s.ship }];
  for (let i = 0; i < s.bots; i++) {
    pilots.push({ name: BOT_NAMES[i % BOT_NAMES.length], isBot: true, assist: true, skill: s.difficulty, ship: botShip(s.seed, i) });
  }
  return { level: s.level, seed: s.seed, pilots, pace: PACE[s.difficulty] };
}

export const DIFFICULTY_FACTOR: Record<Difficulty, number> = { rookie: 1, pilot: 1.5, ace: 2 };

/** How fast everyone flies: Rookie much slower, Pilot as designed, Ace faster. */
export const PACE: Record<Difficulty, number> = { rookie: 0.6, pilot: 1, ace: 1.25 };

export const POINTS = {
  perSecond: 10,
  perPilotOutlasted: 100,
  perCutoff: 250,
  perShotDown: 200,
  perHit: 25,
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
  /** Pilots you shot down. */
  shotDowns: number;
  /** Hits you landed. */
  hits: number;
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
  let shotDowns = 0;
  for (const o of w.gliders) {
    if (o.id === player || !o.crash || o.crash.by !== player || o.crashTick > endTick) continue;
    if (o.crash.kind === 'wall') cutoffs++;
    else if (o.crash.kind === 'shot') shotDowns++;
  }
  const factor = DIFFICULTY_FACTOR[difficulty];
  const base =
    time * POINTS.perSecond +
    outlasted * POINTS.perPilotOutlasted +
    cutoffs * POINTS.perCutoff +
    shotDowns * POINTS.perShotDown +
    g.hits * POINTS.perHit +
    g.rings * POINTS.perRing +
    (won ? POINTS.win : 0);
  return { score: Math.round(base * factor), time, won, place, pilots, outlasted, cutoffs, shotDowns, hits: g.hits, rings: g.rings, factor };
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

/** Score so far while the round is still running, for the HUD. */
export function liveScore(w: World, player: number, difficulty: Difficulty): number {
  const g = w.gliders[player];
  if (!g.alive || w.phase === 'over') return soloScore(w, player, difficulty).score;
  const time = w.phase === 'countdown' ? 0 : w.flyTicks / TICK_RATE;
  let down = 0;
  let cutoffs = 0;
  let shotDowns = 0;
  for (const o of w.gliders) {
    if (o.id === player) continue;
    if (!o.alive) down++;
    if (o.crash && o.crash.by === player) {
      if (o.crash.kind === 'wall') cutoffs++;
      else if (o.crash.kind === 'shot') shotDowns++;
    }
  }
  const base =
    time * POINTS.perSecond +
    down * POINTS.perPilotOutlasted +
    cutoffs * POINTS.perCutoff +
    shotDowns * POINTS.perShotDown +
    g.hits * POINTS.perHit +
    g.rings * POINTS.perRing;
  return Math.round(base * DIFFICULTY_FACTOR[difficulty]);
}
