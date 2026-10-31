import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from '../src/core/config';
import { dsin } from '../src/core/math';
import { ReplayRecorder, decodeReplay, quantize } from '../src/core/replay';
import { playerFinished, replaySolo, soloScore, soloWorldSetup, type SoloSetup } from '../src/core/solo';
import type { PilotInput } from '../src/core/types';
import { World } from '../src/core/world';
import { Firestore, decodeFields, encodeFields, type Doc } from '../server/firestore';
import { handleHealth, handleLeaderboard, handleScore, type Store } from '../server/handlers';

const setup: SoloSetup = { level: 'cloud-sea', seed: 4242, bots: 3, difficulty: 'pilot', assist: true };

/** Plays a solo round like the game does: quantize, record, step, until the player is done. */
function play(s: SoloSetup) {
  const w = new World(soloWorldSetup(s, 'Tester'));
  const rec = new ReplayRecorder();
  for (let t = 0; t < 60 * 200; t++) {
    const inp: PilotInput = quantize({
      steerX: 0.55 + dsin(t * 0.017) * 0.4,
      steerY: dsin(t * 0.011) * 0.3,
      roll: t % 500 < 30 ? 0.7 : 0,
      boost: t % 240 < 60,
    });
    rec.push(inp);
    w.step([inp]);
    if (playerFinished(w, 0)) return { world: w, rec, ticks: t + 1, score: soloScore(w, 0, s.difficulty) };
  }
  throw new Error('round did not finish');
}

describe('scores and replays', () => {
  it('replays a recorded flight to exactly the same score', () => {
    const run = play(setup);
    const data = run.rec.encode(run.ticks);
    const inputs = decodeReplay(data);
    expect(inputs).not.toBeNull();
    expect(inputs!.length).toBe(run.ticks);
    const again = replaySolo(setup, inputs!);
    expect(again).not.toBeNull();
    expect(again!.ticks).toBe(run.ticks);
    expect(again!.result).toEqual(run.score);
    expect(run.score.score).toBeGreaterThan(0);
  });

  it('gives a different seed a different flight', () => {
    const a = play(setup);
    const b = play({ ...setup, seed: 77 });
    expect(a.world.fingerprint()).not.toBe(b.world.fingerprint());
  });

  it('rejects broken recordings', () => {
    expect(decodeReplay('!!!not base64')).toBeNull();
    expect(decodeReplay(btoa(String.fromCharCode(5, 120, 0, 0)))).toBeNull();
    expect(decodeReplay(btoa(String.fromCharCode(0, 0, 0, 0, 0)))).toBeNull();
  });

  it('says a recording is unfinished when it stops too early', () => {
    const run = play(setup);
    const inputs = decodeReplay(run.rec.encode(run.ticks - 30))!;
    expect(replaySolo(setup, inputs)).toBeNull();
  });
});

describe('firestore values', () => {
  it('round-trips the field types the game uses', () => {
    const data = { a: 'x', b: 12, c: 1.5, d: true, e: null };
    const fields = encodeFields(data) as unknown as Record<string, Record<string, unknown>>;
    expect(decodeFields(fields)).toEqual(data);
  });
});

/** In-memory stand-in for Firestore. */
class MemoryStore implements Store {
  docs = new Map<string, Doc>();
  async get(path: string) {
    return this.docs.get(path) ?? null;
  }
  async create(collection: string, id: string, data: Record<string, unknown>) {
    const key = `${collection}/${id}`;
    if (this.docs.has(key)) return false;
    this.docs.set(key, this.clean(data));
    return true;
  }
  async set(path: string, data: Record<string, unknown>) {
    this.docs.set(path, this.clean(data));
  }
  async top(collection: string, field: string, limit: number) {
    return [...this.docs.entries()]
      .filter(([k]) => k.startsWith(`${collection}/`))
      .map(([, v]) => v)
      .sort((a, b) => Number(b[field]) - Number(a[field]))
      .slice(0, limit);
  }
  async countGreater(collection: string, field: string, value: number) {
    return [...this.docs.entries()].filter(([k, v]) => k.startsWith(`${collection}/`) && Number(v[field]) > value).length;
  }
  private clean(d: Record<string, unknown>): Doc {
    const out: Doc = {};
    for (const [k, v] of Object.entries(d)) out[k] = v instanceof Date ? v.toISOString() : (v as Doc[string]);
    return out;
  }
}

