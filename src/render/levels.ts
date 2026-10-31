import * as THREE from 'three';
import type { LevelId } from '../core/types';
import type { World } from '../core/world';
import { latticeMaterial, makeDome } from './shaders';
import type { WallStyle } from './ribbon';
import { cloudTexture, sharedTextures } from './textures';

/** Everything that makes a level look the way it does. */
export interface LevelEnv {
  readonly group: THREE.Group;
  readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly lattice: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Scales the lattice to the current arena radius. */
  readonly latticeScale: (r: number) => void;
  readonly fog: THREE.Fog | null;
  readonly background: number;
  readonly wall: WallStyle;
  /** Wall colours: index 0 is the player. */
  readonly colors: number[];
  readonly hemi: [number, number, number];
  readonly sun: [number, number, THREE.Vector3];
  update(world: World, time: number, dt: number): void;
  /** Lightning flash, 0..1. */
  flash(v: number): void;
  dispose(): void;
}

function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    // Sprites share one geometry inside three.js, so it must stay alive.
    if (m.geometry && !(o as THREE.Sprite).isSprite) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

function cylinderLattice(R: number, y0: number, y1: number, ringStep: number, verts: number): THREE.BufferGeometry {
  const pts: number[] = [];
  const TAU = Math.PI * 2;
  for (let y = y0; y <= y1 + 0.01; y += ringStep) {
    for (let i = 0; i < 96; i++) {
      const a0 = (i / 96) * TAU;
      const a1 = ((i + 1) / 96) * TAU;
      pts.push(R * Math.cos(a0), y, R * Math.sin(a0), R * Math.cos(a1), y, R * Math.sin(a1));
    }
  }
  for (let j = 0; j < verts; j++) {
    const a = (j / verts) * TAU;
    pts.push(R * Math.cos(a), y0, R * Math.sin(a), R * Math.cos(a), y1, R * Math.sin(a));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function stars(n: number, minY: number, size: number, color: number): THREE.Points {
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
    new THREE.PointsMaterial({ color, size, sizeAttenuation: false, map: sharedTextures().soft, transparent: true, depthWrite: false }),
  );
}

/** Level 1: sunset over a sea of clouds. */
function cloudSea(): LevelEnv {
  const group = new THREE.Group();
  const dome = makeDome({
    top: 0x0b1640,
    mid: 0x4a4aa0,
    hor: 0xff9a66,
    bot: 0x2a1533,
    sunDir: new THREE.Vector3(-0.6, 0.06, -0.8),
    sunCol: 0xffc890,
  });
  group.add(dome);

  const seaTex = cloudTexture(7);
  const sea = new THREE.SpriteMaterial({ map: seaTex, color: 0xffd2c2, transparent: true, opacity: 0.66, depthWrite: false });
  const seaDark = new THREE.SpriteMaterial({ map: seaTex, color: 0xc48aa0, transparent: true, opacity: 0.8, depthWrite: false });
  const wispTex = cloudTexture(19);
  const wisp = new THREE.SpriteMaterial({ map: wispTex, color: 0xb9a6ff, transparent: true, opacity: 0.22, depthWrite: false });
  for (let i = 0; i < 150; i++) {
    const s = new THREE.Sprite(i % 3 === 0 ? seaDark : sea);
    const r = 20 + Math.sqrt(Math.random()) * 460;
    const a = Math.random() * Math.PI * 2;
    s.position.set(Math.cos(a) * r, -46 + Math.random() * 9, Math.sin(a) * r);
    const sc = 70 + Math.random() * 120;
    s.scale.set(sc, sc * 0.42, 1);
    group.add(s);
  }
  for (let i = 0; i < 24; i++) {
    const s = new THREE.Sprite(wisp);
    const r = 120 + Math.random() * 400;
    const a = Math.random() * Math.PI * 2;
    s.position.set(Math.cos(a) * r, 85 + Math.random() * 40, Math.sin(a) * r);
    const sc = 90 + Math.random() * 140;
    s.scale.set(sc, sc * 0.35, 1);
    group.add(s);
  }

  const lattice = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(110, 3), 1),
    latticeMaterial(0xffc79a, 0.06, 40),
  );
  group.add(lattice);

  return {
    group,
    dome,
    lattice,
    latticeScale: (r) => lattice.scale.setScalar(r / 110),
    fog: new THREE.Fog(0xe7896b, 170, 720),
    background: 0xe7896b,
    wall: { additive: false, core: 0.34, fogColor: 0xe7896b, fogFar: 520 },
    colors: [0x7af0ff, 0xff4f7b, 0xffe08a, 0xb48cff, 0x7dffb0, 0xff9a3d, 0x4aa8ff, 0xffffff],
    hemi: [0xffd2b0, 0x2a1a3a, 2.4],
    sun: [0xffd9b0, 2.6, new THREE.Vector3(-0.6, 0.5, -0.8)],
    update() {},
    flash() {},
    dispose() {
      seaTex.dispose();
      wispTex.dispose();
      disposeGroup(group);
    },
  };
}

