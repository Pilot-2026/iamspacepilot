import { createHmac } from 'node:crypto';

/**
 * Small LiveKit helper for Netlify Functions: access tokens (JWT, HS256) and
 * the RoomService API (Twirp over HTTPS). No SDK needed.
 *
 * Needs LIVEKIT_URL (wss://...), LIVEKIT_API_KEY and LIVEKIT_API_SECRET.
 */

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export interface VideoGrant {
  room?: string;
  roomJoin?: boolean;
  roomList?: boolean;
  roomCreate?: boolean;
  roomAdmin?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
}

export interface RoomInfo {
  name: string;
  numParticipants: number;
  maxParticipants: number;
  metadata: string;
  creationTime: number;
}

export class LiveKitError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function liveKitFromEnv(env: Record<string, string | undefined> = process.env): LiveKitConfig | null {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** A LiveKit access token. */
export function signToken(
  cfg: LiveKitConfig,
  opts: { identity: string; name?: string; ttlSeconds?: number; video: VideoGrant; metadata?: string },
  now = Math.floor(Date.now() / 1000),
): string {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const claims: Record<string, unknown> = {
    iss: cfg.apiKey,
    sub: opts.identity,
    nbf: now - 10,
    exp: now + (opts.ttlSeconds ?? 6 * 3600),
    video: opts.video,
  };
  if (opts.name) claims.name = opts.name;
  if (opts.metadata) claims.metadata = opts.metadata;
  const body = b64(claims);
  const sig = createHmac('sha256', cfg.apiSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** The HTTPS address of the LiveKit server for API calls. */
export function httpBase(cfg: LiveKitConfig): string {
  return cfg.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/+$/, '');
}

export class RoomService {
  constructor(
    private readonly cfg: LiveKitConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call(method: string, body: unknown, video: VideoGrant): Promise<Record<string, unknown>> {
    const token = signToken(this.cfg, { identity: 'iamspacepilot-server', ttlSeconds: 600, video });
    const res = await this.fetchFn(`${httpBase(this.cfg)}/twirp/livekit.RoomService/${method}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new LiveKitError(`LiveKit ${method}: ${String(data.msg ?? data.message ?? res.status)}`, res.status);
    return data;
  }

  async listRooms(names?: string[]): Promise<RoomInfo[]> {
    const data = await this.call('ListRooms', names ? { names } : {}, { roomList: true });
    const rooms = (data.rooms as Record<string, unknown>[] | undefined) ?? [];
    return rooms.map((r) => ({
      name: String(r.name ?? ''),
      numParticipants: Number(r.num_participants ?? r.numParticipants ?? 0),
      maxParticipants: Number(r.max_participants ?? r.maxParticipants ?? 0),
      metadata: String(r.metadata ?? ''),
      creationTime: Number(r.creation_time ?? r.creationTime ?? 0),
    }));
  }

  async createRoom(name: string, metadata: string, maxParticipants: number): Promise<void> {
    await this.call('CreateRoom', { name, metadata, max_participants: maxParticipants, empty_timeout: 120 }, { roomCreate: true });
  }

  /** Identities of the participants in a room. */
  async listParticipants(room: string): Promise<string[]> {
    const data = await this.call('ListParticipants', { room }, { roomAdmin: true, room });
    const list = (data.participants as Record<string, unknown>[] | undefined) ?? [];
    return list.map((p) => String(p.identity ?? ''));
  }

  async updateRoomMetadata(room: string, metadata: string): Promise<void> {
    await this.call('UpdateRoomMetadata', { room, metadata }, { roomAdmin: true, room });
  }
}
