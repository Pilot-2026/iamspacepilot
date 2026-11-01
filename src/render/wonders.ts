import * as THREE from 'three';
import { sharedTextures } from './textures';

/**
 * Wonders: the strange and wonderful things you see beyond the arena shield.
 * Pure decoration, far away, always moving: balloons, whales, a storm eye,
 * a snow globe, zeppelins, jellyfish of light, a cube planet, a disco moon,
 * a donut planet, a black hole, a tesseract and wandering planets.
 */

export type WonderKind =
  | 'balloons'
  | 'skywhales'
  | 'spacewhales'
  | 'debris'
  | 'eye'
  | 'snowglobe'
  | 'zeppelins'
  | 'paperplanes'
  | 'jellyfish'
  | 'cubeplanet'
  | 'astronaut'
  | 'discomoon'
  | 'donut'
  | 'train'
  | 'blackhole'
  | 'tesseract'
  | 'tetris'
  | 'planets';

export interface Wonder {
  readonly group: THREE.Group;
  update(time: number, dt: number, camera: THREE.Camera): void;
}

const std = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, metalness: 0.1, fog: false, ...extra });
const basic = (color: number, extra: Partial<THREE.MeshBasicMaterialParameters> = {}) => new THREE.MeshBasicMaterial({ color, fog: false, ...extra });
const glow = (color: number, size: number, opacity = 0.8) => {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: sharedTextures().glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  s.scale.setScalar(size);
  return s;
};

function rnd(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Planet surface painted on a canvas. */
function planetTexture(kind: 'gas' | 'lava' | 'ice' | 'candy' | 'toxic' | 'earth', seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  const r = rnd(seed);
  const band = (cols: string[], n: number) => {
    for (let i = 0; i < n; i++) {
      x.fillStyle = cols[i % cols.length];
      const y = (i / n) * 128 + (r() - 0.5) * 6;
      x.fillRect(0, y, 256, 128 / n + 4);
    }
  };
  if (kind === 'gas') band(['#e8b77a', '#c98a52', '#f3d9a7', '#a8633a', '#ddb07c'], 14);
  else if (kind === 'candy') band(['#ff7eb6', '#fff4f9', '#7ee0ff', '#fff4f9'], 16);
  else if (kind === 'toxic') band(['#7dff6a', '#2a8f3a', '#c6ff4f', '#1e5f2f'], 10);
  else if (kind === 'ice') {
    x.fillStyle = '#dff4ff';
    x.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 40; i++) {
      x.fillStyle = `rgba(110,170,220,${0.2 + r() * 0.3})`;
      x.fillRect(r() * 256, r() * 128, 20 + r() * 60, 2 + r() * 5);
    }
  } else if (kind === 'lava') {
    x.fillStyle = '#1d0f0c';
    x.fillRect(0, 0, 256, 128);
    x.strokeStyle = '#ff6a1a';
    x.lineWidth = 2;
    for (let i = 0; i < 30; i++) {
      x.beginPath();
      let px = r() * 256;
      let py = r() * 128;
      x.moveTo(px, py);
      for (let k = 0; k < 5; k++) {
        px += (r() - 0.5) * 40;
        py += (r() - 0.5) * 20;
        x.lineTo(px, py);
      }
      x.stroke();
    }
  } else {
    x.fillStyle = '#1f4fa8';
    x.fillRect(0, 0, 256, 128);
    x.fillStyle = '#3f9f4a';
    for (let i = 0; i < 18; i++) {
      x.beginPath();
      x.ellipse(r() * 256, 20 + r() * 88, 10 + r() * 30, 6 + r() * 16, r() * 3, 0, Math.PI * 2);
      x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------- builders

function balloons(): Wonder {
  const g = new THREE.Group();
  const r = rnd(5);
  const list: { o: THREE.Group; a: number; rad: number; y: number; sp: number }[] = [];
  const stripes = [0xff4f7b, 0xffd23d, 0x5ad1ff, 0x7dffb0, 0xb48cff, 0xff9a3d, 0xffffff];
  for (let i = 0; i < 9; i++) {
    const o = new THREE.Group();
    const env = new THREE.LatheGeometry(
      [
        [0.5, -7],
        [3.5, -4],
        [6, 1],
        [5.4, 5],
        [2.5, 7.6],
        [0.1, 8],
      ].map(([a, b]) => new THREE.Vector2(a, b)),
      12,
    );
    const colors: number[] = [];
    const pos = env.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      const ang = Math.atan2(pos.getZ(k), pos.getX(k));
      const col = new THREE.Color(stripes[(Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 6) + i) % stripes.length]);
      colors.push(col.r, col.g, col.b);
    }
    env.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    o.add(new THREE.Mesh(env, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, fog: false })));
    const basket = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2), std(0x8a5a2b));
    basket.position.y = -10;
    o.add(basket, glow(0xffb347, 5, 0.6));
    (o.children[2] as THREE.Sprite).position.y = -8.5;
    const s = 1 + r() * 0.8;
    o.scale.setScalar(s);
    g.add(o);
    list.push({ o, a: r() * Math.PI * 2, rad: 170 + r() * 160, y: -10 + r() * 70, sp: 0.01 + r() * 0.02 });
  }
  return {
    group: g,
    update(t) {
      for (const b of list) {
        const a = b.a + t * b.sp;
        b.o.position.set(Math.cos(a) * b.rad, b.y + Math.sin(t * 0.3 + b.a) * 4, Math.sin(a) * b.rad);
      }
    },
  };
}

