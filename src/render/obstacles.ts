import * as THREE from 'three';
import type { Obstacle } from '../core/obstacles';
import { sharedTextures } from './textures';

/**
 * How the obstacles look: mostly glass (clear in the middle, bright at the
 * edges), some glass grown out of rock, and a few waterfalls pouring down to
 * the floor. Every look is built inside its collision shape (or just a little
 * outside it), so what you see is what can hit you.
 * Local +Y of each model is the obstacle's axis.
 */

export interface ObstacleView {
  readonly obj: THREE.Object3D;
  update(o: Obstacle, time: number): void;
  dispose(): void;
}

const Y = new THREE.Vector3(0, 1, 0);
const tq = new THREE.Quaternion();
const tv = new THREE.Vector3();
const tm = new THREE.Matrix4();

function std(color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, metalness: 0.1, ...extra });
}

function glowMat(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
}

function glowSprite(color: number, size: number, opacity = 0.8): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sharedTextures().glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.scale.setScalar(size);
  return s;
}

const GLASS_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const GLASS_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uBase;
uniform float uRim;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  float f = 1.0 - abs(dot(n, v));
  float rim = pow(f, 2.2);
  // A glint from a light high up in front.
  vec3 l = normalize(vec3(0.35, 0.9, 0.25));
  float spec = pow(max(dot(reflect(-l, n), v), 0.0), 48.0) + pow(max(dot(reflect(-l, -n), v), 0.0), 48.0);
  vec3 col = uColor * (0.55 + 0.9 * rim) + vec3(spec);
  float a = clamp(uBase + rim * uRim + spec * 0.8, 0.0, 0.92);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}`;

/** Glass: see-through in the middle, bright towards the edges, with a glint. */
function glass(tint: number, base = 0.08, rim = 0.8): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(tint) }, uBase: { value: base }, uRim: { value: rim } }]),
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/** A six-sided glass crystal of radius r and length len, base at the origin pointing up. */
function crystalMesh(r: number, len: number, mat: THREE.Material): THREE.Mesh {
  const body = new THREE.CylinderGeometry(r, r * 1.05, len * 0.78, 6);
  body.translate(0, len * 0.39, 0);
  const tip = new THREE.ConeGeometry(r, len * 0.22, 6);
  tip.translate(0, len * 0.89, 0);
  const g = mergeGeo([body, tip]);
  return new THREE.Mesh(g, mat);
}

/** Joins geometries without indices (enough for these simple shapes). */
function mergeGeo(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    const pa = g.getAttribute('position') as THREE.BufferAttribute;
    const na = g.getAttribute('normal') as THREE.BufferAttribute;
    pos.set(pa.array as Float32Array, o * 3);
    nor.set(na.array as Float32Array, o * 3);
    o += pa.count;
  }
  for (const g of list) g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/** Points a crystal (built along +Y) in direction d. */
function pointAlong(m: THREE.Object3D, dx: number, dy: number, dz: number): void {
  m.quaternion.setFromUnitVectors(Y, tv.set(dx, dy, dz).normalize());
}

/** A lumpy low-poly rock of about radius r (never more than 6% bigger). */
function rock(r: number, color: number, seed: number): THREE.Mesh {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = 0.86 + rnd() * 0.2;
      seen.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, std(color));
}

/** Points the model's +Y along the obstacle's axis. */
function alignY(obj: THREE.Object3D, o: Obstacle): void {
  obj.quaternion.copy(tq.setFromUnitVectors(Y, tv.set(o.a.x, o.a.y, o.a.z)));
}

function view(obj: THREE.Object3D, update: (o: Obstacle, time: number) => void): ObstacleView {
  return {
    obj,
    update(o, time) {
      obj.position.set(o.c.x, o.c.y, o.c.z);
      update(o, time);
    },
    dispose() {
      obj.traverse((x) => {
        const m = x as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((q) => q.dispose());
        else mat?.dispose();
      });
    },
  };
}

/** A floating island: a rock belly with glass crystals growing out of the top. */
function island(r: number, seed: number, tint: number): ObstacleView {
  const g = new THREE.Group();
  const base = rock(r * 0.8, 0x7a6658, seed);
  base.scale.set(1, 0.6, 1);
  base.position.y = -r * 0.3;
  g.add(base);
  const mat = glass(tint);
  for (let k = 0; k < 7; k++) {
    const a = k * 2.39996 + seed;
    const d = k === 0 ? 0 : r * (0.2 + 0.08 * (k % 3));
    const len = r * (k === 0 ? 0.9 : 0.45 + 0.07 * (k % 4));
    const c = crystalMesh(r * (k === 0 ? 0.22 : 0.14), len, mat);
    c.position.set(Math.cos(a) * d, -r * 0.08, Math.sin(a) * d);
    pointAlong(c, Math.cos(a) * d * 0.04, 1, Math.sin(a) * d * 0.04);
    g.add(c);
  }
  // A faint glass dome over everything.
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.97, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), glass(tint, 0.02, 0.45)));
  const heart = glowSprite(tint, r * 2.4, 0.35);
  heart.position.y = r * 0.3;
  g.add(heart);
  return view(g, (_o, t) => {
    g.rotation.y = t * 0.05 + seed;
  });
}

/** Rock with glass crystals growing out on every side. */
function geode(r: number, seed: number, tint: number): ObstacleView {
  const g = new THREE.Group();
  g.add(rock(r * 0.66, 0x6c625e, seed));
  const mat = glass(tint);
  for (let k = 0; k < 9; k++) {
    // Even spread over the sphere.
    const y = 1 - (2 * (k + 0.5)) / 9;
    const rr = Math.sqrt(1 - y * y);
    const a = k * 2.39996 + seed;
    const dx = Math.cos(a) * rr;
    const dz = Math.sin(a) * rr;
    const c = crystalMesh(r * 0.13, r * 0.42, mat);
    c.position.set(dx * r * 0.52, y * r * 0.52, dz * r * 0.52);
    pointAlong(c, dx, y, dz);
    g.add(c);
  }
  g.add(glowSprite(tint, r * 2.6, 0.3));
  return view(g, (_o, t) => {
    g.rotation.set(Math.sin(t * 0.2 + seed) * 0.2, t * 0.12 + seed, 0);
  });
}

function whale(r: number, half: number, tint: number): ObstacleView {
  const g = new THREE.Group();
  const len = half + r;
  const prof: [number, number][] = [
    [0.1, len],
    [r * 0.75, len * 0.75],
    [r * 0.98, len * 0.3],
    [r * 0.9, -len * 0.2],
    [r * 0.5, -len * 0.7],
    [r * 0.18, -len * 0.95],
  ];
  const body = new THREE.LatheGeometry(
    prof.map(([a, b]) => new THREE.Vector2(a, b)),
    12,
  );
  body.rotateX(Math.PI / 2);
  body.scale(1, 0.82, 1);
  const skin = glass(tint, 0.1, 0.85);
  g.add(new THREE.Mesh(body, skin));
  // Its glowing heart and spine, seen through the glass.
  const heart = glowSprite(0xffffff, r * 2.2, 0.55);
  heart.position.z = len * 0.25;
  g.add(heart);
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.08, r * 0.08, len * 1.5, 6), glowMat(tint, 0.6));
  spine.rotation.x = Math.PI / 2;
  g.add(spine);
  const fluke = new THREE.Mesh(new THREE.ConeGeometry(r * 0.9, r * 1.4, 3), skin);
  fluke.scale.set(1.6, 0.18, 1);
  fluke.rotation.x = -Math.PI / 2;
  fluke.position.z = -len * 1.0;
  g.add(fluke);
  for (const s of [1, -1]) {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(r * 0.4, r * 1.4, 3), skin);
    fin.scale.set(1, 0.2, 1);
    fin.rotation.set(0, 0, s * 1.9);
    fin.position.set(s * r * 0.95, -r * 0.3, len * 0.25);
    g.add(fin);
    const eye = glowSprite(0xffffff, r * 0.5, 0.9);
    eye.position.set(s * r * 0.62, r * 0.05, len * 0.62);
    g.add(eye);
  }
  return view(g, (o, t) => {
    tm.lookAt(new THREE.Vector3(0, 0, 0), tv.set(-o.a.x, -o.a.y, -o.a.z), Y);
    g.quaternion.setFromRotationMatrix(tm);
    g.rotateZ(Math.sin(t * 0.8) * 0.08);
    fluke.rotation.y = Math.sin(t * 1.6) * 0.35;
    heart.material.opacity = 0.4 + 0.2 * Math.sin(t * 2.4);
  });
}

function spire(r: number, half: number, tint: number): ObstacleView {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, half * 2, 6), glass(tint, 0.08, 0.9));
  g.add(pole);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.12, half * 2, 6), glowMat(0xe6dcff, 0.8));
  g.add(core);
  for (let k = -2; k <= 2; k++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.95, 0.2, 4, 12), glowMat(0xc9b8ff, 0.7));
    band.rotation.x = Math.PI / 2;
    band.position.y = (k * half) / 2.6;
    g.add(band);
  }
  const top = crystalMesh(r * 0.7, r * 2.2, glass(0xffffff, 0.2, 0.9));
  top.position.y = half - r * 1.2;
  const halo = glowSprite(0xb9a8ff, r * 7);
  halo.position.y = half;
  g.add(top, halo);
  return view(g, (o, t) => {
    alignY(g, o);
    halo.material.opacity = 0.5 + 0.4 * Math.abs(Math.sin(t * 9 + o.c.x));
  });
}

function crystal(r: number, half: number, tint: number): ObstacleView {
  const g = new THREE.Group();
  const ice = glass(tint, 0.12, 0.85);
  const prism = new THREE.Mesh(new THREE.CylinderGeometry(r, r, half * 2 - r * 0.4, 6), ice);
  const tipA = new THREE.Mesh(new THREE.ConeGeometry(r, r * 2.2, 6), ice);
  tipA.position.y = half + r * 0.9;
  tipA.scale.set(1, 0.85, 1);
  const tipB = tipA.clone();
  tipB.position.y = -tipA.position.y;
  tipB.rotation.x = Math.PI;
  // A rock caught inside the ice.
  const stone = rock(r * 0.55, 0x5a5f6a, Math.round(half));
  stone.position.y = -half * 0.35;
  const core = glowSprite(0x7fe8ff, r * 5, 0.5);
  g.add(prism, tipA, tipB, stone, core);
  return view(g, (o, t) => {
    alignY(g, o);
    core.material.opacity = 0.4 + 0.2 * Math.sin(t * 2 + o.c.z);
  });
}

/** Ring of glass; rocks or lights ride around it. */
function ringLook(R: number, r: number, tint: number, light: number, markers: number, rocks: boolean): ObstacleView {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.TorusGeometry(R, r, 10, 72), glass(tint, 0.1, 0.9));
  tube.rotation.x = Math.PI / 2;
  const glow = new THREE.Mesh(new THREE.TorusGeometry(R, r * 0.18, 4, 72), glowMat(light, 0.8));
  glow.rotation.x = Math.PI / 2;
  g.add(tube, glow);
  const spinner = new THREE.Group();
  for (let k = 0; k < markers; k++) {
    const a = (k / markers) * Math.PI * 2;
    const m = rocks ? rock(r * 1.15, 0x6f6458, 3 + k) : new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, r * 1.2, r * 2.2), glowMat(light));
    m.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
    m.rotation.y = -a;
    spinner.add(m);
  }
  g.add(spinner);
  return view(g, (o, t) => {
    alignY(g, o);
    spinner.rotation.y = t * (rocks ? 0.15 : 0.6);
  });
}

function arch(R: number, r: number): ObstacleView {
  const g = new THREE.Group();
  const mat = glass(0x6dffcf, 0.12, 0.95);
  const tube = new THREE.Mesh(new THREE.TorusGeometry(R, r, 10, 96), mat);
  tube.rotation.x = Math.PI / 2;
  const core = new THREE.Mesh(new THREE.TorusGeometry(R, r * 0.22, 6, 96), glowMat(0xffffff, 0.8));
  core.rotation.x = Math.PI / 2;
  g.add(tube, core);
  const c = new THREE.Color();
  return view(g, (o, t) => {
    alignY(g, o);
    mat.uniforms.uColor.value.copy(c.setHSL(0.42 + 0.12 * Math.sin(t * 0.4 + o.a.x * 2), 1, 0.6));
  });
}

function hub(r: number, half: number, tint: number): ObstacleView {
  const g = new THREE.Group();
  const shell = glass(tint, 0.07, 0.8);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, half * 2, 16), shell);
  const capA = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), shell);
  capA.position.y = half;
  const capB = capA.clone();
  capB.rotation.x = Math.PI;
  capB.position.y = -half;
  g.add(body, capA, capB);
  // Decks and a lit shaft inside the glass.
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.22, half * 2.2, 8), std(0xd9dde6, { metalness: 0.6, roughness: 0.3 })));
  for (let k = -2; k <= 2; k++) {
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.85, 0.25, 16), glowMat(0xffe48a, 0.35));
    deck.position.y = (k * half) / 2.5;
    g.add(deck);
  }
  const beacon = glowSprite(0xff4040, 3);
  beacon.position.y = half + r;
  g.add(beacon);
  return view(g, (_o, t) => {
    g.rotation.y = t * 0.1;
    beacon.material.opacity = Math.sin(t * 4) > 0 ? 0.9 : 0.1;
  });
}

function satellite(r: number): ObstacleView {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(r * 0.8, r * 0.8, r * 1.0), std(0xc9a227, { metalness: 0.7, roughness: 0.3 })));
  for (const s of [1, -1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(r * 0.55, 0.08, r * 0.7), glass(0x4a7bff, 0.3, 0.8));
    panel.position.x = s * r * 0.72;
    g.add(panel);
  }
  const dish = new THREE.Mesh(new THREE.ConeGeometry(r * 0.35, r * 0.25, 10, 1, true), std(0xeeeeee, { side: THREE.DoubleSide }));
  dish.position.z = r * 0.62;
  dish.rotation.x = -Math.PI / 2;
  g.add(dish);
  return view(g, (_o, t) => {
    g.rotation.set(t * 0.2, t * 0.35, 0);
  });
}

/** A rock with glass shards growing out of it. */
function asteroid(r: number, seed: number, tint: number): ObstacleView {
  const g = new THREE.Group();
  g.add(rock(r * 0.85, 0x6f6a66, seed));
  const mat = glass(tint);
  for (let k = 0; k < 4; k++) {
    const a = k * 1.9 + seed;
    const y = 0.5 - k * 0.3;
    const rr = Math.sqrt(1 - y * y);
    const c = crystalMesh(r * 0.14, r * 0.38, mat);
    c.position.set(Math.cos(a) * rr * r * 0.6, y * r * 0.6, Math.sin(a) * rr * r * 0.6);
    pointAlong(c, Math.cos(a) * rr, y, Math.sin(a) * rr);
    g.add(c);
  }
  return view(g, (_o, t) => {
    g.rotation.set(t * 0.13 + seed, t * 0.21, 0);
  });
}

/** A glass bubble with a glowing rock heart. */
function orb(r: number, tint: number): ObstacleView {
  const g = new THREE.Group();
  const heart = rock(r * 0.4, 0x3a1530, 11);
  (heart.material as THREE.MeshStandardMaterial).emissive.setHex(0xff3df2);
  (heart.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8;
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), glass(tint, 0.06, 0.9));
  const halo = glowSprite(0xff5cf0, r * 5, 0.45);
  g.add(heart, shell, halo);
  return view(g, (_o, t) => {
    heart.rotation.set(t * 0.7, t * 0.5, 0);
    shell.rotation.set(-t * 0.1, t * 0.15, 0);
    halo.material.opacity = 0.35 + 0.15 * Math.sin(t * 3);
  });
}

function beam(r: number, half: number, tint: number): ObstacleView {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, half * 2, r * 1.2), glass(tint, 0.1, 0.9)));
  for (const [x, z] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.16, half * 2 + r, 0.16), glowMat(0xc58bff));
    edge.position.set(x * r * 0.62, 0, z * r * 0.62);
    g.add(edge);
  }
  for (const s of [1, -1]) {
    const tip = glowSprite(0xd9a8ff, r * 5);
    tip.position.y = s * half;
    g.add(tip);
  }
  return view(g, (o) => alignY(g, o));
}

let streaks: THREE.CanvasTexture | null = null;

/** Falling water: soft vertical streaks that scroll down. */
function waterTexture(): THREE.CanvasTexture {
  if (streaks) return streaks;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const x = c.getContext('2d');
  if (x) {
    x.fillStyle = 'rgba(200,236,255,0.45)';
    x.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 70; i++) {
      const px = Math.random() * 64;
      const py = Math.random() * 256;
      const len = 20 + Math.random() * 70;
      x.strokeStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.5})`;
      x.lineWidth = 1 + Math.random() * 2.5;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px, py + len);
      x.stroke();
      if (py + len > 256) {
        x.beginPath();
        x.moveTo(px, py - 256);
        x.lineTo(px, py + len - 256);
        x.stroke();
      }
    }
  }
  streaks = new THREE.CanvasTexture(c);
  streaks.wrapS = THREE.RepeatWrapping;
  streaks.wrapT = THREE.RepeatWrapping;
  return streaks;
}

