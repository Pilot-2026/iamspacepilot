import * as THREE from 'three';
import { TAIL_OFFSET, TICK_RATE } from '../core/config';
import type { SimEvent } from '../core/types';
import { RING_RADIUS, type World } from '../core/world';
import { createLevelEnv, type LevelEnv } from './levels';
import { RibbonView } from './ribbon';
import { sharedTextures } from './textures';

// Colours are written exactly as they should appear on screen.
THREE.ColorManagement.enabled = false;

const FWD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

interface PilotView {
  group: THREE.Group;
  ribbon: RibbonView;
  color: number;
  prevP: THREE.Vector3;
  prevQ: THREE.Quaternion;
  prevQb: THREE.Quaternion;
  p: THREE.Vector3;
  q: THREE.Quaternion;
  qb: THREE.Quaternion;
}

interface ShotView {
  core: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  glow: THREE.Sprite;
  seen: boolean;
}

interface BoltView {
  mesh: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  glow: THREE.Sprite;
}

interface Burst {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  vel: Float32Array;
  flash: THREE.Sprite;
  age: number;
}

/** Team games: warm colours for team 0, cool ones for team 1, taken from the level's palette. */
function teamPalette(colors: number[], team: number): number[] {
  const warm: number[] = [];
  const cool: number[] = [];
  const hsl = { h: 0, s: 0, l: 0 };
  const c = new THREE.Color();
  for (const v of colors) {
    c.setHex(v).getHSL(hsl);
    if (hsl.s < 0.3) continue;
    const deg = hsl.h * 360;
    (deg < 75 || deg >= 290 ? warm : cool).push(v);
  }
  const list = team === 0 ? warm : cool;
  return list.length ? list : [team === 0 ? 0xffb02e : 0x3dd6ff];
}

let gliderGeometry: THREE.BufferGeometry | null = null;

function gliderGeo(): THREE.BufferGeometry {
  if (gliderGeometry) return gliderGeometry;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 2.6, -1.8, 0, -1.2, 1.8, 0, -1.2, 0, 0.5, -0.8, 0, -0.22, -0.9], 3),
  );
  geo.setIndex([0, 1, 3, 0, 3, 2, 0, 4, 1, 0, 2, 4, 1, 3, 4, 2, 4, 3]);
  geo.computeVertexNormals();
  gliderGeometry = geo;
  return geo;
}

function makeGlider(color: number): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    gliderGeo(),
    new THREE.MeshStandardMaterial({ color: 0x161b28, metalness: 0.7, roughness: 0.3, flatShading: true, side: THREE.DoubleSide }),
  );
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(gliderGeo()), new THREE.LineBasicMaterial({ color, fog: false }));
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sharedTextures().glow,
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  glow.position.set(0, 0.05, -1.1);
  glow.scale.set(4, 4, 1);
  group.add(body, edges, glow);
  return group;
}