/** A friendly low-poly whale, swimming along +Z. */
function whaleModel(color: number, belly: number, glowing: boolean): THREE.Group {
  const g = new THREE.Group();
  const mat = glowing
    ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    : std(color);
  const body = new THREE.LatheGeometry(
    [
      [0.2, 12],
      [3.4, 9],
      [4.4, 3],
      [4, -4],
      [2.2, -9],
      [0.8, -12],
    ].map(([a, b]) => new THREE.Vector2(a, b)),
    9,
  );
  body.rotateX(Math.PI / 2);
  body.scale(1, 0.82, 1);
  g.add(new THREE.Mesh(body, mat));
  if (!glowing) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(3.6, 9, 6, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), std(belly));
    b.scale.set(1, 0.75, 2.6);
    b.position.set(0, -0.2, 1);
    g.add(b);
  }
  const fluke = new THREE.Mesh(new THREE.ConeGeometry(4, 6, 3), mat);
  fluke.scale.set(1.6, 0.18, 1);
  fluke.rotation.x = -Math.PI / 2;
  fluke.position.z = -13;
  fluke.name = 'fluke';
  g.add(fluke);
  for (const s of [1, -1]) {
    const fin = new THREE.Mesh(new THREE.ConeGeometry(1.8, 6, 3), mat);
    fin.scale.set(1, 0.2, 1);
    fin.rotation.set(0, 0, s * 1.9);
    fin.position.set(s * 4.2, -1.2, 3);
    g.add(fin);
  }
  return g;
}

function skywhales(glowing = false): Wonder {
  const g = new THREE.Group();
  const whales = [0, 1].map((i) => {
    const w = whaleModel(glowing ? 0x7fe8ff : 0x5d7fa6, 0xdfe8f0, glowing);
    w.scale.setScalar(glowing ? 9 : 4 + i * 1.5);
    g.add(w);
    return { w, phase: i * Math.PI, rad: glowing ? 900 : 380 + i * 120, y: glowing ? 120 + i * 80 : 60 + i * 40, sp: 0.03 + i * 0.01 };
  });
  return {
    group: g,
    update(t) {
      for (const k of whales) {
        const a = k.phase + t * k.sp;
        k.w.position.set(Math.cos(a) * k.rad, k.y + Math.sin(t * 0.4 + k.phase) * 8, Math.sin(a) * k.rad);
        k.w.rotation.set(Math.sin(t * 0.4 + k.phase) * 0.08, -a, Math.sin(t * 0.7) * 0.06);
        const f = k.w.getObjectByName('fluke');
        if (f) f.rotation.y = Math.sin(t * 1.5 + k.phase) * 0.35;
      }
    },
  };
}

