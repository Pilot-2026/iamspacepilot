import * as THREE from 'three';
import type { ShipId } from '../core/ships';
import type { ShipMesh } from './ships';

/**
 * Ten creature gliders: animals, fantasy beasts, comic figures and aliens.
 * Smooth, colourful, built from many parts, and alive: wings flap, tails
 * sway, tentacles wave. Forward is +Z, up is +Y, +X is the left side, about
 * as long as the ships (5 to 6 m).
 */

export type CreatureId = 'dragon' | 'unicorn' | 'phoenix' | 'shark' | 'owl' | 'bee' | 'duck' | 'pig' | 'octopus' | 'jelly';

export const CREATURES: readonly CreatureId[] = ['dragon', 'unicorn', 'phoenix', 'shark', 'owl', 'bee', 'duck', 'pig', 'octopus', 'jelly'];

export const isCreature = (id: ShipId): id is CreatureId => (CREATURES as readonly string[]).includes(id);

export interface CreatureMesh extends ShipMesh {
  animate(time: number, dt: number, speed: number, boosting: boolean): void;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Ellipsoid of radii rx, ry, rz. */
function ell(rx: number, ry: number, rz: number, seg = 28): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.max(8, Math.round(seg * 0.7)));
  g.scale(rx, ry, rz);
  return g;
}

/** Body of revolution around +Z: profile points [radius, z]. */
function latheZ(profile: [number, number][], seg = 40): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    profile.map(([r, z]) => new THREE.Vector2(r, z)),
    seg,
  );
  g.rotateX(Math.PI / 2);
  return g;
}

/** A tube along a curve that gets thinner from r0 to r1. */
function taper(points: THREE.Vector3[], r0: number, r1: number, segs = 24, radial = 14): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    const n = frames.normals[i];
    const b = frames.binormals[i];
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(p.x + r * (c * n.x + s * b.x), p.y + r * (c * n.y + s * b.y), p.z + r * (c * n.z + s * b.z));
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat wing or fin: outline points [span (x), chord (z)], thickness t, lying in the XZ plane. */
function flat(outline: [number, number][], t = 0.05): THREE.BufferGeometry {
  const s = new THREE.Shape();
  outline.forEach(([x, z], i) => (i === 0 ? s.moveTo(x, z) : s.lineTo(x, z)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(Math.PI / 2);
  g.translate(0, t / 2, 0);
  return g;
}

/** Colours a geometry by height, from `low` to `high`. */
function tint(g: THREE.BufferGeometry, y0: number, y1: number, low: number, high: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const a = new THREE.Color(low);
  const b = new THREE.Color(high);
  const c = new THREE.Color();
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    c.copy(a).lerp(b, Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0))));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Keeps track of what a creature is made of, so it can be freed. */
class Kit {
  readonly group = new THREE.Group();
  readonly solids: THREE.MeshStandardMaterial[] = [];
  readonly flames: THREE.Sprite[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly others: THREE.Material[] = [];
  readonly glowMat: THREE.MeshBasicMaterial;

  constructor(
    color: number,
    private readonly glowTex: THREE.Texture,
  ) {
    this.glowMat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  }

  mat(color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...o });
    this.solids.push(m);
    return m;
  }

  /** Vertex-coloured material (see tint). */
  painted(o: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    return this.mat(0xffffff, { vertexColors: true, ...o });
  }

  shine(color: number, opacity = 1): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    this.others.push(m);
    return m;
  }

  add(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.group, x = 0, y = 0, z = 0): THREE.Mesh {
    this.geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /** A joint: an empty group at a point, to turn parts around. */
  joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  /** A glowing sprite (engine flame, eye glow, aura). */
  glow(color: number, size: number, parent: THREE.Object3D, x: number, y: number, z: number, flame = false, opacity = 0.85): THREE.Sprite {
    const m = new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.others.push(m);
    const s = new THREE.Sprite(m);
    s.scale.setScalar(size);
    s.position.set(x, y, z);
    parent.add(s);
    if (flame) this.flames.push(s);
    return s;
  }

  /** Eyes: white, iris, pupil and a highlight, looking forward. */
  eye(parent: THREE.Object3D, x: number, y: number, z: number, r: number, iris: number, side: number): void {
    const white = this.mat(0xffffff, { roughness: 0.2 });
    const ir = this.mat(iris, { roughness: 0.15 });
    const pupil = this.mat(0x080808, { roughness: 0.05 });
    this.add(ell(r, r, r * 0.8, 20), white, parent, x, y, z);
    this.add(ell(r * 0.62, r * 0.62, r * 0.3, 18), ir, parent, x + side * r * 0.12, y, z + r * 0.62);
    this.add(ell(r * 0.32, r * 0.32, r * 0.18, 14), pupil, parent, x + side * r * 0.14, y, z + r * 0.8);
    this.add(ell(r * 0.12, r * 0.12, r * 0.08, 10), this.shine(0xffffff), parent, x + side * r * 0.3, y + r * 0.3, z + r * 0.86);
  }

  free(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.others) m.dispose();
  }
}

type Animate = (t: number, dt: number, speed: number, boost: boolean) => void;

/** Bird-like wing: a row of feathers fanned along the span, coloured from root to tip. */
function featherWing(k: Kit, parent: THREE.Object3D, side: number, n: number, span: number, len: number, colors: number[]): THREE.Group {
  const w = k.joint(parent, 0, 0, 0);
  const mats = colors.map((c) => k.mat(c, { roughness: 0.6, side: THREE.DoubleSide }));
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const f = k.add(ell(0.16 + 0.05 * (1 - u), 0.035, len * (0.75 + 0.45 * u), 16), mats[Math.min(mats.length - 1, Math.floor(u * mats.length))], w, side * (0.35 + u * span), 0, -0.15 - u * 0.55);
    f.rotation.y = side * (0.25 + u * 0.55);
  }
  // Covert feathers on top, near the body.
  for (let i = 0; i < Math.ceil(n / 2); i++) {
    const u = i / n;
    const f = k.add(ell(0.2, 0.05, 0.42, 14), mats[0], w, side * (0.35 + u * span * 0.9), 0.04, 0.12);
    f.rotation.y = side * 0.2;
  }
  return w;
}

