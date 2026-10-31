import { createHash, createSign } from 'node:crypto';

/**
 * Minimal Firestore client for Netlify Functions, using the REST API and a
 * service account. No SDK: fast cold starts and nothing to bundle.
 *
 * Needs three environment variables in Netlify:
 * FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.
 */

export interface FirestoreConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export type Doc = Record<string, string | number | boolean | null>;

type Value =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null };

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): FirestoreConfig | null {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim();
  let privateKey = env.FIREBASE_PRIVATE_KEY?.trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  // Accept the key with or without surrounding quotes and with literal \n.
  privateKey = privateKey.replace(/^"+|"+$/g, '').replace(/\\n/g, '\n');
  return { projectId, clientEmail, privateKey };
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function encodeValue(v: unknown): Value {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  return { nullValue: null };
}

export function encodeFields(data: Record<string, unknown>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(data)) out[k] = encodeValue(v);
  return out;
}

export function decodeFields(fields: Record<string, Record<string, unknown>> | undefined): Doc {
  const out: Doc = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    if ('stringValue' in v) out[k] = String(v.stringValue);
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('doubleValue' in v) out[k] = Number(v.doubleValue);
    else if ('booleanValue' in v) out[k] = Boolean(v.booleanValue);
    else if ('timestampValue' in v) out[k] = String(v.timestampValue);
    else out[k] = null;
  }
  return out;
}

const tokens = new Map<string, { value: string; exp: number }>();

export class Firestore {
  private readonly base: string;

  constructor(
    private readonly cfg: FirestoreConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/(default)/documents`;
  }

  /** OAuth access token from a self-signed JWT, cached while it is valid. */
  private async token(): Promise<string> {
    const cached = tokens.get(this.cfg.clientEmail);
    if (cached && cached.exp > Date.now() + 60_000) return cached.value;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = b64({ alg: 'RS256', typ: 'JWT' });
    const claim = b64({
      iss: this.cfg.clientEmail,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    });
    let sig: string;
    try {
      sig = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(this.cfg.privateKey).toString('base64url');
    } catch {
      throw new StoreError('The private key in FIREBASE_PRIVATE_KEY could not be read.', 500);
    }
    const res = await this.fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !body.access_token) {
      throw new StoreError(`Google sign-in failed: ${body.error_description ?? res.status}`, 502);
    }
    tokens.set(this.cfg.clientEmail, { value: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 });
    return body.access_token;
  }

  private async call(method: string, url: string, body?: unknown): Promise<{ status: number; data: unknown }> {
    const res = await this.fetchFn(url, {
      method,
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }

  private fail(what: string, r: { status: number; data: unknown }): never {
    const msg = (r.data as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${r.status}`;
    throw new StoreError(`${what}: ${msg}`, 502);
  }

  /** Reads one document, or null if it does not exist. */
  async get(path: string): Promise<Doc | null> {
    const r = await this.call('GET', `${this.base}/${path}`);
    if (r.status === 404) return null;
    if (r.status !== 200) this.fail(`Reading ${path}`, r);
    return decodeFields((r.data as { fields?: Record<string, Record<string, unknown>> }).fields);
  }

  /** Creates a document. Returns false if it already exists. */
  async create(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const r = await this.call('POST', `${this.base}/${collection}?documentId=${encodeURIComponent(id)}`, { fields: encodeFields(data) });
    if (r.status === 409) return false;
    if (r.status !== 200) this.fail(`Creating ${collection}/${id}`, r);
    return true;
  }

  /** Writes a whole document, replacing what was there. */
  async set(path: string, data: Record<string, unknown>): Promise<void> {
    const r = await this.call('PATCH', `${this.base}/${path}`, { fields: encodeFields(data) });
    if (r.status !== 200) this.fail(`Writing ${path}`, r);
  }

  /** The highest documents of a collection by one number field. */
  async top(collection: string, field: string, limit: number): Promise<Doc[]> {
    const r = await this.call('POST', `${this.base}:runQuery`, {
      structuredQuery: {
        from: [{ collectionId: collection }],
        orderBy: [{ field: { fieldPath: field }, direction: 'DESCENDING' }],
        limit,
      },
    });
    if (r.status !== 200) this.fail(`Listing ${collection}`, r);
    const rows = (r.data as { document?: { fields?: Record<string, Record<string, unknown>> } }[]) ?? [];
    return rows.filter((x) => x.document).map((x) => decodeFields(x.document?.fields));
  }

  /** How many documents have a field value greater than value. */
  async countGreater(collection: string, field: string, value: number): Promise<number> {
    const r = await this.call('POST', `${this.base}:runAggregationQuery`, {
      structuredAggregationQuery: {
        structuredQuery: {
          from: [{ collectionId: collection }],
          where: { fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN', value: encodeValue(value) } },
        },
        aggregations: [{ alias: 'n', count: {} }],
      },
    });
    if (r.status !== 200) this.fail(`Counting ${collection}`, r);
    const rows = r.data as { result?: { aggregateFields?: { n?: { integerValue?: string } } } }[];
    return Number(rows?.[0]?.result?.aggregateFields?.n?.integerValue ?? 0);
  }
}
