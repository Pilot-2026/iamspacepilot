import { describe, expect, it } from 'vitest';
import { FLIGHT, GUN, WALL_HALF } from '../src/core/config';
import { Quat } from '../src/core/math';
import { BIG_WALL, RAPID_INTERVAL, type PowerId } from '../src/core/powerups';
import { JAM_TICKS, SHIPS, type ShipId } from '../src/core/ships';
import type { PilotInput } from '../src/core/types';
import { World, type PilotSetup } from '../src/core/world';

const IDLE: PilotInput = { steerX: 0, steerY: 0, roll: 0, boost: false, fire: false, special: false };
const person = (name: string, ship: ShipId, extra: Partial<PilotSetup> = {}): PilotSetup => ({ name, isBot: false, assist: true, skill: 'pilot', ship, ...extra });

/** A in front of nothing at z=-30, B 60 m ahead at z=+30, both flying along +Z, after the countdown. */
function duel(a: ShipId, b: ShipId = 'trident', opts: { wall?: boolean; bAt?: number } = {}): World {
  const pilots = [person('A', a), person('B', b)];
  if (opts.wall) pilots.push(person('C', 'trident', { remote: true }));
  const w = new World({ level: 'orbit', seed: 1, pilots });
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
  place(1, opts.bAt ?? 30);
  if (opts.wall) {
    w.addRemoteSamples(2, 0, [-20, 0, -5, 0, 1, 0, WALL_HALF, 20, 0, -5, 0, 1, 0, WALL_HALF]);
    w.gliders[2].p.set(60, 20, 60);
  }
  // No bonus rings in the way.
  for (const r of w.rings) r.active = false;
  for (const r of w.rings) r.respawnTick = 1e9;
  return w;
}

const shotsOf = (w: World, id: number) => w.events.filter((e) => e.type === 'shot' && e.id === id).length;

describe('ships', () => {
  it('has five models (four ships and the dachshund); the Bulwark takes five hits', () => {
    expect(Object.keys(SHIPS)).toEqual(['trident', 'manta', 'halo', 'bulwark', 'dachshund']);
    const w = duel('bulwark', 'manta');
    expect(w.gliders[0].hull).toBe(5);
    expect(w.gliders[1].hull).toBe(3);
  });

  it('Trident Burst fires five shots at once without heat, then needs to recharge', () => {
    const w = duel('trident');
    w.step([{ ...IDLE, special: true }, IDLE]);
    expect(shotsOf(w, 0)).toBe(5);
    expect(w.gliders[0].heat).toBe(0);
    expect(w.events.some((e) => e.type === 'special' && e.id === 0 && e.kind === 'burst')).toBe(true);
    w.step([{ ...IDLE, special: true }, IDLE]);
    expect(shotsOf(w, 0)).toBe(0);
    expect(w.specialWait(w.gliders[0])).toBeGreaterThan(7);
  });

  it('Manta Afterburner flies faster than a normal boost without using energy', () => {
    const w = duel('manta');
    const g = w.gliders[0];
    const energy = g.energy;
    w.step([{ ...IDLE, special: true }, IDLE]);
    for (let t = 0; t < 100; t++) w.step([IDLE, IDLE]);
    expect(g.speed).toBeGreaterThan(FLIGHT.boostSpeed * 1.1);
    expect(g.energy).toBeGreaterThanOrEqual(energy);
    for (let t = 0; t < 120; t++) w.step([IDLE, IDLE]);
    expect(g.speed).toBeLessThan(FLIGHT.boostSpeed);
  });

  it('Halo Phase Shift flies through a wall; without it the wall is deadly', () => {
    const plain = duel('halo', 'trident', { wall: true });
    for (let t = 0; t < 80; t++) plain.step([IDLE, IDLE]);
    expect(plain.gliders[0].crash?.kind).toBe('wall');

    const w = duel('halo', 'trident', { wall: true });
    w.step([{ ...IDLE, special: true }, IDLE]);
    for (let t = 0; t < 80; t++) w.step([IDLE, IDLE]);
    expect(w.gliders[0].alive).toBe(true);
    expect(w.gliders[0].p.z).toBeGreaterThan(0);
  });

  it('Halo cannot be hit while phasing', () => {
    const w = duel('trident', 'halo');
    w.step([{ ...IDLE, fire: true }, { ...IDLE, special: true }]);
    for (let t = 0; t < 60; t++) w.step([IDLE, IDLE]);
    expect(w.gliders[1].hull).toBe(3);
  });

  it('Bulwark Shockwave wipes enemy shots nearby and jams their guns', () => {
    // B (Bulwark) 25 m in front of A; A fires, B answers with a shockwave.
    const w = duel('trident', 'bulwark', { bAt: -5 });
    w.step([{ ...IDLE, fire: true }, IDLE]);
    expect(w.shots.length).toBe(1);
    w.step([IDLE, { ...IDLE, special: true }]);
    expect(w.events.some((e) => e.type === 'jam' && e.id === 0)).toBe(true);
    w.step([{ ...IDLE, fire: true }, IDLE]);
    expect(w.shots.filter((s) => s.alive && s.owner === 0).length).toBe(0);
    expect(w.gliders[0].jamUntil).toBeGreaterThan(w.tick + JAM_TICKS - 10);
    expect(w.gliders[1].hull).toBe(5);
  });
});