// ---------------------------------------------------------------- dragon

function dragon(k: Kit): Animate {
  const body = k.painted({ roughness: 0.45, metalness: 0.15 });
  const g = latheZ([
    [0.0, -1.5],
    [0.38, -1.25],
    [0.62, -0.6],
    [0.7, 0.2],
    [0.6, 0.9],
    [0.38, 1.3],
    [0.0, 1.45],
  ]);
  g.scale(0.85, 1, 1);
  k.add(tint(g, -0.6, 0.6, 0xffb347, 0xc1121f), body);
  // Neck up to the head.
  const neck = taper([V(0, 0.2, 1.1), V(0, 0.7, 1.7), V(0, 1.1, 2.15)], 0.36, 0.24, 20, 16);
  k.add(tint(neck, 0.2, 1.1, 0xe85d04, 0xc1121f), body);
  const head = k.joint(k.group, 0, 1.15, 2.2);
  const skull = ell(0.34, 0.3, 0.45);
  k.add(tint(skull, -0.3, 0.3, 0xe85d04, 0xa4161a), body, head, 0, 0, 0);
  const snout = ell(0.24, 0.18, 0.4);
  k.add(tint(snout, -0.2, 0.2, 0xf48c06, 0xa4161a), body, head, 0, -0.05, 0.42);
  const jaw = k.joint(head, 0, -0.14, 0.15);
  k.add(tint(ell(0.2, 0.08, 0.4), -0.1, 0.1, 0xffba08, 0xe85d04), body, jaw, 0, 0, 0.3);
  const ivory = k.mat(0xfff3c4, { roughness: 0.3 });
  for (const s of [1, -1]) {
    const horn = k.add(new THREE.ConeGeometry(0.07, 0.6, 12), ivory, head, s * 0.18, 0.3, -0.25);
    horn.rotation.set(-1.0, 0, s * -0.3);
    k.add(ell(0.07, 0.07, 0.05, 12), k.shine(0xffe14d), head, s * 0.2, 0.12, 0.32);
    k.add(ell(0.03, 0.03, 0.03, 8), k.shine(0x000000), head, s * 0.21, 0.12, 0.37);
    k.add(ell(0.04, 0.03, 0.03, 8), k.mat(0x370617), head, s * 0.08, 0.02, 0.8);
  }
  // Fire glow in the throat while boosting.
  const fire = k.glow(0xff7b00, 1.4, head, 0, -0.05, 0.95, false, 0);
  // Spikes along the back and tail.
  const spike = k.mat(0xffd166, { roughness: 0.35 });
  for (let i = 0; i < 9; i++) {
    const z = 1.0 - i * 0.32;
    const sp = k.add(new THREE.ConeGeometry(0.08, 0.32 - i * 0.015, 8), spike, k.group, 0, 0.64 - Math.abs(z) * 0.08, z);
    sp.rotation.x = -0.4;
  }
  // Tail with a spade at the end.
  const tail = k.joint(k.group, 0, 0.05, -1.35);
  const tailGeo = taper([V(0, 0, 0), V(0, 0.1, -0.9), V(0, 0.25, -1.8), V(0, 0.15, -2.5)], 0.28, 0.06, 26, 12);
  k.add(tint(tailGeo, -0.2, 0.3, 0xe85d04, 0xc1121f), body, tail);
  const spade = k.add(flat([[0, 0], [0.32, -0.25], [0, -0.7], [-0.32, -0.25]], 0.06), spike, tail, 0, 0.15, -2.45);
  spade.rotation.z = Math.PI / 2;
  // Bat wings: a frame of bones and a membrane.
  const membrane = k.mat(0x7b2cbf, { side: THREE.DoubleSide, roughness: 0.7, emissive: 0x240046 });
  const bone = k.mat(0xc1121f, { roughness: 0.4 });
  const wings: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const w = k.joint(k.group, s * 0.45, 0.45, 0.45);
    const shape = flat(
      [
        [0, 0.4],
        [1.2, 0.7],
        [2.6, 0.5],
        [3.3, -0.1],
        [2.6, -0.5],
        [2.2, -0.2],
        [1.7, -0.9],
        [1.2, -0.45],
        [0.7, -1.2],
        [0.15, -0.6],
      ],
      0.03,
    );
    const m = k.add(shape, membrane, w);
    m.scale.x = s;
    for (const [x, z] of [
      [3.3, -0.1],
      [1.7, -0.9],
      [0.7, -1.2],
    ]) {
      const b = k.add(taper([V(0, 0.03, 0.3), V(s * x * 0.55, 0.06, z * 0.3 + 0.3), V(s * x, 0.04, z)], 0.07, 0.025, 10, 8), bone, w);
      b.castShadow = false;
    }
    wings.push(w);
  }
  const legMat = k.mat(0xa4161a);
  for (const [x, z] of [
    [0.35, 0.7],
    [-0.35, 0.7],
    [0.38, -0.8],
    [-0.38, -0.8],
  ]) {
    const l = k.add(taper([V(0, 0, 0), V(0, -0.35, -0.1), V(0, -0.55, 0.05)], 0.13, 0.07, 8, 10), legMat, k.group, x, -0.35, z);
    l.rotation.x = 0.3;
  }
  return (t, _dt, _speed, boost) => {
    const flap = Math.sin(t * (boost ? 7 : 4.5));
    wings.forEach((w, i) => {
      const s = i === 0 ? 1 : -1;
      w.rotation.z = s * (0.15 + flap * 0.55);
      w.rotation.y = s * 0.1 * Math.cos(t * 4.5);
    });
    tail.rotation.y = Math.sin(t * 2.2) * 0.35;
    tail.rotation.x = Math.sin(t * 1.7) * 0.1;
    head.rotation.set(Math.sin(t * 1.3) * 0.08, Math.sin(t * 0.9) * 0.25, 0);
    jaw.rotation.x = boost ? 0.45 + 0.1 * Math.sin(t * 20) : 0.05;
    fire.material.opacity = boost ? 0.8 + 0.2 * Math.sin(t * 30) : 0;
    k.group.position.y = flap * 0.08;
  };
}