/** Where a waterfall pours, in world space, for the splash check. */
export function fallColumn(o: Obstacle): { x: number; z: number; top: number; r: number } | null {
  const f = o.def.fall;
  if (!f) return null;
  const s = o.def.shape;
  const r = s.kind === 'sphere' ? s.r : s.kind === 'capsule' ? s.r : s.r;
  return { x: o.c.x + f.dx, z: o.c.z + f.dz, top: o.c.y - r * 0.3, r: f.r };
}

/** Adds the waterfall of obstacle o (if it has one), pouring down to floorY. */
function withWaterfall(v: ObstacleView, o: Obstacle, floorY: number): ObstacleView {
  const f = o.def.fall;
  if (!f) return v;
  const holder = new THREE.Group();
  holder.add(v.obj);
  const tex = waterTexture();
  const geo = new THREE.CylinderGeometry(1, 1.35, 1, 16, 1, true);
  geo.translate(0, -0.5, 0);
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xe6f7ff, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
  const water = new THREE.Mesh(geo, mat);
  const foam = glowSprite(0xffffff, f.r * 6, 0.6);
  const mist = glowSprite(0xbfe8ff, f.r * 11, 0.3);
  const lip = glowSprite(0xffffff, f.r * 3, 0.5);
  holder.add(water, foam, mist, lip);
  return {
    obj: holder,
    update(ob, time) {
      v.update(ob, time);
      // The model is placed in world space by its own update; undo that inside the holder.
      v.obj.position.set(0, 0, 0);
      holder.position.set(ob.c.x, ob.c.y, ob.c.z);
      const col = fallColumn(ob);
      if (!col) return;
      const len = Math.max(1, col.top - floorY);
      water.position.set(f.dx, col.top - ob.c.y, f.dz);
      water.scale.set(f.r, len, f.r);
      lip.position.set(f.dx, col.top - ob.c.y, f.dz);
      foam.position.set(f.dx, floorY - ob.c.y + 1, f.dz);
      mist.position.set(f.dx, floorY - ob.c.y + f.r * 2, f.dz);
      foam.material.opacity = 0.5 + 0.15 * Math.sin(time * 7);
      tex.repeat.set(2, Math.max(1, len / 40));
      tex.offset.y = (time * 0.9) % 1;
    },
    dispose() {
      v.dispose();
      geo.dispose();
      mat.dispose();
      for (const sp of [foam, mist, lip]) sp.material.dispose();
    },
  };
}

