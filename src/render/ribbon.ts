import * as THREE from 'three';
import { TAPER_TICKS, TICK_RATE } from '../core/config';
import { WALL_PLAIN, WALL_TUBE, wallHalfAt, type Trail } from '../core/trail';
import { ribbonBeamFrag, ribbonFrag, ribbonVert } from './shaders';
import { TubeView } from './tube';

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
  /** The glass tube bonus, where the wall is a tube. */
  readonly tube: TubeView;
  private lenArr!: Float32Array;
  private halfArr!: Float32Array;
  private kindArr!: Float32Array;
  private lenAttr!: THREE.BufferAttribute;
  private halfAttr!: THREE.BufferAttribute;
  private kindAttr!: THREE.BufferAttribute;
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
    this.tube = new TubeView(material.uniforms, style.additive);
    this.mesh.add(this.tube.mesh);
    this.allocate(4096);
  }

  private allocate(cap: number): void {
    const oldPos = this.pos;
    const oldBeam = this.beamPos;
    const oldBirth = this.birth;
    const old3 = this.lenArr ? [this.lenArr, this.halfArr, this.kindArr] : null;
    const lenArr = new Float32Array(cap * 2);
    const halfArr = new Float32Array(cap * 2);
    const kindArr = new Float32Array(cap * 2);
    if (old3) {
      lenArr.set(old3[0].subarray(0, Math.min(old3[0].length, lenArr.length)));
      halfArr.set(old3[1].subarray(0, Math.min(old3[1].length, halfArr.length)));
      kindArr.set(old3[2].subarray(0, Math.min(old3[2].length, kindArr.length)));
    }
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
    this.lenAttr = new THREE.BufferAttribute(lenArr, 1).setUsage(THREE.DynamicDrawUsage);
    this.halfAttr = new THREE.BufferAttribute(halfArr, 1).setUsage(THREE.DynamicDrawUsage);
    this.kindAttr = new THREE.BufferAttribute(kindArr, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aLen', this.lenAttr);
    geo.setAttribute('aHalf', this.halfAttr);
    geo.setAttribute('aKind', this.kindAttr);
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
    bgeo.setAttribute('aLen', this.lenAttr);
    bgeo.setAttribute('aHalf', this.halfAttr);
    bgeo.setAttribute('aKind', this.kindAttr);
    bgeo.setIndex(geo.getIndex());
    bgeo.setDrawRange(0, 0);
    const oldBeamGeo = this.beam.geometry;
    this.beam.geometry = bgeo;
    oldBeamGeo.dispose();
    this.beamPos = beamPos;
    this.lenArr = lenArr;
    this.halfArr = halfArr;
    this.kindArr = kindArr;
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
  sync(tr: Trail, head: THREE.Vector3 | null, headUp: THREE.Vector3 | null, now: number, tick: number, headHalf: number, headKind = WALL_PLAIN): void {
    this.tube.sync(tr, head, headUp, now, tick, headHalf, headKind === WALL_TUBE);
    const n = tr.count;
    const total = n + (head ? 1 : 0);
    if (total + 1 > this.capacity) this.allocate(Math.max(this.capacity * 2, total + 512));
    const pos = this.pos;
    const beam = this.beamPos;
    const birth = this.birth;
    let from = Math.min(this.written, n);
    while (from > 0 && tick - tr.tick[from - 1] <= TAPER_TICKS + 1) from--;
    for (let k = from; k < n; k++) {
      const h = wallHalfAt(tr, k, tick);
      const o = k * 6;
      this.lenArr[k * 2] = this.lenArr[k * 2 + 1] = tr.len[k];
      this.halfArr[k * 2] = this.halfArr[k * 2 + 1] = h;
      this.kindArr[k * 2] = this.kindArr[k * 2 + 1] = tr.kind[k];
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
      this.beamCorners(o, tr.px[k], tr.py[k], tr.pz[k], nx - tr.px[prev], ny - tr.py[prev], nz - tr.pz[prev], tr.ux[k], tr.uy[k], tr.uz[k], tr.kind[k] === WALL_PLAIN ? 1 : 0);
      const b = tr.tick[k] / TICK_RATE;
      birth[k * 2] = b;
      birth[k * 2 + 1] = b;
    }
    this.written = n;
    if (head && headUp) {
      const h = headKind === WALL_TUBE ? 0 : headHalf;
      const o = n * 6;
      const along = n > 0 ? Math.hypot(head.x - tr.px[n - 1], head.y - tr.py[n - 1], head.z - tr.pz[n - 1]) : 0;
      this.lenArr[n * 2] = this.lenArr[n * 2 + 1] = (n > 0 ? tr.len[n - 1] : 0) + along;
      this.halfArr[n * 2] = this.halfArr[n * 2 + 1] = h;
      this.kindArr[n * 2] = this.kindArr[n * 2 + 1] = headKind;
      pos[o] = head.x + headUp.x * h;
      pos[o + 1] = head.y + headUp.y * h;
      pos[o + 2] = head.z + headUp.z * h;
      pos[o + 3] = head.x - headUp.x * h;
      pos[o + 4] = head.y - headUp.y * h;
      pos[o + 5] = head.z - headUp.z * h;
      if (n > 0) this.beamCorners(o, head.x, head.y, head.z, head.x - tr.px[n - 1], head.y - tr.py[n - 1], head.z - tr.pz[n - 1], headUp.x, headUp.y, headUp.z, headKind === WALL_PLAIN ? 1 : 0);
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
      for (const a of [this.lenAttr, this.halfAttr, this.kindAttr]) {
        a.addUpdateRange(from * 2, (last - from + 1) * 2);
        a.needsUpdate = true;
      }
    }
    this.mesh.geometry.setDrawRange(0, Math.max(0, total - 1) * 6);
    this.beam.geometry.setDrawRange(0, Math.max(0, total - 1) * 6);
    this.mesh.material.uniforms.uNow.value = now;
  }

  /** The two beam corners at sample o: centre ± (direction × up) normalised, BEAM_HALF wide (times width: the bonus walls have none). */
  private beamCorners(o: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, ux: number, uy: number, uz: number, width = 1): void {
    let sx = dy * uz - dz * uy;
    let sy = dz * ux - dx * uz;
    let sz = dx * uy - dy * ux;
    const l = Math.hypot(sx, sy, sz);
    const beam = this.beamPos;
    // No direction yet (the very first sample): keep what is there.
    if (l < 1e-6) return;
    const k = (BEAM_HALF * width) / l;
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
    this.tube.dispose();
    this.mesh.geometry.dispose();
    this.beam.geometry.dispose();
    this.mesh.material.dispose();
    this.beam.material.dispose();
  }
}