// ---------------------------------------------------------------- unicorn

function unicorn(k: Kit): Animate {
  const coat = k.painted({ roughness: 0.4 });
  const g = latheZ([
    [0, -1.25],
    [0.4, -1.05],
    [0.55, -0.4],
    [0.56, 0.4],
    [0.48, 0.95],
    [0, 1.2],
  ]);
  g.scale(0.82, 1, 1);
  k.add(tint(g, -0.55, 0.55, 0xe9e4ff, 0xffffff), coat);
  const neck = taper([V(0, 0.25, 0.9), V(0, 0.8, 1.35), V(0, 1.15, 1.6)], 0.3, 0.2, 16, 14);
  k.add(tint(neck, 0.2, 1.2, 0xece6ff, 0xffffff), coat);
  const head = k.joint(k.group, 0, 1.2, 1.65);
  k.add(tint(ell(0.24, 0.26, 0.34), -0.3, 0.3, 0xece6ff, 0xffffff), coat, head, 0, 0, 0);
  const muzzle = k.add(tint(ell(0.18, 0.17, 0.32), -0.2, 0.2, 0xffd6e8, 0xffffff), coat, head, 0, -0.12, 0.34);
  muzzle.rotation.x = 0.35;
  const gold = k.mat(0xffc300, { metalness: 0.7, roughness: 0.25, emissive: 0x5a3f00 });
  const horn = k.add(new THREE.ConeGeometry(0.075, 0.75, 16, 6), gold, head, 0, 0.42, 0.2);
  horn.rotation.x = 0.6;
  for (let i = 0; i < 4; i++) {
    const ring = k.add(new THREE.TorusGeometry(0.06 - i * 0.012, 0.012, 6, 16), gold, horn, 0, -0.25 + i * 0.16, 0);
    ring.rotation.x = Math.PI / 2;
  }
  for (const s of [1, -1]) {
    k.eye(head, s * 0.17, 0.06, 0.18, 0.07, 0x7b2cbf, s);
    const ear = k.add(new THREE.ConeGeometry(0.06, 0.2, 10), coat, head, s * 0.12, 0.3, -0.08);
    ear.rotation.z = s * -0.3;
    tint(ear.geometry, -0.1, 0.1, 0xffd6e8, 0xffffff);
  }
  // Rainbow mane along the neck and a rainbow tail.
  const rainbow = [0xff595e, 0xff924c, 0xffca3a, 0x8ac926, 0x1982c4, 0x6a4c93];
  const maneMats = rainbow.map((c) => k.mat(c, { roughness: 0.5 }));
  const mane: THREE.Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const u = i / 8;
    const m = k.add(ell(0.1, 0.18, 0.16, 14), maneMats[i % maneMats.length], k.group, 0, 0.55 + u * 0.75, 0.95 + u * 0.6);
    m.rotation.x = -0.5;
    mane.push(m);
  }
  const tail = k.joint(k.group, 0, 0.3, -1.15);
  const strands: THREE.Mesh[] = [];
  rainbow.forEach((_c, i) => {
    const off = (i - 2.5) * 0.06;
    strands.push(k.add(taper([V(off, 0, 0), V(off * 2, -0.15, -0.5), V(off * 3, -0.35, -1.0), V(off * 3.5, -0.4, -1.5)], 0.07, 0.02, 14, 8), maneMats[i], tail));
  });
  // Feathered wings in pastel colours.
  const wings = [1, -1].map((s) => {
    const w = featherWing(k, k.joint(k.group, s * 0.35, 0.45, 0.45), s, 7, 2.3, 0.6, [0xffffff, 0xffd6ff, 0xbde0fe, 0xcaffbf]);
    return w;
  });
  // Legs with golden hooves.
  interface Leg {
    hip: THREE.Group;
    knee: THREE.Group;
    front: boolean;
    side: number;
  }
  const legs: Leg[] = [];
  for (const [x, z, front] of [
    [0.3, 0.75, true],
    [-0.3, 0.75, true],
    [0.3, -0.8, false],
    [-0.3, -0.8, false],
  ] as [number, number, boolean][]) {
    const hip = k.joint(k.group, x, -0.3, z);
    const up = new THREE.CapsuleGeometry(0.12, 0.42, 6, 14);
    up.translate(0, -0.26, 0);
    k.add(tint(up, -0.5, 0.1, 0xe9e4ff, 0xffffff), coat, hip);
    const knee = k.joint(hip, 0, -0.55, 0);
    const low = new THREE.CapsuleGeometry(0.08, 0.4, 6, 12);
    low.translate(0, -0.24, 0);
    k.add(tint(low, -0.4, 0, 0xe9e4ff, 0xffffff), coat, knee);
    k.add(new THREE.CylinderGeometry(0.09, 0.1, 0.1, 14), gold, knee, 0, -0.52, 0);
    legs.push({ hip, knee, front, side: Math.sign(x) });
  }
  return (t, _dt, speed, boost) => {
    const f = 1.6 + speed / 40 + (boost ? 0.5 : 0);
    const ph = t * Math.PI * 2 * f;
    for (const l of legs) {
      const p = ph + (l.front ? 0 : Math.PI) + (l.side > 0 ? 0 : 0.3);
      l.hip.rotation.x = Math.sin(p) * 0.8;
      l.knee.rotation.x = (l.front ? -1 : 1) * Math.max(0, Math.cos(p)) * 0.9;
    }
    wings.forEach((w, i) => (w.rotation.z = (i === 0 ? 1 : -1) * (0.2 + Math.sin(t * 5) * 0.5)));
    mane.forEach((m, i) => (m.rotation.z = Math.sin(t * 8 + i) * 0.25));
    strands.forEach((s, i) => (s.rotation.y = Math.sin(t * 6 + i * 0.4) * 0.25));
    tail.rotation.x = 0.2 + Math.sin(t * 3) * 0.1;
    head.rotation.x = Math.sin(ph) * 0.06;
    k.group.position.y = Math.sin(ph * 2) * 0.06;
  };
}

