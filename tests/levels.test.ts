import { describe, expect, it } from 'vitest';
import { LEVELS, LEVEL_ORDER, nextLevel } from '../src/core/levels';
import { AXIS_FWD, V3, dsin } from '../src/core/math';
import { World, type PilotSetup } from '../src/core/world';

function pilots(bots: number): PilotSetup[] {
  const list: PilotSetup[] = [{ name: 'You', isBot: false, assist: true, skill: 'pilot' }];
  for (let i = 0; i < bots; i++) list.push({ name: `Bot ${i}`, isBot: true, assist: true, skill: 'pilot' });
  return list;
}

describe('levels', () => {
  it('has ten levels in order', () => {
    expect(LEVEL_ORDER).toHaveLength(10);
    LEVEL_ORDER.forEach((id, i) => expect(LEVELS[id].index).toBe(i + 1));
    expect(nextLevel('cloud-sea')).toBe('storm-eye');
    expect(nextLevel('lattice-core')).toBeNull();
  });

  for (const id of LEVEL_ORDER) {
    it(`plays ${id} with bots for 25 seconds`, () => {
      const w = new World({ level: id, seed: 3, pilots: pilots(5) });
      for (let t = 0; t < 180 + 60 * 25; t++) {
        w.step([{ steerX: 0.45 + dsin(t * 0.02) * 0.3, steerY: dsin(t * 0.013) * 0.2, roll: 0, boost: false }]);
      }
      // Bots should not all crash straight away on any level.
      const crashedEarly = w.gliders.filter((g) => g.isBot && !g.alive && g.crashTick < 180 + 60 * 6).length;
      expect(crashedEarly).toBeLessThanOrEqual(2);
      for (const g of w.gliders) {
        expect(Number.isFinite(g.p.x + g.p.y + g.p.z)).toBe(true);
      }
    });
  }

  it('pulls gliders towards the core and kills on contact', () => {
    const w = new World({ level: 'lattice-core', seed: 1, pilots: pilots(1) });
    const g = w.gliders[0];
    for (let t = 0; t < 180; t++) w.step([]);
    // Point the player straight at the core.
    g.p.set(0, 0, 30);
    g.pPrev.set(0, 0, 30);
    g.qb.setAxisAngle(0, 1, 0, Math.PI);
    g.q.copy(g.qb);
    for (let t = 0; t < 120 && g.alive; t++) w.step([{ steerX: 0, steerY: 0, roll: 0, boost: false }]);
    expect(g.alive).toBe(false);
    expect(g.crash?.kind).toBe('core');
  });

  it('blows gliders sideways in the jet stream', () => {
    const w = new World({ level: 'jet-stream', seed: 2, pilots: pilots(0) });
    for (let t = 0; t < 181; t++) w.step([]);
    const g = w.gliders[0];
    const f = g.q.rotate(AXIS_FWD, new V3());
    const before = g.p.clone();
    w.step([{ steerX: 0, steerY: 0, roll: 0, boost: false }]);
    const expected = (f.x * g.speed + 5) / 60;
    expect(g.p.x - before.x).toBeCloseTo(expected, 9);
  });
});
