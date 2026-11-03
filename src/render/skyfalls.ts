import * as THREE from 'three';
import type { World } from '../core/world';
import { waterTexture } from './obstacles';
import { sharedTextures } from './textures';

/**
 * Waterfalls in every level: tall columns of water pouring from the ceiling
 * (or from a glowing spring high up in the dome arenas) down to the floor.
 * They are only scenery: fly through them as often as you like, they splash.
 * Every level has its own, always in the same places, away from obstacles.
 */
export interface SkyFall {
  x: number;
  z: number;
  top: number;
  bottom: number;
  r: number;
}

/** Waterfalls per level. */
export const SKY_FALLS = 6;

/** Small seeded random numbers, so a level always looks the same. */
function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export function placeSkyFalls(w: World, count = SKY_FALLS): SkyFall[] {
  const a = w.spec.arena;
  const R = a.radius;
  const rand = rng(w.spec.index * 7919 + 13);
  const out: SkyFall[] = [];
  for (let k = 0, tries = 0; out.length < count && tries < count * 8; tries++, k++) {
    const ang = (k / count) * Math.PI * 2 + rand() * 0.45;
    const dist = R * (0.2 + rand() * 0.62);
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const r = 3.2 + rand() * 2.6;
    const top = a.kind === 'cylinder' ? a.ceilY : Math.min(a.floorY + 270, Math.sqrt(Math.max(0, R * R - dist * dist)) - 30);
    if (top - a.floorY < 60) continue;
    // Not through an obstacle, and not right on top of another waterfall.
    let clear = true;
    for (let y = a.floorY + 10; y < top && clear; y += 18) if (w.obstacles.length && w.obstacleDist(x, y, z) < r + 7) clear = false;
    for (const f of out) if (Math.hypot(f.x - x, f.z - z) < f.r + r + 18) clear = false;
    if (!clear) continue;
    out.push({ x, z, top, bottom: a.floorY, r });
  }
  return out;
}

function glow(color: number, size: number, opacity: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sharedTextures().glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}

export class SkyFallsView {
  readonly group = new THREE.Group();
  private readonly geo: THREE.CylinderGeometry;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly tex: THREE.Texture;
  private readonly sprites: THREE.Sprite[] = [];
  private readonly foam: THREE.Sprite[] = [];

  constructor(falls: readonly SkyFall[], fromCeiling: boolean) {
    // A texture of its own: these columns are taller than the ones from the obstacles.
    this.tex = waterTexture().clone();
    this.tex.wrapS = this.tex.wrapT = THREE.RepeatWrapping;
    this.tex.repeat.set(2, 6);
    this.tex.needsUpdate = true;
    this.geo = new THREE.CylinderGeometry(1, 1.3, 1, 18, 1, true);
    this.geo.translate(0, -0.5, 0);
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, color: 0xe6f7ff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    for (const f of falls) {
      const len = f.top - f.bottom;
      const water = new THREE.Mesh(this.geo, this.mat);
      water.position.set(f.x, f.top, f.z);
      water.scale.set(f.r, len, f.r);
      this.group.add(water);
      // Where it comes from: a bright lip at the ceiling, or a glowing spring cloud up in the air.
      const src = fromCeiling ? [glow(0xffffff, f.r * 3.2, 0.55)] : [glow(0xdff6ff, f.r * 7, 0.55), glow(0xffffff, f.r * 3, 0.7)];
      for (const s of src) s.position.set(f.x, f.top, f.z);
      const foam = glow(0xffffff, f.r * 6, 0.55);
      foam.position.set(f.x, f.bottom + 1, f.z);
      const mist = glow(0xbfe8ff, f.r * 12, 0.28);
      mist.position.set(f.x, f.bottom + f.r * 2, f.z);
      this.group.add(...src, foam, mist);
      this.sprites.push(...src, foam, mist);
      this.foam.push(foam);
    }
  }

  update(time: number): void {
    this.tex.offset.y = (time * 0.9) % 1;
    this.foam.forEach((f, i) => (f.material.opacity = 0.45 + 0.15 * Math.sin(time * 7 + i)));
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
    for (const s of this.sprites) s.material.dispose();
  }
}