// ---------------------------------------------------------------- phoenix

function phoenix(k: Kit): Animate {
  const plume = k.painted({ roughness: 0.4, emissive: 0x401000 });
  const g = latheZ([
    [0, -1.0],
    [0.35, -0.75],
    [0.5, -0.1],
    [0.46, 0.5],
    [0.3, 0.9],
    [0, 1.05],
  ]);
  k.add(tint(g, -0.5, 0.5, 0xffd60a, 0xff5400), plume);
  const head = k.joint(k.group, 0, 0.35, 1.05);
  k.add(tint(ell(0.28, 0.27, 0.3), -0.25, 0.25, 0xffc300, 0xff5400), plume, head);
  const beak = k.add(new THREE.ConeGeometry(0.1, 0.4, 14), k.mat(0xffe066, { roughness: 0.3 }), head, 0, -0.03, 0.42);
  beak.rotation.x = Math.PI / 2;
  for (const s of [1, -1]) k.eye(head, s * 0.15, 0.08, 0.15, 0.06, 0x00b4d8, s);
  // A crest of flame feathers.
  const crestMats = [0xff0054, 0xff5400, 0xffbd00].map((c) => k.shine(c));
  const crest: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const c = k.add(ell(0.05, 0.28 - i * 0.03, 0.06, 10), crestMats[i % 3], head, (i - 2) * 0.05, 0.3, -0.05 - i * 0.04);
    c.rotation.x = -0.6 - i * 0.12;
    crest.push(c);
  }
  const wings = [1, -1].map((s) => featherWing(k, k.joint(k.group, s * 0.3, 0.2, 0.25), s, 9, 2.8, 0.7, [0xffd60a, 0xff9e00, 0xff5400, 0xff0054]));
  // Long glowing tail plumes.
  const tail = k.joint(k.group, 0, 0.05, -0.95);
  const plumes: THREE.Group[] = [];
  const tailColors = [0xff0054, 0xff5400, 0xffbd00, 0xff5400, 0xff0054];
  tailColors.forEach((c, i) => {
    const j = k.joint(tail, (i - 2) * 0.1, 0, 0);
    j.rotation.y = (i - 2) * 0.12;
    k.add(taper([V(0, 0, 0), V(0, 0.1, -0.8), V(0, -0.05, -1.7), V(0, 0.05, -2.4)], 0.06, 0.015, 18, 8), k.shine(c), j);
    k.add(ell(0.13, 0.04, 0.22, 12), k.shine(0xffe066), j, 0, 0.05, -2.45);
    plumes.push(j);
  });
  const aura = k.glow(0xff7b00, 5, k.group, 0, 0.1, 0, false, 0.4);
  k.glow(0xffd60a, 2.2, k.group, 0, 0.05, -1.0, true, 0.8);
  for (const [x, z] of [
    [0.15, 0.1],
    [-0.15, 0.1],
  ]) {
    const leg = k.add(taper([V(0, 0, 0), V(0, -0.3, -0.2), V(0, -0.35, -0.45)], 0.05, 0.03, 8, 8), k.mat(0x6a040f), k.group, x, -0.4, z);
    leg.rotation.x = 0.2;
  }
  return (t, _dt, _speed, boost) => {
    const flap = Math.sin(t * (boost ? 8 : 5));
    wings.forEach((w, i) => (w.rotation.z = (i === 0 ? 1 : -1) * (0.1 + flap * 0.65)));
    plumes.forEach((p, i) => (p.rotation.x = Math.sin(t * 4 + i * 0.7) * 0.15));
    crest.forEach((c, i) => (c.rotation.z = Math.sin(t * 9 + i) * 0.12));
    aura.material.opacity = 0.3 + 0.15 * Math.sin(t * 6) + (boost ? 0.25 : 0);
    k.group.position.y = flap * 0.1;
  };
}

// ---------------------------------------------------------------- rocket shark

