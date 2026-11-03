import * as THREE from 'three';
import { TAPER_TICKS, TICK_RATE } from '../core/config';
import { WALL_TUBE, halfAt, type Trail } from '../core/trail';
import { tubeFrag, tubeVert } from './shaders';

/** Corners around the tube. */
const RING = 16;

/**
 * The glass tube bonus: where a wall is a tube, a see-through tube runs
 * along the line the glider flew. Bright where you look along its skin
 * (like glass), with faint rings every few metres. Built up as the trail
 * grows; young pieces are rewritten while they still inflate.
 */
export class TubeView {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private capacity = 0;
  private pos!: Float32Array;
  private nrm!: Float32Array;
  private len!: Float32Array;
  private birth!: Float32Array;
  private index!: Uint32Array;
  private posAttr!: THREE.BufferAttribute;
  private nrmAttr!: THREE.BufferAttribute;
  private lenAttr!: THREE.BufferAttribute;
  private birthAttr!: THREE.BufferAttribute;
  private indexAttr!: THREE.BufferAttribute;
  private written = 0;
  /** Indices of the finished tube pieces; the piece to the glider follows them. */
  private segIndex = 0;
  private readonly t = new THREE.Vector3();
  private readonly u = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly along = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(uniforms: Record<string, THREE.IUniform>, additive: boolean) {
    const material = new THREE.ShaderMaterial({
      vertexShader: tubeVert,
      fragmentShader: tubeFrag,
      uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.allocate(512);
  }

  private allocate(cap: number): void {
    const old = this.capacity ? { pos: this.pos, nrm: this.nrm, len: this.len, birth: this.birth, index: this.index } : null;
    this.pos = new Float32Array(cap * RING * 3);
    this.nrm = new Float32Array(cap * RING * 3);
    this.len = new Float32Array(cap * RING);
    this.birth = new Float32Array(cap * RING);
    this.index = new Uint32Array(cap * RING * 6);
    if (old) {
      this.pos.set(old.pos);
      this.nrm.set(old.nrm);
      this.len.set(old.len);
      this.birth.set(old.birth);
      this.index.set(old.index);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.lenAttr = new THREE.BufferAttribute(this.len, 1).setUsage(THREE.DynamicDrawUsage);
    this.birthAttr = new THREE.BufferAttribute(this.birth, 1).setUsage(THREE.DynamicDrawUsage);
    this.indexAttr = new THREE.BufferAttribute(this.index, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('normal', this.nrmAttr);
    geo.setAttribute('aLen', this.lenAttr);
    geo.setAttribute('aBirth', this.birthAttr);
    geo.setIndex(this.indexAttr);
    geo.setDrawRange(0, 0);
    const prev = this.mesh.geometry;
    this.mesh.geometry = geo;
    prev.dispose();
    this.capacity = cap;
  }

  /** A ring of corners at slot k around centre c with radius r; along = direction of the trail, up = the wall's up. */
  private ring(k: number, cx: number, cy: number, cz: number, along: THREE.Vector3, up: THREE.Vector3, r: number, len: number, birth: number): void {
    const t = this.t.copy(along);
    if (t.lengthSq() < 1e-10) t.set(0, 0, 1);
    t.normalize();
    const u = this.u.copy(up).addScaledVector(t, -up.dot(t));
    if (u.lengthSq() < 1e-8) u.set(0, 1, 0).addScaledVector(t, -t.y);
    u.normalize();
    const s = this.s.crossVectors(t, u);
    for (let j = 0; j < RING; j++) {
      const a = (j / RING) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const nx = u.x * ca + s.x * sa;
      const ny = u.y * ca + s.y * sa;
      const nz = u.z * ca + s.z * sa;
      const o = (k * RING + j) * 3;
      this.pos[o] = cx + nx * r;
      this.pos[o + 1] = cy + ny * r;
      this.pos[o + 2] = cz + nz * r;
      this.nrm[o] = nx;
      this.nrm[o + 1] = ny;
      this.nrm[o + 2] = nz;
      this.len[k * RING + j] = len;
      this.birth[k * RING + j] = birth;
    }
  }

  /** Two triangles per side between ring a and ring b, written at index position at. */
  private link(at: number, a: number, b: number): void {
    const idx = this.index;
    for (let j = 0; j < RING; j++) {
      const j2 = (j + 1) % RING;
      const o = at + j * 6;
      idx[o] = a * RING + j;
      idx[o + 1] = b * RING + j;
      idx[o + 2] = a * RING + j2;
      idx[o + 3] = a * RING + j2;
      idx[o + 4] = b * RING + j;
      idx[o + 5] = b * RING + j2;
    }
  }

  sync(tr: Trail, head: THREE.Vector3 | null, headUp: THREE.Vector3 | null, now: number, tick: number, headRadius: number, headTube: boolean): void {
    const n = tr.count;
    if (n + 2 > this.capacity) this.allocate(Math.max(this.capacity * 2, n + 256));
    let from = Math.min(this.written, n);
    while (from > 0 && tick - tr.tick[from - 1] <= TAPER_TICKS + 1) from--;
    const along = this.along;
    const up = this.up;
    // Only what changed goes to the GPU: rings lo..hi and indices idxLo..idxHi.
    let lo = Infinity;
    let hi = -1;
    let idxLo = Infinity;
    let idxHi = -1;
    for (let k = from; k < n; k++) {
      if (tr.kind[k] !== WALL_TUBE) continue;
      const a = Math.max(0, k - 1);
      const b = k + 1 < n ? k + 1 : k;
      if (b === k && head) along.set(head.x - tr.px[k], head.y - tr.py[k], head.z - tr.pz[k]);
      else along.set(tr.px[b] - tr.px[a], tr.py[b] - tr.py[a], tr.pz[b] - tr.pz[a]);
      up.set(tr.ux[k], tr.uy[k], tr.uz[k]);
      this.ring(k, tr.px[k], tr.py[k], tr.pz[k], along, up, halfAt(tr, k, tick), tr.len[k], tr.tick[k] / TICK_RATE);
      lo = Math.min(lo, k);
      hi = Math.max(hi, k);
    }
    // New pieces between two tube samples join the finished tube.
    for (let k = Math.max(1, this.written); k < n; k++) {
      if (tr.kind[k] === WALL_TUBE && tr.kind[k - 1] === WALL_TUBE) {
        this.link(this.segIndex, k - 1, k);
        idxLo = Math.min(idxLo, this.segIndex);
        this.segIndex += RING * 6;
        idxHi = Math.max(idxHi, this.segIndex);
      }
    }
    this.written = n;
    // The piece from the last sample to the glider.
    let count = this.segIndex;
    if (head && headUp && headTube && n > 0 && tr.kind[n - 1] === WALL_TUBE) {
      along.set(head.x - tr.px[n - 1], head.y - tr.py[n - 1], head.z - tr.pz[n - 1]);
      up.copy(headUp);
      this.ring(n, head.x, head.y, head.z, along, up, headRadius, tr.len[n - 1] + along.length(), now);
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
      this.link(count, n - 1, n);
      idxLo = Math.min(idxLo, count);
      count += RING * 6;
      idxHi = Math.max(idxHi, count);
    }
    if (hi >= lo) {
      const rings = hi - lo + 1;
      for (const [a, size] of [
        [this.posAttr, 3],
        [this.nrmAttr, 3],
        [this.lenAttr, 1],
        [this.birthAttr, 1],
      ] as const) {
        a.addUpdateRange(lo * RING * size, rings * RING * size);
        a.needsUpdate = true;
      }
    }
    if (idxHi > idxLo) {
      this.indexAttr.addUpdateRange(idxLo, idxHi - idxLo);
      this.indexAttr.needsUpdate = true;
    }
    this.mesh.geometry.setDrawRange(0, count);
    this.mesh.visible = count > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
