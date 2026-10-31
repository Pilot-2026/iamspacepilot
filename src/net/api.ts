import { CORE_VERSION } from '../core/config';
import type { SoloSetup } from '../core/solo';
import type { LevelId } from '../core/types';

/** One pilot on the online leaderboard. */
export interface BoardRow {
  callsign: string;
  score: number;
  time: number;
  won: boolean;
  difficulty: string;
  bots: number;
  at: string;
}

export type BoardResult = { ok: true; rows: BoardRow[] } | { ok: false; error: string };

export type SubmitResult =
  | { ok: true; score: number; best: number; improved: boolean; rank: number }
  | { ok: false; error: string };

export async function request(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, body };
  } finally {
    window.clearTimeout(timer);
  }
}

/** The 50 best pilots of a level. */
export async function fetchBoard(level: LevelId): Promise<BoardResult> {
  try {
    const { status, body } = await request(`/api/leaderboard?level=${encodeURIComponent(level)}`);
    if (status === 200 && body && Array.isArray(body.rows)) return { ok: true, rows: body.rows as BoardRow[] };
    return { ok: false, error: String(body?.error ?? (status === 404 ? 'not-configured' : 'store')) };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

/** Sends a finished solo flight. The server replays it before the score counts. */
export async function submitScore(p: { callsign: string; key: string; setup: SoloSetup; replay: string; score: number }): Promise<SubmitResult> {
  try {
    const { status, body } = await request('/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: CORE_VERSION, ...p }),
    });
    if (status === 200 && body?.ok) {
      return { ok: true, score: Number(body.score), best: Number(body.best), improved: Boolean(body.improved), rank: Number(body.rank) };
    }
    return { ok: false, error: String(body?.error ?? (status === 404 ? 'not-configured' : 'store')) };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

/** Plain-language explanation for an online error. */
export function onlineErrorText(error: string): string {
  switch (error) {
    case 'not-configured':
      return 'The online leaderboard is not set up yet. Your score is saved on this device.';
    case 'offline':
      return 'No connection. Your score is saved on this device.';
    case 'callsign-taken':
      return 'Another pilot already owns this callsign online. Pick a new one in Settings to post your scores.';
    case 'outdated':
      return 'A new version of the game is out. Reload the page to post scores again.';
    case 'mismatch':
    case 'unfinished':
      return 'The server could not confirm this flight, so it was not posted.';
    default:
      return 'The online leaderboard is not reachable right now. Your score is saved on this device.';
  }
}