function shark(k: Kit): Animate {
  const skin = k.painted({ roughness: 0.35, metalness: 0.1 });
  const g = latheZ([
    [0, -1.6],
    [0.25, -1.3],
    [0.5, -0.5],
    [0.58, 0.3],
    [0.5, 1.0],
    [0.3, 1.5],
    [0, 1.75],
  ]);
  g.scale(0.85, 1, 1);
  k.add(tint(g, -0.45, 0.4, 0xf1faee, 0x1d6fa5), skin);
  const fin = k.mat(0x1d6fa5, { roughness: 0.35 });
  const dorsal = k.add(flat([[0, 0.4], [0.75, -0.25], [0, -0.35]], 0.06), fin, k.group, 0, 0.45, 0);
  dorsal.rotation.z = Math.PI / 2;
  for (const s of [1, -1]) {
    const pec = k.add(flat([[0, 0.25], [0.9, -0.35], [0, -0.25]], 0.05), fin, k.group, s * 0.4, -0.2, 0.4);
    pec.scale.x = s;
    pec.rotation.z = s * -0.35;
    k.eye(k.group, s * 0.3, 0.12, 1.15, 0.08, 0x1d3557, s);
    for (let i = 0; i < 3; i++) k.add(new THREE.BoxGeometry(0.02, 0.28, 0.04), k.mat(0x0b3c5d), k.group, s * 0.47, 0.0, 0.55 - i * 0.12);
  }
  // Grin full of teeth.
  const mouth = k.mat(0x6a040f);
  k.add(ell(0.28, 0.06, 0.12, 16), mouth, k.group, 0, -0.22, 1.3);
  const tooth = k.mat(0xffffff, { roughness: 0.2 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 8 - 0.5) * 2.2;
    const th = k.add(new THREE.ConeGeometry(0.03, 0.08, 6), tooth, k.group, Math.sin(a) * 0.25, -0.18, 1.3 + Math.cos(a) * 0.1);
    th.rotation.x = Math.PI;
  }
  const tail = k.joint(k.group, 0, 0, -1.5);
  const tf = k.add(flat([[0, 0.2], [0.85, -0.45], [0.2, -0.05], [-0.65, -0.4], [0, 0.2]], 0.06), fin, tail);
  tf.rotation.z = Math.PI / 2;
  // A red rocket strapped on its back.
  const rocket = k.joint(k.group, 0, 0.75, -0.3);
  const red = k.mat(0xe63946, { metalness: 0.4, roughness: 0.3 });
  k.add(new THREE.CylinderGeometry(0.2, 0.2, 1.2, 20).rotateX(Math.PI / 2), red, rocket);
  const nose = k.add(new THREE.ConeGeometry(0.2, 0.4, 20), k.mat(0xf1faee, { metalness: 0.3 }), rocket, 0, 0, 0.8);
  nose.rotation.x = Math.PI / 2;
  for (const s of [1, -1]) k.add(flat([[0, 0.1], [0.3, -0.2], [0, -0.25]], 0.03), red, rocket, s * 0.15, 0, -0.45).scale.set(s, 1, 1);
  k.add(new THREE.TorusGeometry(0.42, 0.04, 8, 24), k.mat(0x333333, { metalness: 0.6 }), k.group, 0, 0.25, -0.3).rotation.y = Math.PI / 2;
  k.glow(0xffb703, 1.6, rocket, 0, 0, -0.8, true);
  k.glow(0xfb5607, 1.1, rocket, 0, 0, -1.05, true);
  return (t, _dt, _speed, boost) => {
    tail.rotation.y = Math.sin(t * (boost ? 9 : 5)) * 0.4;
    k.group.rotation.y = Math.sin(t * (boost ? 9 : 5) + 1.5) * 0.04;
    rocket.position.y = 0.75 + Math.sin(t * 25) * 0.01;
  };
}

// ---------------------------------------------------------------- owl

function owl(k: Kit): Animate {
  const plum = k.painted({ roughness: 0.75 });
  const body = ell(0.75, 0.85, 0.9, 32);
  k.add(tint(body, -0.8, 0.8, 0xffd6a5, 0x7b2cbf), plum);
  const head = k.joint(k.group, 0, 0.8, 0.2);
  k.add(tint(ell(0.62, 0.55, 0.55, 30), -0.5, 0.5, 0xc77dff, 0x5a189a), plum, head);
  // The face disc and huge eyes.
  k.add(ell(0.5, 0.42, 0.12, 24), k.mat(0xfff1e6, { roughness: 0.6 }), head, 0, -0.02, 0.46);
  for (const s of [1, -1]) {
    k.add(new THREE.TorusGeometry(0.2, 0.035, 8, 24), k.mat(0xff9e00), head, s * 0.22, 0.03, 0.55);
    k.eye(head, s * 0.22, 0.03, 0.5, 0.18, 0xffbe0b, s);
    const tuft = k.add(new THREE.ConeGeometry(0.1, 0.4, 10), k.mat(0x5a189a), head, s * 0.35, 0.5, 0.05);
    tuft.rotation.z = s * -0.45;
  }
  const beak = k.add(new THREE.ConeGeometry(0.07, 0.22, 10), k.mat(0xff9e00, { roughness: 0.3 }), head, 0, -0.15, 0.6);
  beak.rotation.x = Math.PI / 2 + 0.6;
  // Feathered belly pattern.
  const spot = k.mat(0xe0aaff);
  for (let i = 0; i < 10; i++) k.add(ell(0.08, 0.05, 0.03, 10), spot, k.group, ((i % 3) - 1) * 0.22, -0.1 - Math.floor(i / 3) * 0.18, 0.86 - Math.floor(i / 3) * 0.05);
  const wings = [1, -1].map((s) => featherWing(k, k.joint(k.group, s * 0.6, 0.25, 0.05), s, 8, 2.4, 0.65, [0x5a189a, 0x3c096c, 0x00b4d8, 0x48cae4]));
  const tail = k.joint(k.group, 0, -0.3, -0.75);
  for (let i = 0; i < 5; i++) {
    const f = k.add(ell(0.1, 0.03, 0.45, 12), k.mat(i % 2 ? 0x3c096c : 0x00b4d8), tail, (i - 2) * 0.12, 0, -0.35);
    f.rotation.y = (i - 2) * 0.15;
  }
  const claw = k.mat(0xffb703);
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const c = k.add(new THREE.ConeGeometry(0.04, 0.2, 8), claw, k.group, s * 0.22 + (i - 1) * 0.06, -0.85, 0.15);
      c.rotation.x = Math.PI * 0.75;
    }
  }
  return (t, _dt, _speed, boost) => {
    const flap = Math.sin(t * (boost ? 6.5 : 3.5));
    wings.forEach((w, i) => (w.rotation.z = (i === 0 ? 1 : -1) * (0.15 + flap * 0.6)));
    // Owls turn their heads: a slow look around.
    head.rotation.y = Math.sin(t * 0.7) * 0.9;
    head.rotation.z = Math.sin(t * 0.5) * 0.12;
    tail.rotation.x = Math.sin(t * 2) * 0.1;
    k.group.position.y = flap * 0.1;
  };
}

// ---------------------------------------------------------------- bumblebee

