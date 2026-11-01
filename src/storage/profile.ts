import { validateCallsign } from '../core/callsign';
import { LEVELS, LEVEL_ORDER } from '../core/levels';
import type { Difficulty, LevelId } from '../core/types';

export { validateCallsign };

export type Quality = 'auto' | 'low' | 'high';

export interface Settings {
  volume: number;
  /** Flight mode: arrow up lowers the nose. */
  invertPitch: boolean;
  /** Version of the control defaults this profile has seen. */
  controls: number;
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

/** What the pilot last chose when hosting an online game. */
export interface OnlinePrefs {
  level: LevelId;
  mode: 'ffa' | 'teams';
  public: boolean;
  bots: number;
  difficulty: Difficulty;
  /** Agreed to the voice radio rules. */
  voiceOk: boolean;
  /** Microphone always open instead of push to talk. */
  openMic: boolean;
}

export interface Profile {
  v: 1;
  callsign: string;
  /** Secret that proves this browser owns the callsign online. Never shown. */
  pilotKey: string;
  settings: Settings;
  solo: { level: LevelId; bots: number; difficulty: Difficulty };
  /** How many levels are open: win a level to open the next one. */
  unlocked: number;
  records: Partial<Record<LevelId, LevelRecord>>;
  highscores: Partial<Record<LevelId, LocalScore[]>>;
  online: OnlinePrefs;
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
    settings: { volume: 0.8, invertPitch: true, controls: 2, autoHorizon: isTouch, quality: 'auto' },
    solo: { level: 'cloud-sea', bots: 3, difficulty: 'pilot' },
    unlocked: 1,
    records: {},
    highscores: {},
    online: { level: 'cloud-sea', mode: 'ffa', public: true, bots: 3, difficulty: 'pilot', voiceOk: false, openMic: false },
  };
}

/** Loads the profile from this browser. Falls back to defaults when storage is blocked. */
export function loadProfile(): Profile {
  const base = defaultProfile();
  let p: Profile = base;
  /** Control defaults version stored in this browser (0 before flight mode became standard). */
  let storedControls = 2;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<Profile>;
      storedControls = Number((stored.settings as Partial<Settings> | undefined)?.controls ?? 0);
      p = {
        ...base,
        ...stored,
        pilotKey: typeof stored.pilotKey === 'string' && /^[0-9a-f]{32}$/.test(stored.pilotKey) ? stored.pilotKey : base.pilotKey,
        settings: { ...base.settings, ...(stored.settings ?? {}) },
        solo: { ...base.solo, ...(stored.solo ?? {}) },
        records: { ...(stored.records ?? {}) },
        highscores: { ...(stored.highscores ?? {}) },
        online: { ...base.online, ...(stored.online ?? {}) },
        v: 1,
      };
    }
  } catch {
    p = base;
  }
  // Levels already flown or won stay open, also for profiles from before levels unlocked.
  let open = typeof p.unlocked === 'number' ? p.unlocked : 1;
  for (const id of LEVEL_ORDER) {
    const rec = p.records[id];
    if (!rec) continue;
    const i = LEVELS[id].index;
    open = Math.max(open, rec.wins > 0 ? i + 1 : i);
  }
  p.unlocked = Math.max(1, Math.min(LEVEL_ORDER.length, open));
  // Control defaults v2: flight mode (arrow up = nose down) is the standard now.
  if (!(storedControls >= 2)) {
    p.settings.invertPitch = true;
    p.settings.controls = 2;
  }
  if (!LEVELS[p.solo.level] || LEVELS[p.solo.level].index > p.unlocked) p.solo.level = 'cloud-sea';
  if (!LEVELS[p.online.level]) p.online.level = 'cloud-sea';
  p.online.bots = Math.max(0, Math.min(7, Number(p.online.bots) | 0));
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
