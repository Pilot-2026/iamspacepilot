import { describe, expect, it } from 'vitest';
import { GAME_VERSION } from '../src/online/match';
import { handleGame, handleGames, identityFor, parseMeta, type GameDeps } from '../server/games';
import { RoomService, signToken, type RoomInfo } from '../server/livekit';

const cfg = { url: 'wss://example.livekit.cloud', apiKey: 'APIkey', apiSecret: 'secret-secret-secret' };

/** In-memory stand-in for the LiveKit room service. */
function fakeRooms() {
  const rooms = new Map<string, RoomInfo>();
  const people = new Map<string, string[]>();
  return {
    rooms,
    people,
    api: {
      async listParticipants(name: string) {
        return people.get(name) ?? [];
      },
      async listRooms(names?: string[]) {
        return [...rooms.values()].filter((r) => !names || names.includes(r.name));
      },
      async createRoom(name: string, metadata: string, max: number) {
        rooms.set(name, { name, metadata, numParticipants: 0, maxParticipants: max, creationTime: 1 });
      },
      async updateRoomMetadata(name: string, metadata: string) {
        const r = rooms.get(name);
        if (r) r.metadata = metadata;
      },
    },
  };
}

const post = (body: unknown) => new Request('http://x/api/game', { method: 'POST', body: JSON.stringify(body) });
const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);

async function host(deps: GameDeps, extra: Record<string, unknown> = {}) {
  const res = await handleGame(post({ action: 'host', callsign: 'Alpha', key: KEY_A, protocol: GAME_VERSION, level: 'orbit', ...extra }), deps);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('online game list and tickets', () => {
  it('hosts a game: creates a room and hands out a token for it', async () => {
    const f = fakeRooms();
    const deps: GameDeps = { lk: { cfg, rooms: f.api }, store: null };
    const { status, body } = await host(deps);
    expect(status).toBe(200);
    const code = body.code as string;
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    const room = f.rooms.get(`g-${code}`)!;
    const meta = parseMeta(room.metadata)!;
    expect(meta.host).toBe('Alpha');
    expect(meta.level).toBe('orbit');
    expect(meta.protocol).toBe(GAME_VERSION);
    const claims = JSON.parse(Buffer.from(String(body.token).split('.')[1], 'base64url').toString());
    expect(claims.sub).toBe(identityFor('Alpha', KEY_A));
    expect(claims.video).toMatchObject({ room: `g-${code}`, roomJoin: true, canPublish: true, canPublishData: true });
    expect(body.url).toBe(cfg.url);
  });

  it('lists only public games with pilots in them', async () => {
    const f = fakeRooms();
    const deps: GameDeps = { lk: { cfg, rooms: f.api }, store: null };
    const pub = (await host(deps)).body.code as string;
    const priv = (await host(deps, { public: false })).body.code as string;
    let res = await (await handleGames(new Request('http://x/api/games'), deps)).json();
    expect(res.games).toHaveLength(0);
    f.rooms.get(`g-${pub}`)!.numParticipants = 3;
    f.rooms.get(`g-${priv}`)!.numParticipants = 2;
    res = await (await handleGames(new Request('http://x/api/games'), deps)).json();
    expect(res.online).toBe(5);
    expect(res.games.map((g: { code: string }) => g.code)).toEqual([pub]);
    expect(res.games[0]).toMatchObject({ host: 'Alpha', level: 'orbit', levelName: 'Orbit', players: 3, max: 8, protocol: GAME_VERSION });
  });

  it('lets pilots join by code unless the game is full, gone or on another version', async () => {
    const f = fakeRooms();
    const deps: GameDeps = { lk: { cfg, rooms: f.api }, store: null };
    const code = (await host(deps)).body.code as string;
    const join = (extra: Record<string, unknown> = {}) =>
      handleGame(post({ action: 'join', callsign: 'Bravo', key: KEY_B, code, protocol: GAME_VERSION, ...extra }), deps);
    expect((await join()).status).toBe(200);
    expect((await join({ code: 'ZZZZZ' })).status).toBe(404);
    expect((await join({ protocol: 'p0.core-1' })).status).toBe(409);
    f.rooms.get(`g-${code}`)!.numParticipants = 8;
    const full = await join();
    expect(full.status).toBe(409);
    expect((await full.json()).error).toBe('full');
    expect((await join({ code: 'abc' })).status).toBe(400);
  });

  it('only the host updates the list entry, a new host takes over', async () => {
    const f = fakeRooms();
    const deps: GameDeps = { lk: { cfg, rooms: f.api }, store: null };
    const code = (await host(deps)).body.code as string;
    const update = (callsign: string, key: string, extra: Record<string, unknown>) =>
      handleGame(post({ action: 'update', callsign, key, code, ...extra }), deps);
    expect((await update('Bravo', KEY_B, { status: 'flying' })).status).toBe(403);
    expect((await update('Alpha', KEY_A, { status: 'flying', round: 2, level: 'nebula' })).status).toBe(200);
    let meta = parseMeta(f.rooms.get(`g-${code}`)!.metadata)!;
    expect(meta).toMatchObject({ status: 'flying', round: 2, level: 'nebula', host: 'Alpha' });
    // Taking over needs the pilot to be in the game.
    expect((await update('Bravo', KEY_B, { takeover: true, status: 'lobby' })).status).toBe(403);
    f.people.set(`g-${code}`, [identityFor('Bravo', KEY_B)]);
    expect((await update('Bravo', KEY_B, { takeover: true, status: 'lobby' })).status).toBe(200);
    meta = parseMeta(f.rooms.get(`g-${code}`)!.metadata)!;
    expect(meta).toMatchObject({ status: 'lobby', host: 'Bravo' });
    expect((await update('Alpha', KEY_A, { status: 'flying' })).status).toBe(403);
  });

  it('says so when LiveKit is not set up', async () => {
    const deps: GameDeps = { lk: null, store: null };
    expect((await handleGames(new Request('http://x/api/games'), deps)).status).toBe(503);
    expect((await handleGame(post({ action: 'host', callsign: 'Alpha', key: KEY_A }), deps)).status).toBe(503);
  });

  it('talks to the LiveKit room service with a signed admin token', async () => {
    const calls: { url: string; auth: string; body: string }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: String((init.headers as Record<string, string>).authorization), body: String(init.body) });
      return new Response(JSON.stringify({ rooms: [{ name: 'g-ABCDE', num_participants: 2, metadata: '{}' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const rs = new RoomService(cfg, fetchFn);
    const rooms = await rs.listRooms();
    expect(rooms[0]).toMatchObject({ name: 'g-ABCDE', numParticipants: 2 });
    expect(calls[0].url).toBe('https://example.livekit.cloud/twirp/livekit.RoomService/ListRooms');
    const token = calls[0].auth.replace('Bearer ', '');
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(claims.iss).toBe('APIkey');
    expect(claims.video.roomList).toBe(true);
    // The signature checks out with the secret.
    const again = signToken(cfg, { identity: claims.sub, ttlSeconds: claims.exp - claims.nbf - 10, video: claims.video }, claims.nbf + 10);
    expect(again).toBe(token);
  });
});