function cow(): THREE.Group {
  const g = new THREE.Group();
  const white = std(0xf4f4f4);
  const black = std(0x222222);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 1.5), white));
  const spot = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.62, 0.8), black);
  spot.position.set(0.4, 0, 0.2);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1, 0.9, 0.9), white);
  head.position.set(1.9, 0.4, 0);
  g.add(spot, head);
  for (const [x, z] of [
    [1, 0.5],
    [1, -0.5],
    [-1, 0.5],
    [-1, -0.5],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 0.3), black);
    leg.position.set(x, -1.2, z);
    g.add(leg);
  }
  return g;
}

function house(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3), std(0xd9c7a3)));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.8, 4), std(0xa83a2a));
  roof.position.y = 2.1;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  return g;
}

function debris(): Wonder {
  const g = new THREE.Group();
  const r = rnd(9);
  const items: { o: THREE.Object3D; a: number; rad: number; y: number; sp: number; spin: THREE.Vector3 }[] = [];
  for (let i = 0; i < 18; i++) {
    const kind = i % 3;
    const o = kind === 0 ? cow() : kind === 1 ? house() : new THREE.Mesh(new THREE.ConeGeometry(1.4, 4, 5), std(0x2f6f3e));
    o.scale.setScalar(1.6 + r() * 1.4);
    g.add(o);
    items.push({ o, a: r() * Math.PI * 2, rad: 108 + r() * 40, y: -30 + r() * 100, sp: 0.15 + r() * 0.15, spin: new THREE.Vector3(r(), r(), r()) });
  }
  return {
    group: g,
    update(t) {
      for (const it of items) {
        const a = it.a + t * it.sp;
        it.o.position.set(Math.cos(a) * it.rad, it.y + Math.sin(t * 0.5 + it.a) * 10, Math.sin(a) * it.rad);
        it.o.rotation.set(t * it.spin.x, t * it.spin.y, t * it.spin.z);
      }
    },
  };
}

function eye(): Wonder {
  const g = new THREE.Group();
  const white = new THREE.Mesh(new THREE.SphereGeometry(60, 24, 16), basic(0xf3ecff));
  const iris = new THREE.Mesh(new THREE.CircleGeometry(30, 32), basic(0x6a3cff));
  // The lids close over the eye from above and below.
  iris.position.z = 59;
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(13, 24), basic(0x05030a));
  pupil.position.z = 60;
  const look = new THREE.Group();
  look.add(white, iris, pupil);
  const lid = new THREE.Mesh(new THREE.SphereGeometry(63, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), std(0x2c2440));
  const lid2 = lid.clone();
  lid2.rotation.x = Math.PI;
  const face = new THREE.Group();
  face.add(look, lid, lid2);
  g.add(face, glow(0x9c84ff, 420, 0.35));
  g.position.set(0, 190, -460);
  const tv = new THREE.Vector3();
  return {
    group: g,
    update(t, _dt, camera) {
      // The whole eye turns to watch you.
      face.lookAt(tv.copy(camera.position));
      // Blink now and then.
      const b = Math.max(0, Math.sin(t * 0.7) - 0.97) * 30;
      lid.rotation.x = -0.15 + b;
      lid2.rotation.x = Math.PI + 0.15 - b;
    },
  };
}

