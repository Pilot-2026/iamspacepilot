import { LEVELS } from '../src/core/levels';
import type { Doc } from './firestore';
import { json, type Store } from './handlers';

/**
 * Anonymous visit statistics: every page load and every flight adds to a few
 * counters, all time and per day (Vienna time). Only totals are stored:
 * country and city (worked out by the host from the connection, never stored
 * as an address), device type, where the visitor came from and the level
 * flown. No IP addresses, no identifiers, nothing that points to a person.
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
  now?: () => Date;
}

const DAYS = 'statsDays';
const ALL = 'stats/all';

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
  try {
    await store.increment([
      { path: ALL, inc, min: { first: n } },
      { path: `${DAYS}/${day}`, inc: dayInc, set: { day: n } },
    ]);
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

/** GET /api/stats: all-time totals and the last 60 days. */
export async function handleStats(req: Request, deps: StatsDeps): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'method' });
  const store = deps.store;
  if (!store) return json(200, { ok: false, error: 'offline' });
  try {
    const [all, days] = await Promise.all([store.get(ALL), store.top(DAYS, 'day', 60)]);
    const a = all ?? {};
    const recent: Doc = {};
    for (const d of days.slice(0, 30)) {
      for (const [k, v] of Object.entries(d)) if (typeof v === 'number' && k !== 'day') recent[k] = ((recent[k] as number) ?? 0) + v;
    }
    const first = typeof a.first === 'number' ? String(a.first) : '';
    return json(200, {
      ok: true,
      total: Number(a.total ?? 0),
      flights: Number(a.flights ?? 0),
      since: first ? `${first.slice(0, 4)}-${first.slice(4, 6)}-${first.slice(6, 8)}` : null,
      all: groups(a, PREFIXES),
      recent: groups(recent, PREFIXES),
      days: days.map((d) => {
        const n = String(d.day ?? '');
        return { day: `${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 8)}`, visits: Number(d.total ?? 0), flights: Number(d.flights ?? 0) };
      }),
    });
  } catch {
    return json(200, { ok: false, error: 'store' });
  }
}
