import { beforeEach, describe, expect, it } from 'vitest';
import { loadProfile, saveProfile } from '../src/storage/profile';

/** A tiny localStorage for the profile code. */
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('profile', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  });

  it('starts every visit with the first ship and without the dachshund cheat', () => {
    localStorage.setItem('iamspacepilot.profile', JSON.stringify({ callsign: 'TESTER', ship: 'dachshund', dog: true }));
    const p = loadProfile();
    expect(p.callsign).toBe('TESTER');
    expect(p.ship).toBe('trident');
    expect(p.dog).toBe(false);
  });

  it('keeps the other settings', () => {
    const p = loadProfile();
    p.callsign = 'ACE';
    p.ship = 'manta';
    p.settings.music = false;
    saveProfile(p);
    const q = loadProfile();
    expect(q.callsign).toBe('ACE');
    expect(q.settings.music).toBe(false);
    expect(q.ship).toBe('trident');
  });
});
