import type { Difficulty, LevelId } from '../core/types';

export type Quality = 'auto' | 'low' | 'high';

export interface Settings {
  volume: number;
  invertPitch: boolean;
  autoHorizon: boolean;
  quality: Quality;
}

export interface LevelRecord {
  bestTime: number;
  wins: number;
  flights: number;
}

export interface Profile {
  v: 1;
  callsign: string;
  settings: Settings;
  solo: { level: LevelId; bots: number; difficulty: Difficulty };
  records: Partial<Record<LevelId, LevelRecord>>;
}

const KEY = 'iamspacepilot.profile';
const isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function defaultProfile(): Profile {
  return {
    v: 1,
    callsign: '',
    settings: { volume: 0.8, invertPitch: false, autoHorizon: isTouch, quality: 'auto' },
    solo: { level: 'cloud-sea', bots: 3, difficulty: 'pilot' },
    records: {},
  };
}

/** Loads the profile from this browser. Falls back to defaults when storage is blocked. */
export function loadProfile(): Profile {
  const base = defaultProfile();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Profile>;
    return {
      ...base,
      ...p,
      settings: { ...base.settings, ...(p.settings ?? {}) },
      solo: { ...base.solo, ...(p.solo ?? {}) },
      records: { ...(p.records ?? {}) },
      v: 1,
    };
  } catch {
    return base;
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage can be blocked (private mode). The game still works, it just forgets.
  }
}

/** Callsign rules: 3 to 16 characters, letters, digits, - and _. */
export function validateCallsign(raw: string): string | null {
  const s = raw.trim();
  if (s.length < 3) return 'Use at least 3 characters.';
  if (s.length > 16) return 'Use at most 16 characters.';
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return 'Use letters, numbers, - and _ only.';
  return null;
}