function snowglobe(): Wonder {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(70, 32, 20),
    new THREE.MeshBasicMaterial({ color: 0xcfefff, transparent: true, opacity: 0.18, depthWrite: false, fog: false }),
  );
  const base = new THREE.Mesh(new THREE.CylinderGeometry(52, 64, 26, 24), std(0x7a3b1d));
  base.position.y = -72;
  const snow = new THREE.Mesh(new THREE.CylinderGeometry(58, 58, 4, 24), std(0xffffff));
  snow.position.y = -52;
  g.add(glass, base, snow);
  const r = rnd(3);
  for (let i = 0; i < 9; i++) {
    const h = house();
    h.scale.setScalar(4 + r() * 2);
    h.position.set((r() - 0.5) * 70, -44, (r() - 0.5) * 70);
    g.add(h);
  }
  const tree = new THREE.Mesh(new THREE.ConeGeometry(12, 40, 6), std(0x2f8f4e));
  tree.position.set(0, -30, 0);
  g.add(tree);
  const flakes = new Float32Array(400 * 3);
  for (let i = 0; i < 400; i++) flakes.set([(r() - 0.5) * 110, (r() - 0.5) * 100, (r() - 0.5) * 110], i * 3);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(flakes, 3));
  const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.5, fog: false }));
  g.add(pts);
  g.position.set(-360, 30, -300);
  return {
    group: g,
    update(t, dt) {
      g.rotation.y = t * 0.05;
      for (let i = 0; i < 400; i++) {
        let y = flakes[i * 3 + 1] - dt * 6;
        if (y < -50) y = 50;
        flakes[i * 3 + 1] = y;
      }
      (pg.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    },
  };
}

function zeppelins(): Wonder {
  const g = new THREE.Group();
  const list = [0, 1, 2].map((i) => {
    const z = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 10), std([0xd9d4c4, 0xc9a227, 0x8f9db0][i]));
    hull.scale.set(1, 1, 3);
    const gondola = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 10), std(0x4a3b2a));
    gondola.position.y = -11;
    z.add(hull, gondola);
    for (const [x, y] of [
      [0, 12],
      [0, -12],
      [12, 0],
      [-12, 0],
    ]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(x ? 10 : 0.8, y ? 10 : 0.8, 8), std(0x7a1f2b));
      fin.position.set(x * 0.6, y * 0.6, -26);
      z.add(fin);
    }
    z.scale.setScalar(1.4 + i * 0.3);
    g.add(z);
    return { z, x0: -700 + i * 300, y: 30 + i * 35, zz: -350 - i * 160 };
  });
  return {
    group: g,
    update(t) {
      for (const k of list) {
        const x = ((k.x0 + t * 12 + 900) % 1800) - 900;
        k.z.position.set(x, k.y + Math.sin(t * 0.3 + k.x0) * 5, k.zz);
        k.z.rotation.y = Math.PI / 2;
      }
    },
  };
}

function paperplanes(): Wonder {
  const g = new THREE.Group();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 3, -2.2, 0, -2, 0, 0.5, -1.5, 0, 0, 3, 0, 0.5, -1.5, 2.2, 0, -2], 3));
  const planes = Array.from({ length: 10 }, (_, i) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false }));
    m.scale.setScalar(3);
    g.add(m);
    return { m, i };
  });
  return {
    group: g,
    update(t) {
      for (const { m, i } of planes) {
        const a = t * 0.25 + i * 0.63;
        const R = 260 + (i % 3) * 60;
        m.position.set(Math.cos(a) * R, 20 + Math.sin(a * 3 + i) * 30, Math.sin(a) * R);
        m.lookAt(Math.cos(a + 0.1) * R, 20 + Math.sin((a + 0.1) * 3 + i) * 30, Math.sin(a + 0.1) * R);
      }
    },
  };
}

