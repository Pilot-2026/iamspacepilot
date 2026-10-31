import { describe, expect, it } from 'vitest';
import { GUN } from '../src/core/config';
import { Quat } from '../src/core/math';
import { decodeReplay, quantize, ReplayRecorder } from '../src/core/replay';
import { replaySolo, soloScore, soloWorldSetup, type SoloSetup } from '../src/core/solo';
import type { PilotInput } from '../src/core/types';
import { World, type PilotSetup } from '../src/core/world';

const STRAIGHT: PilotInput = { steerX: 0, steerY: 0, roll: 0, boost: false, fire: false };
const FIRE: PilotInput = { ...STRAIGHT, fire: true };
const person = (name: string, extra: Partial<PilotSetup> = {}): PilotSetup => ({ name, isBot: false, assist: true, skill: 'pilot', ...extra });

/** Two pilots after the countdown, both flying along +Z: A at z=-30, B 60 m ahead. */
function duel(opts: { teams?: boolean; wall?: boolean } = {}): World {
  const pilots = [person('A', { team: 0 }), person('B', { team: opts.teams ? 0 : 1 })];
  if (opts.wall) pilots.push(person('C', { remote: true, team: 1 }));
  const w = new World({ level: 'orbit', seed: 1, pilots, teams: opts.teams });
  for (let t = 0; t < 180; t++) w.step([]);
  const place = (i: number, z: number) => {
    const g = w.gliders[i];
    g.p.set(0, 0, z);
    g.pPrev.set(0, 0, z);
    g.qb.copy(new Quat());
    g.q.copy(new Quat());
    g.bank = 0;
  };
  place(0, -30);
  place(1, 30);
  if (opts.wall) {
    // A wall across the line of fire at z = -5, owned by a third glider far away.
    w.addRemoteSamples(2, 0, [-20, 0, -5, 0, 1, 0, 20, 0, -5, 0, 1, 0]);
    w.gliders[2].p.set(60, 20, 60);
  }
  return w;
}

function fly(w: World, ticks: number, a: PilotInput = STRAIGHT, b: PilotInput = STRAIGHT): void {
  for (let t = 0; t < ticks; t++) w.step([a, b]);
}

describe('shots', () => {
  it('fires in bursts until the gun overheats, then cools down', () => {
    const w = duel();
    let shots = 0;
    for (let t = 0; t < 120; t++) {
      w.step([FIRE, STRAIGHT]);
      shots += w.events.filter((e) => e.type === 'shot' && e.id === 0).length;
    }
    const a = w.gliders[0];
    expect(shots).toBeGreaterThanOrEqual(5);
    expect(shots).toBeLessThanOrEqual(8);
    expect(a.overheated).toBe(true);
    // Locked while hot, free again once it cooled.
    fly(w, 30, FIRE);
    expect(w.events.some((e) => e.type === 'shot')).toBe(false);
    fly(w, 140);
    expect(a.overheated).toBe(false);
  });

  it('flies through walls and hits the glider behind them', () => {
    const w = duel({ wall: true });
    const hits: number[] = [];
    w.step([FIRE, STRAIGHT]);
    for (let t = 0; t < 90; t++) {
      w.step([STRAIGHT, STRAIGHT]);
      for (const e of w.events) if (e.type === 'hit') hits.push(e.id, e.by, e.hull);
    }
    expect(hits).toEqual([1, 0, GUN.hull - 1]);
    expect(w.gliders[1].hull).toBe(GUN.hull - 1);
    expect(w.gliders[0].hits).toBe(1);
    // The wall is still there: the shooter flew into it.
    expect(w.gliders[0].crash?.kind).toBe('wall');
  });

  it('shoots a glider down after three hits and scores it', () => {
    const w = duel();
    for (let k = 0; k < 3; k++) {
      w.step([FIRE, STRAIGHT]);
      fly(w, 14);
    }
    fly(w, 90);
    const b = w.gliders[1];
    expect(b.alive).toBe(false);
    expect(b.crash).toMatchObject({ kind: 'shot', by: 0 });
    const score = soloScore(w, 0, 'rookie');
    expect(score.shotDowns).toBe(1);
    expect(score.hits).toBe(3);
    expect(score.won).toBe(true);
  });

  it('never hits teammates', () => {
    const w = duel({ teams: true });
    for (let k = 0; k < 4; k++) {
      w.step([FIRE, STRAIGHT]);
      fly(w, 14);
    }
    fly(w, 90);
    expect(w.gliders[1].hull).toBe(GUN.hull);
    expect(w.gliders[0].hits).toBe(0);
  });

  it('repairs one hit when flying through a ring', () => {
    const w = duel();
    const b = w.gliders[1];
    b.hull = 1;
    const ring = w.rings[0];
    ring.active = true;
    ring.c.set(0, 0, 36);
    ring.n.set(0, 0, 1);
    fly(w, 30);
    expect(b.hull).toBe(2);
  });

  it('records the trigger in replays, so scores with shots can be checked', () => {
    const setup: SoloSetup = { level: 'cloud-sea', seed: 77, bots: 4, difficulty: 'ace', assist: true };
    const w = new World(soloWorldSetup(setup, 'You'));
    const rec = new ReplayRecorder();
    let fired = 0;
    for (let t = 0; t < 60 * 60 && w.gliders[0].alive && w.phase !== 'over'; t++) {
      const inp = quantize({ steerX: Math.sin(t * 0.013) * 0.6, steerY: Math.sin(t * 0.007) * 0.3, roll: 0, boost: t % 200 < 40, fire: t % 90 < 30 });
      if (inp.fire) fired++;
      rec.push(inp);
      w.step([inp]);
    }
    const live = soloScore(w, 0, setup.difficulty);
    const decoded = decodeReplay(rec.encode())!;
    expect(decoded.filter((i) => i.fire).length).toBe(fired);
    const again = replaySolo(setup, decoded);
    expect(again?.result.score).toBe(live.score);
    expect(again?.result.hits).toBe(live.hits);
  });

  it('lets bots fire', () => {
    const setup: SoloSetup = { level: 'orbit', seed: 5, bots: 6, difficulty: 'ace', assist: true };
    let shots = 0;
    for (let seed = 1; seed <= 4 && shots === 0; seed++) {
      const w = new World(soloWorldSetup({ ...setup, seed }, 'You'));
      for (let t = 0; t < 180 + 60 * 30 && w.phase !== 'over'; t++) {
        w.step([{ steerX: 0.4, steerY: 0, roll: 0, boost: false }]);
        shots += w.events.filter((e) => e.type === 'shot' && e.id > 0).length;
      }
    }
    expect(shots).toBeGreaterThan(0);
  });
});