function bee(k: Kit): Animate {
  const yellow = k.mat(0xffd000, { roughness: 0.7 });
  const black = k.mat(0x111111, { roughness: 0.6 });
  // Striped abdomen.
  const abdomen = k.joint(k.group, 0, 0, -0.75);
  for (let i = 0; i < 6; i++) {
    const z = 0.55 - i * 0.28;
    const r = 0.62 * Math.sin(((i + 0.8) / 6.6) * Math.PI) + 0.12;
    k.add(ell(r, r * 0.95, 0.2, 26), i % 2 ? black : yellow, abdomen, 0, 0, z);
  }
  const sting = k.add(new THREE.ConeGeometry(0.06, 0.4, 10), black, abdomen, 0, 0, -1.3);
  sting.rotation.x = -Math.PI / 2;
  // Fuzzy thorax and the head with big eyes.
  k.add(ell(0.5, 0.5, 0.5, 28), k.mat(0x2b2b2b, { roughness: 0.95 }), k.group, 0, 0.05, 0.25);
  k.add(ell(0.52, 0.2, 0.3, 20), yellow, k.group, 0, 0.32, 0.3);
  const head = k.joint(k.group, 0, 0.1, 0.85);
  k.add(ell(0.36, 0.34, 0.3, 26), k.mat(0x1b1b1b, { roughness: 0.5 }), head);
  for (const s of [1, -1]) {
    k.add(ell(0.18, 0.24, 0.16, 20), k.mat(0x3a0ca3, { roughness: 0.05, metalness: 0.3 }), head, s * 0.22, 0.05, 0.14);
    k.add(ell(0.04, 0.05, 0.03, 8), k.shine(0xffffff), head, s * 0.26, 0.14, 0.27);
    const ant = k.add(taper([V(0, 0, 0), V(s * 0.1, 0.35, 0.15), V(s * 0.25, 0.55, 0.35)], 0.025, 0.018, 10, 6), black, head, s * 0.1, 0.25, 0.1);
    k.add(ell(0.05, 0.05, 0.05, 10), black, ant, s * 0.25, 0.55, 0.35);
  }
  k.add(ell(0.12, 0.05, 0.05, 12), k.mat(0xff5d8f), head, 0, -0.18, 0.28);
  // Four see-through wings.
  const wingMat = k.mat(0xcaf0f8, { transparent: true, opacity: 0.45, side: THREE.DoubleSide, roughness: 0.1, metalness: 0.2, depthWrite: false });
  const wings: { j: THREE.Group; s: number; big: boolean }[] = [];
  for (const s of [1, -1]) {
    for (const big of [true, false]) {
      const j = k.joint(k.group, s * 0.3, 0.45, big ? 0.35 : 0.05);
      const w = k.add(ell(big ? 1.1 : 0.7, 0.02, big ? 0.38 : 0.26, 20), wingMat, j, s * (big ? 1.0 : 0.65), 0, -0.1);
      w.rotation.y = s * -0.3;
      wings.push({ j, s, big });
    }
  }
  for (let i = 0; i < 6; i++) {
    const s = i < 3 ? 1 : -1;
    const leg = k.add(taper([V(0, 0, 0), V(s * 0.2, -0.25, 0), V(s * 0.25, -0.5, -0.1)], 0.035, 0.02, 8, 6), black, k.group, s * 0.25, -0.3, 0.45 - (i % 3) * 0.25);
    leg.rotation.x = 0.3;
  }
  return (t) => {
    const buzz = Math.sin(t * 60);
    for (const w of wings) w.j.rotation.z = w.s * (0.2 + buzz * 0.5);
    abdomen.rotation.x = Math.sin(t * 3) * 0.08;
    head.rotation.y = Math.sin(t * 1.4) * 0.2;
    k.group.position.y = Math.sin(t * 7) * 0.05;
  };
}

// ---------------------------------------------------------------- rubber duck

function duck(k: Kit): Animate {
  const rubber = k.painted({ roughness: 0.25, metalness: 0 });
  const body = ell(0.95, 0.75, 1.25, 34);
  k.add(tint(body, -0.7, 0.7, 0xffb703, 0xffe14d), rubber);
  // Little tail up at the back.
  const tailTip = k.add(new THREE.ConeGeometry(0.3, 0.6, 18), rubber, k.group, 0, 0.45, -1.15);
  tailTip.rotation.x = -2.3;
  tint(tailTip.geometry, -0.3, 0.3, 0xffb703, 0xffe14d);
  const head = k.joint(k.group, 0, 0.95, 0.7);
  k.add(tint(ell(0.6, 0.58, 0.58, 32), -0.5, 0.5, 0xffc300, 0xffe14d), rubber, head);
  const beak = k.mat(0xff7b00, { roughness: 0.3 });
  k.add(ell(0.34, 0.1, 0.36, 22), beak, head, 0, -0.12, 0.6);
  k.add(ell(0.3, 0.07, 0.3, 20), beak, head, 0, -0.24, 0.52);
  // Aviator goggles on the forehead and eyes below.
  const strap = k.mat(0x6f4518, { roughness: 0.8 });
  const band = k.add(new THREE.TorusGeometry(0.6, 0.05, 8, 40), strap, head, 0, 0.18, 0);
  band.rotation.x = Math.PI / 2 - 0.25;
  const glass = k.mat(0x48cae4, { roughness: 0.05, metalness: 0.5, emissive: 0x0b3c5d });
  for (const s of [1, -1]) {
    const rim = k.add(new THREE.TorusGeometry(0.15, 0.04, 10, 22), k.mat(0xb08968, { metalness: 0.6 }), head, s * 0.2, 0.34, 0.45);
    rim.rotation.x = -0.4;
    const lens = k.add(ell(0.13, 0.13, 0.05, 16), glass, head, s * 0.2, 0.34, 0.47);
    lens.rotation.x = -0.4;
    k.eye(head, s * 0.24, 0.05, 0.42, 0.09, 0x1d3557, s);
  }
  // A red scarf whose ends flap in the wind.
  const scarf = k.mat(0xe63946, { roughness: 0.7, side: THREE.DoubleSide });
  const collar = k.add(new THREE.TorusGeometry(0.5, 0.11, 10, 30), scarf, k.group, 0, 0.62, 0.62);
  collar.rotation.x = Math.PI / 2;
  const ends: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const j = k.joint(k.group, s * 0.25, 0.65, 0.2);
    k.add(flat([[-0.12, 0], [0.12, 0], [0.1, -1.1], [-0.1, -1.0]], 0.03), scarf, j);
    ends.push(j);
  }
  // A jet engine on its back.
  const jet = k.joint(k.group, 0, 0.62, -0.45);
  const metal = k.mat(0xadb5bd, { metalness: 0.8, roughness: 0.25 });
  k.add(new THREE.CylinderGeometry(0.22, 0.26, 0.8, 22, 1, true).rotateX(Math.PI / 2), metal, jet);
  k.add(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 22).rotateX(Math.PI / 2), k.mat(0x222222), jet, 0, 0, 0.38);
  k.glow(0x4cc9f0, 1.5, jet, 0, 0, -0.55, true);
  // Little orange feet paddling.
  const feet = [1, -1].map((s) => {
    const j = k.joint(k.group, s * 0.35, -0.65, 0);
    k.add(flat([[0, 0.25], [0.18, -0.15], [0, -0.05], [-0.18, -0.15]], 0.04), beak, j, 0, -0.08, 0);
    return j;
  });
  return (t, _dt, _speed, boost) => {
    ends.forEach((e, i) => {
      e.rotation.x = -1.1 + Math.sin(t * (boost ? 16 : 10) + i) * 0.2;
      e.rotation.z = Math.sin(t * 7 + i * 2) * 0.2;
    });
    feet.forEach((f, i) => (f.rotation.x = Math.sin(t * 6 + i * Math.PI) * 0.6));
    head.rotation.z = Math.sin(t * 1.5) * 0.08;
    k.group.position.y = Math.sin(t * 2.4) * 0.08;
    k.group.rotation.z = Math.sin(t * 1.2) * 0.05;
  };
}

