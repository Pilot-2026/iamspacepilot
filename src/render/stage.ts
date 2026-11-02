import * as THREE from 'three';
import { SHIP_ORDER, type ShipId } from '../core/ships';
import type { DogMesh } from './dachshund';
import { disposeShip, makeShip, type ShipMesh } from './ships';
import { sharedTextures } from './textures';

/**
 * The stage behind the menus: a transparent 3D layer between the yellow
 * background and the menu text, so ships never cover any words.
 *
 * intro: the four ships fly at the viewer, roll, fire and leave walls of light;
 * while the finished title waits for a tap, more ships keep crossing.
 * menu: ships cross the screen now and then, their trails fade quickly; now
 * and then one comes straight at the viewer and flashes past, huge.
 */

export type StageMode = 'off' | 'intro' | 'menu';

const FWD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

interface Sample {
  p: THREE.Vector3;
  up: THREE.Vector3;
  t: number;
}

/** A ribbon of light behind a ship: narrow at the ship, wider behind, fading away. */
class Trail {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly samples: Sample[] = [];
  private readonly color: THREE.Color;

  constructor(
    color: number,
    private readonly max: number,
    private readonly life: number,
    private readonly height: number,
    additive: boolean,
  ) {
    this.color = new THREE.Color(color);
    this.pos = new Float32Array(max * 2 * 3);
    this.col = new Float32Array(max * 2 * 4);
    const index: number[] = [];
    for (let i = 0; i < max - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(index);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    this.mesh.frustumCulled = false;
  }

  private lastT = -1;

  /** Adds a sample at most 60 times a second, so the trail is equally long on every screen. */
  push(p: THREE.Vector3, up: THREE.Vector3, t: number): void {
    if (t - this.lastT < 1 / 62) return;
    this.lastT = t;
    this.samples.push({ p: p.clone(), up: up.clone(), t });
    if (this.samples.length > this.max) this.samples.shift();
  }

  update(now: number): void {
    while (this.samples.length && now - this.samples[0].t > this.life) this.samples.shift();
    const n = this.samples.length;
    for (let k = 0; k < n; k++) {
      const s = this.samples[k];
      const age = now - s.t;
      const grow = Math.min(1, 0.15 + age / 0.25);
      const h = this.height * grow;
      const a = Math.max(0, 1 - age / this.life);
      const o = k * 6;
      this.pos[o] = s.p.x + s.up.x * h;
      this.pos[o + 1] = s.p.y + s.up.y * h;
      this.pos[o + 2] = s.p.z + s.up.z * h;
      this.pos[o + 3] = s.p.x - s.up.x * h;
      this.pos[o + 4] = s.p.y - s.up.y * h;
      this.pos[o + 5] = s.p.z - s.up.z * h;
      const c = k * 8;
      for (const off of [0, 4]) {
        this.col[c + off] = this.color.r;
        this.col[c + off + 1] = this.color.g;
        this.col[c + off + 2] = this.color.b;
        this.col[c + off + 3] = a * a * 0.78;
      }
    }
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, Math.max(0, n - 1) * 6);
  }