function submission(run: ReturnType<typeof play>, callsign = 'Tester', key = 'a'.repeat(32)) {
  return {
    version: CORE_VERSION,
    callsign,
    key,
    setup,
    replay: run.rec.encode(run.ticks),
    score: run.score.score,
  };
}

const post = (body: unknown) =>
  new Request('https://example.test/api/score', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('score API', () => {
  const run = play(setup);

  it('stores a verified score and reports the rank', async () => {
    const store = new MemoryStore();
    store.docs.set('lb_cloud-sea/ace', { callsign: 'Ace', score: run.score.score + 1000 });
    const res = await handleScore(post(submission(run)), { store });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, score: run.score.score, improved: true, rank: 2 });
    expect(store.docs.get('lb_cloud-sea/tester')?.score).toBe(run.score.score);
    expect(store.docs.get('replays/cloud-sea_tester')?.data).toBeTypeOf('string');
  });

  it('refuses a score that does not match the flight', async () => {
    const store = new MemoryStore();
    const res = await handleScore(post({ ...submission(run), score: run.score.score + 1 }), { store });
    expect(res.status).toBe(422);
    expect(store.docs.size).toBe(0);
  });

  it('protects a callsign that belongs to another pilot', async () => {
    const store = new MemoryStore();
    expect((await handleScore(post(submission(run)), { store })).status).toBe(200);
    const res = await handleScore(post(submission(run, 'TESTER', 'b'.repeat(32))), { store });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('callsign-taken');
  });

  it('keeps the better score', async () => {
    const store = new MemoryStore();
    expect((await handleScore(post(submission(run)), { store })).status).toBe(200);
    store.docs.set('lb_cloud-sea/tester', { callsign: 'Tester', score: 999999 });
    const body = await (await handleScore(post(submission(run)), { store })).json();
    expect(body.improved).toBe(false);
    expect(body.best).toBe(999999);
    expect(store.docs.get('lb_cloud-sea/tester')?.score).toBe(999999);
  });

  it('rejects outdated game versions and bad input', async () => {
    const store = new MemoryStore();
    expect((await handleScore(post({ ...submission(run), version: 'core-0' }), { store })).status).toBe(409);
    expect((await handleScore(post({ ...submission(run), callsign: 'x' }), { store })).status).toBe(400);
    expect((await handleScore(post({ ...submission(run), replay: '%%%' }), { store })).status).toBe(400);
  });

  it('answers 503 when Firebase is not set up', async () => {
    const res = await handleScore(post(submission(run)), { store: null });
    expect(res.status).toBe(503);
  });

  it('lists the leaderboard', async () => {
    const store = new MemoryStore();
    await handleScore(post(submission(run)), { store });
    const res = await handleLeaderboard(new Request('https://example.test/api/leaderboard?level=cloud-sea'), { store });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows[0]).toMatchObject({ callsign: 'Tester', score: run.score.score });
    const bad = await handleLeaderboard(new Request('https://example.test/api/leaderboard?level=moon'), { store });
    expect(bad.status).toBe(400);
  });
});

describe('health check', () => {
  it('reports a missing setup', async () => {
    const body = await (await handleHealth({ store: null })).json();
    expect(body).toMatchObject({ configured: false, reachable: false });
  });

  it('reports a working store', async () => {
    const body = await (await handleHealth({ store: new MemoryStore() })).json();
    expect(body).toMatchObject({ configured: true, reachable: true });
  });
});

describe('firestore REST client', () => {
  it('signs in with the service account and reads a document', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const calls: { url: string; method: string; auth?: string }[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', auth: (init?.headers as Record<string, string> | undefined)?.authorization });
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        const assertion = new URLSearchParams(String(init?.body)).get('assertion') ?? '';
        expect(assertion.split('.')).toHaveLength(3);
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      if (url.endsWith('/documents/pilots/tester')) {
        return new Response(JSON.stringify({ fields: { callsign: { stringValue: 'Tester' }, n: { integerValue: '3' } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
    }) as typeof fetch;
    const fs = new Firestore({ projectId: 'demo', clientEmail: 'bot@demo.iam.gserviceaccount.com', privateKey: pem }, fakeFetch);
    expect(await fs.get('pilots/tester')).toEqual({ callsign: 'Tester', n: 3 });
    expect(await fs.get('pilots/nobody')).toBeNull();
    expect(calls.filter((c) => c.url.includes('oauth2')).length).toBe(1);
    expect(calls.find((c) => c.url.includes('/documents/'))?.auth).toBe('Bearer tok');
  });
});