/** Glass tint of each look. */
const TINT: Record<string, number> = {
  island: 0xbff4ff,
  whale: 0x9fd8ff,
  spire: 0xc9b8ff,
  crystal: 0xcff6ff,
  geode: 0xa8ffe6,
  turbine: 0xb0f0ff,
  station: 0xffe9a8,
  hub: 0xdfe8ff,
  asteroid: 0xd8c8ff,
  gate: 0xffd08a,
  orb: 0xff9cf2,
  beam: 0xd2a8ff,
};

/** The model for an obstacle; floorY is where its waterfall (if any) lands. */
export function makeObstacleView(o: Obstacle, index: number, floorY = -100): ObstacleView {
  const s = o.def.shape;
  const seed = 1 + index * 7;
  const tint = TINT[o.def.look] ?? 0xcfefff;
  let v: ObstacleView;
  switch (o.def.look) {
    case 'island':
      v = island(s.kind === 'sphere' ? s.r : 6, seed, tint);
      break;
    case 'geode':
      v = geode(s.kind === 'sphere' ? s.r : 6, seed, tint);
      break;
    case 'whale':
      v = s.kind === 'capsule' ? whale(s.r, s.half, tint) : asteroid(6, seed, tint);
      break;
    case 'spire':
      v = s.kind === 'capsule' ? spire(s.r, s.half, tint) : asteroid(4, seed, tint);
      break;
    case 'crystal':
      v = s.kind === 'capsule' ? crystal(s.r, s.half, tint) : asteroid(4, seed, tint);
      break;
    case 'turbine':
      v = s.kind === 'torus' ? ringLook(s.R, s.r, tint, 0x9cf0ff, 6, false) : asteroid(4, seed, tint);
      break;
    case 'arch':
      v = s.kind === 'torus' ? arch(s.R, s.r) : asteroid(4, seed, tint);
      break;
    case 'hub':
      v = s.kind === 'capsule' ? hub(s.r, s.half, tint) : asteroid(4, seed, tint);
      break;
    case 'station':
      v = s.kind === 'torus' ? ringLook(s.R, s.r, tint, 0xffe48a, 10, false) : asteroid(4, seed, tint);
      break;
    case 'satellite':
      v = satellite(s.kind === 'sphere' ? s.r : 3);
      break;
    case 'gate':
      v = s.kind === 'torus' ? ringLook(s.R, s.r, tint, 0xffc36b, 7, true) : asteroid(4, seed, tint);
      break;
    case 'orb':
      v = orb(s.kind === 'sphere' ? s.r : 4, tint);
      break;
    case 'beam':
      v = s.kind === 'capsule' ? beam(s.r, s.half, tint) : asteroid(4, seed, tint);
      break;
    default:
      v = asteroid(s.kind === 'sphere' ? s.r : 4, seed, tint);
  }
  return withWaterfall(v, o, floorY);
}