function jellyfish(): Wonder {
  const g = new THREE.Group();
  const r = rnd(11);
  const list = Array.from({ length: 7 }, (_, i) => {
    const j = new THREE.Group();
    const col = [0x6dffcf, 0xff6ff0, 0x7fbaff][i % 3];
    const bell = new THREE.Mesh(
      new THREE.SphereGeometry(8, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    j.add(bell, glow(col, 30, 0.5));
    const pts: number[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      for (let s = 0; s < 6; s++) {
        pts.push(Math.cos(a) * 5, -s * 4, Math.sin(a) * 5, Math.cos(a) * 5, -(s + 1) * 4, Math.sin(a) * 5);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    j.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.6, fog: false })));
    j.scale.setScalar(1 + r());
    g.add(j);
    return { j, a: r() * Math.PI * 2, rad: 200 + r() * 250, y0: -60 + r() * 100, sp: 4 + r() * 4 };
  });
  return {
    group: g,
    update(t) {
      for (const k of list) {
        const y = k.y0 + ((t * k.sp) % 260);
        k.j.position.set(Math.cos(k.a) * k.rad, y, Math.sin(k.a) * k.rad);
        k.j.scale.y = 1 + Math.sin(t * 2 + k.a) * 0.12;
      }
    },
  };
}

function cubeplanet(): Wonder {
  const g = new THREE.Group();
  const tex = planetTexture('earth', 4);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(160, 160, 160), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, fog: false }));
  g.add(cube, glow(0x6fb7ff, 520, 0.35));
  g.position.set(620, 260, -900);
  return {
    group: g,
    update(t) {
      cube.rotation.set(t * 0.05, t * 0.08, 0);
    },
  };
}

function astronaut(): Wonder {
  const g = new THREE.Group();
  const suit = std(0xf2f2f2);
  const body = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 2), suit);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), suit);
  head.position.y = 3.2;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0xffb02e, metalness: 0.9, roughness: 0.1, fog: false }));
  visor.position.set(0, 3.3, 0.6);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 1.2), std(0xc0c0c0));
  pack.position.z = -1.6;
  g.add(body, head, visor, pack);
  for (const [x, y, rx] of [
    [-2, 0.8, 0.6],
    [2, 0.8, -0.5],
    [-0.8, -3.2, 0.2],
    [0.8, -3.2, -0.3],
  ]) {
    const limb = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), suit);
    limb.position.set(x, y, 0);
    limb.rotation.z = rx;
    g.add(limb);
  }
  g.scale.setScalar(6);
  return {
    group: g,
    update(t) {
      g.position.set(Math.cos(t * 0.02) * 420, 120 + Math.sin(t * 0.1) * 30, Math.sin(t * 0.02) * 420);
      g.rotation.set(t * 0.21, t * 0.13, t * 0.17);
    },
  };
}

function discomoon(): Wonder {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(120, 3), new THREE.MeshStandardMaterial({ color: 0xe8e8f0, metalness: 0.95, roughness: 0.12, flatShading: true, fog: false }));
  g.add(ball);
  const sparkles = Array.from({ length: 14 }, () => {
    const s = glow(0xffffff, 40, 0);
    g.add(s);
    return s;
  });
  g.position.set(-480, 170, -700);
  const r = rnd(21);
  return {
    group: g,
    update(t) {
      ball.rotation.y = t * 0.2;
      for (const [i, s] of sparkles.entries()) {
        const ph = (t * 1.3 + i * 0.37) % 1;
        if (ph < 0.02) {
          const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() * 0.6 + 0.4).normalize().multiplyScalar(122);
          s.position.copy(v);
        }
        s.material.opacity = Math.max(0, 1 - ph * 4);
      }
    },
  };
}

function donut(): Wonder {
  const g = new THREE.Group();
  const dough = new THREE.Mesh(new THREE.TorusGeometry(140, 70, 20, 48), std(0xd99a52, { roughness: 0.9 }));
  const icing = new THREE.Mesh(new THREE.TorusGeometry(140, 72, 20, 48, Math.PI * 2), std(0xff7eb6, { roughness: 0.5 }));
  icing.scale.set(1, 1, 0.55);
  icing.position.z = 22;
  g.add(dough, icing);
  const r = rnd(17);
  const cols = [0xffffff, 0x7ee0ff, 0xffd23d, 0x7dffb0, 0xb48cff];
  for (let i = 0; i < 120; i++) {
    const a = r() * Math.PI * 2;
    const b = r() * Math.PI - Math.PI / 2;
    const rr = 140 + Math.cos(b) * 72;
    const sp = new THREE.Mesh(new THREE.CapsuleGeometry(2.4, 10, 2, 4), std(cols[i % cols.length]));
    sp.position.set(Math.cos(a) * rr, Math.sin(a) * rr, 22 + Math.sin(b) * 40 + 40);
    sp.rotation.set(r() * 3, r() * 3, r() * 3);
    g.add(sp);
  }
  g.position.set(700, 220, -800);
  g.rotation.x = -0.9;
  return {
    group: g,
    update(t) {
      g.rotation.z = t * 0.04;
    },
  };
}

