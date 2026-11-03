import { describe, expect, it } from 'vitest';
import { LEVEL_ORDER } from '../src/core/levels';
import { SHIP_ORDER } from '../src/core/ships';
import { World } from '../src/core/world';
import { SKY_FALLS, placeSkyFalls } from '../src/render/skyfalls';
import { VISITORS, visitorsFor } from '../src/render/visitors';

const world = (level: (typeof LEVEL_ORDER)[number]) =>
  new World({ level, seed: 3, pilots: [{ name: 'A', isBot: false, assist: true, skill: 'pilot', ship: 'trident' }] });

describe('scenery', () => {
  it('every level has many waterfalls inside the arena, clear of obstacles and of each other, always the same', () => {
    for (const id of LEVEL_ORDER) {
      const w = world(id);
      const falls = placeSkyFalls(w);
      expect(falls.length, id).toBe(SKY_FALLS);
      const a = w.spec.arena;
      for (const f of falls) {
        expect(Math.hypot(f.x, f.z)).toBeLessThan(a.radius * 0.85);
        expect(f.top - f.bottom).toBeGreaterThan(60);
        expect(f.bottom).toBe(a.floorY);
        if (w.obstacles.length) expect(w.obstacleDist(f.x, (f.top + f.bottom) / 2, f.z)).toBeGreaterThan(f.r);
      }
      for (let i = 0; i < falls.length; i++)
        for (let j = i + 1; j < falls.length; j++) expect(Math.hypot(falls[i].x - falls[j].x, falls[i].z - falls[j].z)).toBeGreaterThan(falls[i].r + falls[j].r);
      // Another round in the same level: the same waterfalls.
      expect(placeSkyFalls(new World({ level: id, seed: 77, pilots: [{ name: 'B', isBot: true, assist: true, skill: 'ace' }] }))).toEqual(falls);
    }
  });

  it('six creative gliders from the hangar visit every level, a different six in each', () => {
    const creative = SHIP_ORDER.slice(SHIP_ORDER.indexOf('dachshund'));
    const sets = LEVEL_ORDER.map((_, i) => visitorsFor(i + 1));
    for (const set of sets) {
      expect(set).toHaveLength(VISITORS);
      expect(new Set(set).size).toBe(VISITORS);
      for (const id of set) expect(creative).toContain(id);
    }
    for (let i = 1; i < sets.length; i++) expect(sets[i]).not.toEqual(sets[i - 1]);
    // Over all levels every creative glider shows up.
    expect(new Set(sets.flat()).size).toBe(creative.length);
  });
});
