import * as THREE from 'three';
import { LEVELS, type ArenaSpec } from '../core/levels';
import type { LevelId } from '../core/types';
import type { World } from '../core/world';
import type { WallStyle } from './ribbon';
import {
  auroraMaterial,
  makeDome,
  makeGiant,
  makePlanet,
  makePlanetRing,
  shieldMaterial,
  type DomeOptions,
  type ShieldOptions,
} from './shaders';
import { cloudTexture, sharedTextures } from './textures';

/** Everything that makes a level look the way it does. */
export interface LevelEnv {
  readonly group: THREE.Group;
  readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  /** Glowing grid on the arena boundary, floor and ceiling. */
  readonly shield: THREE.Group;
  readonly shieldMats: THREE.ShaderMaterial[];
  /** Fits the shield to the current arena radius. */
  readonly shieldScale: (r: number) => void;
  readonly fog: THREE.Fog | null;
  readonly background: number;
  readonly wall: WallStyle;
  /** Wall colours: index 0 is the player. */
  readonly colors: number[];
  readonly hemi: [number, number, number];
  readonly sun: [number, number, THREE.Vector3];
  readonly ringColor: number;
  readonly boltColor: number;
  readonly boltGlow: number;
  update(world: World, time: number, dt: number, camera: THREE.Camera): void;
  /** Lightning flash, 0..1. */
  flash(v: number): void;
  dispose(): void;
}

type V3t = [number, number, number];

/** The recipe of one level's look. Every part is optional except sky, light and walls. */
interface Look {
  sky: DomeOptions;
  fog: [number, number, number] | null;
  background: number;
  wall: WallStyle;
  colors: number[];
  hemi: [number, number, number];
  sun: [number, number, V3t];
  shield: { color: number; line: number; fill: number; cells: [number, number] };
  ringColor?: number;
  bolt?: [number, number];
  clouds?: { y: number; height: number; count: number; spread: number; color: number; dark: number; opacity: number; seed: number };
  wisps?: { y: number; count: number; color: number; opacity: number };
  stormWall?: { inner: number; outer: number; y0: number; y1: number; color: number; edge: number; flash: number };
  stars?: { count: number; minY: number; size: number; color: number };
  sunSprite?: { dir: V3t; size: number; color: number };
  planet?: { radius: number; below: number; cap: number; sun: V3t; rim: number; day: number; kind: 0 | 1 };
  skyEarth?: { dir: V3t; radius: number };
  giant?: { dir: V3t; radius: number; c1: number; c2: number; ring: number; sun: V3t };
  aurora?: { low: number; high: number };
  debris?: { shape: 'ring' | 'disc'; inner: number; outer: number; y0: number; y1: number; count: number; color: number; size: number };
  nebula?: { dir: V3t; color: number; opacity: number; size: number }[];
  core?: { color: number; glow: number };
  particles?: { kind: 'snow' | 'streak' | 'motes' | 'updraft'; count: number; color: number; size: number };
}

const v = (a: V3t) => new THREE.Vector3(a[0], a[1], a[2]).normalize();
const SUN_ORBIT: V3t = [0.75, -0.1, -0.65];
const SUN_MOON: V3t = [0.8, 0.35, -0.5];
const SUN_RINGS: V3t = [-0.6, 0.4, 0.5];
const SUN_JET: V3t = [0.7, 0.25, 0.4];

