import * as THREE from 'three';
import { isShip, type ShipId } from '../core/ships';
import { disposeShip, makeShip, type ShipMesh } from './ships';
import { sharedTextures } from './textures';

/**
 * Turning 3D views of the ships for the hangar. One small renderer draws every
 * ship in turn and copies the picture into each card's canvas.
 */
export class ShipPreviews {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 480 / 300, 0.1, 100);
  private readonly ships = new Map<ShipId, ShipMesh>();
  private canvases: HTMLCanvasElement[] = [];
  private raf = 0;
  private t = 0;
  private last = 0;

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xfff6dc, 0x6a4a1a, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-5, 8, 6);
    const rim = new THREE.DirectionalLight(0xffe9a8, 1.4);
    rim.position.set(6, 3, -6);
    this.scene.add(key, rim);
    this.camera.position.set(0, 6.5, 15);
    this.camera.lookAt(0, -0.3, 0);
  }

  /** Starts drawing into these canvases (each with data-ship), or stops when empty. */
  attach(canvases: HTMLCanvasElement[]): void {
    this.canvases = canvases;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (!canvases.length) return;
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      } catch {
        return;
      }
      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(480, 300, false);
      this.renderer.setClearColor(0x000000, 0);
    }
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.t += Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private ship(id: ShipId): ShipMesh {
    let s = this.ships.get(id);
    if (!s) {
      s = makeShip(id, 0xffe45c, sharedTextures().glow);
      for (const f of s.flames) f.scale.multiplyScalar(0.9);
      this.ships.set(id, s);
    }
    return s;
  }

  private draw(): void {
    const r = this.renderer;
    if (!r) return;
    this.canvases = this.canvases.filter((c) => c.isConnected);
    if (!this.canvases.length) {
      this.attach([]);
      return;
    }
    for (const c of this.canvases) {
      const id = c.dataset.ship;
      if (!isShip(id)) continue;
      const s = this.ship(id);
      this.scene.add(s.group);
      s.group.rotation.set(0.12 * Math.sin(this.t * 0.9), this.t * 0.6 + SHIP_PHASE[id], 0.08 * Math.sin(this.t * 1.3));
      r.render(this.scene, this.camera);
      this.scene.remove(s.group);
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(r.domElement, 0, 0, c.width, c.height);
    }
  }

  dispose(): void {
    this.attach([]);
    for (const s of this.ships.values()) disposeShip(s);
    this.ships.clear();
    this.renderer?.dispose();
    this.renderer = null;
  }
}

const SHIP_PHASE: Record<ShipId, number> = { trident: 0, manta: 1.6, halo: 3.1, bulwark: 4.7 };