// ---------------------------------------------------------------- flying pig

function pig(k: Kit): Animate {
  const pink = k.painted({ roughness: 0.55 });
  const body = ell(0.82, 0.78, 1.25, 34);
  k.add(tint(body, -0.7, 0.7, 0xffafcc, 0xff85a1), pink);
  const head = k.joint(k.group, 0, 0.3, 1.25);
  k.add(tint(ell(0.55, 0.52, 0.5, 30), -0.5, 0.5, 0xffafcc, 0xff85a1), pink, head);
  const snout = k.mat(0xff5d8f, { roughness: 0.4 });
  const sn = k.add(new THREE.CylinderGeometry(0.22, 0.24, 0.2, 24).rotateX(Math.PI / 2), snout, head, 0, -0.08, 0.5);
  for (const s of [1, -1]) {
    k.add(ell(0.05, 0.07, 0.03, 10), k.mat(0x6a040f), sn, s * 0.08, 0, 0.1);
    k.eye(head, s * 0.22, 0.15, 0.38, 0.08, 0x3a86ff, s);
    const ear = k.add(new THREE.ConeGeometry(0.16, 0.32, 3), pink, head, s * 0.33, 0.42, 0.05);
    ear.rotation.set(-0.5, 0, s * -0.5);
    tint(ear.geometry, -0.2, 0.2, 0xff85a1, 0xffafcc);
  }
  // Curly tail: a little spiral.
  const curl: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 4;
    curl.push(V(Math.cos(a) * 0.12 * (1 - i / 40), Math.sin(a) * 0.12 * (1 - i / 40), -i * 0.025));
  }
  const tail = k.joint(k.group, 0, 0.25, -1.22);
  k.add(taper(curl, 0.05, 0.03, 40, 8), snout, tail);
  // Tiny white feathered wings, flapping hard.
  const wings = [1, -1].map((s) => featherWing(k, k.joint(k.group, s * 0.55, 0.55, 0.25), s, 6, 1.2, 0.4, [0xffffff, 0xf8f9fa, 0xe9ecef]));
  const hoof = k.mat(0x6d4c41);
  const legs = [
    [0.4, 0.7],
    [-0.4, 0.7],
    [0.4, -0.7],
    [-0.4, -0.7],
  ].map(([x, z], i) => {
    const j = k.joint(k.group, x, -0.55, z);
    const leg = new THREE.CapsuleGeometry(0.12, 0.25, 6, 12);
    leg.translate(0, -0.18, 0);
    k.add(tint(leg, -0.4, 0.1, 0xff85a1, 0xffafcc), pink, j);
    k.add(new THREE.CylinderGeometry(0.12, 0.13, 0.1, 12), hoof, j, 0, -0.42, 0);
    return { j, i };
  });
  return (t, _dt, _speed, boost) => {
    const flap = Math.sin(t * (boost ? 22 : 15));
    wings.forEach((w, i) => (w.rotation.z = (i === 0 ? 1 : -1) * (0.3 + flap * 0.6)));
    tail.rotation.z = t * 6;
    legs.forEach(({ j, i }) => (j.rotation.x = Math.sin(t * 8 + i * 1.6) * 0.5));
    head.rotation.x = Math.sin(t * 2) * 0.06;
    k.group.position.y = Math.sin(t * 3) * 0.1;
  };
}

// ---------------------------------------------------------------- octopus alien