const LOOKS: Record<LevelId, Look> = {
  'cloud-sea': {
    sky: { top: 0x0b1640, mid: 0x4a4aa0, hor: 0xff9a66, bot: 0x2a1533, sunDir: v([-0.6, 0.06, -0.8]), sunCol: 0xffc890 },
    fog: [0xe7896b, 170, 720],
    background: 0xe7896b,
    wall: { additive: false, core: 0.34, fogColor: 0xe7896b, fogFar: 520 },
    colors: [0x7af0ff, 0xff4f7b, 0xffe08a, 0xb48cff, 0x7dffb0, 0xff9a3d, 0x4aa8ff, 0xffffff],
    hemi: [0xffd2b0, 0x2a1a3a, 2.4],
    sun: [0xffd9b0, 2.6, [-0.6, 0.5, -0.8]],
    shield: { color: 0x7ff6ff, line: 0.34, fill: 0.025, cells: [48, 24] },
    ringColor: 0xffc36b,
    clouds: { y: -46, height: 9, count: 150, spread: 460, color: 0xffd2c2, dark: 0xc48aa0, opacity: 0.66, seed: 7 },
    wisps: { y: 85, count: 24, color: 0xb9a6ff, opacity: 0.22 },
  },
  'storm-eye': {
    sky: { top: 0x05071a, mid: 0x141133, hor: 0x3b3260, bot: 0x100c1f },
    fog: [0x1d1836, 150, 620],
    background: 0x1d1836,
    wall: { additive: true, core: 0.2, fogColor: 0x1d1836, fogFar: 460 },
    colors: [0x9ff3ff, 0xffcc4d, 0xc78bff, 0xff6f91, 0x7dffb0, 0xff9a3d, 0x6ad5ff, 0xffffff],
    hemi: [0x8f86c8, 0x120e22, 1.8],
    sun: [0xb8b0ff, 1.4, [0.2, 1, 0.1]],
    shield: { color: 0x8ff6ff, line: 0.55, fill: 0.035, cells: [36, 8] },
    bolt: [0xf3ecff, 0x9c84ff],
    stars: { count: 320, minY: 0.55, size: 1.5, color: 0xd8d0ff },
    stormWall: { inner: 118, outer: 183, y0: -70, y1: 100, color: 0x4b4470, edge: 0x7a6fa8, flash: 0xb7a8ff },
    clouds: { y: -78, height: 12, count: 80, spread: 180, color: 0x2c2648, dark: 0x2c2648, opacity: 0.9, seed: 31 },
    particles: { kind: 'updraft', count: 260, color: 0xcfc6ff, size: 0.9 },
  },
  'frost-heights': {
    sky: { top: 0x1550c8, mid: 0x5e9bf5, hor: 0xe8f4ff, bot: 0xc6dbf0, sunDir: v([0.4, 0.35, -0.8]), sunCol: 0xfff3d6 },
    fog: [0xdcebfb, 220, 820],
    background: 0xdcebfb,
    wall: { additive: false, core: 0.42, fogColor: 0xdcebfb, fogFar: 620 },
    colors: [0xff2d55, 0x7b2dff, 0xff8a00, 0x00a86b, 0x0050ff, 0xe5007a, 0x008fa6, 0x1a1a1a],
    hemi: [0xffffff, 0x9fb4d0, 2.6],
    sun: [0xffffff, 3.0, [0.4, 0.6, -0.8]],
    shield: { color: 0x2b55ff, line: 0.42, fill: 0.02, cells: [46, 23] },
    ringColor: 0xff8a00,
    clouds: { y: -45, height: 8, count: 170, spread: 480, color: 0xffffff, dark: 0xd2e2f4, opacity: 0.85, seed: 11 },
    wisps: { y: 70, count: 30, color: 0xffffff, opacity: 0.35 },
    particles: { kind: 'snow', count: 500, color: 0xffffff, size: 0.22 },
  },
  'jet-stream': {
    sky: {
      top: 0x020515,
      mid: 0x0b2a6b,
      hor: 0x78bdff,
      bot: 0x10203a,
      horY: -0.12,
      bandCol: 0x8fd0ff,
      bandY: -0.1,
      bandW: 16,
      sunDir: v(SUN_JET),
      sunCol: 0xfff0d0,
    },
    fog: [0x0b1a3a, 220, 900],
    background: 0x0b1a3a,
    wall: { additive: true, core: 0.2, fogColor: 0x0b1a3a, fogFar: 520 },
    colors: [0xffd23d, 0xff4f7b, 0x7af0ff, 0xb48cff, 0x7dffb0, 0xff9a3d, 0xffffff, 0x4aa8ff],
    hemi: [0x9fc0ff, 0x101830, 1.6],
    sun: [0xfff4e0, 2.4, SUN_JET],
    shield: { color: 0xffffff, line: 0.4, fill: 0.02, cells: [52, 7] },
    ringColor: 0xffd23d,
    stars: { count: 700, minY: 0.25, size: 1.3, color: 0xffffff },
    sunSprite: { dir: SUN_JET, size: 150, color: 0xfff4d8 },
    clouds: { y: -74, height: 8, count: 120, spread: 520, color: 0xcfe3ff, dark: 0x9fb8e0, opacity: 0.5, seed: 23 },
    particles: { kind: 'streak', count: 240, color: 0xdbeaff, size: 6 },
  },
  aurora: {
    sky: { top: 0x01020a, mid: 0x040a1c, hor: 0x0b1d40, bot: 0x000000, horY: -0.25, bandCol: 0x1f8f62, bandY: -0.235, bandW: 34 },
    fog: null,
    background: 0x02040c,
    wall: { additive: true, core: 0.18, fogColor: 0x02040c, fogFar: 420 },
    colors: [0xff6fd8, 0xffd23d, 0x7af0ff, 0xff9a3d, 0xb48cff, 0xffffff, 0x4aa8ff, 0xff4f7b],
    hemi: [0x6fe8c0, 0x05060f, 1.2],
    sun: [0x9fb8ff, 1.0, [0, 1, 0]],
    shield: { color: 0x7dffc8, line: 0.4, fill: 0.02, cells: [44, 6] },
    ringColor: 0x7dffb0,
    stars: { count: 1700, minY: -0.24, size: 1.6, color: 0xe2e8ff },
    planet: { radius: 2000, below: 35, cap: 0.42, sun: [0.3, -0.85, 0.4], rim: 0x2457b0, day: 0, kind: 0 },
    aurora: { low: 0x2bff9e, high: 0xa24dff },
  },
  orbit: {
    sky: {
      top: 0x000000,
      mid: 0x00010a,
      hor: 0x06102a,
      bot: 0x000000,
      horY: -0.43,
      sunDir: v(SUN_ORBIT),
      sunCol: 0xffdcae,
      bandCol: 0x3d8dff,
      bandY: -0.42,
      bandW: 24,
    },
    fog: null,
    background: 0x000000,
    wall: { additive: true, core: 0.2, fogColor: 0x000000, fogFar: 420 },
    colors: [0xff9a3d, 0x6ad5ff, 0xff4f7b, 0x7dffb0, 0xb48cff, 0xffe08a, 0xffffff, 0x4aa8ff],
    hemi: [0x8fb0ff, 0x05070f, 0.9],
    sun: [0xffe6c0, 3.2, SUN_ORBIT],
    shield: { color: 0xffb35c, line: 0.38, fill: 0.02, cells: [48, 24] },
    ringColor: 0xffd23d,
    stars: { count: 2200, minY: -0.42, size: 1.5, color: 0xffffff },
    sunSprite: { dir: SUN_ORBIT, size: 260, color: 0xfff1d6 },
    planet: { radius: 1200, below: 95, cap: 0.7, sun: SUN_ORBIT, rim: 0x4aa8ff, day: 1, kind: 0 },
    debris: { shape: 'ring', inner: 115, outer: 185, y0: -30, y1: 30, count: 220, color: 0x9aa0b2, size: 1 },
  },
  'moon-shadow': {
    sky: { top: 0x000000, mid: 0x000000, hor: 0x040406, bot: 0x000000, sunDir: v(SUN_MOON), sunCol: 0xffffff },
    fog: null,
    background: 0x000000,
    wall: { additive: true, core: 0.2, fogColor: 0x000000, fogFar: 420 },
    colors: [0x7af0ff, 0xff4f7b, 0xffe08a, 0xb48cff, 0x7dffb0, 0xff9a3d, 0xffffff, 0x4aa8ff],
    hemi: [0xffffff, 0x151515, 0.7],
    sun: [0xffffff, 3.6, SUN_MOON],
    shield: { color: 0xdfe6ff, line: 0.36, fill: 0.02, cells: [44, 22] },
    ringColor: 0xffffff,
    stars: { count: 2600, minY: -0.15, size: 1.4, color: 0xffffff },
    sunSprite: { dir: SUN_MOON, size: 170, color: 0xffffff },
    planet: { radius: 1500, below: 1, cap: 0.5, sun: SUN_MOON, rim: 0x222222, day: 1, kind: 1 },
    skyEarth: { dir: [-0.5, 0.32, -0.8], radius: 55 },
  },
  'ring-world': {
    sky: { top: 0x060312, mid: 0x120a24, hor: 0x2a1a3c, bot: 0x07040f, sunDir: v(SUN_RINGS), sunCol: 0xffe8c0 },
    fog: [0x120a24, 220, 950],
    background: 0x120a24,
    wall: { additive: true, core: 0.2, fogColor: 0x120a24, fogFar: 520 },
    colors: [0x7af0ff, 0xff4f7b, 0xffd23d, 0xb48cff, 0x7dffb0, 0xff9a3d, 0xffffff, 0x4aa8ff],
    hemi: [0xffe6c0, 0x100818, 1.4],
    sun: [0xfff0d0, 2.4, SUN_RINGS],
    shield: { color: 0xffd27a, line: 0.45, fill: 0.02, cells: [52, 6] },
    ringColor: 0x7af0ff,
    stars: { count: 1500, minY: -1, size: 1.4, color: 0xfff0d8 },
    sunSprite: { dir: SUN_RINGS, size: 120, color: 0xfff0d0 },
    giant: { dir: [0.35, 0.22, -1], radius: 380, c1: 0xe8c98a, c2: 0xa87c48, ring: 0xe6d2a8, sun: SUN_RINGS },
    debris: { shape: 'disc', inner: 20, outer: 460, y0: -52, y1: -40, count: 900, color: 0xd8ccb4, size: 0.9 },
  },
  nebula: {
    sky: { top: 0x0a0218, mid: 0x1a0638, hor: 0x3a0f4a, bot: 0x05010d },
    fog: [0x1a0638, 180, 700],
    background: 0x1a0638,
    wall: { additive: true, core: 0.22, fogColor: 0x1a0638, fogFar: 480 },
    colors: [0x7af0ff, 0xffd23d, 0x7dffb0, 0xff9a3d, 0xffffff, 0x4aa8ff, 0xb48cff, 0xff4f7b],
    hemi: [0xff9ad6, 0x10061c, 1.6],
    sun: [0xffd6f0, 1.6, [0.3, 0.8, 0.2]],
    shield: { color: 0xff6fd8, line: 0.45, fill: 0.025, cells: [48, 24] },
    bolt: [0xb8fbff, 0x2fd6ff],
    stars: { count: 1200, minY: -1, size: 1.5, color: 0xffe6ff },
    nebula: [
      { dir: [-0.5, 0.3, -0.8], color: 0xff3d9a, opacity: 0.45, size: 1400 },
      { dir: [0.7, -0.1, 0.5], color: 0x1fd6c8, opacity: 0.35, size: 1200 },
      { dir: [0.1, 0.85, 0.2], color: 0x6b3dff, opacity: 0.45, size: 1300 },
      { dir: [-0.8, -0.3, 0.3], color: 0xff8a3d, opacity: 0.3, size: 1000 },
    ],
    particles: { kind: 'motes', count: 600, color: 0xff9ad6, size: 0.8 },
  },
  'lattice-core': {
    sky: { top: 0x07030f, mid: 0x0b0520, hor: 0x170a30, bot: 0x07030f },
    fog: null,
    background: 0x07030f,
    wall: { additive: true, core: 0.18, fogColor: 0x07030f, fogFar: 340 },
    colors: [0xff3df2, 0x7cf7c9, 0xffd23d, 0x7af0ff, 0xff9a3d, 0xffffff, 0x4aa8ff, 0xff4f7b],
    hemi: [0xb09fff, 0x150828, 1.8],
    sun: [0xffffff, 1.6, [-0.6, 1, -0.8]],
    shield: { color: 0x9d6bff, line: 0.5, fill: 0.02, cells: [36, 18] },
    stars: { count: 900, minY: -1, size: 1.4, color: 0xd8c8ff },
    nebula: [
      { dir: [-0.5, 0.3, -0.8], color: 0x4a1f8f, opacity: 0.5, size: 1500 },
      { dir: [0.7, -0.2, 0.5], color: 0x135a68, opacity: 0.35, size: 1100 },
    ],
    core: { color: 0xffe6ff, glow: 0xff3df2 },
    particles: { kind: 'motes', count: 1200, color: 0xa07bff, size: 0.9 },
  },
};

