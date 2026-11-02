import { request } from './api';

/** One visitor, as the owner sees it: shortened address, place, device, how often. */
export interface Visitor {
  ip: string;
  country: string;
  city: string;
  device: string;
  visits: number;
  /** Different days with a visit. */
  days: number;
  first: string;
  last: string;
}

/** Visit statistics from /api/stats. */
export interface Stats {
  total: number;
  flights: number;
  /** Unique visitors and how many came back on another day. */
  visitors: number;
  returningVisitors: number;
  returningVisits: number;
  since: string | null;
  all: Record<'countries' | 'devices' | 'levels' | 'modes' | 'cities' | 'sources', Record<string, number>>;
  recent: Record<'countries' | 'devices' | 'levels' | 'modes' | 'cities' | 'sources', Record<string, number>>;
  days: { day: string; visits: number; visitors: number; flights: number }[];
  months: { month: string; visits: number; visitors: number; flights: number }[];
  /** The owner's key was given and is right: the visitor lists are filled. */
  owner: boolean;
  ownerKeySet: boolean;
  list: Visitor[];
  loyal: Visitor[];
}

export type StatsResult = { ok: true; stats: Stats } | { ok: false; error: string };

/** Counts this page load (anonymous: only totals are stored). */
export function countVisit(): void {
  let ref = '';
  try {
    if (document.referrer) {
      const u = new URL(document.referrer);
      if (u.host !== location.host) ref = u.hostname;
    }
  } catch {
    // No referrer.
  }
  void request('/api/visit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'visit', ref }) }).catch(() => undefined);
}

/** Counts a flight on a level. */
export function countFlight(level: string, mode: 'solo' | 'online'): void {
  void request('/api/visit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'flight', level, mode }) }).catch(() => undefined);
}

const KEY = 'iamspacepilot.statsKey';

/** The owner's key, kept only in this browser. */
export function statsKey(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setStatsKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked.
  }
}

export async function fetchStats(): Promise<StatsResult> {
  try {
    const key = statsKey();
    const r = await request(`/api/stats${key ? `?key=${encodeURIComponent(key)}` : ''}`);
    const b = r.body as ({ ok?: boolean; error?: string } & Partial<Stats>) | null;
    if (!b || !b.ok) return { ok: false, error: b?.error ?? `HTTP ${r.status}` };
    return { ok: true, stats: b as unknown as Stats };
  } catch {
    return { ok: false, error: 'network' };
  }
}
