import { createHash, timingSafeEqual } from 'node:crypto';
import { LEVELS } from '../src/core/levels';
import type { Doc } from './firestore';
import { json, type Store } from './handlers';

/**
 * Visit statistics. Every page load and every flight adds to counters, all
 * time and per day (Vienna time): country, city, device type, where the
 * visitor came from and the level flown.
 *
 * To count unique and returning visitors each visit also updates one record
 * per visitor. Its id is a pseudonymous key: a hash of the IP address and the
 * browser with a secret salt, so the address itself is never stored and the
 * key cannot be turned back into it. The record keeps a shortened address
 * (last part removed), country, city, device, first and last visit and how
 * often. Nothing is stored on the visitor's device. Everything is kept
 * permanently. The list of visitors is only shown with the owner's key.
 */

export interface StatsStore extends Store {
  increment(updates: { path: string; inc: Record<string, number>; set?: Record<string, unknown>; min?: Record<string, number> }[]): Promise<void>;
}

export interface Geo {
  country?: string;
  city?: string;
}

export interface StatsDeps {
  store: StatsStore | null;
  geo?: Geo;
  /** The visitor's IP address (only hashed and shortened, never stored as it is). */
  ip?: string;
  /** Secret salt for the visitor key. */
  salt?: string;
  /** The owner's key that unlocks the visitor list (env STATS_KEY). */
  ownerKey?: string;
  now?: () => Date;
}

const DAYS = 'statsDays';
const ALL = 'stats/all';
const VISITORS = 'visitors';

/** The shortened address that is shown: 84.115.12.x, or the first three groups of an IPv6 address. */
export function maskIp(ip: string): string {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip.trim());
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
  if (ip.includes(':')) {
    const groups = ip.trim().split(':').filter((g) => g !== '');
    return `${groups.slice(0, 3).join(':')}:…`;
  }
  return 'unknown';
}

/** Pseudonymous visitor key: the same IP address and browser give the same key, but it cannot be reversed. */
export function visitorKey(ip: string, ua: string, salt: string): string {
  return createHash('sha256').update(`${salt}|${ip}|${ua}`).digest('hex').slice(0, 24);
}

function sameKey(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Turns any text into a safe field name part: letters, digits and _ only. */
export function fieldKey(raw: string, max = 40): string {
  const s = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max);
  return s || 'unknown';
}

/** The day in Vienna as YYYY-MM-DD. */
export function viennaDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function deviceOf(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function hostOf(ref: unknown): string | null {
  if (typeof ref !== 'string' || !ref) return null;
  const h = ref.toLowerCase().replace(/^www\./, '');
  return /^[a-z0-9.-]{1,60}$/.test(h) ? h : null;
}

/** POST /api/visit {kind: 'visit', ref?} or {kind: 'flight', level, mode}. */
export async function handleVisit(req: Request, deps: StatsDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const body = (await req.json().catch(() => null)) as { kind?: unknown; ref?: unknown; level?: unknown; mode?: unknown } | null;
  if (!body || (body.kind !== 'visit' && body.kind !== 'flight')) return json(400, { error: 'bad' });
  const store = deps.store;
  if (!store) return json(200, { ok: false, error: 'offline' });
  const now = (deps.now ?? (() => new Date()))();
  const day = viennaDay(now);
  const inc: Record<string, number> = {};
  if (body.kind === 'visit') {
    inc.total = 1;
    const cc = typeof deps.geo?.country === 'string' && /^[A-Za-z]{2}$/.test(deps.geo.country) ? deps.geo.country.toUpperCase() : 'XX';
    inc[`c_${cc}`] = 1;
    inc[`d_${deviceOf(req.headers.get('user-agent') ?? '')}`] = 1;
  } else {
    if (typeof body.level !== 'string' || !Object.prototype.hasOwnProperty.call(LEVELS, body.level)) return json(400, { error: 'bad' });
    inc.flights = 1;
    inc[`l_${fieldKey(body.level)}`] = 1;
    inc[`m_${body.mode === 'online' ? 'online' : 'solo'}`] = 1;
  }
  const dayInc: Record<string, number> = { ...inc };
  if (body.kind === 'visit') {
    if (deps.geo?.city) dayInc[`t_${fieldKey(`${deps.geo.city} ${deps.geo.country ?? ''}`)}`] = 1;
    const host = hostOf(body.ref);
    dayInc[`r_${host ? fieldKey(host) : 'direct'}`] = 1;
  }
  const n = Number(day.replace(/-/g, ''));
  const updates: Parameters<StatsStore['increment']>[0] = [];
  try {
    if (body.kind === 'visit' && deps.ip && deps.salt) {
      // One record per visitor: new, back on another day, or again the same day.
      const ua = req.headers.get('user-agent') ?? '';
      const key = visitorKey(deps.ip, ua, deps.salt);
      const seen = await store.get(`${VISITORS}/${key}`);
      const lastDay = typeof seen?.last === 'number' ? seen.last : 0;
      const newDay = !seen || lastDay < n;
      if (!seen) {
        inc.visitors = 1;
        dayInc.visitors = 1;
        dayInc.newVisitors = 1;
      } else if (newDay) {
        inc.returning = 1;
        dayInc.visitors = 1;
        dayInc.returning = 1;
      }
      const vInc: Record<string, number> = { visits: 1 };
      if (newDay) vInc.days = 1;
      updates.push({
        path: `${VISITORS}/${key}`,
        inc: vInc,
        set: {
          ip: maskIp(deps.ip),
          country: typeof deps.geo?.country === 'string' ? deps.geo.country.slice(0, 2).toUpperCase() : '',
          city: typeof deps.geo?.city === 'string' ? deps.geo.city.slice(0, 60) : '',
          device: deviceOf(ua),
          last: n,
          lastMs: now.getTime(),
        },
        min: { first: n },
      });
    }
    updates.push({ path: ALL, inc, min: { first: n } }, { path: `${DAYS}/${day}`, inc: dayInc, set: { day: n } });
    await store.increment(updates);
  } catch {
    return json(200, { ok: false, error: 'store' });
  }
  return json(200, { ok: true });
}

/** Splits flat counters by prefix: c_AT → countries.AT. */
function groups(d: Doc, prefixes: Record<string, string>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const name of Object.values(prefixes)) out[name] = {};
  for (const [k, v] of Object.entries(d)) {
    if (typeof v !== 'number') continue;
    const i = k.indexOf('_');
    if (i < 1) continue;
    const g = prefixes[k.slice(0, i)];
    if (g) out[g][k.slice(i + 1)] = (out[g][k.slice(i + 1)] ?? 0) + v;
  }
  return out;
}