function disposeTree(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    // Sprites share one geometry inside three.js, so it must stay alive.
    if (m.geometry && !(o as THREE.Sprite).isSprite) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

function starField(n: number, minY: number, size: number, color: number): THREE.Points {
  const pos = new Float32Array(n * 3);
  let i = 0;
  while (i < n) {
    const x = Math.random() * 2 - 1;
    const y = Math.random() * 2 - 1;
    const z = Math.random() * 2 - 1;
    const l = Math.hypot(x, y, z);
    if (l > 1 || l < 0.05 || y / l < minY) continue;
    pos[i * 3] = (x / l) * 1300;
    pos[i * 3 + 1] = (y / l) * 1300;
    pos[i * 3 + 2] = (z / l) * 1300;
    i++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    g,
    new THREE.PointsMaterial({ color, size, sizeAttenuation: false, map: sharedTextures().soft, transparent: true, depthWrite: false, fog: false }),
  );
}

function glowSprite(color: number, size: number, opacity = 1): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sharedTextures().glow,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  s.scale.set(size, size, 1);
  return s;
}

/** A flat round grid for floors and ceilings. Radius 1, scaled later. */
function shieldDisc(y: number, o: ShieldOptions): THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial> {
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 96), shieldMaterial(o));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.renderOrder = -5;
  return m;
}

