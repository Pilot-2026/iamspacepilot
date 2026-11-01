import { describe, expect, it } from 'vitest';
import type { Doc } from '../server/firestore';
import { deviceOf, fieldKey, handleStats, handleVisit, viennaDay, type StatsStore } from '../server/stats';

/** Keeps documents in memory and does what Firestore's commit does for our counters. */
class MemoryStore implements StatsStore {
  docs = new Map<string, Doc>();
  async get(path: string) {
    return this.docs.get(path) ?? null;
  }
  async create() {
    return true;
  }
  async set(path: string, data: Record<string, unknown>) {
    this.docs.set(path, data as Doc);
  }
  async top(collection: string, field: string, limit: number) {
    return [...this.docs.entries()]
      .filter(([k]) => k.startsWith(`${collection}/`))
      .map(([, d]) => d)
      .sort((a, b) => Number(b[field] ?? 0) - Number(a[field] ?? 0))
      .slice(0, limit);
  }
  async countGreater() {
    return 0;
  }
  async increment(updates: { path: string; inc: Record<string, number>; set?: Record<string, unknown>; min?: Record<string, number> }[]) {
    for (const u of updates) {
      const d: Doc = { ...(this.docs.get(u.path) ?? {}), ...((u.set ?? {}) as Doc) };
      for (const [k, n] of Object.entries(u.inc)) d[k] = Number(d[k] ?? 0) + n;
      for (const [k, n] of Object.entries(u.min ?? {})) d[k] = d[k] === undefined ? n : Math.min(Number(d[k]), n);
      this.docs.set(u.path, d);
    }
  }
}

const visit = (body: unknown, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile') =>
  new Request('https://x/api/visit', { method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': ua } });

describe('visit statistics', () => {
  it('makes safe field names and knows devices and the Vienna day', () => {
    expect(fieldKey('Wien Österreich')).toBe('Wien_Osterreich');
    expect(fieldKey('Großraming AT')).toBe('Grossraming_AT');
    expect(fieldKey('`; DROP')).toBe('DROP');
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('tablet');
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14) Mobile Safari')).toBe('mobile');
    expect(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('desktop');
    // 23:30 UTC on 31 Oct is already 1 Nov in Vienna.
    expect(viennaDay(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
  });

  it('counts visits and flights and reports them', async () => {
    const store = new MemoryStore();
    let now = new Date('2026-11-01T10:00:00Z');
    const deps = (country: string, city: string) => ({ store, geo: { country, city }, now: () => now });
    await handleVisit(visit({ kind: 'visit', ref: 'www.google.com' }), deps('AT', 'Wien'));
    await handleVisit(visit({ kind: 'visit' }, 'Mozilla/5.0 (Macintosh)'), deps('AT', 'Graz'));
    await handleVisit(visit({ kind: 'flight', level: 'cloud-sea', mode: 'solo' }), deps('AT', 'Graz'));
    now = new Date('2026-11-02T10:00:00Z');
    await handleVisit(visit({ kind: 'visit' }), deps('DE', 'München'));
    // Rubbish is refused and counts nothing.
    expect((await handleVisit(visit({ kind: 'flight', level: 'nowhere' }), deps('DE', 'Berlin'))).status).toBe(400);
    expect((await handleVisit(visit({ kind: 'party' }), deps('DE', 'Berlin'))).status).toBe(400);

    const res = await handleStats(new Request('https://x/api/stats'), { store });
    const s = (await res.json()) as {
      ok: boolean;
      total: number;
      flights: number;
      since: string;
      all: Record<string, Record<string, number>>;
      recent: Record<string, Record<string, number>>;
      days: { day: string; visits: number; flights: number }[];
    };
    expect(s.ok).toBe(true);
    expect(s.total).toBe(3);
    expect(s.flights).toBe(1);
    expect(s.since).toBe('2026-11-01');
    expect(s.all.countries).toEqual({ AT: 2, DE: 1 });
    expect(s.all.devices).toEqual({ mobile: 2, desktop: 1 });
    expect(s.all.levels).toEqual({ cloud_sea: 1 });
    expect(s.recent.cities).toEqual({ Wien_AT: 1, Graz_AT: 1, Munchen_DE: 1 });
    expect(s.recent.sources).toEqual({ google_com: 1, direct: 2 });
    expect(s.days).toEqual([
      { day: '2026-11-02', visits: 1, flights: 0 },
      { day: '2026-11-01', visits: 2, flights: 1 },
    ]);
  });

  it('keeps working without a database', async () => {
    const res = await handleVisit(visit({ kind: 'visit' }), { store: null });
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });
});
