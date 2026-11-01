import { validateCallsign } from '../src/core/callsign';
import { CORE_VERSION } from '../src/core/config';
import { LEVELS } from '../src/core/levels';
import { isShip } from '../src/core/ships';
import { decodeReplay } from '../src/core/replay';
import { replaySolo, type SoloSetup } from '../src/core/solo';
import type { Difficulty, LevelId } from '../src/core/types';
import { Firestore, StoreError, configFromEnv, sha256, type Doc } from './firestore';

/**
 * Request handlers behind the Netlify Functions. Kept free of Netlify specifics
 * so they can be tested with a fake store.
 *
 * Firestore layout:
 *   pilots/{callsign lower case}        callsign, keyHash, created
 *   lb_{level}/{callsign lower case}    the pilot's best verified score on that level
 *   replays/{level}_{callsign}          the recorded flight behind that best score
 */

export interface Store {
  get(path: string): Promise<Doc | null>;
  create(collection: string, id: string, data: Record<string, unknown>): Promise<boolean>;
  set(path: string, data: Record<string, unknown>): Promise<void>;
  top(collection: string, field: string, limit: number): Promise<Doc[]>;
  countGreater(collection: string, field: string, value: number): Promise<number>;
}

export interface Deps {
  store: Store | null;
  now?: () => Date;
}

export function storeFromEnv(): Firestore | null {
  const cfg = configFromEnv();
  return cfg ? new Firestore(cfg) : null;
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

const isLevel = (v: unknown): v is LevelId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(LEVELS, v);
const isDifficulty = (v: unknown): v is Difficulty => v === 'rookie' || v === 'pilot' || v === 'ace';

export interface Submission {
  version: string;
  callsign: string;
  key: string;
  setup: SoloSetup;
  replay: string;
  score: number;
}

/** Checks the shape of a score submission. Returns an error code or the parsed submission. */
export function parseSubmission(body: unknown): Submission | string {
  if (!body || typeof body !== 'object') return 'bad-request';
  const b = body as Record<string, unknown>;
  const s = b.setup as Record<string, unknown> | undefined;
  if (typeof b.version !== 'string') return 'bad-version';
  if (typeof b.callsign !== 'string' || validateCallsign(b.callsign)) return 'bad-callsign';
  if (typeof b.key !== 'string' || !/^[0-9a-f]{32}$/.test(b.key)) return 'bad-key';
  if (!s || typeof s !== 'object' || !isLevel(s.level) || !isDifficulty(s.difficulty)) return 'bad-setup';
  if (typeof s.seed !== 'number' || !Number.isInteger(s.seed) || s.seed < 0 || s.seed > 0xffffffff) return 'bad-setup';
  if (typeof s.bots !== 'number' || !Number.isInteger(s.bots) || s.bots < 1 || s.bots > 7) return 'bad-setup';
  if (typeof s.assist !== 'boolean') return 'bad-setup';
  if (!isShip(s.ship)) return 'bad-setup';
  if (typeof b.replay !== 'string' || b.replay.length > 400_000) return 'bad-replay';
  if (typeof b.score !== 'number' || !Number.isInteger(b.score)) return 'bad-score';
  return {
    version: b.version,
    callsign: b.callsign.trim(),
    key: b.key,
    setup: { level: s.level, seed: s.seed, bots: s.bots, difficulty: s.difficulty, assist: s.assist, ship: s.ship },
    replay: b.replay,
    score: b.score,
  };
}

/** Claims a callsign for the browser that holds this key. The first one to use a callsign owns it. */
export async function claimCallsign(store: Store, callsign: string, key: string, now: Date): Promise<'ok' | 'taken'> {
  const id = callsign.toLowerCase();
  const keyHash = sha256(key);
  let pilot = await store.get(`pilots/${id}`);
  if (!pilot) {
    const created = await store.create('pilots', id, { callsign, keyHash, created: now });
    if (!created) pilot = await store.get(`pilots/${id}`);
  }
  return pilot && pilot.keyHash !== keyHash ? 'taken' : 'ok';
}

/** POST /api/score: replays the flight, then stores the pilot's best score. */
export async function handleScore(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const store = deps.store;
  if (!store) return json(503, { error: 'not-configured' });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad-json' });
  }
  const sub = parseSubmission(body);
  if (typeof sub === 'string') return json(400, { error: sub });
  if (sub.version !== CORE_VERSION) return json(409, { error: 'outdated' });
  const inputs = decodeReplay(sub.replay);
  if (!inputs) return json(400, { error: 'bad-replay' });
  const run = replaySolo(sub.setup, inputs);
  if (!run) return json(422, { error: 'unfinished' });
  const r = run.result;
  if (r.score !== sub.score) return json(422, { error: 'mismatch', score: r.score });

  const id = sub.callsign.toLowerCase();
  const level = sub.setup.level;
  const now = (deps.now ?? (() => new Date()))();
  try {
    if ((await claimCallsign(store, sub.callsign, sub.key, now)) === 'taken') return json(409, { error: 'callsign-taken' });

    const col = `lb_${level}`;
    const prev = await store.get(`${col}/${id}`);
    const prevScore = prev && typeof prev.score === 'number' ? prev.score : -1;
    const improved = r.score > prevScore;
    if (improved) {
      await store.set(`${col}/${id}`, {
        callsign: sub.callsign,
        score: r.score,
        time: Math.round(r.time * 10) / 10,
        won: r.won,
        place: r.place,
        pilots: r.pilots,
        difficulty: sub.setup.difficulty,
        bots: sub.setup.bots,
        ship: sub.setup.ship,
        cutoffs: r.cutoffs,
        shotDowns: r.shotDowns,
        hits: r.hits,
        rings: r.rings,
        at: now,
      });
      await store.set(`replays/${level}_${id}`, {
        callsign: sub.callsign,
        level,
        score: r.score,
        version: sub.version,
        seed: sub.setup.seed,
        bots: sub.setup.bots,
        difficulty: sub.setup.difficulty,
        assist: sub.setup.assist,
        ship: sub.setup.ship,
        ticks: run.ticks,
        data: sub.replay,
        at: now,
      });
    }
    const best = improved ? r.score : prevScore;
    const rank = (await store.countGreater(col, 'score', best)) + 1;
    return json(200, { ok: true, score: r.score, best, improved, rank });
  } catch (e) {
    console.error('score failed', e);
    return json(502, { error: 'store', detail: e instanceof StoreError ? e.message : 'unknown' });
  }
}