function train(): Wonder {
  const g = new THREE.Group();
  const R = 520;
  const rail = new THREE.Mesh(new THREE.TorusGeometry(R, 1.5, 4, 160), basic(0xffc36b));
  rail.rotation.x = Math.PI / 2;
  rail.position.y = 60;
  g.add(rail);
  const cars = Array.from({ length: 7 }, (_, i) => {
    const car = new THREE.Group();
    car.add(new THREE.Mesh(new THREE.BoxGeometry(10, 9, 22), std(i === 0 ? 0xd94b3d : 0x2f3f8f, { metalness: 0.4 })));
    for (const s of [1, -1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3, 16), basic(0xffe48a));
      w.position.set(s * 5.1, 1.5, 0);
      car.add(w);
    }
    if (i === 0) {
      const lamp = glow(0xffffff, 24, 0.9);
      lamp.position.z = 12;
      car.add(lamp);
    }
    g.add(car);
    return car;
  });
  return {
    group: g,
    update(t) {
      cars.forEach((car, i) => {
        const a = t * 0.06 - i * 0.045;
        car.position.set(Math.cos(a) * R, 66, Math.sin(a) * R);
        car.rotation.y = -a;
      });
    },
  };
}

function blackhole(): Wonder {
  const g = new THREE.Group();
  const disk = new THREE.Mesh(
    new THREE.RingGeometry(110, 330, 96, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform float uTime; varying vec2 vP; void main(){ float r = length(vP); float a = atan(vP.y, vP.x); float k = clamp((r-110.0)/220.0, 0.0, 1.0); float swirl = 0.5 + 0.5*sin(a*6.0 + r*0.05 - uTime*2.0); vec3 hot = mix(vec3(1.0,0.95,0.8), vec3(1.0,0.35,0.05), k); gl_FragColor = vec4(hot * (0.6 + 0.6*swirl), (1.0-k) * 0.9); }',
    }),
  );
  disk.rotation.x = -1.25;
  const hole = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 20), basic(0x000000));
  g.add(disk, hole, glow(0xff8a3d, 900, 0.4));
  g.position.set(-650, 260, -1000);
  return {
    group: g,
    update(t) {
      (disk.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    },
  };
}

function tesseract(): Wonder {
  const g = new THREE.Group();
  // 16 corners of a 4D cube, joined by 32 edges; turned in 4D and projected.
  const verts: number[][] = [];
  for (let i = 0; i < 16; i++) verts.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
  const edges: [number, number][] = [];
  for (let i = 0; i < 16; i++) for (let b = 0; b < 4; b++) if (!(i & (1 << b))) edges.push([i, i | (1 << b)]);
  const pos = new Float32Array(edges.length * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xff3df2, fog: false }));
  g.add(lines, glow(0xff3df2, 700, 0.3));
  g.position.set(0, 380, -900);
  return {
    group: g,
    update(t) {
      const a = t * 0.3;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const p = verts.map(([x, y, z, w]) => {
        const x2 = x * c - w * s;
        const w2 = x * s + w * c;
        const y2 = y * Math.cos(a * 0.7) - z * Math.sin(a * 0.7);
        const z2 = y * Math.sin(a * 0.7) + z * Math.cos(a * 0.7);
        const k = 160 / (3 - w2);
        return [x2 * k, y2 * k, z2 * k];
      });
      edges.forEach(([i, j], e) => pos.set([...p[i], ...p[j]], e * 6));
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      g.rotation.y = t * 0.05;
    },
  };
}

