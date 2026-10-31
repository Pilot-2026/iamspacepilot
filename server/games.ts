import { randomInt } from 'node:crypto';
import { validateCallsign } from '../src/core/callsign';
import { MAX_ONLINE_PILOTS, NET_PROTOCOL } from '../src/core/config';
import { LEVELS } from '../src/core/levels';
import type { LevelId } from '../src/core/types';
import { sha256 } from './firestore';
import { claimCallsign, json, type Store } from './handlers';
import { LiveKitError, RoomService, liveKitFromEnv, signToken, type LiveKitConfig, type RoomInfo } from './livekit';

/**
 * Online games. Every game is a LiveKit room named "g-<CODE>". Its metadata
 * (JSON) tells the game list who hosts, which level and mode, and whether the
 * game is public. Game data and voice then flow through the room itself.
 */

export const MAX_PILOTS = MAX_ONLINE_PILOTS;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface GameMeta {
  v: 1;
  protocol: string;
  host: string;
  /** Short hash of the host's pilot key, so only the host can change the listing. */
  hostKey: string;
  level: LevelId;
  mode: 'ffa' | 'teams';
  public: boolean;
  status: 'lobby' | 'flying';
  bots: number;
  round: number;
}

export interface GameListing {
  code: string;
  host: string;
  level: LevelId;
  levelName: string;
  mode: 'ffa' | 'teams';
  status: 'lobby' | 'flying';
  players: number;
  max: number;
  round: number;
  protocol: string;
}

export interface GameDeps {
  lk: { cfg: LiveKitConfig; rooms: Pick<RoomService, 'listRooms' | 'createRoom' | 'updateRoomMetadata' | 'listParticipants'> } | null;
  store: Store | null;
  now?: () => Date;
}

export function gameDepsFromEnv(store: Store | null): GameDeps {
  const cfg = liveKitFromEnv();
  return { lk: cfg ? { cfg, rooms: new RoomService(cfg) } : null, store };
}

const isLevel = (v: unknown): v is LevelId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(LEVELS, v);
const keyHash = (key: string) => sha256(key).slice(0, 16);
const roomName = (code: string) => `g-${code}`;

export function identityFor(callsign: string, key: string): string {
  return `${callsign}~${sha256(key).slice(0, 6)}`;
}

export function parseMeta(raw: string): GameMeta | null {
  try {
    const m = JSON.parse(raw) as Partial<GameMeta>;
    if (m.v !== 1 || !isLevel(m.level) || typeof m.host !== 'string') return null;
    return {
      v: 1,
      protocol: String(m.protocol ?? ''),
      host: m.host,
      hostKey: String(m.hostKey ?? ''),
      level: m.level,
      mode: m.mode === 'teams' ? 'teams' : 'ffa',
      public: m.public !== false,
      status: m.status === 'flying' ? 'flying' : 'lobby',
      bots: Math.max(0, Math.min(7, Number(m.bots ?? 0) | 0)),
      round: Math.max(0, Number(m.round ?? 0) | 0),
    };
  } catch {
    return null;
  }
}

function listing(r: RoomInfo, m: GameMeta): GameListing {
  return {
    code: r.name.slice(2),
    host: m.host,
    level: m.level,
    levelName: LEVELS[m.level].name,
    mode: m.mode,
    status: m.status,
    players: r.numParticipants,
    max: MAX_PILOTS,
    round: m.round,
    protocol: m.protocol,
  };
}

/** GET /api/games: public games that are running right now, and how many pilots are online. */
export async function handleGames(req: Request, deps: GameDeps): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'method' });
  if (!deps.lk) return json(503, { error: 'not-configured' });
  try {
    const rooms = await deps.lk.rooms.listRooms();
    let online = 0;
    const games: GameListing[] = [];
    for (const r of rooms) {
      if (!r.name.startsWith('g-')) continue;
      online += r.numParticipants;
      const m = parseMeta(r.metadata);
      if (!m || !m.public || r.numParticipants === 0) continue;
      games.push(listing(r, m));
    }
    games.sort((a, b) => b.players - a.players || a.code.localeCompare(b.code));
    return json(200, { games, online }, { 'cache-control': 'public, max-age=3' });
  } catch (e) {
    console.error('games failed', e);
    return json(502, { error: 'livekit', detail: e instanceof LiveKitError ? e.message : 'unknown' });
  }
}

interface Ask {
  action: 'host' | 'join' | 'update';
  callsign: string;
  key: string;
  code?: string;
  level?: LevelId;
  mode?: 'ffa' | 'teams';
  public?: boolean;
  bots?: number;
  status?: 'lobby' | 'flying';
  round?: number;
  takeover?: boolean;
  protocol?: string;
}

