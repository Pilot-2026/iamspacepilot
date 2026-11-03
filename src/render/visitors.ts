import * as THREE from 'three';
import { SHIP_ORDER, type ShipId } from '../core/ships';
import type { World } from '../core/world';
import type { DogMesh } from './dachshund';
import { disposeShip, makeShip, type ShipMesh } from './ships';

/**
 * Visitors: six of the creative gliders from the hangar (the dachshund and
 * everything after it) fly around in every level, a different six in each.
 * Only scenery: they leave no wall, nobody can hit them, they hit nobody.
 */

/** How many visit each level. */
export const VISITORS = 6;
/** The creative gliders: the dachshund and all after it in the hangar. */
export const VISITOR_SHIPS: readonly ShipId[] = SHIP_ORDER.slice(SHIP_ORDER.indexOf('dachshund'));

/** The six for a level (by its number, 1 to 10): a different set for each level. */
export function visitorsFor(levelIndex: number): ShipId[] {
  const n = VISITOR_SHIPS.length;
  const start = ((levelIndex - 1) * 5) % n;
  return Array.from({ length: Math.min(VISITORS, n) }, (_, k) => VISITOR_SHIPS[(start + k) % n]);
}

interface Visitor {
  ship: ShipMesh;
  holder: THREE.Group;
  /** Share of the arena radius it circles at, height, speed (m/s), direction, phases. */
  ring: number;
  y: number;
  speed: number;
  dir: number;
  angle: number;
  bob: number;
  phase: number;
}

const COLORS = [0xff5fd2, 0x5ff3ff, 0xffd84a, 0x7dff9a, 0xff8a3d, 0xb48cff];

export class Visitors {
  readonly group = new THREE.Group();
  private readonly list: Visitor[] = [];
  private readonly pos = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();

  constructor(w: World, glow: THREE.Texture) {
    const a = w.spec.arena;
    const lo = a.floorY + 35;
    const hi = a.kind === 'cylinder' ? a.ceilY - 30 : a.floorY + 190;
    visitorsFor(w.spec.index).forEach((id, k) => {
      const ship = makeShip(id, COLORS[k % COLORS.length], glow);
      const holder = new THREE.Group();
      holder.add(ship.group);
      holder.scale.setScalar(1.9);
      this.group.add(holder);
      this.list.push({
        ship,
        holder,
        ring: 0.3 + (k / Math.max(1, VISITORS - 1)) * 0.45,
        y: lo + ((k * 0.618) % 1) * (hi - lo),
        speed: 13 + (k % 3) * 3,
        dir: k % 2 ? 1 : -1,
        angle: k * 1.9,
        bob: 6 + (k % 3) * 4,
        phase: k * 1.3,
      });
    });
  }

  /** Where visitor v is at the given angle and time, inside the arena as it is now. */
  private place(w: World, v: Visitor, angle: number, time: number, out: THREE.Vector3): THREE.Vector3 {
    const a = w.spec.arena;
    const R = w.radius();
    const y = v.y + v.bob * Math.sin(time * 0.45 + v.phase);
    // In a dome the room gets narrower higher up.
    const room = a.kind === 'dome' ? Math.sqrt(Math.max(0, R * R - y * y)) : R;
    const r = room * v.ring * (1 + 0.1 * Math.sin(time * 0.3 + v.phase * 2));
    return out.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
  }

  update(w: World, time: number, dt: number): void {
    const R = Math.max(30, w.radius());
    for (const v of this.list) {
      v.angle += (v.dir * v.speed * dt) / Math.max(20, R * v.ring);
      const p = this.place(w, v, v.angle, time, this.pos);
      const q = this.place(w, v, v.angle + v.dir * 0.02, time + 0.05, this.ahead);
      v.holder.position.copy(p);
      v.holder.lookAt(q);
      // Lean into the turn.
      v.holder.rotateZ(-v.dir * 0.45);
      (v.ship as Partial<DogMesh>).animate?.(time, dt, v.speed, false);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const v of this.list) disposeShip(v.ship);
  }
}
