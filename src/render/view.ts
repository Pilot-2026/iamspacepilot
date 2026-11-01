import * as THREE from 'three';
import { TAIL_OFFSET, TAPER_MIN, TICK_RATE, WALL_HALF } from '../core/config';
import type { SimEvent } from '../core/types';
import { BIG_WALL, POWERS, type PowerId } from '../core/powerups';
import { SHOCKWAVE_RADIUS } from '../core/ships';
import type { LevelId } from '../core/types';
import { RING_RADIUS, World } from '../core/world';
import { Cockpit, COCKPIT_FOV } from './cockpit';
import { fallColumn, makeObstacleView, type ObstacleView } from './obstacles';
import { disposeShip, makeShip, type ShipMesh } from './ships';
import { createLevelEnv, type LevelEnv } from './levels';
import { RibbonView } from './ribbon';
import { sharedTextures } from './textures';

// Colours are written exactly as they should appear on screen.
THREE.ColorManagement.enabled = false;

const FWD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** Camera views, switched with the eye button (or V) in this order. */
export type ViewMode = 'chase' | 'cockpit' | 'rear' | 'front' | 'top' | 'below' | 'far' | 'clean';
export const VIEW_ORDER: readonly ViewMode[] = ['chase', 'far', 'cockpit', 'rear', 'front', 'top', 'below', 'clean'];
export const VIEW_NAMES: Readonly<Record<ViewMode, string>> = {
  chase: 'Chase',
  cockpit: 'Cockpit',
  rear: 'Rear three-quarter',
  front: 'Front',
  top: 'Top',
  below: 'Below',
  far: 'Far',
  clean: 'Clean view',
};

/**
 * Where the camera sits and looks, in the ship's frame (x left, y up, z forward),
 * which way is up on screen, and how quickly the camera follows.
 */
interface Rig {
  cam: THREE.Vector3;
  look: THREE.Vector3;
  up: 'ship' | 'fwd';
  follow: number;
}
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const CHASE: Rig = { cam: v3(0, 4.2, -14), look: v3(0, 1.2, 14), up: 'ship', follow: 7 };
const RIGS: Readonly<Record<Exclude<ViewMode, 'cockpit'>, Rig>> = {
  chase: CHASE,
  clean: CHASE,
  rear: { cam: v3(-9, 5.5, -11), look: v3(0, 0.5, 9), up: 'ship', follow: 6 },
  front: { cam: v3(0, 3, 16), look: v3(0, 0.6, -4), up: 'ship', follow: 7 },
  top: { cam: v3(0, 30, -4), look: v3(0, 0, 5), up: 'fwd', follow: 6 },
  below: { cam: v3(0, -26, -4), look: v3(0, 0, 5), up: 'fwd', follow: 6 },
  far: { cam: v3(0, 24, -64), look: v3(0, 0, 24), up: 'ship', follow: 3 },
};
/** The pilot's eye inside the ship. */
const SEAT = v3(0, 0.75, 0.85);
const TURN = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);

interface PilotView {
  group: THREE.Group;
  ship: ShipMesh;
  /** Bubble of the shield power-up. */
  shield: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  /** Coloured glow while a power-up runs. */
  aura: THREE.Sprite;
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
  /** Water drops fall; sparks do not. */
  gravity?: number;
  life?: number;
}

/** A soft dark spot with a thin light ring: readable on bright and on dark floors. */
function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const x = c.getContext('2d');
  if (x) {
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 60);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    g.addColorStop(0.8, 'rgba(0,0,0,0.1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    x.strokeStyle = 'rgba(255,255,255,0.75)';
    x.lineWidth = 3;
    x.beginPath();
    x.arc(64, 64, 50, 0, Math.PI * 2);
    x.stroke();
  }
  return new THREE.CanvasTexture(c);
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

const ICONS: Record<PowerId, string> = { triple: '×3', bigwall: '▲', shield: '◯', rapid: '∞', turbo: '»', seeker: '◎', repair: '+' };
const iconCache = new Map<PowerId, THREE.Texture>();