function parseAsk(body: unknown): Ask | string {
  if (!body || typeof body !== 'object') return 'bad-request';
  const b = body as Record<string, unknown>;
  if (b.action !== 'host' && b.action !== 'join' && b.action !== 'update') return 'bad-action';
  if (typeof b.callsign !== 'string' || validateCallsign(b.callsign)) return 'bad-callsign';
  if (typeof b.key !== 'string' || !/^[0-9a-f]{32}$/.test(b.key)) return 'bad-key';
  if (b.action !== 'host' && (typeof b.code !== 'string' || !/^[A-Z0-9]{5}$/.test(b.code))) return 'bad-code';
  if (b.level !== undefined && !isLevel(b.level)) return 'bad-level';
  return {
    action: b.action,
    callsign: b.callsign.trim(),
    key: b.key,
    code: typeof b.code === 'string' ? b.code : undefined,
    level: b.level as LevelId | undefined,
    mode: b.mode === 'teams' ? 'teams' : b.mode === 'ffa' ? 'ffa' : undefined,
    public: typeof b.public === 'boolean' ? b.public : undefined,
    bots: typeof b.bots === 'number' ? Math.max(0, Math.min(7, b.bots | 0)) : undefined,
    status: b.status === 'flying' ? 'flying' : b.status === 'lobby' ? 'lobby' : undefined,
    round: typeof b.round === 'number' ? Math.max(0, b.round | 0) : undefined,
    takeover: b.takeover === true,
    protocol: typeof b.protocol === 'string' && /^[a-z0-9.-]{1,16}$/.test(b.protocol) ? b.protocol : undefined,
  };
}

function ticket(cfg: LiveKitConfig, code: string, callsign: string, key: string) {
  const identity = identityFor(callsign, key);
  const token = signToken(cfg, {
    identity,
    name: callsign,
    video: { room: roomName(code), roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  });
  return { url: cfg.url, token, identity, code };
}

/** POST /api/game: host a new game, join one by code, or update the game list entry. */
export async function handleGame(req: Request, deps: GameDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const lk = deps.lk;
  if (!lk) return json(503, { error: 'not-configured' });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad-json' });
  }
  const ask = parseAsk(body);
  if (typeof ask === 'string') return json(400, { error: ask });
  const now = (deps.now ?? (() => new Date()))();
  try {
    if (deps.store && ask.action !== 'update') {
      if ((await claimCallsign(deps.store, ask.callsign, ask.key, now)) === 'taken') return json(409, { error: 'callsign-taken' });
    }
    if (ask.action === 'host') {
      let code = '';
      for (let i = 0; i < 6 && !code; i++) {
        const c = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
        if ((await lk.rooms.listRooms([roomName(c)])).length === 0) code = c;
      }
      if (!code) return json(503, { error: 'busy' });
      const meta: GameMeta = {
        v: 1,
        protocol: ask.protocol ?? NET_PROTOCOL,
        host: ask.callsign,
        hostKey: keyHash(ask.key),
        level: ask.level ?? 'cloud-sea',
        mode: ask.mode ?? 'ffa',
        public: ask.public ?? true,
        status: 'lobby',
        bots: ask.bots ?? 3,
        round: 0,
      };
      await lk.rooms.createRoom(roomName(code), JSON.stringify(meta), MAX_PILOTS);
      return json(200, { ...ticket(lk.cfg, code, ask.callsign, ask.key), meta });
    }
    const code = ask.code as string;
    const room = (await lk.rooms.listRooms([roomName(code)]))[0];
    const meta = room ? parseMeta(room.metadata) : null;
    if (!room || !meta) return json(404, { error: 'no-game' });
    if (ask.action === 'join') {
      if (room.numParticipants >= MAX_PILOTS) return json(409, { error: 'full' });
      if (meta.protocol !== (ask.protocol ?? NET_PROTOCOL)) return json(409, { error: 'outdated' });
      return json(200, { ...ticket(lk.cfg, code, ask.callsign, ask.key), meta });
    }
    // update: only the host may change the entry; a pilot in the game can take over when the host left.
    if (meta.hostKey !== keyHash(ask.key)) {
      if (!ask.takeover) return json(403, { error: 'not-host' });
      const here = await lk.rooms.listParticipants(roomName(code));
      if (!here.includes(identityFor(ask.callsign, ask.key))) return json(403, { error: 'not-in-game' });
    }
    const next: GameMeta = {
      ...meta,
      host: ask.callsign,
      hostKey: keyHash(ask.key),
      level: ask.level ?? meta.level,
      mode: ask.mode ?? meta.mode,
      public: ask.public ?? meta.public,
      status: ask.status ?? meta.status,
      bots: ask.bots ?? meta.bots,
      round: ask.round ?? meta.round,
    };
    await lk.rooms.updateRoomMetadata(roomName(code), JSON.stringify(next));
    return json(200, { ok: true, meta: next });
  } catch (e) {
    console.error('game failed', e);
    return json(502, { error: 'livekit', detail: e instanceof LiveKitError ? e.message : e instanceof Error ? e.message : 'unknown' });
  }
}