function octopus(k: Kit): Animate {
  const skin = k.painted({ roughness: 0.35, metalness: 0.05 });
  const head = latheZ([
    [0, -1.3],
    [0.5, -1.1],
    [0.8, -0.5],
    [0.85, 0.1],
    [0.7, 0.5],
    [0, 0.65],
  ]);
  k.add(tint(head, -0.8, 0.8, 0x9d4edd, 0xf72585), skin, k.group, 0, 0.35, -0.1);
  // Glowing spots on the head.
  const spot = k.shine(0x4cc9f0);
  for (let i = 0; i < 12; i++) {
    const a = i * 2.4;
    const z = -0.9 + (i % 4) * 0.35;
    const r = 0.78 * Math.sin(((z + 1.3) / 1.95) * Math.PI) + 0.05;
    k.add(ell(0.06, 0.06, 0.03, 10), spot, k.group, Math.cos(a) * r * 0.95, 0.35 + Math.sin(a) * r * 0.95, z);
  }
  // Three green eyes in front.
  for (const [x, y, r] of [
    [0.3, 0.45, 0.16],
    [-0.3, 0.45, 0.16],
    [0, 0.72, 0.12],
  ]) {
    k.eye(k.group, x, y, 0.5, r, 0x70e000, Math.sign(x) || 1);
    k.glow(0x70e000, r * 4, k.group, x, y, 0.62, false, 0.35);
  }
  // Eight tentacles trailing back, each a chain of segments that waves.
  const arms: THREE.Group[][] = [];
  const armMat = k.painted({ roughness: 0.4 });
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    const chain: THREE.Group[] = [];
    let parent: THREE.Object3D = k.joint(k.group, Math.cos(ang) * 0.45, 0.1 + Math.sin(ang) * 0.35, 0.15);
    for (let s = 0; s < 6; s++) {
      const j = k.joint(parent, 0, 0, s === 0 ? 0 : -0.38);
      const r = 0.15 * (1 - s / 7);
      const seg = new THREE.CylinderGeometry(r * 0.85, r, 0.42, 12).rotateX(Math.PI / 2);
      seg.translate(0, 0, -0.19);
      k.add(tint(seg, -r, r, 0xff99c8, 0x9d4edd), armMat, j);
      // Suckers underneath.
      k.add(ell(r * 0.45, r * 0.2, r * 0.45, 8), k.mat(0xffc8dd), j, 0, -r * 0.8, -0.19);
      chain.push(j);
      parent = j;
    }
    arms.push(chain);
  }
  // A glass bubble helmet.
  k.add(ell(1.0, 0.95, 1.05, 30), k.mat(0xbde0fe, { transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.5, depthWrite: false }), k.group, 0, 0.35, -0.15);
  k.glow(0xf72585, 1.4, k.group, 0, 0, -1.5, true, 0.7);
  return (t, _dt, _speed, boost) => {
    arms.forEach((chain, a) => {
      const ang = (a / 8) * Math.PI * 2;
      chain.forEach((j, s) => {
        const w = Math.sin(t * (boost ? 7 : 4) - s * 0.8 + a) * (0.18 + s * 0.04);
        j.rotation.x = Math.sin(ang) * w + (s === 0 ? -Math.sin(ang) * 0.3 : 0);
        j.rotation.y = Math.cos(ang) * w + (s === 0 ? Math.cos(ang) * 0.3 : 0);
      });
    });
    k.group.position.y = Math.sin(t * 2) * 0.08;
  };
}

// ---------------------------------------------------------------- space jelly

function jelly(k: Kit): Animate {
  // The bell: see-through, glowing pink to cyan, with a bright core.
  const bellGeo = new THREE.SphereGeometry(1.1, 36, 20, 0, Math.PI * 2, 0, Math.PI * 0.55);
  bellGeo.rotateX(Math.PI / 2);
  tint(bellGeo, -1, 1, 0x4cc9f0, 0xf72585);
  const bell = k.joint(k.group, 0, 0, 0.4);
  k.add(bellGeo, k.mat(0xffffff, { vertexColors: true, transparent: true, opacity: 0.55, roughness: 0.1, emissive: 0x3a0ca3, emissiveIntensity: 0.6, side: THREE.DoubleSide, depthWrite: false }), bell);
  const core = k.add(ell(0.45, 0.45, 0.5, 24), k.shine(0xffd6ff, 0.85), bell, 0, 0, 0.15);
  k.glow(0xb5179e, 4.5, bell, 0, 0, 0.1, false, 0.45);
  // A frilly rim.
  const frill = k.mat(0xff99c8, { side: THREE.DoubleSide, roughness: 0.3, emissive: 0x7209b7, emissiveIntensity: 0.4 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const f = k.add(ell(0.2, 0.08, 0.14, 12), frill, bell, Math.cos(a) * 1.05, Math.sin(a) * 1.05, -0.05);
    f.rotation.z = a;
  }
  // Long glowing tentacles trailing behind.
  const ribbons: THREE.Group[] = [];
  const colors = [0x4cc9f0, 0xf72585, 0xb5179e, 0x7209b7, 0x4361ee];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const j = k.joint(k.group, Math.cos(a) * 0.55, Math.sin(a) * 0.55, -0.1);
    k.add(taper([V(0, 0, 0), V(0, 0.08, -1.0), V(0, -0.08, -2.0), V(0, 0.05, -3.0)], 0.05, 0.012, 22, 6), k.shine(colors[i % colors.length], 0.85), j);
    ribbons.push(j);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const j = k.joint(k.group, Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0);
    k.add(taper([V(0, 0, 0), V(0, 0.1, -0.6), V(0, -0.1, -1.3)], 0.13, 0.04, 16, 10), k.mat(0xffc8dd, { transparent: true, opacity: 0.8, emissive: 0xb5179e, emissiveIntensity: 0.5 }), j);
    ribbons.push(j);
  }
  return (t, _dt, _speed, boost) => {
    const pulse = Math.sin(t * (boost ? 7 : 4));
    bell.scale.set(1 + pulse * 0.08, 1 + pulse * 0.08, 1 - pulse * 0.12);
    core.scale.setScalar(1 + 0.1 * Math.sin(t * 6));
    ribbons.forEach((r, i) => {
      r.rotation.x = Math.sin(t * 3 + i) * 0.18;
      r.rotation.y = Math.cos(t * 2.5 + i * 0.7) * 0.18;
    });
  };
}

const BUILD: Record<CreatureId, (k: Kit) => Animate> = { dragon, unicorn, phoenix, shark, owl, bee, duck, pig, octopus, jelly };

/** A creature glider; accents and engine glows use the pilot's colour where it fits. */
export function makeCreature(id: CreatureId, color: number, glowTexture: THREE.Texture): CreatureMesh {
  const k = new Kit(color, glowTexture);
  const animate = BUILD[id](k);
  // The pilot's colour as a small glowing badge on top, like the light strips of the ships.
  k.add(new THREE.OctahedronGeometry(0.09, 0), k.glowMat, k.group, 0, -0.02, 0);
  return {
    group: k.group,
    solids: k.solids,
    glowMat: k.glowMat,
    flames: k.flames,
    flame: 1.2,
    animate,
    free: () => k.free(),
  };
}
