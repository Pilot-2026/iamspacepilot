import * as THREE from 'three';
import { SHIP_ORDER, type ShipId } from '../core/ships';
import { disposeShip, makeShip, type ShipMesh } from './ships';
import { sharedTextures } from './textures';

/**
 * The stage behind the menus: a transparent 3D layer between the yellow
 * background and the menu text, so ships never cover any words.
 *
 * intro: the four ships fly at the viewer, roll, fire and leave walls of light.
 * menu: small ships cross the screen now and then; their trails fade quickly.
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

  push(p: THREE.Vector3, up: THREE.Vector3, t: number): void {
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
        this.col[c + off + 3] = a * a * 0.9;
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
}

interface Bolt {
  sprite: THREE.Sprite;
  v: THREE.Vector3;
  age: number;
  life: number;
}

const INTRO_COLORS: Record<ShipId, number> = { trident: 0xffd23d, manta: 0x5ad1ff, halo: 0xff4fd8, bulwark: 0x7dffb0 };
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

  private makeFlyer(id: ShipId, curve: THREE.Curve<THREE.Vector3>, t0: number, dur: number, trailColor: number, intro: boolean): Flyer {
    const glow = intro ? INTRO_COLORS[id] : 0xffe45c;
    const ship = makeShip(id, glow, sharedTextures().glow);
    let outline: THREE.Mesh | null = null;
    if (!intro) {
      // A dark outline keeps gold ships readable on the yellow background.
      const gold = ship.group.children[0] as THREE.Mesh;
      outline = new THREE.Mesh(gold.geometry, new THREE.MeshBasicMaterial({ color: 0x0a0a0a, side: THREE.BackSide }));
      outline.scale.setScalar(1.07);
      ship.group.add(outline);
      for (const f of ship.flames) f.visible = false;
    }
    ship.group.visible = false;
    this.scene.add(ship.group);
    const trail = intro ? new Trail(trailColor, 140, 2.2, 2.6, true) : new Trail(trailColor, 50, 1.1, 0.7, false);
    this.scene.add(trail.mesh);
    return { ship, outline, curve, t0, dur, roll: 0, rollFrom: 0, rollTo: 0, trail, fire: [], scale: 1 };
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
      new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.8, map: sharedTextures().soft, depthWrite: false }),
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
      // Second pass: in formation from behind the viewer into the distance.
      ['trident', path(P(-9, -6, 60), P(-12, -5, -40), P(-30, 4, -300)), 4.3, 2.8, 0, 0, 0, [4.8]],
      ['manta', path(P(-3, -7, 64), P(-4, -6, -40), P(-8, 10, -320)), 4.4, 2.8, 0, 0, 0, [4.9]],
      ['halo', path(P(3, -7, 64), P(4, -6, -40), P(9, 12, -320)), 4.5, 2.8, 5, 4.5, 7.3, [5.0]],
      ['bulwark', path(P(9, -6, 60), P(12, -5, -40), P(32, 4, -300)), 4.6, 2.8, 0, 0, 0, [5.1]],
    ];
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

  private spawnMenuFlyer(): void {
    const d = 110 + Math.random() * 90;
    const halfH = d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfW = halfH * this.camera.aspect;
    const side = Math.random() < 0.5 ? -1 : 1;
    const y0 = (Math.random() * 2 - 1) * halfH * 0.85;
    const y1 = (Math.random() * 2 - 1) * halfH * 0.85;
    const start = new THREE.Vector3(side * (halfW + 25), y0, -d + (Math.random() * 40 - 20));
    const end = new THREE.Vector3(-side * (halfW + 25), y1, -d + (Math.random() * 60 - 30));
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, (Math.random() * 2 - 1) * halfH * 0.5, (Math.random() * 2 - 1) * 40));
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const id = SHIP_ORDER[Math.floor(Math.random() * SHIP_ORDER.length)];
    const dur = curve.getLength() / (38 + Math.random() * 20);
    const f = this.makeFlyer(id, curve, this.time, dur, MENU_TRAILS[Math.floor(Math.random() * MENU_TRAILS.length)], false);
    if (Math.random() < 0.4) {
      f.roll = (Math.random() < 0.5 ? -1 : 1) * 5;
      f.rollFrom = this.time + dur * 0.3;
      f.rollTo = f.rollFrom + (Math.PI * 2) / 5;
    }
    if (Math.random() < 0.5) f.fire = [this.time + dur * (0.35 + Math.random() * 0.3)];
    this.flyers.push(f);
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
      this.nextSpawn -= dt;
      if (this.nextSpawn <= 0 && this.flyers.length < 3) {
        this.spawnMenuFlyer();
        this.nextSpawn = 1.6 + Math.random() * 2.4;
      }
    }
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
      const tail = FWD.clone().applyQuaternion(g.quaternion).multiplyScalar(-3).add(g.position);
      const up = UP.clone().applyQuaternion(g.quaternion);
      f.trail.push(tail, up, now);
      while (f.fire.length && now >= f.fire[0]) {
        f.fire.shift();
        this.shoot(g, this.mode === 'intro' ? 0xfff2a8 : 0x0a0a0a);
      }
      for (const fl of f.ship.flames) fl.scale.setScalar(f.ship.flame * (0.9 + Math.random() * 0.25));
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

  private shoot(g: THREE.Object3D, color: number): void {
    const dir = FWD.clone().applyQuaternion(g.quaternion);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sharedTextures().glow,
        color,
        transparent: true,
        depthWrite: false,
        blending: this.mode === 'intro' ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    sprite.scale.setScalar(this.mode === 'intro' ? 3.5 : 2.4);
    sprite.position.copy(g.position).addScaledVector(dir, 4);
    this.scene.add(sprite);
    this.bolts.push({ sprite, v: dir.multiplyScalar(160), age: 0, life: this.mode === 'intro' ? 0.9 : 0.6 });
  }

  private clearAll(): void {
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
