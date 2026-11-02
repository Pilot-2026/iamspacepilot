import { describe, expect, it } from 'vitest';
import type { Doc } from '../server/firestore';
import { deviceOf, fieldKey, handleStats, handleVisit, maskIp, viennaDay, visitorKey, type StatsStore } from '../server/stats';

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
  async countGreater(collection: string, field: string, value: number) {
    return [...this.docs.entries()].filter(([k, d]) => k.startsWith(`${collection}/`) && Number(d[field] ?? 0) > value).length;
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
      days: { day: string; visits: number; visitors: number; flights: number }[];
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
      { day: '2026-11-02', visits: 1, visitors: 0, flights: 0 },
      { day: '2026-11-01', visits: 2, visitors: 0, flights: 1 },
    ]);
  });

  it('keeps working without a database', async () => {
    const res = await handleVisit(visit({ kind: 'visit' }), { store: null });
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  it('shortens addresses and makes keys that cannot be read back', () => {
    expect(maskIp('84.115.12.201')).toBe('84.115.12.x');
    expect(maskIp('2a02:8388:1:2:3:4:5:6')).toBe('2a02:8388:1:…');
    expect(maskIp('nonsense')).toBe('unknown');
    const k = visitorKey('84.115.12.201', 'UA', 'salt');
    expect(k).toMatch(/^[0-9a-f]{24}$/);
    expect(visitorKey('84.115.12.201', 'UA', 'salt')).toBe(k);
    expect(visitorKey('84.115.12.202', 'UA', 'salt')).not.toBe(k);
  });

  it('counts unique and returning visitors and shows the list only to the owner', async () => {
    const store = new MemoryStore();
    let now = new Date('2026-11-01T10:00:00Z');
    const go = (ip: string) => handleVisit(visit({ kind: 'visit' }), { store, geo: { country: 'AT', city: 'Wien' }, ip, salt: 's', now: () => now });
    await go('84.115.12.1');
    await go('84.115.12.1');
    await go('91.1.2.3');
    now = new Date('2026-11-03T10:00:00Z');
    await go('84.115.12.1');
    // No full address anywhere in the store.
    expect(JSON.stringify([...store.docs.values()])).not.toContain('84.115.12.1');
    const open = (await (await handleStats(new Request('https://x/api/stats'), { store, ownerKey: 'pw' })).json()) as Record<string, unknown>;
    expect(open.total).toBe(4);
    expect(open.visitors).toBe(2);
    expect(open.returningVisitors).toBe(1);
    expect(open.returningVisits).toBe(1);
    expect(open.owner).toBe(false);
    expect(open.list).toEqual([]);
    const wrong = (await (await handleStats(new Request('https://x/api/stats?key=nope'), { store, ownerKey: 'pw' })).json()) as Record<string, unknown>;
    expect(wrong.owner).toBe(false);
    const mine = (await (await handleStats(new Request('https://x/api/stats?key=pw'), { store, ownerKey: 'pw' })).json()) as {
      owner: boolean;
      list: { ip: string; visits: number; days: number; first: string }[];
      months: { month: string; visits: number; visitors: number }[];
    };
    expect(mine.owner).toBe(true);
    expect(mine.list[0]).toMatchObject({ ip: '84.115.12.x', visits: 3, days: 2, first: '2026-11-01' });
    expect(mine.list[1]).toMatchObject({ ip: '91.1.2.x', visits: 1, days: 1 });
    expect(mine.months).toEqual([{ month: '2026-11', visits: 4, visitors: 3, flights: 0 }]);
  });
});
