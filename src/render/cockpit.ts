import * as THREE from 'three';

/**
 * The cockpit view: canopy frame, dashboard and three glowing screens
 * (flight data, radar, round data). It lives in its own little scene that is
 * drawn after the world with a cleared depth buffer, so walls and ships
 * flying close by never cut through it. The layout follows the screen shape.
 */

/** Size of everything at this distance from the eye. */
const D = 1.2;
/** Field of view of the cockpit camera (the world camera may zoom). */
export const COCKPIT_FOV = 72;

interface Screens {
  left: THREE.CanvasTexture;
  right: THREE.CanvasTexture;
  radar: THREE.CanvasTexture;
}

function roundedShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Faint glare on the canopy glass. */
function glareTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const x = c.getContext('2d');
  if (x) {
    const g = x.createRadialGradient(60, 40, 0, 60, 40, 200);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(255,255,255,0.22)';
    x.lineWidth = 6;
    for (const k of [0, 22]) {
      x.beginPath();
      x.moveTo(150 + k, 0);
      x.lineTo(0, 150 + k);
      x.stroke();
    }
  }
  return new THREE.CanvasTexture(c);
}

export class Cockpit {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(COCKPIT_FOV, 1, 0.05, 20);
  private readonly root = new THREE.Group();
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x202028, 1.6);
  private readonly key = new THREE.DirectionalLight(0xffffff, 1.4);
  private readonly frameMat = new THREE.MeshStandardMaterial({ color: 0x23252e, metalness: 0.75, roughness: 0.38 });
  private readonly panelMat = new THREE.MeshStandardMaterial({ color: 0x14151b, metalness: 0.5, roughness: 0.55 });
  private readonly goldMat = new THREE.MeshStandardMaterial({ color: 0xf6c21c, metalness: 0.9, roughness: 0.25, emissive: 0x6a4a00 });
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: 0x7af0ff, toneMapped: false });
  private readonly bezelMat = new THREE.MeshStandardMaterial({ color: 0x07070a, metalness: 0.3, roughness: 0.2 });
  private readonly glare: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly lights: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>[] = [];
  private screens: Screens | null = null;
  private readonly screenMats: THREE.MeshBasicMaterial[] = [];
  private built: THREE.Object3D[] = [];
  private aspect = 0;
  private touch = false;
  private time = 0;

  constructor() {
    this.key.position.set(0.3, 1, 0.4);
    this.scene.add(this.hemi, this.key, this.root);
    this.glare = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: glareTexture(), transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.glare.renderOrder = 5;
  }

  /** The canvases the HUD draws the cockpit screens into. */
  setScreens(left: HTMLCanvasElement, right: HTMLCanvasElement, radar: HTMLCanvasElement): void {
    if (this.screens && this.screens.left.image === left && this.screens.right.image === right && this.screens.radar.image === radar) return;
    this.disposeScreens();
    const tex = (c: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(c);
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    };
    this.screens = { left: tex(left), right: tex(right), radar: tex(radar) };
    this.aspect = 0;
  }

  /** The HUD drew new pictures: upload them. */
  refresh(side: boolean, radar: boolean): void {
    const s = this.screens;
    if (!s) return;
    if (side) {
      s.left.needsUpdate = true;
      s.right.needsUpdate = true;
    }
    if (radar) s.radar.needsUpdate = true;
  }

  /** Glow colour of the pilot, light of the level. */
  setStyle(color: number, sky: number, ground: number, intensity: number): void {
    this.glowMat.color.setHex(color);
    for (const l of this.lights) l.material.color.setHex(color);
    this.hemi.color.setHex(sky);
    this.hemi.groundColor.setHex(ground);
    this.hemi.intensity = Math.min(2.2, intensity * 0.8);
  }

  /** Looking around inside the cockpit (radians). */
  setHead(yaw: number, pitch: number): void {
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  /**
   * Fits the cockpit to the screen shape; call every frame (cheap when nothing changed).
   * With touch controls the thumbs own the lower corners, so the two data screens
   * move up onto the canopy pillars.
   */
  layout(aspect: number, touch: boolean): void {
    if (Math.abs(aspect - this.aspect) < 0.01 && touch === this.touch) return;
    this.aspect = aspect;
    this.touch = touch;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    for (const o of this.built) {
      this.root.remove(o);
      o.traverse((n) => {
        if (n instanceof THREE.Mesh && n !== this.glare) n.geometry.dispose();
      });
    }
    this.built = [];
    for (const l of this.lights) l.material.dispose();
    this.lights.length = 0;
    const add = (o: THREE.Object3D) => {
      this.root.add(o);
      this.built.push(o);
      return o;
    };

    const hh = D * Math.tan(THREE.MathUtils.degToRad(COCKPIT_FOV / 2));
    const hw = hh * aspect;
    // Narrow screens (phones held upright) get a smaller dashboard.
    const W = Math.min(hw, hh * 1.9);

    // ---- Dashboard with a raised hood in the middle.
    const top = -hh * 0.5;
    const hood = -hh * 0.3;
    const dash = new THREE.Shape();
    dash.moveTo(-hw * 1.2, -hh * 1.3);
    dash.lineTo(-hw * 1.2, top - hh * 0.08);
    dash.lineTo(-W * 0.62, top);
    dash.quadraticCurveTo(-W * 0.44, top, -W * 0.36, hood);
    dash.lineTo(W * 0.36, hood);
    dash.quadraticCurveTo(W * 0.44, top, W * 0.62, top);
    dash.lineTo(hw * 1.2, top - hh * 0.08);
    dash.lineTo(hw * 1.2, -hh * 1.3);
    dash.closePath();
    const dashGeo = new THREE.ExtrudeGeometry(dash, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 10 });
    const dashMesh = new THREE.Mesh(dashGeo, this.panelMat);
    dashMesh.position.z = -D - 0.12;
    add(dashMesh);
    // Gold trim along the top edge of the dashboard.
    const edge = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-hw * 1.2, top - hh * 0.08, 0),
        new THREE.Vector3(-W * 0.62, top, 0),
        new THREE.Vector3(-W * 0.4, (top + hood) / 2 + hh * 0.02, 0),
        new THREE.Vector3(-W * 0.34, hood, 0),
        new THREE.Vector3(W * 0.34, hood, 0),
        new THREE.Vector3(W * 0.4, (top + hood) / 2 + hh * 0.02, 0),
        new THREE.Vector3(W * 0.62, top, 0),
        new THREE.Vector3(hw * 1.2, top - hh * 0.08, 0),
      ],
      false,
      'centripetal',
    );
    const trim = new THREE.Mesh(new THREE.TubeGeometry(edge, 80, 0.012, 6, false), this.goldMat);
    trim.position.z = -D + 0.02;
    add(trim);
    const glowLine = new THREE.Mesh(new THREE.TubeGeometry(edge, 80, 0.004, 4, false), this.glowMat);
    glowLine.position.set(0, -0.022, -D + 0.03);
    add(glowLine);

    // ---- Screens: radar in the hood, flight data left, round data right.
    const radarSize = Math.min(hh * 0.5, W * 0.5);
    const screenY = hood - radarSize / 2 - hh * 0.03;
    let sideW = Math.min(hh * 0.86, (W * 1.18 - radarSize) / 2);
    let sideX = radarSize / 2 + sideW / 2 + hh * 0.08;
    let sideY = top - sideW * 0.25 - hh * 0.05;
    let lift = -0.12;
    let turn = 0.22;
    if (touch) {
      // Up in the corners, turned towards the pilot, fully inside the picture.
      sideW = Math.min(hh * 0.78, hw * 0.42);
      turn = 0.26;
      lift = 0.14;
      const outerZ = D - 0.035 - Math.sin(turn) * sideW * 0.5;
      const visible = outerZ * Math.tan(THREE.MathUtils.degToRad(COCKPIT_FOV / 2));
      sideX = visible * aspect * 0.95 - Math.cos(turn) * sideW * 0.5;
      sideY = visible * 0.9 - sideW * 0.25 - hh * 0.04;
    }
    const sideH = sideW * 0.5;
    const screen = (w: number, h: number, x: number, y: number, tilt: number, map: THREE.Texture | null) => {
      const g = new THREE.Group();
      const bezel = new THREE.Mesh(new THREE.ShapeGeometry(roundedShape(w + 0.05, h + 0.05, 0.03)), this.bezelMat);
      const rim = new THREE.Mesh(new THREE.ShapeGeometry(roundedShape(w + 0.075, h + 0.075, 0.04)), this.goldMat);
      rim.position.z = -0.004;
      g.add(rim, bezel);
      if (map) {
        const mat = new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false, depthWrite: false });
        this.screenMats.push(mat);
        const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        pic.position.z = 0.004;
        g.add(pic);
      }
      // Turned screens stand further out, so their inner edge stays in front of the dashboard.
      g.position.set(x, y, -D + 0.035 + (tilt && !touch ? Math.abs(Math.sin(tilt)) * w * 0.5 + 0.02 : 0));
      g.rotation.set(y > 0 ? lift : -0.12, tilt, 0);
      return add(g);
    };
    for (const m of this.screenMats) m.dispose();
    this.screenMats.length = 0;
    const s = this.screens;
    screen(radarSize, radarSize, 0, screenY, 0, s?.radar ?? null);
    screen(sideW, sideH, -sideX, sideY, turn, s?.left ?? null);
    screen(sideW, sideH, sideX, sideY, -turn, s?.right ?? null);
    if (touch) {
      // Brackets holding the screens on the pillars.
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.12), this.frameMat);
        m.position.set(sx * (sideX + sideW / 2 + 0.01), sideY, -D - 0.02);
        add(m);
      }
    }

    // Little status lights along the dashboard.
    const lightW = touch ? W * 0.5 : sideW;
    for (let i = 0; i < 10; i++) {
      const side = i < 5 ? -1 : 1;
      const k = i % 5;
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.009, 10), new THREE.MeshBasicMaterial({ color: this.glowMat.color.getHex(), toneMapped: false, transparent: true }));
      const x0 = touch ? radarSize / 2 + hh * 0.08 : sideX - sideW / 2;
      l.position.set(side * (x0 + (k + 0.5) * (lightW / 10)), touch ? top - hh * 0.08 : sideY - sideH / 2 - hh * 0.06, -D + 0.04);
      add(l);
      this.lights.push(l);
    }

    // ---- Canopy frame: two pillars up the sides and a bow over the top.
    const bar = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) => {
      const dir = b.clone().sub(a);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, dir.length(), 8), mat);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      return add(m);
    };
    for (const sx of [-1, 1]) {
      const a = new THREE.Vector3(sx * hw * 0.98, top - hh * 0.05, -D * 0.95);
      const b = new THREE.Vector3(sx * hw * 0.58, hh * 1.25, -D * 1.35);
      bar(a, b, 0.055, this.frameMat);
      // Gold edge on the inner side of each pillar.
      const ia = a.clone().add(new THREE.Vector3(-sx * 0.06, 0, 0.03));
      const ib = b.clone().add(new THREE.Vector3(-sx * 0.04, 0, 0.03));
      bar(ia, ib, 0.008, this.goldMat);
    }
    const bow = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-hw * 0.7, hh * 1.14, -D * 1.3),
      new THREE.Vector3(-hw * 0.34, hh * 0.99, -D * 1.3),
      new THREE.Vector3(0, hh * 0.95, -D * 1.3),
      new THREE.Vector3(hw * 0.34, hh * 0.99, -D * 1.3),
      new THREE.Vector3(hw * 0.7, hh * 1.14, -D * 1.3),
    ]);
    add(new THREE.Mesh(new THREE.TubeGeometry(bow, 40, 0.045, 8, false), this.frameMat));
    const bowGlow = new THREE.Mesh(new THREE.TubeGeometry(bow, 40, 0.006, 4, false), this.glowMat);
    bowGlow.position.set(0, -0.05, 0.03);
    add(bowGlow);

    // ---- Glass glare, top left.
    this.glare.scale.set(hw * 1.1, hh * 1.1, 1);
    this.glare.position.set(-hw * 0.45, hh * 0.45, -D * 1.4);
    add(this.glare);
  }

  /** Blinking lights. */
  update(dt: number, boosting: boolean): void {
    this.time += dt;
    this.lights.forEach((l, i) => {
      const on = Math.sin(this.time * (boosting ? 9 : 3) + i * 1.7) > -0.2;
      l.material.opacity = on ? 0.95 : 0.25;
    });
  }

  private disposeScreens(): void {
    const s = this.screens;
    if (!s) return;
    s.left.dispose();
    s.right.dispose();
    s.radar.dispose();
    this.screens = null;
  }

  dispose(): void {
    this.disposeScreens();
    for (const o of this.built) {
      o.traverse((n) => {
        if (n instanceof THREE.Mesh && n !== this.glare) n.geometry.dispose();
      });
    }
    for (const m of this.screenMats) m.dispose();
    for (const l of this.lights) l.material.dispose();
    this.glare.geometry.dispose();
    this.glare.material.map?.dispose();
    this.glare.material.dispose();
    for (const m of [this.frameMat, this.panelMat, this.goldMat, this.glowMat, this.bezelMat]) m.dispose();
  }
}