const PREFIXES = { c: 'countries', d: 'devices', l: 'levels', m: 'modes', t: 'cities', r: 'sources' };

const dayText = (n: unknown) => {
  const t = String(n ?? '');
  return t.length === 8 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : '';
};

/**
 * GET /api/stats: totals, visitors (unique, returning), the last 60 days, the
 * months, and with ?key=<owner key> also the list of visitors.
 */
export async function handleStats(req: Request, deps: StatsDeps): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'method' });
  const store = deps.store;
  if (!store) return json(200, { ok: false, error: 'offline' });
  const given = new URL(req.url).searchParams.get('key') ?? '';
  const owner = !!deps.ownerKey && !!given && sameKey(given, deps.ownerKey);
  try {
    const [all, days, returningVisitors, list, loyal] = await Promise.all([
      store.get(ALL),
      store.top(DAYS, 'day', 400),
      store.countGreater(VISITORS, 'days', 1),
      owner ? store.top(VISITORS, 'lastMs', 100) : Promise.resolve([] as Doc[]),
      owner ? store.top(VISITORS, 'visits', 15) : Promise.resolve([] as Doc[]),
    ]);
    const a = all ?? {};
    const recent: Doc = {};
    for (const d of days.slice(0, 30)) {
      for (const [k, v] of Object.entries(d)) if (typeof v === 'number' && k !== 'day') recent[k] = ((recent[k] as number) ?? 0) + v;
    }
    // Months from the stored days (kept forever).
    const months = new Map<string, { visits: number; visitors: number; flights: number }>();
    for (const d of days) {
      const m = dayText(d.day).slice(0, 7);
      if (!m) continue;
      const row = months.get(m) ?? { visits: 0, visitors: 0, flights: 0 };
      row.visits += Number(d.total ?? 0);
      row.visitors += Number(d.visitors ?? 0);
      row.flights += Number(d.flights ?? 0);
      months.set(m, row);
    }
    const visitor = (v: Doc) => ({
      ip: String(v.ip ?? ''),
      country: String(v.country ?? ''),
      city: String(v.city ?? ''),
      device: String(v.device ?? ''),
      visits: Number(v.visits ?? 0),
      days: Number(v.days ?? 0),
      first: dayText(v.first),
      last: typeof v.lastMs === 'number' ? new Date(v.lastMs).toISOString() : dayText(v.last),
    });
    return json(200, {
      ok: true,
      total: Number(a.total ?? 0),
      flights: Number(a.flights ?? 0),
      visitors: Number(a.visitors ?? 0),
      returningVisitors,
      returningVisits: Number(a.returning ?? 0),
      since: dayText(a.first) || null,
      all: groups(a, PREFIXES),
      recent: groups(recent, PREFIXES),
      days: days.slice(0, 60).map((d) => ({ day: dayText(d.day), visits: Number(d.total ?? 0), visitors: Number(d.visitors ?? 0), flights: Number(d.flights ?? 0) })),
      months: [...months.entries()].map(([month, r]) => ({ month, ...r })),
      owner,
      ownerKeySet: !!deps.ownerKey,
      list: list.map(visitor),
      loyal: loyal.map(visitor),
    });
  } catch {
    return json(200, { ok: false, error: 'store' });
  }
}