function buildShield(a: ArenaSpec, s: Look['shield']): { group: THREE.Group; mats: THREE.ShaderMaterial[]; scale: (r: number) => void } {
  const group = new THREE.Group();
  const flat: ShieldOptions = { color: s.color, cells: [16, 16], line: s.line * 0.62, fill: s.fill * 0.5, floorY: -1e9 };
  if (a.kind === 'dome') {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(a.radius, 96, 48),
      shieldMaterial({ color: s.color, cells: s.cells, line: s.line, fill: s.fill, floorY: a.floorY }),
    );
    sphere.renderOrder = -5;
    const floor = shieldDisc(a.floorY, flat);
    group.add(sphere, floor);
    return {
      group,
      mats: [sphere.material, floor.material],
      scale: (r) => {
        sphere.scale.setScalar(r / a.radius);
        const fr = Math.sqrt(Math.max(1, r * r - a.floorY * a.floorY));
        floor.scale.set(fr, fr, 1);
      },
    };
  }
  const h = a.ceilY - a.floorY;
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(a.radius, a.radius, h, 96, 1, true),
    shieldMaterial({ color: s.color, cells: [s.cells[0], Math.max(4, Math.round(h / 14))], line: s.line, fill: s.fill, floorY: -1e9 }),
  );
  tube.position.y = (a.ceilY + a.floorY) / 2;
  tube.renderOrder = -5;
  const floor = shieldDisc(a.floorY, flat);
  const ceil = shieldDisc(a.ceilY, flat);
  group.add(tube, floor, ceil);
  return {
    group,
    mats: [tube.material, floor.material, ceil.material],
    scale: (r) => {
      tube.scale.set(r / a.radius, 1, r / a.radius);
      floor.scale.set(r, r, 1);
      ceil.scale.set(r, r, 1);
    },
  };
}