describe('bonus rings', () => {
  function powered(power: PowerId, ship: ShipId = 'manta'): World {
    const w = duel(ship, 'trident', { bAt: -90 });
    const ring = w.rings[0];
    ring.active = true;
    ring.power = power;
    ring.c.set(0, 0, -24);
    ring.n.set(0, 0, 1);
    for (let t = 0; t < 30; t++) w.step([IDLE, IDLE]);
    return w;
  }

  it('places rings the same way on every device and shows their power-up', () => {
    const a = new World({ level: 'orbit', seed: 99, pilots: [person('A', 'halo')] });
    const b = new World({ level: 'orbit', seed: 99, pilots: [person('A', 'halo')], online: true });
    expect(a.rings.length).toBeGreaterThan(0);
    expect(b.rings.map((r) => [r.c.x, r.c.y, r.c.z, r.power])).toEqual(a.rings.map((r) => [r.c.x, r.c.y, r.c.z, r.power]));
  });

  it('gives the power-up of the ring you fly through', () => {
    const w = powered('turbo');
    const g = w.gliders[0];
    expect(g.power).toBe('turbo');
    expect(g.rings).toBe(1);
    // Turbo: boost without using energy.
    const e = g.energy;
    for (let t = 0; t < 60; t++) w.step([{ ...IDLE, boost: true }, IDLE]);
    expect(g.boosting).toBe(true);
    expect(g.energy).toBeGreaterThanOrEqual(e);
  });

  it('triple shot fires three, rapid fire never overheats, seeker shots hunt', () => {
    const t3 = powered('triple');
    t3.step([{ ...IDLE, fire: true }, IDLE]);
    expect(shotsOf(t3, 0)).toBe(3);

    const rapid = powered('rapid');
    let shots = 0;
    for (let t = 0; t < 120; t++) {
      rapid.step([{ ...IDLE, fire: true }, IDLE]);
      shots += shotsOf(rapid, 0);
    }
    expect(shots).toBe(Math.ceil(120 / RAPID_INTERVAL));
    expect(rapid.gliders[0].overheated).toBe(false);

    const seek = powered('seeker');
    seek.step([{ ...IDLE, fire: true }, IDLE]);
    expect(seek.shots.some((s) => s.seek)).toBe(true);
  });

  it('big wall makes the new wall almost twice as high', () => {
    const w = powered('bigwall');
    for (let t = 0; t < 12; t++) w.step([IDLE, IDLE]);
    const tr = w.trails[0];
    expect(tr.h[tr.count - 1]).toBeCloseTo(WALL_HALF * BIG_WALL);
    expect(w.trails[1].h[w.trails[1].count - 1]).toBe(WALL_HALF);
  });

  it('a shield takes one hit, then one more hit counts', () => {
    const w = duel('trident', 'trident');
    const b = w.gliders[1];
    b.power = 'shield';
    b.shield = true;
    b.powerUntil = 1e9;
    const hits: boolean[] = [];
    for (let t = 0; t < 120; t++) {
      // Two shots, a quarter second apart.
      w.step([{ ...IDLE, fire: t === 0 || t === 15 }, IDLE]);
      for (const e of w.events) if (e.type === 'hit') hits.push(e.shield);
    }
    expect(hits).toEqual([true, false]);
    expect(b.hull).toBe(2);
    expect(b.shield).toBe(false);
  });

  it('a shield takes one wall', () => {
    const w = duel('manta', 'trident', { wall: true });
    const a = w.gliders[0];
    a.power = 'shield';
    a.shield = true;
    a.powerUntil = 1e9;
    for (let t = 0; t < 80; t++) w.step([IDLE, IDLE]);
    expect(a.alive).toBe(true);
    expect(a.shield).toBe(false);
  });

  it('repair fixes one hit at once', () => {
    const w = duel('manta', 'trident', { bAt: -90 });
    const g = w.gliders[0];
    g.hull = 1;
    const ring = w.rings[0];
    ring.active = true;
    ring.power = 'repair';
    ring.c.set(0, 0, -24);
    ring.n.set(0, 0, 1);
    for (let t = 0; t < 30; t++) w.step([IDLE, IDLE]);
    expect(g.hull).toBe(2);
    expect(g.power).toBe(null);
    expect(GUN.hull).toBe(3);
  });

  it('lets the dachshund spit a fan of five bones and turn tighter than any ship', () => {
    const d = SHIPS.dachshund;
    expect(d.special.kind).toBe('burst');
    for (const id of ['trident', 'manta', 'halo', 'bulwark'] as const) expect(d.turn).toBeGreaterThan(SHIPS[id].turn);
    const w = duel('dachshund', 'manta');
    expect(w.gliders[0].ship.id).toBe('dachshund');
  });
});
