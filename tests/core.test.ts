import { describe, expect, it } from 'vitest';
import { AXIS_FWD, Quat, V3, dcos, dsin } from '../src/core/math';
import { Trail, quadCorners, segQuad, segSegDistSq } from '../src/core/trail';
import { World, type PilotSetup, type WorldSetup } from '../src/core/world';
import type { PilotInput } from '../src/core/types';

function setup(bots: number, seed = 1234, level: WorldSetup['level'] = 'cloud-sea'): WorldSetup {
  const pilots: PilotSetup[] = [{ name: 'You', isBot: false, assist: true, skill: 'pilot' }];
  for (let i = 0; i < bots; i++) pilots.push({ name: `Bot ${i + 1}`, isBot: true, assist: true, skill: 'pilot' });
  return { level, seed, pilots };
}

/** A fixed pattern of inputs so tests do not depend on a real player. */
function scripted(t: number): PilotInput {
  return {
    steerX: dsin(t * 0.013) * 0.8,
    steerY: dsin(t * 0.021 + 1) * 0.5,
    roll: t % 600 < 40 ? 1 : 0,
    boost: t % 300 < 90,
  };
}

describe('deterministic math', () => {
  it('dsin and dcos match Math.sin and Math.cos closely', () => {
    for (let x = -40; x < 40; x += 0.173) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-8);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-8);
    }
  });

  it('builds a rotation from a basis', () => {
    const f = new V3(1, 0, 0);
    const up = new V3(0, 1, 0);
    const left = new V3().cross(up, f);
    const q = new Quat().setFromBasis(left, up, f);
    const out = q.rotate(AXIS_FWD, new V3());
    expect(out.x).toBeCloseTo(1);
    expect(out.y).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(0);
    const back = q.rotateInverse(out, new V3());
    expect(back.z).toBeCloseTo(1);
  });
});

describe('wall geometry', () => {
  const tr = new Trail();
  tr.add(new V3(0, 0, 0), new V3(0, 1, 0), 0);
  tr.add(new V3(0, 0, 10), new V3(0, 1, 0), 3);
  const c = new Float64Array(12);
  quadCorners(tr, 0, c);

  it('hits a segment that crosses the wall', () => {
    expect(segQuad(-1, 0, 5, 2, 0, 0, c)).toBeCloseTo(0.5);
  });

  it('misses a segment that passes above the wall', () => {
    expect(segQuad(-1, 5, 5, 2, 0, 0, c)).toBe(-1);
  });

  it('measures the distance between two segments', () => {
    expect(segSegDistSq(0, 0, 0, 10, 0, 0, 5, 3, -1, 5, 3, 1)).toBeCloseTo(9);
  });
});

describe('world', () => {
  it('counts down for three seconds before the start', () => {
    const w = new World(setup(1));
    for (let i = 0; i < 179; i++) w.step([]);
    expect(w.phase).toBe('countdown');
    w.step([]);
    expect(w.phase).toBe('flying');
  });

  it('runs the same way twice with the same inputs', () => {
    const a = new World(setup(5, 99));
    const b = new World(setup(5, 99));
    for (let t = 0; t < 3000; t++) {
      a.step([scripted(t)]);
      b.step([scripted(t)]);
    }
    expect(a.fingerprint()).toBe(b.fingerprint());
    expect(a.trails[0].count).toBeGreaterThan(10);
  });

  it('builds a wall behind every glider', () => {
    const w = new World(setup(3));
    for (let t = 0; t < 180 + 120; t++) w.step([]);
    for (const tr of w.trails) expect(tr.count).toBeGreaterThan(30);
  });

  it('keeps most bots alive through the first seconds', () => {
    const w = new World(setup(7, 7));
    for (let t = 0; t < 180 + 360; t++) w.step([scripted(t)]);
    const bots = w.gliders.filter((g) => g.isBot && g.alive).length;
    expect(bots).toBeGreaterThanOrEqual(5);
  });

  it('ends the round when one pilot is left', () => {
    const w = new World(setup(3, 5));
    for (let t = 0; t < 180 + 60 * 150 && w.phase !== 'over'; t++) w.step([{ steerX: 0, steerY: 0, roll: 0, boost: false }]);
    expect(w.phase).toBe('over');
    expect(w.aliveCount()).toBeLessThanOrEqual(1);
    const places = w.gliders.map((g) => g.place).sort();
    expect(places[0]).toBeGreaterThanOrEqual(0);
  });

  it('crashes a pilot who flies into the floor', () => {
    const w = new World(setup(1));
    for (let t = 0; t < 180 + 60 * 20 && w.gliders[0].alive; t++) w.step([{ steerX: 0, steerY: -1, roll: 0, boost: false }]);
    expect(w.gliders[0].alive).toBe(false);
    expect(['floor', 'wall', 'shield', 'collision']).toContain(w.gliders[0].crash?.kind);
  });

  it('runs the storm level with lightning', () => {
    const w = new World(setup(3, 11, 'storm-eye'));
    let warned = 0;
    for (let t = 0; t < 180 + 60 * 12; t++) {
      w.step([scripted(t)]);
      for (const e of w.events) if (e.type === 'bolt-warn') warned++;
    }
    expect(warned).toBeGreaterThan(0);
  });
});