  get empty(): boolean {
    return this.samples.length === 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

interface Flyer {
  ship: ShipMesh;
  outline: THREE.Mesh | null;
  curve: THREE.Curve<THREE.Vector3>;
  t0: number;
  dur: number;
  /** Roll speed in rad/s and the time window it rolls in. */
  roll: number;
  rollFrom: number;
  rollTo: number;
  trail: Trail;
  fire: number[];
  scale: number;
  /** Comes straight at the viewer. */
  flyby?: boolean;
}

interface Bolt {
  sprite: THREE.Sprite;
  v: THREE.Vector3;
  age: number;
  life: number;
}

/** Strong colours that stand out on the yellow sky. */
const INTRO_COLORS: Record<ShipId, number> = { trident: 0xd10000, manta: 0x000088, halo: 0xd4007a, bulwark: 0x00806a, dachshund: 0x8a4415 };
/** The intro choreography is over by then; afterwards ships keep coming while the title waits. */
const INTRO_END = 7.6;
const MENU_TRAILS = [0x0a0a0a, 0xff2d55, 0x7b2dff, 0x0050ff, 0x00a86b, 0xff6a00];

export class MenuStage {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.5, 4000);
  private flyers: Flyer[] = [];
  private fading: Trail[] = [];
  private bolts: Bolt[] = [];
  private stars: THREE.Points | null = null;
  private mode: StageMode = 'off';
  private raf = 0;
  private last = 0;
  private time = 0;
  private nextSpawn = 0;
  private nextRoundel = 14;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.add(new THREE.HemisphereLight(0xfff4d6, 0x5a3f12, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(-4, 8, 7);
    const rim = new THREE.DirectionalLight(0xffe2a0, 1.2);
    rim.position.set(5, -2, -6);
    this.scene.add(key, rim);
    window.addEventListener('resize', () => this.resize());
  }

  get current(): StageMode {
    return this.mode;
  }

  /** Switches the stage to a mode; 'off' stops drawing. */
  setMode(mode: StageMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.clearAll();
    this.canvas.hidden = mode === 'off';
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (mode === 'off') return;
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
      } catch {
        this.mode = 'off';
        this.canvas.hidden = true;
        return;
      }
      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    }
    this.resize();
    this.time = 0;
    this.last = performance.now();
    if (mode === 'intro') this.buildIntro();
    else this.nextSpawn = 0.3;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.step(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private resize(): void {
    const r = this.renderer;
    if (!r) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private makeFlyer(id: ShipId, curve: THREE.Curve<THREE.Vector3>, t0: number, dur: number, trailColor: number, intro: boolean, scale = 1): Flyer {
    const glow = intro ? INTRO_COLORS[id] : 0xffe45c;
    const ship = makeShip(id, glow, sharedTextures().glow);
    // A dark outline keeps the gold ships readable on the yellow background.
    const gold = ship.group.children[0] as THREE.Mesh;
    const outline = new THREE.Mesh(gold.geometry, new THREE.MeshBasicMaterial({ color: 0x0a0a0a, side: THREE.BackSide }));
    outline.scale.setScalar(1.07);
    ship.group.add(outline);
    for (const f of ship.flames) f.visible = false;
    ship.group.visible = false;
    ship.group.scale.setScalar(scale);
    this.scene.add(ship.group);
    // Long walls of light that thin out and fade away at their end.
    const trail = intro ? new Trail(trailColor, 340, 4.6, 2.8 * scale, false) : new Trail(trailColor, 240, 3.4, 0.75 * scale, false);
    this.scene.add(trail.mesh);
    return { ship, outline, curve, t0, dur, roll: 0, rollFrom: 0, rollTo: 0, trail, fire: [], scale };
  }

  // ---------- intro ----------

  private buildIntro(): void {
    // Stars far away for depth.
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, -Math.random()).normalize().multiplyScalar(900 + Math.random() * 600);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0x8a6400, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0.35, map: sharedTextures().soft, depthWrite: false }),
    );
    this.scene.add(this.stars);
    this.camera.position.set(0, 0, 40);
    this.camera.lookAt(0, 0, 0);
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const path = (...pts: THREE.Vector3[]) => new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const plan: [ShipId, THREE.Curve<THREE.Vector3>, number, number, number, number, number, number[]][] = [
      // ship, path, start, duration, roll speed, roll from, roll to, shots
      ['trident', path(P(-70, 14, -320), P(-14, 5, -130), P(12, -2, -45), P(7, -4, 22), P(-30, -12, 70)), 0.0, 3.2, 3.2, 0.9, 2.1, [1.0, 1.15, 1.3, 1.45]],
      ['manta', path(P(80, -22, -330), P(22, -7, -140), P(-13, 4, -50), P(-9, 7, 24), P(28, 16, 75)), 0.35, 3.3, -6.3, 1.3, 2.3, [1.6, 1.8]],
      ['halo', path(P(0, 45, -360), P(0, 13, -150), P(1, 2, -58), P(0, -5, 10), P(0, 22, 70)), 0.9, 3.4, 4.5, 0.9, 4.3, [2.1, 2.3, 2.5]],
      ['bulwark', path(P(-90, -34, -300), P(-32, -11, -115), P(11, 0, -32), P(21, 10, 16), P(64, 22, 45)), 1.4, 3.2, 1.6, 2.0, 3.6, [2.5, 2.7, 2.9]],
      // Straight at the viewer and past, close by.
      ['manta', path(P(34, -22, -460), P(12, -7, -170), P(4.5, -2.2, 12), P(11, -5, 75)), 1.1, 2.3, 4.2, 1.6, 3.4, [1.9, 2.1, 2.3]],
      ['trident', path(P(-30, 20, -460), P(-10, 7, -170), P(-4.5, 2.4, 14), P(-10, 6, 75)), 2.0, 2.2, -5, 2.6, 4.2, [2.7, 2.9, 3.1]],
      ['halo', path(P(2, -34, -460), P(1, -12, -170), P(1.2, -3.4, 16), P(4, -9, 75)), 2.9, 2.2, 6.3, 3.4, 5.1, [3.6, 3.8]],
      ['bulwark', path(P(44, 12, -460), P(15, 4, -170), P(5.2, 1.6, 12), P(13, 4, 75)), 3.7, 2.4, 3, 4.6, 6.1, [4.4, 4.6, 4.8]],
      // Second pass: in formation from behind the viewer into the distance.
      ['trident', path(P(-9, -6, 60), P(-12, -5, -40), P(-30, 4, -300)), 4.3, 2.8, 0, 0, 0, [4.8]],
      ['manta', path(P(-3, -7, 64), P(-4, -6, -40), P(-8, 10, -320)), 4.4, 2.8, 0, 0, 0, [4.9]],
      ['halo', path(P(3, -7, 64), P(4, -6, -40), P(9, 12, -320)), 4.5, 2.8, 5, 4.5, 7.3, [5.0]],
      ['bulwark', path(P(9, -6, 60), P(12, -5, -40), P(32, 4, -300)), 4.6, 2.8, 0, 0, 0, [5.1]],
      // And one more from far away, right at you, as the title stands.
      ['manta', path(P(-20, 30, -500), P(-6, 9, -180), P(-3, 2, 14), P(-8, 5, 75)), 5.6, 2.2, -6, 6.2, 7.6, [6.4, 6.6]],
    ];
    // The round logo flies at the viewer, big, flipping like a coin, and through the screen.
    this.launchRoundel(3.1);
    for (const [id, curve, t0, dur, roll, rollFrom, rollTo, fire] of plan) {
      const f = this.makeFlyer(id, curve, t0, dur, INTRO_COLORS[id], true);
      f.roll = roll;
      f.rollFrom = rollFrom;
      f.rollTo = rollTo;
      f.fire = fire;
      this.flyers.push(f);
    }
  }

  // ---------- menu ----------

  /** A ship crossing the screen from one side to the other, now and then with a loop or a wild curve. */
  private spawnCrosser(intro: boolean): void {
    const scale = intro ? 1.5 : 2.6;
    if (Math.random() < 0.5) {
      this.spawnStunt(intro, scale);
      return;
    }
    const d = (110 + Math.random() * 90) * (intro ? 1 : 0.9);
    const halfH = d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfW = halfH * this.camera.aspect;
    const side = Math.random() < 0.5 ? -1 : 1;
    const y0 = (Math.random() * 2 - 1) * halfH * 0.85;
    const y1 = (Math.random() * 2 - 1) * halfH * 0.85;
    const c = this.camera.position;
    const start = new THREE.Vector3(side * (halfW + 35), y0, -d + (Math.random() * 40 - 20)).add(c);
    const end = new THREE.Vector3(-side * (halfW + 35), y1, -d + (Math.random() * 60 - 30)).add(c);
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, (Math.random() * 2 - 1) * halfH * 0.5, (Math.random() * 2 - 1) * 40));
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const id = SHIP_ORDER[Math.floor(Math.random() * SHIP_ORDER.length)];
    const dur = curve.getLength() / (44 + Math.random() * 24);
    const trail = intro ? INTRO_COLORS[id] : MENU_TRAILS[Math.floor(Math.random() * MENU_TRAILS.length)];
    const f = this.makeFlyer(id, curve, this.time, dur, trail, intro, scale);
    if (Math.random() < 0.4) {
      f.roll = (Math.random() < 0.5 ? -1 : 1) * 5;
      f.rollFrom = this.time + dur * 0.3;
      f.rollTo = f.rollFrom + (Math.PI * 2) / 5;
    }
    if (Math.random() < 0.5) f.fire = [this.time + dur * (0.35 + Math.random() * 0.3)];
    this.flyers.push(f);
  }

  /** A ship far ahead that comes straight at the viewer, rolls, fires and flashes past just beside the camera. */
  private spawnFlyby(intro: boolean): void {
    const c = this.camera.position;
    const sx = Math.random() < 0.5 ? -1 : 1;
    const sy = Math.random() < 0.5 ? -1 : 1;
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).add(c);
    const curve = new THREE.CatmullRomCurve3(
      [
        P(sx * (30 + Math.random() * 40), sy * (10 + Math.random() * 25), -420),
        P(sx * (8 + Math.random() * 8), sy * (3 + Math.random() * 5), -110),
        P(sx * (4.5 + Math.random() * 2), sy * (1.6 + Math.random()), -14),
        P(sx * 9, sy * 4, 26),
      ],
      false,
      'centripetal',
    );
    const id = SHIP_ORDER[Math.floor(Math.random() * SHIP_ORDER.length)];
    const dur = 2.3 + Math.random() * 0.6;
    const trail = intro ? INTRO_COLORS[id] : MENU_TRAILS[Math.floor(Math.random() * MENU_TRAILS.length)];
    const f = this.makeFlyer(id, curve, this.time, dur, trail, intro, 1);
    f.roll = (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 2.5);
    f.rollFrom = this.time + dur * 0.15;
    f.rollTo = this.time + dur;
    f.fire = [0.35, 0.45, 0.55].map((k) => this.time + dur * k);
    f.flyby = true;
    this.flyers.push(f);
  }

  /** Daring moves across the screen: a loop, a barrel roll or a deep S-curve, firing on the way. */
  private spawnStunt(intro: boolean, scale: number): void {
    const d = 120 + Math.random() * 60;
    const halfH = d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfW = halfH * this.camera.aspect;
    const side = Math.random() < 0.5 ? -1 : 1;
    const c = this.camera.position;
    const y0 = (Math.random() * 2 - 1) * halfH * 0.5;
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).add(c);
    const kind = Math.floor(Math.random() * 3);
    let pts: THREE.Vector3[];
    if (kind === 0) {
      // A full loop in the middle of the screen.
      const lx = (Math.random() - 0.5) * halfW * 0.6;
      const lr = halfH * 0.38;
      pts = [P(side * (halfW + 40), y0, -d), P(lx + side * lr, y0, -d), P(lx, y0 + lr, -d + 12), P(lx - side * lr, y0 + lr * 2, -d), P(lx, y0 + lr * 3, -d - 12), P(lx + side * lr * 1.2, y0 + lr * 2, -d), P(lx, y0 + lr * 0.6, -d + 20), P(-side * (halfW + 40), y0 - lr * 0.3, -d)];
      for (const q of pts) q.y -= lr * 1.2;
    } else if (kind === 1) {
      // A deep S through the picture, close to the viewer in the middle.
      pts = [P(side * (halfW + 40), halfH * 0.7, -d), P(side * halfW * 0.4, -halfH * 0.5, -d * 0.6), P(-side * halfW * 0.1, halfH * 0.4, -d * 0.35), P(-side * halfW * 0.5, -halfH * 0.3, -d * 0.6), P(-side * (halfW + 40), halfH * 0.5, -d)];
    } else {
      // Straight across with barrel rolls.
      pts = [P(side * (halfW + 40), y0, -d), P(0, y0 + halfH * 0.15, -d * 0.8), P(-side * (halfW + 40), y0 - halfH * 0.1, -d)];
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const id = SHIP_ORDER[Math.floor(Math.random() * SHIP_ORDER.length)];
    const dur = curve.getLength() / (55 + Math.random() * 25);
    const trail = intro ? INTRO_COLORS[id] : MENU_TRAILS[Math.floor(Math.random() * MENU_TRAILS.length)];
    const f = this.makeFlyer(id, curve, this.time, dur, trail, intro, scale);
    f.roll = (Math.random() < 0.5 ? -1 : 1) * (kind === 2 ? 9 : 5);
    f.rollFrom = this.time + dur * (kind === 2 ? 0.2 : 0.55);
    f.rollTo = f.rollFrom + (kind === 2 ? (Math.PI * 4) / 9 : (Math.PI * 2) / 5);
    f.fire = [0.3, 0.42, 0.7].map((k) => this.time + dur * k);
    this.flyers.push(f);
  }

  /** Every few seconds a new ship: crossing, a stunt, or (often) straight at you. */
  private spawnSome(intro: boolean): void {
    const flyby = this.flyers.some((f) => f.flyby);
    if (!flyby && Math.random() < 0.5) this.spawnFlyby(intro);
    else this.spawnCrosser(intro);
  }

  // ---------- the round logo ----------

  private roundel: { group: THREE.Group; t0: number; from: THREE.Vector3; to: THREE.Vector3; dur: number; spin: number } | null = null;

  /** The round logo in 3D: a disc with a navy ring, a white ring and a red centre, flying at the viewer. */
  private launchRoundel(t0: number): void {
    this.removeRoundel();
    const group = new THREE.Group();
    const disc = (r: number, color: number, z: number) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 64), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.z = z;
      group.add(m);
    };
    disc(1, 0x000088, 0);
    disc(0.725, 0xffffff, 0.01);
    disc(0.352, 0xa60000, 0.02);
    // The same on the back.
    disc(0.725, 0xffffff, -0.01);
    disc(0.352, 0xa60000, -0.02);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 64), new THREE.MeshStandardMaterial({ color: 0xf6c21c, metalness: 0.9, roughness: 0.25, emissive: 0x5a3f00 }));
    group.add(rim);
    group.scale.setScalar(11);
    group.visible = false;
    this.scene.add(group);
    const c = this.camera.position;
    const sx = Math.random() < 0.5 ? -1 : 1;
    this.roundel = {
      group,
      t0,
      from: new THREE.Vector3(sx * 70, 40, -950).add(c),
      to: new THREE.Vector3(-sx * 3, -1, 8).add(c),
      dur: 1.9,
      spin: (Math.random() < 0.5 ? -1 : 1) * Math.PI * 3,
    };
  }

  private updateRoundel(now: number): void {
    const r = this.roundel;
    if (!r) return;
    const u = (now - r.t0) / r.dur;
    if (u < 0) return;
    if (u > 1) {
      this.removeRoundel();
      return;
    }
    // Speeds up as it comes closer.
    const e = u * u * u;
    r.group.visible = true;
    r.group.position.lerpVectors(r.from, r.to, e);
    r.group.rotation.set(Math.sin(u * 3) * 0.3, r.spin * (1 - u) * (1 - u), u * 1.2);
  }

  private removeRoundel(): void {
    const r = this.roundel;
    if (!r) return;
    this.scene.remove(r.group);
    r.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (m.material as THREE.Material).dispose();
    });
    this.roundel = null;
  }

  // ---------- frame ----------

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  private step(dt: number): void {
    const r = this.renderer;
    if (!r) return;
    this.time += dt;
    const now = this.time;
    if (this.mode === 'menu') {
      this.camera.position.set(0, 0, 0);
      this.camera.lookAt(0, 0, -1);
    }
    // In the menus all the time; in the intro once the choreography is over and the title waits.
    if (this.mode === 'menu' || now > INTRO_END) {
      this.nextSpawn -= dt;
      if (this.nextSpawn <= 0 && this.flyers.length < 4) {
        this.spawnSome(this.mode === 'intro');
        this.nextSpawn = 1.2 + Math.random() * 2;
      }
      // While the title waits, the round logo comes again now and then.
      if (this.mode === 'intro' && !this.roundel && now > this.nextRoundel) {
        this.launchRoundel(now);
        this.nextRoundel = now + 11 + Math.random() * 6;
      }
    }
    this.updateRoundel(now);
    for (let k = this.flyers.length - 1; k >= 0; k--) {
      const f = this.flyers[k];
      const u = (now - f.t0) / f.dur;
      const g = f.ship.group;
      if (u < 0) continue;
      if (u > 1) {
        // Done: the ship is gone, its trail fades on.
        this.scene.remove(g);
        disposeShip(f.ship);
        if (f.outline) (f.outline.material as THREE.Material).dispose();
        this.fading.push(f.trail);
        this.flyers.splice(k, 1);
        continue;
      }
      g.visible = true;
      const p = f.curve.getPointAt(u, this.tmp);
      const tan = f.curve.getTangentAt(u, this.tmp2);
      g.position.copy(p);
      g.lookAt(p.x + tan.x, p.y + tan.y, p.z + tan.z);
      if (f.roll && now > f.rollFrom) g.rotateZ(f.roll * (Math.min(now, f.rollTo) - f.rollFrom));
      // Trail from the tail, using the ship's up direction like the walls in the game.
      const tail = FWD.clone().applyQuaternion(g.quaternion).multiplyScalar(-3 * f.scale).add(g.position);
      const up = UP.clone().applyQuaternion(g.quaternion);
      f.trail.push(tail, up, now);
      while (f.fire.length && now >= f.fire[0]) {
        f.fire.shift();
        this.shoot(g, this.mode === 'intro' ? 0xa60000 : 0x0a0a0a, f.scale);
      }
      for (const fl of f.ship.flames) fl.scale.setScalar(f.ship.flame * (0.9 + Math.random() * 0.25));
      (f.ship as Partial<DogMesh>).animate?.(now, dt, 30, false);
    }
    for (const f of this.flyers) f.trail.update(now);
    for (let k = this.fading.length - 1; k >= 0; k--) {
      const t = this.fading[k];
      t.update(now);
      if (t.empty) {
        this.scene.remove(t.mesh);
        t.dispose();
        this.fading.splice(k, 1);
      }
    }
    for (let k = this.bolts.length - 1; k >= 0; k--) {
      const b = this.bolts[k];
      b.age += dt;
      b.sprite.position.addScaledVector(b.v, dt);
      b.sprite.material.opacity = Math.max(0, 1 - b.age / b.life);
      if (b.age > b.life) {
        this.scene.remove(b.sprite);
        b.sprite.material.dispose();
        this.bolts.splice(k, 1);
      }
    }
    if (this.stars) this.stars.rotation.z += dt * 0.01;
    r.render(this.scene, this.camera);
  }

  private shoot(g: THREE.Object3D, color: number, scale = 1): void {
    const dir = FWD.clone().applyQuaternion(g.quaternion);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sharedTextures().glow,
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
      }),
    );
    sprite.scale.setScalar((this.mode === 'intro' ? 3.5 : 2.4) * scale);
    sprite.position.copy(g.position).addScaledVector(dir, 4 * scale);
    this.scene.add(sprite);
    this.bolts.push({ sprite, v: dir.multiplyScalar(160), age: 0, life: this.mode === 'intro' ? 0.9 : 0.6 });
  }

  private clearAll(): void {
    this.removeRoundel();
    this.nextRoundel = 14;
    for (const f of this.flyers) {
      this.scene.remove(f.ship.group, f.trail.mesh);
      disposeShip(f.ship);
      if (f.outline) (f.outline.material as THREE.Material).dispose();
      f.trail.dispose();
    }
    this.flyers = [];
    for (const t of this.fading) {
      this.scene.remove(t.mesh);
      t.dispose();
    }
    this.fading = [];
    for (const b of this.bolts) {
      this.scene.remove(b.sprite);
      b.sprite.material.dispose();
    }
    this.bolts = [];
    if (this.stars) {
      this.scene.remove(this.stars);
      this.stars.geometry.dispose();
      (this.stars.material as THREE.Material).dispose();
      this.stars = null;
    }
  }
}