/** Level 2: the calm eye of a storm, a turning wall of clouds and lightning. */
function stormEye(): LevelEnv {
  const group = new THREE.Group();
  const dome = makeDome({ top: 0x05071a, mid: 0x141133, hor: 0x3b3260, bot: 0x100c1f });
  dome.add(stars(320, 0.55, 1.5, 0xd8d0ff));
  group.add(dome);

  const stormTex = cloudTexture(31);
  const base = new THREE.Color(0x4b4470);
  const flashC = new THREE.Color(0xb7a8ff);
  const wallMat = new THREE.SpriteMaterial({ map: stormTex, color: 0x4b4470, transparent: true, opacity: 0.92, depthWrite: false });
  const edgeMat = new THREE.SpriteMaterial({ map: stormTex, color: 0x7a6fa8, transparent: true, opacity: 0.5, depthWrite: false });
  const floorMat = new THREE.SpriteMaterial({ map: stormTex, color: 0x2c2648, transparent: true, opacity: 0.9, depthWrite: false });
  const storm = new THREE.Group();
  for (let i = 0; i < 300; i++) {
    const s = new THREE.Sprite(wallMat);
    const a = Math.random() * Math.PI * 2;
    const r = 118 + Math.random() * 65;
    s.position.set(Math.cos(a) * r, -70 + Math.random() * 170, Math.sin(a) * r);
    const sc = 60 + Math.random() * 80;
    s.scale.set(sc, sc * 0.6, 1);
    storm.add(s);
  }
  for (let i = 0; i < 70; i++) {
    const s = new THREE.Sprite(edgeMat);
    const a = Math.random() * Math.PI * 2;
    const r = 108 + Math.random() * 12;
    s.position.set(Math.cos(a) * r, -55 + Math.random() * 140, Math.sin(a) * r);
    const sc = 30 + Math.random() * 40;
    s.scale.set(sc, sc * 0.7, 1);
    storm.add(s);
  }
  group.add(storm);
  for (let i = 0; i < 80; i++) {
    const s = new THREE.Sprite(floorMat);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 180;
    s.position.set(Math.cos(a) * r, -66 - Math.random() * 12, Math.sin(a) * r);
    const sc = 60 + Math.random() * 70;
    s.scale.set(sc, sc * 0.4, 1);
    group.add(s);
  }

  const lattice = new THREE.LineSegments(cylinderLattice(100, -55, 70, 25, 40), latticeMaterial(0xb8a8ff, 0.07, 40));
  group.add(lattice);

  // Rising air in the middle.
  const UPN = 260;
  const up = new Float32Array(UPN * 3);
  for (let i = 0; i < UPN; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 18;
    up[i * 3] = Math.cos(a) * r;
    up[i * 3 + 1] = -55 + Math.random() * 125;
    up[i * 3 + 2] = Math.sin(a) * r;
  }
  const upGeo = new THREE.BufferGeometry();
  const upAttr = new THREE.BufferAttribute(up, 3).setUsage(THREE.DynamicDrawUsage);
  upGeo.setAttribute('position', upAttr);
  const updraft = new THREE.Points(
    upGeo,
    new THREE.PointsMaterial({
      color: 0xcfc6ff,
      size: 0.9,
      map: sharedTextures().soft,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  updraft.frustumCulled = false;
  group.add(updraft);

  return {
    group,
    dome,
    lattice,
    latticeScale: (r) => lattice.scale.set(r / 100, 1, r / 100),
    fog: new THREE.Fog(0x1d1836, 150, 620),
    background: 0x1d1836,
    wall: { additive: true, core: 0.2, fogColor: 0x1d1836, fogFar: 460 },
    colors: [0x9ff3ff, 0xffcc4d, 0xc78bff, 0xff6f91, 0x7dffb0, 0xff9a3d, 0x6ad5ff, 0xffffff],
    hemi: [0x8f86c8, 0x120e22, 1.8],
    sun: [0xb8b0ff, 1.4, new THREE.Vector3(0.2, 1, 0.1)],
    update(_world, _time, dt) {
      storm.rotation.y += dt * 0.03;
      for (let i = 0; i < UPN; i++) {
        let y = up[i * 3 + 1] + dt * 16;
        if (y > 70) y -= 125;
        up[i * 3 + 1] = y;
      }
      upAttr.needsUpdate = true;
    },
    flash(v) {
      dome.material.uniforms.flash.value = v * 0.3;
      wallMat.color.copy(base).lerp(flashC, v * 0.6);
    },
    dispose() {
      stormTex.dispose();
      disposeGroup(group);
    },
  };
}

export function createLevelEnv(id: LevelId): LevelEnv {
  return id === 'storm-eye' ? stormEye() : cloudSea();
}
