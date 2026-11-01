import { request } from './api';

/** Anonymous visit statistics from /api/stats. */
export interface Stats {
  total: number;
  flights: number;
  since: string | null;
  all: Record<'countries' | 'devices' | 'levels' | 'modes' | 'cities' | 'sources', Record<string, number>>;
  recent: Record<'countries' | 'devices' | 'levels' | 'modes' | 'cities' | 'sources', Record<string, number>>;
  days: { day: string; visits: number; flights: number }[];
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

export async function fetchStats(): Promise<StatsResult> {
  try {
    const r = await request('/api/stats');
    const b = r.body as ({ ok?: boolean; error?: string } & Partial<Stats>) | null;
    if (!b || !b.ok) return { ok: false, error: b?.error ?? `HTTP ${r.status}` };
    return { ok: true, stats: b as unknown as Stats };
  } catch {
    return { ok: false, error: 'network' };
  }
}
