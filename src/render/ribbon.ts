import * as THREE from 'three';
import { TICK_RATE, WALL_HALF } from '../core/config';
import type { Trail } from '../core/trail';
import { ribbonFrag, ribbonVert } from './shaders';

export interface WallStyle {
  additive: boolean;
  core: number;
  fogColor: number;
  fogFar: number;
}

/**
 * GPU mesh for one light wall. New wall samples are appended to a growing
 * buffer; only the changed part is uploaded each frame. The newest piece
 * between the last sample and the glider (the "head") is updated every frame.
 */
export class RibbonView {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private capacity = 0;
  private pos!: Float32Array;
  private birth!: Float32Array;
  private posAttr!: THREE.BufferAttribute;
  private birthAttr!: THREE.BufferAttribute;
  private written = 0;

  constructor(color: number, style: WallStyle) {
    const material = new THREE.ShaderMaterial({
      vertexShader: ribbonVert,
      fragmentShader: ribbonFrag,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uFogColor: { value: new THREE.Color(style.fogColor) },
        uCore: { value: style.core },
        uFogFar: { value: style.fogFar },
        uAdditive: { value: style.additive ? 1 : 0 },
        uDim: { value: 1 },
        uNow: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: style.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.frustumCulled = false;
    this.allocate(4096);
  }

  private allocate(cap: number): void {
    const oldPos = this.pos;
    const oldBirth = this.birth;
    const pos = new Float32Array(cap * 6);
    const birth = new Float32Array(cap * 2);
    const side = new Float32Array(cap * 2);
    for (let i = 0; i < cap; i++) {
      side[i * 2] = 1;
      side[i * 2 + 1] = -1;
    }
    if (oldPos) {
      pos.set(oldPos.subarray(0, Math.min(oldPos.length, pos.length)));
      birth.set(oldBirth.subarray(0, Math.min(oldBirth.length, birth.length)));
    }
    const index = new Uint32Array((cap - 1) * 6);
    for (let i = 0; i < cap - 1; i++) {
      const a = i * 2;
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.birthAttr = new THREE.BufferAttribute(birth, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aBirth', this.birthAttr);
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    const old = this.mesh.geometry;
    this.mesh.geometry = geo;
    old.dispose();
    this.pos = pos;
    this.birth = birth;
    this.capacity = cap;
  }

  setDim(v: number): void {
    this.mesh.material.uniforms.uDim.value = v;
  }

  /** Brings the GPU copy up to date with the trail and moves the head to the glider. */
  sync(tr: Trail, head: THREE.Vector3 | null, headUp: THREE.Vector3 | null, now: number): void {
    const n = tr.count;
    const total = n + (head ? 1 : 0);
    if (total + 1 > this.capacity) this.allocate(Math.max(this.capacity * 2, total + 512));
    const pos = this.pos;
    const birth = this.birth;
    const h = WALL_HALF;
    const from = Math.min(this.written, n);
    for (let k = this.written; k < n; k++) {
      const o = k * 6;
      pos[o] = tr.px[k] + tr.ux[k] * h;
      pos[o + 1] = tr.py[k] + tr.uy[k] * h;
      pos[o + 2] = tr.pz[k] + tr.uz[k] * h;
      pos[o + 3] = tr.px[k] - tr.ux[k] * h;
      pos[o + 4] = tr.py[k] - tr.uy[k] * h;
      pos[o + 5] = tr.pz[k] - tr.uz[k] * h;
      const b = tr.tick[k] / TICK_RATE;
      birth[k * 2] = b;
      birth[k * 2 + 1] = b;
    }
    this.written = n;
    if (head && headUp) {
      const o = n * 6;
      pos[o] = head.x + headUp.x * h;
      pos[o + 1] = head.y + headUp.y * h;
      pos[o + 2] = head.z + headUp.z * h;
      pos[o + 3] = head.x - headUp.x * h;
      pos[o + 4] = head.y - headUp.y * h;
      pos[o + 5] = head.z - headUp.z * h;
      birth[n * 2] = now;
      birth[n * 2 + 1] = now;
    }
    const last = total - 1;
    if (last >= from) {
      this.posAttr.addUpdateRange(from * 6, (last - from + 1) * 6);
      this.posAttr.needsUpdate = true;
      this.birthAttr.addUpdateRange(from * 2, (last - from + 1) * 2);
      this.birthAttr.needsUpdate = true;
    }
    this.mesh.geometry.setDrawRange(0, Math.max(0, total - 1) * 6);
    this.mesh.material.uniforms.uNow.value = now;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