function tetris(): Wonder {
  const g = new THREE.Group();
  const shapes = [
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [2, 0], [1, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[0, 0], [0, 1], [1, 0], [2, 0]],
  ];
  const cols = [0x5ad1ff, 0xffd23d, 0xb48cff, 0x7dffb0, 0xff9a3d];
  const r = rnd(13);
  const blocks = Array.from({ length: 14 }, (_, i) => {
    const b = new THREE.Group();
    for (const [x, y] of shapes[i % shapes.length]) {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(9.4, 9.4, 9.4), std(cols[i % cols.length], { emissive: cols[i % cols.length], emissiveIntensity: 0.35 }));
      cube.position.set(x * 10, y * 10, 0);
      b.add(cube);
    }
    g.add(b);
    return { b, x: (r() - 0.5) * 1400, z: -400 - r() * 700, y0: r() * 800, sp: 20 + r() * 30, rot: r() * 4 };
  });
  return {
    group: g,
    update(t) {
      for (const k of blocks) {
        const y = 500 - ((k.y0 + t * k.sp) % 900);
        k.b.position.set(k.x, y, k.z);
        k.b.rotation.z = Math.floor((t * 0.5 + k.rot) % 4) * (Math.PI / 2);
      }
    },
  };
}

function planets(seed: number): Wonder {
  const g = new THREE.Group();
  const kinds: ('gas' | 'lava' | 'ice' | 'candy' | 'toxic')[] = ['gas', 'lava', 'ice', 'candy', 'toxic'];
  const r = rnd(seed);
  const list = [0, 1, 2].map((i) => {
    const kind = kinds[(seed + i * 2) % kinds.length];
    const radius = 50 + r() * 80;
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 32, 20),
      kind === 'lava' ? new THREE.MeshBasicMaterial({ map: planetTexture(kind, seed + i), fog: false }) : new THREE.MeshStandardMaterial({ map: planetTexture(kind, seed + i), roughness: 0.9, fog: false }),
    );
    const holder = new THREE.Group();
    holder.add(p);
    if (r() < 0.6) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 1.4, radius * 2.1, 64),
        new THREE.MeshBasicMaterial({ color: [0xffe0b0, 0xbfe8ff, 0xffb0e0][i], transparent: true, opacity: 0.45, side: THREE.DoubleSide, fog: false }),
      );
      ring.rotation.x = 1.2 + r() * 0.4;
      holder.add(ring);
    }
    if (kind === 'lava') holder.add(glow(0xff5a1a, radius * 4, 0.5));
    g.add(holder);
    return { holder, p, a: r() * Math.PI * 2, rad: 1100 + i * 250, y: 150 + r() * 400, sp: 0.004 + r() * 0.006 };
  });
  return {
    group: g,
    update(t) {
      for (const k of list) {
        const a = k.a + t * k.sp;
        k.holder.position.set(Math.cos(a) * k.rad, k.y, Math.sin(a) * k.rad);
        k.p.rotation.y = t * 0.05;
      }
    },
  };
}

export function makeWonder(kind: WonderKind, seed = 1): Wonder {
  switch (kind) {
    case 'balloons':
      return balloons();
    case 'skywhales':
      return skywhales(false);
    case 'spacewhales':
      return skywhales(true);
    case 'debris':
      return debris();
    case 'eye':
      return eye();
    case 'snowglobe':
      return snowglobe();
    case 'zeppelins':
      return zeppelins();
    case 'paperplanes':
      return paperplanes();
    case 'jellyfish':
      return jellyfish();
    case 'cubeplanet':
      return cubeplanet();
    case 'astronaut':
      return astronaut();
    case 'discomoon':
      return discomoon();
    case 'donut':
      return donut();
    case 'train':
      return train();
    case 'blackhole':
      return blackhole();
    case 'tesseract':
      return tesseract();
    case 'tetris':
      return tetris();
    case 'planets':
      return planets(seed);
  }
}
