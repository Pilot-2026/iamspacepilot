import type { Difficulty, LevelId } from '../core/types';
import { GAME_VERSION, type Mode } from '../online/match';
import { request } from './api';

/** One public game in the "who is online?" list. */
export interface GameListing {
  code: string;
  host: string;
  level: LevelId;
  levelName: string;
  mode: Mode;
  status: 'lobby' | 'flying';
  players: number;
  max: number;
  round: number;
  protocol: string;
}

export type ListResult = { ok: true; games: GameListing[]; online: number } | { ok: false; error: string };

export interface GameMeta {
  host: string;
  level: LevelId;
  mode: Mode;
  public: boolean;
  status: 'lobby' | 'flying';
  bots: number;
  round: number;
}

/** What a device needs to enter a game room. */
export interface Ticket {
  url: string;
  token: string;
  identity: string;
  code: string;
  meta: GameMeta;
}

export type TicketResult = { ok: true; ticket: Ticket } | { ok: false; error: string };

const errorOf = (status: number, body: Record<string, unknown> | null) =>
  String(body?.error ?? (status === 404 ? 'not-configured' : status >= 500 ? 'server' : 'bad-request'));

/** Public games running right now and how many pilots are online. */
export async function listGames(): Promise<ListResult> {
  try {
    const { status, body } = await request('/api/games');
    if (status === 200 && body && Array.isArray(body.games)) {
      return { ok: true, games: body.games as GameListing[], online: Number(body.online ?? 0) };
    }
    return { ok: false, error: errorOf(status, body) };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

async function ticket(payload: Record<string, unknown>): Promise<TicketResult> {
  try {
    const { status, body } = await request('/api/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: GAME_VERSION, ...payload }),
    });
    if (status === 200 && body && typeof body.token === 'string' && typeof body.url === 'string') {
      return { ok: true, ticket: body as unknown as Ticket };
    }
    return { ok: false, error: errorOf(status, body) };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

export function hostGame(p: {
  callsign: string;
  key: string;
  level: LevelId;
  mode: Mode;
  public: boolean;
  bots: number;
  difficulty: Difficulty;
}): Promise<TicketResult> {
  return ticket({ action: 'host', callsign: p.callsign, key: p.key, level: p.level, mode: p.mode, public: p.public, bots: p.bots });
}

export function joinGame(p: { callsign: string; key: string; code: string }): Promise<TicketResult> {
  return ticket({ action: 'join', callsign: p.callsign, key: p.key, code: p.code.toUpperCase() });
}

/** Host: keeps the game list entry up to date. */
export async function updateGame(p: {
  callsign: string;
  key: string;
  code: string;
  level?: LevelId;
  mode?: Mode;
  public?: boolean;
  bots?: number;
  status?: 'lobby' | 'flying';
  round?: number;
  takeover?: boolean;
}): Promise<boolean> {
  try {
    const { status } = await request('/api/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'update', protocol: GAME_VERSION, ...p }),
    });
    return status === 200;
  } catch {
    return false;
  }
}

/** Plain-language explanation for an error while going online. */
export function gameErrorText(error: string): string {
  switch (error) {
    case 'not-configured':
      return 'Online games are not set up on this server yet.';
    case 'offline':
      return 'No connection to the server. Check your internet and try again.';
    case 'no-game':
      return 'There is no game with this code. It may have ended.';
    case 'full':
      return 'This game is full: 8 pilots are already in.';
    case 'outdated':
      return 'This game runs a different version. Reload the page, then try again.';
    case 'callsign-taken':
      return 'Another pilot already owns this callsign online. Pick a new one in Settings.';
    case 'bad-callsign':
      return 'Your callsign is not allowed online. Pick a new one in Settings.';
    case 'bad-code':
      return 'A game code has 5 letters or numbers.';
    case 'busy':
      return 'The server is busy. Try again in a moment.';
    case 'livekit':
      return 'The radio server did not answer. Try again in a moment.';
    default:
      return 'Something went wrong. Try again in a moment.';
  }
}