/** Draws the world with three.js. Knows nothing about menus or input. */
export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(66, 1, 0.5, 3200);
  private readonly scene = new THREE.Scene();
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 2);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private env: LevelEnv | null = null;
  private world: World | null = null;
  private player = 0;
  private pilots: PilotView[] = [];
  private ringViews: THREE.Group[] = [];
  private readonly boltViews = new Map<number, BoltView>();
  private readonly shotViews = new Map<number, ShotView>();
  private readonly shotGeo: THREE.CylinderGeometry;
  private readonly reticle: THREE.Sprite;
  private bursts: Burst[] = [];
  private readonly dust: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly dustPos: Float32Array;
  private flashLevel = 0;
  private shake = 0;
  private time = 0;
  private fov = 66;
  private spectateAngle = 0;
  private snapCamera = true;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3(0, 1, 0);
  private readonly tv = new THREE.Vector3();
  private readonly tv2 = new THREE.Vector3();
  private readonly tq = new THREE.Quaternion();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.scene.add(this.hemi, this.sun);

    // Shots: a bright rod along +Z with a glow at its head.
    this.shotGeo = new THREE.CylinderGeometry(0.16, 0.16, 5.2, 6, 1, true);
    this.shotGeo.rotateX(Math.PI / 2);
    this.shotGeo.translate(0, 0, -2.6);
    // Aiming circle: where your shots go, drawn on top of everything.
    this.reticle = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sharedTextures().reticle, transparent: true, depthTest: false, depthWrite: false, fog: false, sizeAttenuation: false, opacity: 0.8 }),
    );
    this.reticle.scale.set(0.05, 0.05, 1);
    this.reticle.renderOrder = 999;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    const N = 320;
    this.dustPos = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) this.dustPos[i] = (Math.random() - 0.5) * 70;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.dust = new THREE.Points(
      dg,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.18,
        map: sharedTextures().soft,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  setPixelRatio(r: number): void {
    this.renderer.setPixelRatio(r);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  colorOf(i: number): number {
    const pv = this.pilots[i];
    if (pv) return pv.color;
    const c = this.env?.colors ?? [0xffffff];
    return c[i % c.length];
  }

  /** Builds the scene for a new round. */
  load(world: World, player: number): void {
    this.clear();
    this.world = world;
    this.player = player;
    const env = createLevelEnv(world.spec.id);
    this.env = env;
    this.scene.add(env.group);
    this.scene.fog = env.fog;
    this.scene.background = new THREE.Color(env.background);
    this.hemi.color.setHex(env.hemi[0]);
    this.hemi.groundColor.setHex(env.hemi[1]);
    this.hemi.intensity = env.hemi[2];
    this.sun.color.setHex(env.sun[0]);
    this.sun.intensity = env.sun[1];
    this.sun.position.copy(env.sun[2]).normalize().multiplyScalar(100);

    const members = [0, 0];
    world.gliders.forEach((g, i) => {
      let color = env.colors[i % env.colors.length];
      if (world.teams && g.team >= 0) {
        const list = teamPalette(env.colors, g.team);
        color = list[members[g.team & 1]++ % list.length];
      }
      const group = makeGlider(color);
      if (i === player) group.scale.setScalar(1.05);
      const ribbon = new RibbonView(color, env.wall);
      this.scene.add(group, ribbon.mesh);
      const pv: PilotView = {
        group,
        ribbon,
        color,
        prevP: new THREE.Vector3(g.p.x, g.p.y, g.p.z),
        prevQ: new THREE.Quaternion(g.q.x, g.q.y, g.q.z, g.q.w),
        prevQb: new THREE.Quaternion(g.qb.x, g.qb.y, g.qb.z, g.qb.w),
        p: new THREE.Vector3(),
        q: new THREE.Quaternion(),
        qb: new THREE.Quaternion(),
      };
      this.pilots.push(pv);
    });

    for (let k = 0; k < world.rings.length; k++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, 0.35, 10, 64), new THREE.MeshBasicMaterial({ color: env.ringColor })));
      g.add(
        new THREE.Mesh(
          new THREE.TorusGeometry(RING_RADIUS, 1.4, 8, 64),
          new THREE.MeshBasicMaterial({ color: env.ringColor, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }),
        ),
      );
      this.scene.add(g);
      this.ringViews.push(g);
    }
    this.snapCamera = true;
    this.fov = 66;
    this.time = 0;
  }

  /** Remembers the current state so frames between ticks can be interpolated. */
  capturePrev(): void {
    const w = this.world;
    if (!w) return;
    w.gliders.forEach((g, i) => {
      const pv = this.pilots[i];
      pv.prevP.set(g.p.x, g.p.y, g.p.z);
      pv.prevQ.set(g.q.x, g.q.y, g.q.z, g.q.w);
      pv.prevQb.set(g.qb.x, g.qb.y, g.qb.z, g.qb.w);
    });
  }

  handleEvents(events: readonly SimEvent[]): void {
    const w = this.world;
    if (!w) return;
    for (const e of events) {
      if (e.type === 'crash') {
        this.crashAt(e.id);
      } else if (e.type === 'hit') {
        this.hitAt(e.id, e.by);
      } else if (e.type === 'bolt-strike') {
        this.flashLevel = 1;
      }
    }
  }

  /** Sparks where a shot hit glider id. */
  hitAt(id: number, by: number): void {
    const w = this.world;
    const pv = this.pilots[id];
    if (!w || !pv) return;
    const g = w.gliders[id];
    this.spawnBurst(g.p.x, g.p.y, g.p.z, this.pilots[by]?.color ?? 0xffffff, 0.3);
    if (id === this.player) this.shake = Math.max(this.shake, 0.4);
  }

  /** Explosion and dimmed wall where glider id went down. */
  crashAt(id: number): void {
    const w = this.world;
    const pv = this.pilots[id];
    if (!w || !pv) return;
    const g = w.gliders[id];
    this.spawnBurst(g.p.x, g.p.y, g.p.z, pv.color);
    pv.ribbon.setDim(0.6);
    if (id === this.player) this.shake = 1;
  }

  render(alpha: number, dt: number): void {
    const w = this.world;
    const env = this.env;
    if (!w || !env) return;
    this.time += dt;
    const now = (w.tick - 1 + alpha) / TICK_RATE;

    w.gliders.forEach((g, i) => {
      const pv = this.pilots[i];
      pv.p.lerpVectors(pv.prevP, this.tv.set(g.p.x, g.p.y, g.p.z), alpha);
      pv.q.slerpQuaternions(pv.prevQ, this.tq.set(g.q.x, g.q.y, g.q.z, g.q.w), alpha);
      pv.qb.slerpQuaternions(pv.prevQb, this.tq.set(g.qb.x, g.qb.y, g.qb.z, g.qb.w), alpha);
      pv.group.visible = g.alive;
      pv.group.position.copy(pv.p);
      pv.group.quaternion.copy(pv.q);
      if (g.alive) {
        const head = this.tv.copy(FWD).applyQuaternion(pv.q).multiplyScalar(-TAIL_OFFSET).add(pv.p);
        const up = this.tv2.copy(UP).applyQuaternion(pv.q);
        pv.ribbon.sync(w.trails[i], w.phase === 'countdown' ? null : head, up, now);
      } else {
        pv.ribbon.sync(w.trails[i], null, null, now);
      }
    });

    w.rings.forEach((ring, k) => {
      const v = this.ringViews[k];
      v.visible = ring.active;
      if (!ring.active) return;
      v.position.set(ring.c.x, ring.c.y, ring.c.z);
      v.lookAt(ring.c.x + ring.n.x, ring.c.y + ring.n.y, ring.c.z + ring.n.z);
      v.rotateZ(this.time * 0.6);
    });

    this.updateBolts(w);
    this.updateShots(w, alpha);
    this.updateBursts(dt);
    this.updateCamera(w, dt);
    this.updateReticle(w);

    const R = w.radius();
    env.shieldScale(R);
    const shrinking = w.phase !== 'countdown' && w.flyTime > w.spec.arena.shrinkStart && R > w.spec.arena.minRadius;
    for (const m of env.shieldMats) {
      m.uniforms.uPlayer.value.copy(this.pilots[this.player].p);
      m.uniforms.uPulse.value = shrinking ? 1 : 0;
      m.uniforms.uTime.value = this.time;
    }

    this.flashLevel = Math.max(0, this.flashLevel - dt * 2.5);
    env.flash(this.flashLevel * (0.6 + 0.4 * Math.abs(Math.sin(this.time * 70))));
    env.update(w, this.time, dt, this.camera);
    env.dome.position.copy(this.camera.position);
    this.updateDust(w);

    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(w: World, dt: number): void {
    const g = w.gliders[this.player];
    const pv = this.pilots[this.player];
    const chase = g.alive || w.tick - g.crashTick < 50;
    const target = this.tv;
    const look = this.tv2;
    let upTarget = UP;
    let k = 1 - Math.exp(-dt * 7);
    if (chase) {
      const f = new THREE.Vector3().copy(FWD).applyQuaternion(pv.qb);
      const u = new THREE.Vector3().copy(UP).applyQuaternion(pv.qb);
      target.copy(pv.p).addScaledVector(f, -14).addScaledVector(u, 4.2);
      look.copy(pv.p).addScaledVector(f, 14).addScaledVector(u, 1.2);
      upTarget = u;
    } else {
      this.spectateAngle += dt * 0.12;
      const R = w.radius();
      target.set(Math.cos(this.spectateAngle) * R * 0.95, 38, Math.sin(this.spectateAngle) * R * 0.95);
      const leader = w.gliders.find((x) => x.alive);
      if (leader) look.set(leader.p.x, leader.p.y, leader.p.z);
      else look.set(0, 0, 0);
      k = 1 - Math.exp(-dt * 1.5);
    }
    if (this.snapCamera) {
      k = 1;
      this.snapCamera = false;
      this.camUp.copy(upTarget);
    }
    this.camPos.lerp(target, k);
    this.camLook.lerp(look, k);
    this.camUp.lerp(upTarget, 1 - Math.exp(-dt * 5)).normalize();
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      const s = this.shake * 0.9;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 1.6);
    }
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(this.camLook);
    const fovTarget = chase && g.boosting ? 76 : 66;
    const nf = this.fov + (fovTarget - this.fov) * (1 - Math.exp(-dt * 4));
    if (Math.abs(nf - this.fov) > 0.01 || this.camera.fov !== nf) {
      this.fov = nf;
      this.camera.fov = nf;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateDust(w: World): void {
    const g = w.gliders[this.player];
    this.dust.visible = g.alive && w.phase !== 'countdown';
    if (!this.dust.visible) return;
    const c = this.camera.position;
    const pos = this.dustPos;
    const half = 35;
    for (let i = 0; i < pos.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        const cc = a === 0 ? c.x : a === 1 ? c.y : c.z;
        let v = pos[i + a];
        while (v - cc > half) v -= half * 2;
        while (v - cc < -half) v += half * 2;
        pos[i + a] = v;
      }
    }
    (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateShots(w: World, alpha: number): void {
    for (const v of this.shotViews.values()) v.seen = false;
    for (const s of w.shots) {
      if (!s.alive) continue;
      let v = this.shotViews.get(s.key);
      if (!v) {
        const color = this.pilots[s.owner]?.color ?? 0xffffff;
        const core = new THREE.Mesh(
          this.shotGeo,
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55),
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false,
          }),
        );
        const glow = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: sharedTextures().glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
        );
        glow.scale.set(4.4, 4.4, 1);
        this.scene.add(core, glow);
        v = { core, glow, seen: true };
        this.shotViews.set(s.key, v);
      }
      v.seen = true;
      const p = this.tv.set(s.pPrev.x, s.pPrev.y, s.pPrev.z).lerp(this.tv2.set(s.p.x, s.p.y, s.p.z), alpha);
      v.core.position.copy(p);
      v.glow.position.copy(p);
      v.core.quaternion.setFromUnitVectors(FWD, this.tv2.set(s.d.x, s.d.y, s.d.z));
    }
    for (const [key, v] of this.shotViews) {
      if (v.seen) continue;
      this.removeShot(v);
      this.shotViews.delete(key);
    }
  }

  private removeShot(v: ShotView): void {
    this.scene.remove(v.core, v.glow);
    v.core.material.dispose();
    v.glow.material.dispose();
  }

  /** Puts the aiming circle where your shots fly. */
  private updateReticle(w: World): void {
    const g = w.gliders[this.player];
    const pv = this.pilots[this.player];
    const on = !!g && !!pv && g.alive && w.phase === 'flying';
    this.reticle.visible = on;
    if (!on) return;
    this.reticle.position.copy(this.tv.copy(FWD).applyQuaternion(pv.q).multiplyScalar(70).add(pv.p));
    this.reticle.material.color.setHex(g.overheated ? 0xff5050 : pv.color);
  }

  private spawnBurst(x: number, y: number, z: number, color: number, size = 1): void {
    const N = Math.round(180 * size);
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      let vx = Math.random() * 2 - 1;
      let vy = Math.random() * 2 - 1;
      let vz = Math.random() * 2 - 1;
      const l = Math.hypot(vx, vy, vz) || 1;
      const s = (6 + Math.random() * 22) * (0.5 + size * 0.5);
      vx = (vx / l) * s;
      vy = (vy / l) * s;
      vz = (vz / l) * s;
      vel[i * 3] = vx;
      vel[i * 3 + 1] = vy;
      vel[i * 3 + 2] = vz;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color,
        size: 1.1,
        map: sharedTextures().soft,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    points.frustumCulled = false;
    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sharedTextures().glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    flash.position.set(x, y, z);
    flash.scale.set(34 * size, 34 * size, 1);
    this.scene.add(points, flash);
    this.bursts.push({ points, vel, flash, age: 0 });
  }

  private updateBursts(dt: number): void {
    for (let b = this.bursts.length - 1; b >= 0; b--) {
      const burst = this.bursts[b];
      burst.age += dt;
      const attr = burst.points.geometry.attributes.position as THREE.BufferAttribute;
      const pos = attr.array as Float32Array;
      const drag = Math.max(0, 1 - dt * 1.4);
      for (let i = 0; i < pos.length; i++) {
        pos[i] += burst.vel[i] * dt;
        burst.vel[i] *= drag;
      }
      attr.needsUpdate = true;
      burst.points.material.opacity = Math.max(0, 1 - burst.age / 1.6);
      burst.flash.material.opacity = Math.max(0, 1 - burst.age / 0.35);
      if (burst.age > 1.6) {
        this.scene.remove(burst.points, burst.flash);
        burst.points.geometry.dispose();
        burst.points.material.dispose();
        burst.flash.material.dispose();
        this.bursts.splice(b, 1);
      }
    }
  }

  private updateBolts(w: World): void {
    const alive = new Set<number>();
    for (const b of w.bolts) {
      alive.add(b.id);
      let v = this.boltViews.get(b.id);
      if (!v) {
        const pts = b.x.map((x, k) => new THREE.Vector3(x, b.y[k], b.z[k]));
        const path = new THREE.CurvePath<THREE.Vector3>();
        for (let k = 0; k < pts.length - 1; k++) path.add(new THREE.LineCurve3(pts[k], pts[k + 1]));
        const mesh = new THREE.Mesh(
          new THREE.TubeGeometry(path, 48, 0.55, 6, false),
          new THREE.MeshBasicMaterial({
            color: this.env?.boltColor ?? 0xf3ecff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false,
          }),
        );
        const glow = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: sharedTextures().glow,
            color: this.env?.boltGlow ?? 0x9c84ff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false,
          }),
        );
        const mid = Math.floor(pts.length / 2);
        glow.position.copy(pts[mid]);
        glow.scale.set(60, 140, 1);
        this.scene.add(mesh, glow);
        v = { mesh, glow };
        this.boltViews.set(b.id, v);
      }
      const t = w.tick;
      if (t < b.strikeTick) {
        // Warning: a faint flickering column shows where the bolt will hit.
        const k = (t - b.warnTick) / (b.strikeTick - b.warnTick);
        v.mesh.material.opacity = 0.08 + 0.18 * k * (0.5 + 0.5 * Math.sin(this.time * 40));
        v.glow.material.opacity = 0.1 * k;
      } else {
        const since = (t - b.strikeTick) / TICK_RATE;
        const left = (b.endTick - t) / TICK_RATE;
        const fade = Math.min(1, left / 0.6);
        v.mesh.material.opacity = (since < 0.25 ? 1 : 0.55 + 0.25 * Math.sin(this.time * 31)) * fade;
        v.glow.material.opacity = (since < 0.3 ? 0.9 : 0.25) * fade;
      }
    }
    for (const [id, v] of this.boltViews) {
      if (alive.has(id)) continue;
      this.scene.remove(v.mesh, v.glow);
      v.mesh.geometry.dispose();
      v.mesh.material.dispose();
      v.glow.material.dispose();
      this.boltViews.delete(id);
    }
  }

  /** Removes everything that belongs to the current round. */
  clear(): void {
    for (const pv of this.pilots) {
      this.scene.remove(pv.group, pv.ribbon.mesh);
      pv.ribbon.dispose();
      pv.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.material) (m.material as THREE.Material).dispose();
        if (o instanceof THREE.LineSegments) o.geometry.dispose();
      });
    }
    this.pilots = [];
    for (const r of this.ringViews) {
      this.scene.remove(r);
      r.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (m.material as THREE.Material).dispose();
      });
    }
    this.ringViews = [];
    for (const [, v] of this.boltViews) {
      this.scene.remove(v.mesh, v.glow);
      v.mesh.geometry.dispose();
      v.mesh.material.dispose();
      v.glow.material.dispose();
    }
    this.boltViews.clear();
    for (const v of this.shotViews.values()) this.removeShot(v);
    this.shotViews.clear();
    this.reticle.visible = false;
    for (const b of this.bursts) {
      this.scene.remove(b.points, b.flash);
      b.points.geometry.dispose();
      b.points.material.dispose();
      b.flash.material.dispose();
    }
    this.bursts = [];
    if (this.env) {
      this.scene.remove(this.env.group);
      this.env.dispose();
      this.env = null;
    }
    this.world = null;
  }
}