type Updater = (world: World, time: number, dt: number, camera: THREE.Camera) => void;

/** Keeps a point cloud in a box around the camera, so it never runs out. */
function wrapAround(pos: Float32Array, stride: number, c: THREE.Vector3, half: number): void {
  for (let o = 0; o < pos.length; o += stride) {
    for (let a = 0; a < 3; a++) {
      const cc = a === 0 ? c.x : a === 1 ? c.y : c.z;
      let x = pos[o + a];
      while (x - cc > half) x -= half * 2;
      while (x - cc < -half) x += half * 2;
      pos[o + a] = x;
    }
  }
}

function particles(look: Look, arena: ArenaSpec, updraftRadius: number, windX: number, group: THREE.Group, updaters: Updater[]): void {
  const pt = look.particles;
  if (!pt) return;
  const n = pt.count;
  if (pt.kind === 'streak') {
    // Wind lines rushing past.
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 120;
      const y = (Math.random() - 0.5) * 120;
      const z = (Math.random() - 0.5) * 120;
      pos.set([x, y, z, x + pt.size, y, z], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: pt.color, transparent: true, opacity: 0.45, depthWrite: false, fog: false }));
    lines.frustumCulled = false;
    group.add(lines);
    updaters.push((_w, _t, dt, cam) => {
      for (let o = 0; o < pos.length; o += 6) pos[o] += dt * windX * 14;
      wrapAround(pos, 6, cam.position, 60);
      for (let o = 0; o < pos.length; o += 6) {
        pos[o + 3] = pos[o] + pt.size;
        pos[o + 4] = pos[o + 1];
        pos[o + 5] = pos[o + 2];
      }
      attr.needsUpdate = true;
    });
    return;
  }
  const pos = new Float32Array(n * 3);
  const R = arena.radius;
  for (let i = 0; i < n; i++) {
    if (pt.kind === 'motes') {
      let x = 0;
      let y = 0;
      let z = 0;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
      } while (x * x + y * y + z * z > 1);
      pos.set([x * R, Math.max(arena.floorY + 2, y * R), z * R], i * 3);
    } else if (pt.kind === 'updraft') {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * updraftRadius;
      pos.set([Math.cos(a) * r, arena.floorY + Math.random() * (Math.min(arena.ceilY, 80) - arena.floorY), Math.sin(a) * r], i * 3);
    } else {
      pos.set([(Math.random() - 0.5) * 90, (Math.random() - 0.5) * 90, (Math.random() - 0.5) * 90], i * 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  const snow = pt.kind === 'snow';
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: pt.color,
      size: pt.size,
      map: sharedTextures().soft,
      transparent: true,
      opacity: snow ? 0.9 : 0.75,
      depthWrite: false,
      blending: snow ? THREE.NormalBlending : THREE.AdditiveBlending,
    }),
  );
  points.frustumCulled = false;
  const holder = new THREE.Group();
  holder.add(points);
  group.add(holder);
  if (pt.kind === 'motes') {
    updaters.push((_w, _t, dt) => {
      holder.rotation.y += dt * 0.02;
    });
  } else if (pt.kind === 'updraft') {
    const top = Math.min(arena.ceilY, 80);
    updaters.push((_w, _t, dt) => {
      for (let o = 1; o < pos.length; o += 3) {
        let y = pos[o] + dt * 16;
        if (y > top) y -= top - arena.floorY;
        pos[o] = y;
      }
      attr.needsUpdate = true;
    });
  } else {
    // Snow: falling ice crystals around the camera.
    updaters.push((_w, t, dt, cam) => {
      for (let o = 0, i = 0; o < pos.length; o += 3, i++) {
        pos[o] += Math.sin(t * 0.7 + i) * dt * 1.5;
        pos[o + 1] -= dt * 3;
      }
      wrapAround(pos, 3, cam.position, 45);
      attr.needsUpdate = true;
    });
  }
}

