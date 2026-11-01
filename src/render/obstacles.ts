import * as THREE from 'three';
import type { Obstacle } from '../core/obstacles';
import { sharedTextures } from './textures';

/**
 * How the obstacles look. Every look is built inside its collision shape (or
 * just a little outside it), so what you see is what can hit you.
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

function island(r: number, seed: number): ObstacleView {
  const g = new THREE.Group();
  const base = rock(r, 0x8a6f5a, seed);
  base.scale.set(1, 0.85, 1);
  const grass = new THREE.Mesh(new THREE.SphereGeometry(r * 0.98, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.32), std(0x6fcf6a));
  grass.position.y = r * 0.06;
  g.add(base, grass);
  for (let k = 0; k < 3; k++) {
    const tree = new THREE.Mesh(new THREE.ConeGeometry(r * 0.13, r * 0.42, 5), std(0x2f8f4e));
    const a = k * 2.1 + seed;
    tree.position.set(Math.cos(a) * r * 0.35, r * 0.88, Math.sin(a) * r * 0.35);
    g.add(tree);
  }
  // A waterfall pouring off the edge.
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.35, r * 2.2), glowMat(0xbfe9ff, 0.55));
  fall.position.set(r * 0.92, -r * 0.6, 0);
  fall.rotation.y = Math.PI / 2;
  g.add(fall);
  return view(g, (_o, t) => {
    g.rotation.y = t * 0.05 + seed;
    (fall.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.12 * Math.sin(t * 6 + seed);
  });
}

function whale(r: number, half: number): ObstacleView {
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
    9,
  );
  body.rotateX(Math.PI / 2);
  body.scale(1, 0.82, 1);
  const skin = std(0x5d7fa6, { roughness: 0.6 });
  g.add(new THREE.Mesh(body, skin));
  const belly = new THREE.Mesh(new THREE.SphereGeometry(r * 0.8, 9, 6, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), std(0xdfe8f0));
  belly.scale.set(1, 0.7, (len * 0.9) / r);
  belly.position.set(0, -r * 0.05, len * 0.1);
  g.add(belly);
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
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.09, 6, 4), std(0x111111));
    eye.position.set(s * r * 0.62, r * 0.05, len * 0.62);
    g.add(eye);
  }
  return view(g, (o, t) => {
    tm.lookAt(new THREE.Vector3(0, 0, 0), tv.set(-o.a.x, -o.a.y, -o.a.z), Y);
    g.quaternion.setFromRotationMatrix(tm);
    g.rotateZ(Math.sin(t * 0.8) * 0.08);
    fluke.rotation.y = Math.sin(t * 1.6) * 0.35;
  });
}

function spire(r: number, half: number): ObstacleView {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, half * 2, 6), std(0x2b2d3a, { metalness: 0.6, roughness: 0.35 }));
  g.add(pole);
  for (let k = -2; k <= 2; k++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.95, 0.18, 4, 12), glowMat(0x9cf0ff));
    band.rotation.x = Math.PI / 2;
    band.position.y = (k * half) / 2.6;
    g.add(band);
  }
  const top = new THREE.Mesh(new THREE.SphereGeometry(r * 0.9, 10, 8), glowMat(0xd7f6ff));
  top.position.y = half;
  const halo = glowSprite(0x8fe4ff, r * 7);
  halo.position.y = half;
  g.add(top, halo);
  return view(g, (o, t) => {
    alignY(g, o);
    halo.material.opacity = 0.5 + 0.4 * Math.abs(Math.sin(t * 9 + o.c.x));
  });
}

function crystal(r: number, half: number): ObstacleView {
  const g = new THREE.Group();
  const ice = std(0xbfefff, { transparent: true, opacity: 0.78, emissive: 0x2a6f8f, roughness: 0.15, metalness: 0.2 });
  const prism = new THREE.Mesh(new THREE.CylinderGeometry(r, r, half * 2 - r * 0.4, 6), ice);
  const tipA = new THREE.Mesh(new THREE.ConeGeometry(r, r * 2.2, 6), ice);
  tipA.position.y = half + r * 0.9;
  tipA.scale.set(1, 0.85, 1);
  const tipB = tipA.clone();
  tipB.position.y = -tipA.position.y;
  tipB.rotation.x = Math.PI;
  const core = glowSprite(0x7fe8ff, r * 5, 0.6);
  g.add(prism, tipA, tipB, core);
  return view(g, (o, t) => {
    alignY(g, o);
    core.material.opacity = 0.45 + 0.2 * Math.sin(t * 2 + o.c.z);
  });
}

function ringLook(R: number, r: number, body: number, light: number, markers: number): ObstacleView {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.TorusGeometry(R, r, 8, 64), std(body, { metalness: 0.55, roughness: 0.35 }));
  tube.rotation.x = Math.PI / 2;
  const glow = new THREE.Mesh(new THREE.TorusGeometry(R - r * 0.9, r * 0.22, 4, 64), glowMat(light));
  glow.rotation.x = Math.PI / 2;
  g.add(tube, glow);
  const spinner = new THREE.Group();
  for (let k = 0; k < markers; k++) {
    const a = (k / markers) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(r * 1.3, r * 1.3, r * 2.4), glowMat(light));
    m.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
    m.rotation.y = -a;
    spinner.add(m);
  }
  g.add(spinner);
  return view(g, (o, t) => {
    alignY(g, o);
    spinner.rotation.y = t * 0.6;
  });
}

function arch(R: number, r: number): ObstacleView {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.TorusGeometry(R, r, 8, 80), glowMat(0x6dffcf, 0.85));
  tube.rotation.x = Math.PI / 2;
  const core = new THREE.Mesh(new THREE.TorusGeometry(R, r * 0.35, 6, 80), glowMat(0xffffff));
  core.rotation.x = Math.PI / 2;
  g.add(tube, core);
  return view(g, (o, t) => {
    alignY(g, o);
    (tube.material as THREE.MeshBasicMaterial).color.setHSL(0.42 + 0.12 * Math.sin(t * 0.4 + o.a.x * 2), 1, 0.6);
  });
}

function hub(r: number, half: number): ObstacleView {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, half * 2, 12), std(0xd9dde6, { metalness: 0.5, roughness: 0.4 }));
  const capA = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), std(0xd9dde6, { metalness: 0.5 }));
  capA.position.y = half;
  const capB = capA.clone();
  capB.rotation.x = Math.PI;
  capB.position.y = -half;
  g.add(body, capA, capB);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, half * 1.2, 0.1), glowMat(0xffe48a));
    win.position.set(Math.cos(a) * r * 1.0, 0, Math.sin(a) * r * 1.0);
    win.rotation.y = -a + Math.PI / 2;
    g.add(win);
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
    const panel = new THREE.Mesh(new THREE.BoxGeometry(r * 0.55, 0.08, r * 0.7), std(0x2747a8, { metalness: 0.4, emissive: 0x0a1540 }));
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

function asteroid(r: number, seed: number): ObstacleView {
  const g = new THREE.Group();
  g.add(rock(r, 0x6f6a66, seed));
  return view(g, (_o, t) => {
    g.rotation.set(t * 0.13 + seed, t * 0.21, 0);
  });
}

function orb(r: number): ObstacleView {
  const g = new THREE.Group();
  const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.75, 2), glowMat(0xffffff));
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), glowMat(0xff3df2, 0.45));
  const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 1.02, 1), new THREE.MeshBasicMaterial({ color: 0xffb0f6, wireframe: true, transparent: true, opacity: 0.6, fog: false }));
  const halo = glowSprite(0xff5cf0, r * 6, 0.7);
  g.add(inner, shell, wire, halo);
  return view(g, (_o, t) => {
    shell.rotation.set(t * 0.7, t * 0.5, 0);
    wire.rotation.set(-t * 0.4, t * 0.9, 0);
    const p = 1 + 0.06 * Math.sin(t * 5);
    inner.scale.setScalar(p);
  });
}

function beam(r: number, half: number): ObstacleView {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, half * 2, r * 1.2), std(0x1c1030, { metalness: 0.6, emissive: 0x2a0d40 }));
  g.add(core);
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

/** The model for an obstacle. */
export function makeObstacleView(o: Obstacle, index: number): ObstacleView {
  const s = o.def.shape;
  const seed = 1 + index * 7;
  switch (o.def.look) {
    case 'island':
      return island(s.kind === 'sphere' ? s.r : 6, seed);
    case 'whale':
      return s.kind === 'capsule' ? whale(s.r, s.half) : asteroid(6, seed);
    case 'spire':
      return s.kind === 'capsule' ? spire(s.r, s.half) : asteroid(4, seed);
    case 'crystal':
      return s.kind === 'capsule' ? crystal(s.r, s.half) : asteroid(4, seed);
    case 'turbine':
      return s.kind === 'torus' ? ringLook(s.R, s.r, 0x8d97a8, 0x9cf0ff, 6) : asteroid(4, seed);
    case 'arch':
      return s.kind === 'torus' ? arch(s.R, s.r) : asteroid(4, seed);
    case 'hub':
      return s.kind === 'capsule' ? hub(s.r, s.half) : asteroid(4, seed);
    case 'station':
      return s.kind === 'torus' ? ringLook(s.R, s.r, 0xd9dde6, 0xffe48a, 10) : asteroid(4, seed);
    case 'satellite':
      return satellite(s.kind === 'sphere' ? s.r : 3);
    case 'gate':
      return s.kind === 'torus' ? ringLook(s.R, s.r, 0x3a2f5c, 0xffc36b, 9) : asteroid(4, seed);
    case 'orb':
      return orb(s.kind === 'sphere' ? s.r : 4);
    case 'beam':
      return s.kind === 'capsule' ? beam(s.r, s.half) : asteroid(4, seed);
    default:
      return asteroid(s.kind === 'sphere' ? s.r : 4, seed);
  }
}
