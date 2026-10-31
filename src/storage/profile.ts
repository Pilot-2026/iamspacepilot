import { validateCallsign } from '../core/callsign';
import type { Difficulty, LevelId } from '../core/types';

export { validateCallsign };

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

/** One entry in this device's highscore list. */
export interface LocalScore {
  score: number;
  time: number;
  won: boolean;
  place: number;
  pilots: number;
  difficulty: Difficulty;
  bots: number;
  /** ISO date. */
  date: string;
}

export interface Profile {
  v: 1;
  callsign: string;
  /** Secret that proves this browser owns the callsign online. Never shown. */
  pilotKey: string;
  settings: Settings;
  solo: { level: LevelId; bots: number; difficulty: Difficulty };
  records: Partial<Record<LevelId, LevelRecord>>;
  highscores: Partial<Record<LevelId, LocalScore[]>>;
}

export const LOCAL_TOP = 10;

const KEY = 'iamspacepilot.profile';
const isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function newPilotKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function defaultProfile(): Profile {
  return {
    v: 1,
    callsign: '',
    pilotKey: newPilotKey(),
    settings: { volume: 0.8, invertPitch: false, autoHorizon: isTouch, quality: 'auto' },
    solo: { level: 'cloud-sea', bots: 3, difficulty: 'pilot' },
    records: {},
    highscores: {},
  };
}

/** Loads the profile from this browser. Falls back to defaults when storage is blocked. */
export function loadProfile(): Profile {
  const base = defaultProfile();
  let p: Profile = base;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<Profile>;
      p = {
        ...base,
        ...stored,
        pilotKey: typeof stored.pilotKey === 'string' && /^[0-9a-f]{32}$/.test(stored.pilotKey) ? stored.pilotKey : base.pilotKey,
        settings: { ...base.settings, ...(stored.settings ?? {}) },
        solo: { ...base.solo, ...(stored.solo ?? {}) },
        records: { ...(stored.records ?? {}) },
        highscores: { ...(stored.highscores ?? {}) },
        v: 1,
      };
    }
  } catch {
    p = base;
  }
  saveProfile(p);
  return p;
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage can be blocked (private mode). The game still works, it just forgets.
  }
}

/** Adds a score to this device's top list. Returns its place (1 = best), or 0 if it did not make the list. */
export function addLocalScore(p: Profile, level: LevelId, entry: LocalScore): number {
  const list = (p.highscores[level] ?? []).slice();
  list.push(entry);
  list.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
  const kept = list.slice(0, LOCAL_TOP);
  p.highscores[level] = kept;
  return kept.indexOf(entry) + 1;
}