/** Builds a level's scenery from its recipe. */
export function createLevelEnv(id: LevelId): LevelEnv {
  const look = LOOKS[id];
  const spec = LEVELS[id];
  const arena = spec.arena;
  const group = new THREE.Group();
  const textures: THREE.Texture[] = [];
  const updaters: Updater[] = [];
  const flashers: ((x: number) => void)[] = [];

  // Sky: everything attached to the dome follows the camera and stays "infinitely" far away.
  const dome = makeDome(look.sky);
  group.add(dome);
  flashers.push((x) => {
    dome.material.uniforms.flash.value = x * 0.3;
  });
  if (look.stars) dome.add(starField(look.stars.count, look.stars.minY, look.stars.size, look.stars.color));
  if (look.sunSprite) {
    const s = glowSprite(look.sunSprite.color, look.sunSprite.size);
    s.position.copy(v(look.sunSprite.dir)).multiplyScalar(1300);
    dome.add(s);
  }
  for (const n of look.nebula ?? []) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sharedTextures().soft,
        color: n.color,
        transparent: true,
        opacity: n.opacity,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    s.position.copy(v(n.dir)).multiplyScalar(1250);
    s.scale.set(n.size, n.size * 0.7, 1);
    dome.add(s);
  }
  if (look.skyEarth) {
    const e = makePlanet(look.skyEarth.radius, Math.PI, v(look.sun[2]), 0x4aa8ff, 1, 0);
    e.position.copy(v(look.skyEarth.dir)).multiplyScalar(1100);
    const halo = glowSprite(0x4aa8ff, look.skyEarth.radius * 3.2, 0.35);
    halo.position.copy(e.position);
    dome.add(e, halo);
  }
  if (look.giant) {
    const gi = look.giant;
    const pos = v(gi.dir).multiplyScalar(1300);
    const planet = makeGiant(gi.radius, v(gi.sun), gi.c1, gi.c2);
    planet.position.copy(pos);
    planet.rotation.z = 0.35;
    const ring = makePlanetRing(gi.radius * 1.25, gi.radius * 2.0, gi.ring);
    ring.position.copy(pos);
    ring.rotation.set(-Math.PI / 2 + 0.3, 0, 0.35);
    dome.add(planet, ring);
  }

  if (look.planet) {
    const p = look.planet;
    const planet = makePlanet(p.radius, p.cap, v(p.sun), p.rim, p.day, p.kind);
    planet.position.y = arena.floorY - p.below - p.radius;
    group.add(planet);
    updaters.push((_w, _t, dt) => {
      planet.rotation.y += dt * 0.004;
    });
  }

  if (look.clouds) {
    const c = look.clouds;
    const tex = cloudTexture(c.seed);
    textures.push(tex);
    const light = new THREE.SpriteMaterial({ map: tex, color: c.color, transparent: true, opacity: c.opacity, depthWrite: false });
    const dark = new THREE.SpriteMaterial({ map: tex, color: c.dark, transparent: true, opacity: Math.min(1, c.opacity + 0.14), depthWrite: false });
    for (let i = 0; i < c.count; i++) {
      const s = new THREE.Sprite(i % 3 === 0 ? dark : light);
      const r = 20 + Math.sqrt(Math.random()) * c.spread;
      const a = Math.random() * Math.PI * 2;
      s.position.set(Math.cos(a) * r, c.y + Math.random() * c.height, Math.sin(a) * r);
      const sc = 70 + Math.random() * 120;
      s.scale.set(sc, sc * 0.42, 1);
      group.add(s);
    }
  }
  if (look.wisps) {
    const w = look.wisps;
    const tex = cloudTexture(19);
    textures.push(tex);
    const mat = new THREE.SpriteMaterial({ map: tex, color: w.color, transparent: true, opacity: w.opacity, depthWrite: false });
    for (let i = 0; i < w.count; i++) {
      const s = new THREE.Sprite(mat);
      const r = 120 + Math.random() * 400;
      const a = Math.random() * Math.PI * 2;
      s.position.set(Math.cos(a) * r, w.y + Math.random() * 40, Math.sin(a) * r);
      const sc = 90 + Math.random() * 140;
      s.scale.set(sc, sc * 0.35, 1);
      group.add(s);
    }
  }
  if (look.stormWall) {
    const sw = look.stormWall;
    const tex = cloudTexture(31);
    textures.push(tex);
    const base = new THREE.Color(sw.color);
    const flashC = new THREE.Color(sw.flash);
    const wallMat = new THREE.SpriteMaterial({ map: tex, color: sw.color, transparent: true, opacity: 0.92, depthWrite: false });
    const edgeMat = new THREE.SpriteMaterial({ map: tex, color: sw.edge, transparent: true, opacity: 0.5, depthWrite: false });
    const storm = new THREE.Group();
    for (let i = 0; i < 300; i++) {
      const s = new THREE.Sprite(wallMat);
      const a = Math.random() * Math.PI * 2;
      const r = sw.inner + Math.random() * (sw.outer - sw.inner);
      s.position.set(Math.cos(a) * r, sw.y0 + Math.random() * (sw.y1 - sw.y0), Math.sin(a) * r);
      const sc = 60 + Math.random() * 80;
      s.scale.set(sc, sc * 0.6, 1);
      storm.add(s);
    }
    for (let i = 0; i < 70; i++) {
      const s = new THREE.Sprite(edgeMat);
      const a = Math.random() * Math.PI * 2;
      const r = sw.inner - 10 + Math.random() * 12;
      s.position.set(Math.cos(a) * r, sw.y0 + 15 + Math.random() * (sw.y1 - sw.y0 - 30), Math.sin(a) * r);
      const sc = 30 + Math.random() * 40;
      s.scale.set(sc, sc * 0.7, 1);
      storm.add(s);
    }
    group.add(storm);
    updaters.push((_w, _t, dt) => {
      storm.rotation.y += dt * 0.03;
    });
    flashers.push((x) => {
      wallMat.color.copy(base).lerp(flashC, x * 0.6);
    });
  }
  if (look.aurora) {
    const mat = auroraMaterial(look.aurora.low, look.aurora.high);
    const curtains: V3t[] = [
      [0, -60, 0.2],
      [50, 45, -0.5],
      [-75, 5, 1.2],
      [10, 115, 0.1],
    ];
    curtains.forEach((c, i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(420, 95, 160, 1), mat);
      m.position.set(c[0], 20 + i * 5, c[1]);
      m.rotation.y = c[2];
      m.frustumCulled = false;
      group.add(m);
    });
    updaters.push((_w, _t, dt) => {
      mat.uniforms.uTime.value += dt;
    });
  }
  if (look.debris) {
    const d = look.debris;
    const rocks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: d.color, metalness: 0.4, roughness: 0.6, flatShading: true }),
      d.count,
    );
    const o = new THREE.Object3D();
    for (let i = 0; i < d.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = d.shape === 'disc' ? d.inner + Math.sqrt(Math.random()) * (d.outer - d.inner) : d.inner + Math.random() * (d.outer - d.inner);
      o.position.set(Math.cos(a) * r, d.y0 + Math.random() * (d.y1 - d.y0), Math.sin(a) * r);
      o.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      const s = d.size * (0.5 + Math.random() * 2.2);
      o.scale.set(s, s * (0.5 + Math.random()), s * (0.6 + Math.random()));
      o.updateMatrix();
      rocks.setMatrixAt(i, o.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    const holder = new THREE.Group();
    holder.add(rocks);
    group.add(holder);
    updaters.push((_w, _t, dt) => {
      holder.rotation.y += dt * (d.shape === 'disc' ? 0.006 : 0.012);
    });
  }
  if (look.core && spec.core) {
    const cr = spec.core.radius;
    const core = new THREE.Mesh(new THREE.SphereGeometry(cr, 32, 16), new THREE.MeshBasicMaterial({ color: look.core.color }));
    const glow = glowSprite(look.core.glow, cr * 9);
    const ringMat = new THREE.MeshBasicMaterial({
      color: look.core.glow,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(cr * 2.2, 0.2, 8, 96), ringMat);
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(cr * 3.3, 0.2, 8, 96), ringMat);
    group.add(core, glow, r1, r2);
    updaters.push((w) => {
      const t = w.tick / 60;
      const pulse = 1 + Math.sin(t * 2.4) * 0.12;
      core.scale.setScalar(pulse);
      glow.scale.set(cr * 9 * pulse, cr * 9 * pulse, 1);
      r1.rotation.set(t * 0.3, t * 0.5, 0);
      r2.rotation.set(-t * 0.2, 0, t * 0.35);
    });
  }
  particles(look, arena, spec.updraft?.radius ?? 18, spec.wind?.x ?? 5, group, updaters);

  const shield = buildShield(arena, look.shield);
  group.add(shield.group);

  return {
    group,
    dome,
    shield: shield.group,
    shieldMats: shield.mats,
    shieldScale: shield.scale,
    fog: look.fog ? new THREE.Fog(look.fog[0], look.fog[1], look.fog[2]) : null,
    background: look.background,
    wall: look.wall,
    colors: look.colors,
    hemi: look.hemi,
    sun: [look.sun[0], look.sun[1], new THREE.Vector3(look.sun[2][0], look.sun[2][1], look.sun[2][2])],
    ringColor: look.ringColor ?? 0xffc36b,
    boltColor: look.bolt?.[0] ?? 0xf3ecff,
    boltGlow: look.bolt?.[1] ?? 0x9c84ff,
    update(world, time, dt, camera) {
      for (const u of updaters) u(world, time, dt, camera);
    },
    flash(x) {
      for (const f of flashers) f(x);
    },
    dispose() {
      for (const t of textures) t.dispose();
      disposeTree(group);
    },
  };
}
