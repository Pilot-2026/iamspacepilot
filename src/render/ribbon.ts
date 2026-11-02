import * as THREE from 'three';
import { TAPER_TICKS, TICK_RATE } from '../core/config';
import { halfAt, type Trail } from '../core/trail';
import { ribbonBeamFrag, ribbonFrag, ribbonVert } from './shaders';

/** Half width of the beam across the middle of the wall (m). */
export const BEAM_HALF = 0.32;

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
 * A narrow glowing beam runs across the middle of the wall (a child mesh), so
 * the wall shows even where you look at it edge-on, like straight from behind.
 */
export class RibbonView {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly beam: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private capacity = 0;
  private pos!: Float32Array;
  private beamPos!: Float32Array;
  private birth!: Float32Array;
  private posAttr!: THREE.BufferAttribute;
  private beamAttr!: THREE.BufferAttribute;
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
    const beamMat = new THREE.ShaderMaterial({
      vertexShader: ribbonVert,
      fragmentShader: ribbonBeamFrag,
      // Same values as the wall: dimming and the flash follow it.
      uniforms: material.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: style.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.beam = new THREE.Mesh(new THREE.BufferGeometry(), beamMat);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 1;
    this.mesh.add(this.beam);
    this.allocate(4096);
  }

  private allocate(cap: number): void {
    const oldPos = this.pos;
    const oldBeam = this.beamPos;
    const oldBirth = this.birth;
    const pos = new Float32Array(cap * 6);
    const beamPos = new Float32Array(cap * 6);
    const birth = new Float32Array(cap * 2);
    const side = new Float32Array(cap * 2);
    for (let i = 0; i < cap; i++) {
      side[i * 2] = 1;
      side[i * 2 + 1] = -1;
    }
    if (oldPos) {
      pos.set(oldPos.subarray(0, Math.min(oldPos.length, pos.length)));
      beamPos.set(oldBeam.subarray(0, Math.min(oldBeam.length, beamPos.length)));
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
    // The beam shares sides, births and the index with the wall, only its corners differ.
    const bgeo = new THREE.BufferGeometry();
    this.beamAttr = new THREE.BufferAttribute(beamPos, 3).setUsage(THREE.DynamicDrawUsage);
    bgeo.setAttribute('position', this.beamAttr);
    bgeo.setAttribute('aSide', geo.getAttribute('aSide'));
    bgeo.setAttribute('aBirth', this.birthAttr);
    bgeo.setIndex(geo.getIndex());
    bgeo.setDrawRange(0, 0);
    const oldBeamGeo = this.beam.geometry;
    this.beam.geometry = bgeo;
    oldBeamGeo.dispose();
    this.beamPos = beamPos;
    this.pos = pos;
    this.birth = birth;
    this.capacity = cap;
  }

  setDim(v: number): void {
    this.mesh.material.uniforms.uDim.value = v;
  }

  /**
   * Brings the GPU copy up to date with the trail and moves the head to the
   * glider. Young wall pieces are still growing, so they are rewritten each frame.
   */
  sync(tr: Trail, head: THREE.Vector3 | null, headUp: THREE.Vector3 | null, now: number, tick: number, headHalf: number): void {
    const n = tr.count;
    const total = n + (head ? 1 : 0);
    if (total + 1 > this.capacity) this.allocate(Math.max(this.capacity * 2, total + 512));
    const pos = this.pos;
    const beam = this.beamPos;
    const birth = this.birth;
    let from = Math.min(this.written, n);
    while (from > 0 && tick - tr.tick[from - 1] <= TAPER_TICKS + 1) from--;
    for (let k = from; k < n; k++) {
      const h = halfAt(tr, k, tick);
      const o = k * 6;
      pos[o] = tr.px[k] + tr.ux[k] * h;
      pos[o + 1] = tr.py[k] + tr.uy[k] * h;
      pos[o + 2] = tr.pz[k] + tr.uz[k] * h;
      pos[o + 3] = tr.px[k] - tr.ux[k] * h;
      pos[o + 4] = tr.py[k] - tr.uy[k] * h;
      pos[o + 5] = tr.pz[k] - tr.uz[k] * h;
      // Across the wall: along the trail crossed with the wall's up.
      const prev = Math.max(0, k - 1);
      const next = k + 1 < n ? k + 1 : head ? -1 : k;
      const nx = next < 0 ? head!.x : tr.px[next];
      const ny = next < 0 ? head!.y : tr.py[next];
      const nz = next < 0 ? head!.z : tr.pz[next];
      this.beamCorners(o, tr.px[k], tr.py[k], tr.pz[k], nx - tr.px[prev], ny - tr.py[prev], nz - tr.pz[prev], tr.ux[k], tr.uy[k], tr.uz[k]);
      const b = tr.tick[k] / TICK_RATE;
      birth[k * 2] = b;
      birth[k * 2 + 1] = b;
    }
    this.written = n;
    if (head && headUp) {
      const h = headHalf;
      const o = n * 6;
      pos[o] = head.x + headUp.x * h;
      pos[o + 1] = head.y + headUp.y * h;
      pos[o + 2] = head.z + headUp.z * h;
      pos[o + 3] = head.x - headUp.x * h;
      pos[o + 4] = head.y - headUp.y * h;
      pos[o + 5] = head.z - headUp.z * h;
      if (n > 0) this.beamCorners(o, head.x, head.y, head.z, head.x - tr.px[n - 1], head.y - tr.py[n - 1], head.z - tr.pz[n - 1], headUp.x, headUp.y, headUp.z);
      else beam.fill(0, o, o + 6);
      birth[n * 2] = now;
      birth[n * 2 + 1] = now;
    }
    const last = total - 1;
    if (last >= from) {
      this.posAttr.addUpdateRange(from * 6, (last - from + 1) * 6);
      this.posAttr.needsUpdate = true;
      this.beamAttr.addUpdateRange(from * 6, (last - from + 1) * 6);
      this.beamAttr.needsUpdate = true;
      this.birthAttr.addUpdateRange(from * 2, (last - from + 1) * 2);
      this.birthAttr.needsUpdate = true;
    }
    this.mesh.geometry.setDrawRange(0, Math.max(0, total - 1) * 6);
    this.beam.geometry.setDrawRange(0, Math.max(0, total - 1) * 6);
    this.mesh.material.uniforms.uNow.value = now;
  }

  /** The two beam corners at sample o: centre ± (direction × up) normalised, BEAM_HALF wide. */
  private beamCorners(o: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, ux: number, uy: number, uz: number): void {
    let sx = dy * uz - dz * uy;
    let sy = dz * ux - dx * uz;
    let sz = dx * uy - dy * ux;
    const l = Math.hypot(sx, sy, sz);
    const beam = this.beamPos;
    // No direction yet (the very first sample): keep what is there.
    if (l < 1e-6) return;
    const k = BEAM_HALF / l;
    sx *= k;
    sy *= k;
    sz *= k;
    beam[o] = cx + sx;
    beam[o + 1] = cy + sy;
    beam[o + 2] = cz + sz;
    beam[o + 3] = cx - sx;
    beam[o + 4] = cy - sy;
    beam[o + 5] = cz - sz;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.beam.geometry.dispose();
    this.mesh.material.dispose();
    this.beam.material.dispose();
  }
}
