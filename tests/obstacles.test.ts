import { describe, expect, it } from 'vitest';
import { LEVEL_ORDER } from '../src/core/levels';
import { Quat } from '../src/core/math';
import { LEVEL_OBSTACLES, Obstacle } from '../src/core/obstacles';
import { soloWorldSetup } from '../src/core/solo';
import type { LevelId, PilotInput } from '../src/core/types';
import { World } from '../src/core/world';

const IDLE: PilotInput = { steerX: 0, steerY: 0, roll: 0, boost: false };

describe('obstacles', () => {
  it('measures the distance to spheres, rods and rings', () => {
    const s = new Obstacle({ shape: { kind: 'sphere', r: 5 }, at: [0, 0, 0], look: 'orb' });
    expect(s.dist(8, 0, 0)).toBeCloseTo(3);
    expect(s.dist(0, 0, 0)).toBeCloseTo(-5);
    const c = new Obstacle({ shape: { kind: 'capsule', r: 2, half: 10, axis: [0, 1, 0] }, at: [0, 0, 0], look: 'spire' });
    expect(c.dist(5, 4, 0)).toBeCloseTo(3);
    expect(c.dist(0, 15, 0)).toBeCloseTo(3);
    const t = new Obstacle({ shape: { kind: 'torus', R: 10, r: 1, axis: [0, 0, 1] }, at: [0, 0, 0], look: 'gate' });
    expect(t.dist(0, 0, 0)).toBeCloseTo(9);
    expect(t.dist(10, 0, 3)).toBeCloseTo(2);
  });

  it('moves the same way on every device', () => {
    const a = new World({ level: 'moon-shadow', seed: 1, pilots: [{ name: 'A', isBot: false, assist: true, skill: 'pilot' }] });
    const b = new World({ level: 'moon-shadow', seed: 9, pilots: [{ name: 'B', isBot: false, assist: true, skill: 'pilot' }], online: true });
    for (let t = 0; t < 400; t++) {
      a.step([IDLE]);
      b.step([IDLE]);
    }
    expect(b.obstacles.map((o) => [o.c.x, o.c.y, o.c.z])).toEqual(a.obstacles.map((o) => [o.c.x, o.c.y, o.c.z]));
    expect(a.obstacles[0].c.x).not.toBeCloseTo(LEVEL_OBSTACLES['moon-shadow'][0].at[0]);
  });

  for (const id of LEVEL_ORDER) {
    it(`keeps ${id} start positions and rings clear`, () => {
      const w = new World(soloWorldSetup({ level: id as LevelId, seed: 4, bots: 7, difficulty: 'pilot', assist: true, ship: 'trident' }, 'P'));
      expect(w.obstacles.length).toBeGreaterThan(0);
      for (const g of w.gliders) expect(w.obstacleDist(g.p.x, g.p.y, g.p.z)).toBeGreaterThan(10);
      for (const r of w.rings) expect(w.obstacleDist(r.c.x, r.c.y, r.c.z)).toBeGreaterThan(7);
    });
  }

  function aimed(level: LevelId, ship: 'trident' | 'halo' = 'trident'): { w: World; target: Obstacle } {
    const w = new World({ level, seed: 1, pilots: [{ name: 'A', isBot: false, assist: false, skill: 'pilot', ship }] });
    for (let t = 0; t < 180; t++) w.step([]);
    const target = w.obstacles[0];
    // Put the ship 40 m from the obstacle, flying straight at its centre.
    const g = w.gliders[0];
    const dir = { x: 1, y: 0, z: 0 };
    g.p.set(target.c.x - dir.x * 40, target.c.y, target.c.z);
    g.pPrev.copy(g.p);
    g.qb.copy(new Quat().setAxisAngle(0, 1, 0, Math.PI / 2));
    g.q.copy(g.qb);
    g.bank = 0;
    for (const r of w.rings) {
      r.active = false;
      r.respawnTick = 1e9;
    }
    return { w, target };
  }

  it('is deadly to fly into', () => {
    const { w } = aimed('cloud-sea');
    for (let t = 0; t < 150 && w.gliders[0].alive; t++) w.step([IDLE]);
    expect(w.gliders[0].crash).toMatchObject({ kind: 'obstacle', seg: 0 });
  });

  it('stops shots', () => {
    const { w, target } = aimed('cloud-sea');
    w.step([{ ...IDLE, fire: true }]);
    expect(w.shots.length).toBe(1);
    for (let t = 0; t < 40; t++) w.step([IDLE]);
    expect(w.shots.length).toBe(0);
    expect(target.dist(w.gliders[0].p.x, w.gliders[0].p.y, w.gliders[0].p.z)).toBeGreaterThan(0);
  });

  it('lets a phasing Halo through', () => {
    const { w } = aimed('cloud-sea', 'halo');
    // Phase just before reaching it (1.5 s of phase cover the island).
    for (let t = 0; t < 40; t++) w.step([IDLE]);
    w.step([{ ...IDLE, special: true }]);
    for (let t = 0; t < 70; t++) w.step([IDLE]);
    expect(w.gliders[0].alive).toBe(true);
  });

  it('bots fly around them', { timeout: 60000 }, () => {
    let obstacleCrashes = 0;
    let crashes = 0;
    for (const id of LEVEL_ORDER) {
      for (let seed = 1; seed <= 2; seed++) {
        const setup = soloWorldSetup({ level: id as LevelId, seed, bots: 6, difficulty: 'pilot', assist: true, ship: 'manta' }, 'P');
        setup.pilots[0].isBot = true;
        const w = new World(setup);
        for (let t = 0; t < 180 + 60 * 20; t++) w.step([]);
        for (const g of w.gliders) {
          if (!g.crash) continue;
          crashes++;
          if (g.crash.kind === 'obstacle') obstacleCrashes++;
        }
      }
    }
    console.log(`bots: ${crashes} crashes in 20 s, ${obstacleCrashes} into obstacles`);
    // Obstacles add danger, but bots mostly avoid them.
    expect(obstacleCrashes).toBeLessThanOrEqual(Math.max(4, crashes * 0.25));
  });
});
