import { liveScore } from '../core/solo';
import type { Difficulty } from '../core/types';
import type { World } from '../core/world';
import type { RadioEntry } from './livekit';
import type { NetPilot } from './match';

/** One line of the pilot board shown during an online round. */
export interface BoardRow {
  name: string;
  /** Glider in the round, -1 for a pilot who waits for the next round. */
  glider: number;
  /** Points in this round so far, null while waiting. */
  points: number | null;
  /** Rounds won in this game; bots do not count wins (-1). */
  wins: number;
  you: boolean;
  bot: boolean;
  /** Crashed in this round. */
  down: boolean;
  /** Left the game during the round. */
  gone: boolean;
  talking: boolean;
}

/**
 * Everybody in the round (pilots and bots) with their points so far, most
 * points first, then the pilots in the room who wait for the next round.
 */
export function boardRows(
  world: World | null,
  pilots: readonly NetPilot[],
  local: number,
  difficulty: Difficulty,
  wins: ReadonlyMap<string, number>,
  room: readonly RadioEntry[],
  talkingSelf: boolean,
): BoardRow[] {
  const inRoom = new Map(room.map((r) => [r.identity, r]));
  const flying = new Set<string>();
  const rows: BoardRow[] = [];
  if (world) {
    pilots.forEach((p, i) => {
      const g = world.gliders[i];
      if (!g) return;
      if (!p.bot) flying.add(p.identity);
      const r = inRoom.get(p.identity);
      const you = i === local;
      rows.push({
        name: p.name,
        glider: i,
        points: liveScore(world, i, difficulty),
        wins: p.bot ? -1 : (wins.get(p.identity) ?? 0),
        you,
        bot: p.bot,
        down: !g.alive,
        gone: !p.bot && !r,
        talking: you ? talkingSelf : !!r && r.speaking && !r.muted,
      });
    });
    rows.sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || a.glider - b.glider);
  }
  for (const r of room) {
    if (flying.has(r.identity)) continue;
    rows.push({
      name: r.name,
      glider: -1,
      points: null,
      wins: wins.get(r.identity) ?? 0,
      you: r.local,
      bot: false,
      down: false,
      gone: false,
      talking: r.local ? talkingSelf : r.speaking && !r.muted,
    });
  }
  return rows;
}