/** Symbol of a power-up, drawn once into a texture. */
function powerIcon(p: PowerId): THREE.Texture {
  let t = iconCache.get(p);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const x = c.getContext('2d');
  if (x) {
    const col = `#${POWERS[p].color.toString(16).padStart(6, '0')}`;
    x.fillStyle = 'rgba(0,0,0,0.35)';
    x.beginPath();
    x.arc(64, 64, 58, 0, Math.PI * 2);
    x.fill();
    x.font = '800 64px Unbounded, Arial Black, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.shadowColor = col;
    x.shadowBlur = 18;
    x.fillStyle = '#ffffff';
    x.fillText(ICONS[p], 64, 70);
  }
  t = new THREE.CanvasTexture(c);
  iconCache.set(p, t);
  return t;
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
  /** Start screen showcase: a world without ships. */
  private show: { world: World; angle: number } | null = null;
  /** Pixel ratio for the game; the showcase behind the menu uses less. */
  private gameRatio = 1;
  private player = 0;
  private pilots: PilotView[] = [];
  private ringViews: THREE.Group[] = [];
  private readonly boltViews = new Map<number, BoltView>();
  private waves: { mesh: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>; age: number }[] = [];
  private obstacleViews: ObstacleView[] = [];
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
  /** Current camera view, zoom (1 = normal, smaller = closer) and orbit around the ship. */
  private viewMode: ViewMode = 'chase';
  private zoom = 1;
  private yaw = 0;
  private pitch = 0;
  private cockpit: Cockpit | null = null;
  /** The cockpit was drawn last frame. */
  private cockpitOn = false;
  private touchLayout = false;
  /** Shadows: one on the floor under every ship, and yours on the nearest shield wall and the ceiling. */
  private readonly shadowGeo = new THREE.PlaneGeometry(1, 1);
  private shadowTex: THREE.CanvasTexture | null = null;
  private floorShadows: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private wallShadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private ceilShadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  /** When each ship may splash again in a waterfall. */
  private splashAt: number[] = [];
  /** Your ship flew through a waterfall. */
  onSplash: () => void = () => undefined;
  private readonly orbitQ = new THREE.Quaternion();
  private readonly orbitE = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tv3 = new THREE.Vector3();
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
    this.gameRatio = r;
    if (!this.show) this.renderer.setPixelRatio(r);
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
  /** Sky, fog and light of a level. */
  private useEnv(env: LevelEnv): void {
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
  }

  /** Start screen: a slowly turning view of a level's world, shining through the menu. */
  showcase(level: LevelId): void {
    this.clear();
    const env = createLevelEnv(level);
    env.shield.visible = false;
    this.useEnv(env);
    const world = new World({ level, seed: 5, pilots: [{ name: '', isBot: true, assist: true, skill: 'rookie', remote: true }] });
    this.show = { world, angle: Math.random() * Math.PI * 2 };
    this.addObstacles(world);
    // Only 5% of it shows through the menu: a lower resolution is plenty.
    this.renderer.setPixelRatio(0.6);
  }

  get showing(): boolean {
    return !!this.show;
  }

  renderShowcase(dt: number): void {
    const s = this.show;
    const env = this.env;
    if (!s || !env) return;
    this.time += dt;
    s.angle += dt * 0.06;
    s.world.tick = Math.floor(this.time * 60);
    s.world.obstacles.forEach((o, k) => {
      o.update(s.world.tick);
      this.obstacleViews[k]?.update(o, this.time);
    });
    const R = s.world.spec.arena.radius * 0.55;
    const a = s.angle;
    this.camera.position.set(Math.cos(a) * R, 10 + Math.sin(this.time * 0.13) * 6, Math.sin(a) * R);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(Math.cos(a + 1.3) * R * 2.2, 26, Math.sin(a + 1.3) * R * 2.2);
    if (this.camera.fov !== 66) {
      this.camera.fov = 66;
      this.camera.updateProjectionMatrix();
    }
    env.update(s.world, this.time, dt, this.camera);
    env.dome.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  load(world: World, player: number): void {
    this.clear();
    this.renderer.setPixelRatio(this.gameRatio);
    this.world = world;
    this.player = player;
    this.useEnv(createLevelEnv(world.spec.id));
    const env = this.env as LevelEnv;
    this.addObstacles(world);

    const members = [0, 0];
    world.gliders.forEach((g, i) => {
      let color = env.colors[i % env.colors.length];
      if (world.teams && g.team >= 0) {
        const list = teamPalette(env.colors, g.team);
        color = list[members[g.team & 1]++ % list.length];
      }
      const ship = makeShip(g.ship.id, color, sharedTextures().glow);
      const group = ship.group;
      if (i === player) group.scale.setScalar(1.05);
      const shield = new THREE.Mesh(
        new THREE.IcosahedronGeometry(4.6, 1),
        new THREE.MeshBasicMaterial({ color: POWERS.shield.color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, wireframe: true }),
      );
      shield.visible = false;
      group.add(shield);
      const aura = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: sharedTextures().glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5, fog: false }),
      );
      aura.scale.setScalar(12);
      aura.visible = false;
      group.add(aura);
      const ribbon = new RibbonView(color, env.wall);
      this.scene.add(group, ribbon.mesh);
      const pv: PilotView = {
        group,
        ship,
        shield,
        aura,
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

    this.shadowTex ??= shadowTexture();
    const shadowMat = (color: number) =>
      new THREE.MeshBasicMaterial({ map: this.shadowTex, color, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: false });
    this.floorShadows = this.pilots.map((pv) => {
      const m = new THREE.Mesh(this.shadowGeo, shadowMat(pv.color));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 2;
      this.scene.add(m);
      return m;
    });
    const mine = this.pilots[player]?.color ?? 0xffffff;
    this.wallShadow = new THREE.Mesh(this.shadowGeo, shadowMat(mine));
    this.ceilShadow = new THREE.Mesh(this.shadowGeo, shadowMat(mine));
    this.ceilShadow.rotation.x = Math.PI / 2;
    this.scene.add(this.wallShadow, this.ceilShadow);
    this.splashAt = this.pilots.map(() => 0);

    for (let k = 0; k < world.rings.length; k++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, 0.35, 10, 64), new THREE.MeshBasicMaterial({ color: env.ringColor })));
      g.add(
        new THREE.Mesh(
          new THREE.TorusGeometry(RING_RADIUS, 1.4, 8, 64),
          new THREE.MeshBasicMaterial({ color: env.ringColor, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }),
        ),
      );
      // The bonus inside the ring, as a symbol.
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false }));
      icon.scale.setScalar(6);
      g.add(icon);
      g.userData.power = '';
      this.scene.add(g);
      this.ringViews.push(g);
    }
    this.snapCamera = true;
    this.fov = 66;
    this.time = 0;
    this.cockpit?.setStyle(this.pilots[player]?.color ?? 0x7af0ff, env.hemi[0], env.hemi[1], env.hemi[2]);
  }

  private addObstacles(world: World): void {
    this.obstacleViews = world.obstacles.map((o, i) => {
      const v = makeObstacleView(o, i, world.spec.arena.floorY);
      v.update(o, 0);
      this.scene.add(v.obj);
      return v;
    });
  }

  // ---------- camera views ----------

  get view(): ViewMode {
    return this.viewMode;
  }

  /** Switches the camera view; zoom and orbit start fresh. */
  setView(mode: ViewMode): void {
    if ((mode === 'cockpit') !== (this.viewMode === 'cockpit')) this.snapCamera = true;
    this.viewMode = mode;
    this.resetLook();
  }

  /** The next view in the cycle. */
  nextView(): ViewMode {
    const i = VIEW_ORDER.indexOf(this.viewMode);
    this.setView(VIEW_ORDER[(i + 1) % VIEW_ORDER.length]);
    return this.viewMode;
  }

  /** Pinch and drag: zoom (multiplier, < 1 comes closer) and orbit around the ship (radians). */
  look(zoomMul: number, dYaw: number, dPitch: number): void {
    const cockpit = this.viewMode === 'cockpit';
    this.zoom = THREE.MathUtils.clamp(this.zoom * zoomMul, cockpit ? 0.4 : 0.35, cockpit ? 1.4 : 3.2);
    this.yaw += dYaw;
    if (cockpit) this.yaw = THREE.MathUtils.clamp(this.yaw, -2.4, 2.4);
    else if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, cockpit ? -1 : -1.45, cockpit ? 1 : 1.45);
  }

  resetLook(): void {
    this.zoom = 1;
    this.yaw = 0;
    this.pitch = 0;
  }

  /** With touch controls the cockpit screens move away from the thumbs. */
  setTouchLayout(on: boolean): void {
    this.touchLayout = on;
  }

  /** Canvases the HUD draws the cockpit screens into. */
  setCockpitScreens(left: HTMLCanvasElement, right: HTMLCanvasElement, radar: HTMLCanvasElement): void {
    this.cockpit ??= new Cockpit();
    this.cockpit.setScreens(left, right, radar);
  }

  /** The HUD redrew the cockpit screens. */
  refreshCockpit(side: boolean, radar: boolean): void {
    if (this.cockpitOn) this.cockpit?.refresh(side, radar);
  }

  /** True while the camera sits in the cockpit. */
  get inCockpit(): boolean {
    return this.cockpitOn;
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
      } else if (e.type === 'special' && e.kind === 'shockwave') {
        this.shockwaveAt(e.id);
      } else if (e.type === 'jam' || e.type === 'shield') {
        const g = w.gliders[e.id];
        this.spawnBurst(g.p.x, g.p.y, g.p.z, e.type === 'shield' ? POWERS.shield.color : 0xffffff, 0.25);
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

  /** Engine flames, phase shimmer, shield bubble and power-up glow of glider i. */
  private shipEffects(w: World, i: number, dt: number): void {
    const g = w.gliders[i];
    const pv = this.pilots[i];
    const s = pv.ship;
    const burner = g.ship.special.kind === 'afterburner' && w.tick < g.specialUntil;
    const flicker = 0.9 + Math.random() * 0.2;
    const size = s.flame * (g.boosting ? 1.7 : 1) * (burner ? 1.6 : 1) * flicker;
    for (const f of s.flames) f.scale.setScalar(size);
    const phase = w.phasing(g);
    for (const m of s.solids) {
      if (m.transparent !== phase) {
        m.transparent = phase;
        m.needsUpdate = true;
      }
      m.opacity = phase ? 0.3 + 0.15 * Math.sin(this.time * 30) : 1;
    }
    pv.shield.visible = g.shield;
    if (g.shield) pv.shield.rotation.y += dt * 0.8;
    const power = g.power && g.power !== 'shield' ? g.power : null;
    pv.aura.visible = !!power;
    if (power) {
      pv.aura.material.color.setHex(POWERS[power].color);
      pv.aura.material.opacity = 0.35 + 0.15 * Math.sin(this.time * 6);
    }
  }

  /** Bulwark shockwave: an expanding shell where it went off. */
  shockwaveAt(id: number): void {
    const w = this.world;
    const pv = this.pilots[id];
    if (!w || !pv) return;
    const g = w.gliders[id];
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshBasicMaterial({ color: pv.color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, wireframe: true }),
    );
    mesh.position.set(g.p.x, g.p.y, g.p.z);
    this.scene.add(mesh);
    this.waves.push({ mesh, age: 0 });
    this.spawnBurst(g.p.x, g.p.y, g.p.z, pv.color, 0.4);
  }

  private updateWaves(dt: number): void {
    for (let k = this.waves.length - 1; k >= 0; k--) {
      const wv = this.waves[k];
      wv.age += dt;
      const u = Math.min(1, wv.age / 0.6);
      wv.mesh.scale.setScalar(2 + SHOCKWAVE_RADIUS * u);
      wv.mesh.material.opacity = 0.6 * (1 - u);
      if (u >= 1) {
        this.scene.remove(wv.mesh);
        wv.mesh.geometry.dispose();
        wv.mesh.material.dispose();
        this.waves.splice(k, 1);
      }
    }
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
      pv.group.visible = g.alive && !(i === this.player && this.cockpitOn);
      pv.group.position.copy(pv.p);
      pv.group.quaternion.copy(pv.q);
      if (g.alive) this.shipEffects(w, i, dt);
      if (g.alive) {
        const head = this.tv.copy(FWD).applyQuaternion(pv.q).multiplyScalar(-TAIL_OFFSET).add(pv.p);
        const up = this.tv2.copy(UP).applyQuaternion(pv.q);
        const headHalf = (g.power === 'bigwall' ? WALL_HALF * BIG_WALL : WALL_HALF) * TAPER_MIN;
        pv.ribbon.sync(w.trails[i], w.phase === 'countdown' ? null : head, up, now, w.tick, headHalf);
      } else {
        pv.ribbon.sync(w.trails[i], null, null, now, w.tick, 0);
      }
    });

    w.rings.forEach((ring, k) => {
      const v = this.ringViews[k];
      v.visible = ring.active;
      if (!ring.active) return;
      if (v.userData.power !== ring.power) {
        v.userData.power = ring.power;
        const color = POWERS[ring.power].color;
        for (const c of v.children) {
          if (c instanceof THREE.Mesh) (c.material as THREE.MeshBasicMaterial).color.setHex(color);
        }
        const icon = v.children[2] as THREE.Sprite;
        icon.material.map = powerIcon(ring.power);
        icon.material.needsUpdate = true;
      }
      v.position.set(ring.c.x, ring.c.y, ring.c.z);
      v.lookAt(ring.c.x + ring.n.x, ring.c.y + ring.n.y, ring.c.z + ring.n.z);
      v.rotateZ(this.time * 0.6);
    });
    this.updateWaves(dt);
    w.obstacles.forEach((o, k) => this.obstacleViews[k]?.update(o, this.time));
    this.updateShadows(w);
    this.updateSplashes(w);

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
    const ck = this.cockpit;
    if (this.cockpitOn && ck) {
      const g = w.gliders[this.player];
      ck.layout(this.camera.aspect, this.touchLayout);
      ck.setHead(this.yaw, -this.pitch);
      ck.update(dt, g.boosting);
      // The cockpit is drawn over the world, so nothing outside can cut through it.
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(ck.scene, ck.camera);
      this.renderer.autoClear = true;
    }
  }

  private updateCamera(w: World, dt: number): void {
    const g = w.gliders[this.player];
    const pv = this.pilots[this.player];
    const chase = g.alive || w.tick - g.crashTick < 50;
    const cockpit = chase && g.alive && this.viewMode === 'cockpit' && !!this.cockpit;
    if (cockpit !== this.cockpitOn) this.snapCamera = true;
    this.cockpitOn = cockpit;
    const target = this.tv;
    const look = this.tv2;
    const up = this.tv3;
    let k = 1 - Math.exp(-dt * 7);
    let upK = 1 - Math.exp(-dt * 5);
    let fovTarget = 66;
    if (cockpit) {
      // Rigidly in the pilot's seat, banking with the ship; the head can turn.
      target.copy(SEAT).applyQuaternion(pv.q).add(pv.p);
      this.camPos.copy(target);
      this.camera.position.copy(target);
      this.orbitE.set(-this.pitch, this.yaw, 0, 'YXZ');
      this.camera.quaternion.copy(pv.q).multiply(TURN).multiply(this.orbitQ.setFromEuler(this.orbitE));
      this.camUp.copy(UP).applyQuaternion(pv.q);
      this.snapCamera = false;
      if (this.shake > 0) {
        const s = this.shake * 0.5;
        this.camera.position.x += (Math.random() - 0.5) * s;
        this.camera.position.y += (Math.random() - 0.5) * s;
        this.camera.position.z += (Math.random() - 0.5) * s;
        this.shake = Math.max(0, this.shake - dt * 1.6);
      }
      fovTarget = COCKPIT_FOV * this.zoom + (g.boosting ? 6 : 0);
    } else {
      if (chase) {
        const rig = RIGS[this.viewMode === 'cockpit' ? 'chase' : this.viewMode];
        this.orbitE.set(this.pitch, this.yaw, 0, 'YXZ');
        const oq = this.orbitQ.setFromEuler(this.orbitE);
        target.copy(rig.cam).applyQuaternion(oq).multiplyScalar(this.zoom).applyQuaternion(pv.qb).add(pv.p);
        look.copy(rig.look).applyQuaternion(oq).multiplyScalar(this.zoom).applyQuaternion(pv.qb).add(pv.p);
        up.copy(rig.up === 'ship' ? UP : FWD).applyQuaternion(oq).applyQuaternion(pv.qb);
        k = 1 - Math.exp(-dt * rig.follow);
        if (g.boosting) fovTarget = 76;
      } else {
        this.spectateAngle += dt * 0.12;
        const R = w.radius();
        target.set(Math.cos(this.spectateAngle) * R * 0.95, 38, Math.sin(this.spectateAngle) * R * 0.95);
        const leader = w.gliders.find((x) => x.alive);
        if (leader) look.set(leader.p.x, leader.p.y, leader.p.z);
        else look.set(0, 0, 0);
        up.copy(UP);
        k = 1 - Math.exp(-dt * 1.5);
      }
      if (this.snapCamera) {
        k = 1;
        upK = 1;
        this.snapCamera = false;
      }
      this.camPos.lerp(target, k);
      this.camLook.lerp(look, k);
      this.camUp.lerp(up, upK).normalize();
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
    }
    const nf = this.fov + (fovTarget - this.fov) * (cockpit && Math.abs(fovTarget - this.fov) > 12 ? 1 : 1 - Math.exp(-dt * 4));
    if (Math.abs(nf - this.fov) > 0.01 || this.camera.fov !== nf) {
      this.fov = nf;
      this.camera.fov = nf;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Ship shadows on the floor, the nearest shield wall and the ceiling: they show how far away the grid is. */
  private updateShadows(w: World): void {
    const a = w.spec.arena;
    const R = w.radius();
    w.gliders.forEach((g, i) => {
      const m = this.floorShadows[i];
      const pv = this.pilots[i];
      if (!m || !pv) return;
      const h = pv.p.y - a.floorY;
      m.visible = g.alive && h < 260;
      if (!m.visible) return;
      m.position.set(pv.p.x, a.floorY + 0.25, pv.p.z);
      m.scale.setScalar(7 + h * 0.06);
      m.material.opacity = Math.max(0.12, Math.min(0.85, 1 - h / 200));
    });
    const g = w.gliders[this.player];
    const pv = this.pilots[this.player];
    const wall = this.wallShadow;
    const ceil = this.ceilShadow;
    if (!wall || !ceil || !g || !pv) return;
    const p = pv.p;
    let d: number;
    if (a.kind === 'dome') {
      const l = Math.max(1e-3, p.length());
      d = R - l;
      wall.position.copy(p).multiplyScalar((R - 0.4) / l);
    } else {
      const l = Math.max(1e-3, Math.hypot(p.x, p.z));
      d = R - l;
      wall.position.set((p.x * (R - 0.4)) / l, p.y, (p.z * (R - 0.4)) / l);
    }
    wall.visible = g.alive && d < 90 && wall.position.y > a.floorY;
    if (wall.visible) {
      wall.lookAt(0, a.kind === 'dome' ? 0 : wall.position.y, 0);
      wall.scale.setScalar(7 + Math.max(0, d) * 0.06);
      wall.material.opacity = Math.max(0, Math.min(0.85, 1 - d / 90));
    }
    const dc = a.ceilY - p.y;
    ceil.visible = g.alive && a.kind === 'cylinder' && dc < 90;
    if (ceil.visible) {
      ceil.position.set(p.x, a.ceilY - 0.25, p.z);
      ceil.scale.setScalar(7 + Math.max(0, dc) * 0.06);
      ceil.material.opacity = Math.max(0, Math.min(0.85, 1 - dc / 90));
    }
  }

  /** Ships flying through a waterfall make it splash. */
  private updateSplashes(w: World): void {
    const floor = w.spec.arena.floorY;
    for (const o of w.obstacles) {
      const col = fallColumn(o);
      if (!col) continue;
      w.gliders.forEach((g, i) => {
        if (!g.alive || this.time < (this.splashAt[i] ?? 0)) return;
        const pv = this.pilots[i];
        const dx = pv.p.x - col.x;
        const dz = pv.p.z - col.z;
        if (dx * dx + dz * dz > (col.r + 1.6) * (col.r + 1.6) || pv.p.y > col.top || pv.p.y < floor) return;
        this.splashAt[i] = this.time + 0.12;
        this.spawnSplash(pv.p.x, pv.p.y, pv.p.z);
        if (i === this.player) this.onSplash();
      });
    }
  }

  /** Water drops spraying away and falling. */
  private spawnSplash(x: number, y: number, z: number): void {
    const N = 70;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const s = 5 + Math.random() * 14;
      vel[i * 3] = Math.cos(a) * s;
      vel[i * 3 + 1] = 2 + Math.random() * 10;
      vel[i * 3 + 2] = Math.sin(a) * s;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xe9f8ff, size: 0.75, map: sharedTextures().soft, transparent: true, depthWrite: false }));
    points.frustumCulled = false;
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: sharedTextures().glow, color: 0xdff4ff, transparent: true, depthWrite: false, opacity: 0.7 }));
    flash.position.set(x, y, z);
    flash.scale.set(10, 10, 1);
    this.scene.add(points, flash);
    this.bursts.push({ points, vel, flash, age: 0, gravity: 22, life: 1.1 });
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
      const fall = (burst.gravity ?? 0) * dt;
      for (let i = 0; i < pos.length; i++) {
        pos[i] += burst.vel[i] * dt;
        burst.vel[i] *= drag;
        if (fall && i % 3 === 1) burst.vel[i] -= fall;
      }
      attr.needsUpdate = true;
      const life = burst.life ?? 1.6;
      burst.points.material.opacity = Math.max(0, 1 - burst.age / life);
      burst.flash.material.opacity = Math.max(0, 1 - burst.age / 0.35);
      if (burst.age > life) {
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
      disposeShip(pv.ship);
      pv.shield.geometry.dispose();
      pv.shield.material.dispose();
      pv.aura.material.dispose();
    }
    for (const v of this.obstacleViews) {
      this.scene.remove(v.obj);
      v.dispose();
    }
    this.obstacleViews = [];
    for (const m of [...this.floorShadows, this.wallShadow, this.ceilShadow]) {
      if (!m) continue;
      this.scene.remove(m);
      m.material.dispose();
    }
    this.floorShadows = [];
    this.wallShadow = null;
    this.ceilShadow = null;
    for (const wv of this.waves) {
      this.scene.remove(wv.mesh);
      wv.mesh.geometry.dispose();
      wv.mesh.material.dispose();
    }
    this.waves = [];
    this.pilots = [];
    for (const r of this.ringViews) {
      this.scene.remove(r);
      r.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && !(o instanceof THREE.Sprite)) m.geometry.dispose();
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
    this.show = null;
  }
}