export interface PublicRow {
  callsign: string;
  score: number;
  time: number;
  won: boolean;
  difficulty: string;
  bots: number;
  at: string;
}

function publicRow(d: Doc): PublicRow {
  return {
    callsign: String(d.callsign ?? ''),
    score: Number(d.score ?? 0),
    time: Number(d.time ?? 0),
    won: Boolean(d.won),
    difficulty: String(d.difficulty ?? ''),
    bots: Number(d.bots ?? 0),
    at: String(d.at ?? ''),
  };
}

/** GET /api/leaderboard?level=cloud-sea: the 50 best pilots of a level. */
export async function handleLeaderboard(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'method' });
  const level = new URL(req.url).searchParams.get('level');
  if (!isLevel(level)) return json(400, { error: 'bad-level' });
  const store = deps.store;
  if (!store) return json(503, { error: 'not-configured' });
  try {
    const rows = await store.top(`lb_${level}`, 'score', 50);
    return json(
      200,
      { level, rows: rows.map(publicRow) },
      { 'cache-control': 'public, max-age=15', 'netlify-cdn-cache-control': 'public, s-maxage=20, stale-while-revalidate=60' },
    );
  } catch (e) {
    console.error('leaderboard failed', e);
    return json(502, { error: 'store', detail: e instanceof StoreError ? e.message : 'unknown' });
  }
}

/**
 * GET /api/health: tells whether the online leaderboard is set up, without
 * revealing any secret. Open it in a browser to check the Firebase settings.
 */
export async function handleHealth(deps: Deps, liveKit?: { listRooms(): Promise<unknown[]> } | null): Promise<Response> {
  const result: Record<string, unknown> = {};
  const store = deps.store;
  if (!store) {
    Object.assign(result, {
      configured: false,
      reachable: false,
      hint: 'Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Netlify, then deploy again.',
    });
  } else {
    try {
      await store.top('lb_cloud-sea', 'score', 1);
      Object.assign(result, { configured: true, reachable: true });
    } catch (e) {
      Object.assign(result, { configured: true, reachable: false, error: e instanceof StoreError ? e.message : 'Unknown error' });
    }
  }
  if (liveKit !== undefined) {
    if (!liveKit) {
      result.livekit = { configured: false, reachable: false, hint: 'Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in Netlify, then deploy again.' };
    } else {
      try {
        await liveKit.listRooms();
        result.livekit = { configured: true, reachable: true };
      } catch (e) {
        result.livekit = { configured: true, reachable: false, error: e instanceof Error ? e.message : 'Unknown error' };
      }
    }
  }
  return json(200, result);
}
