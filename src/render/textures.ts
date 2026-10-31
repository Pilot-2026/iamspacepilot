import * as THREE from 'three';

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

/** Bright round glow, used for engines, the sun and bursts. */
export function glowTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (x) => {
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
  });
}

/** Soft round dot, used for particles and stars. */
export function softTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
  });
}

/** A puffy cloud made of a few overlapping soft blobs. */
export function cloudTexture(seed: number): THREE.CanvasTexture {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return canvasTexture(256, 128, (x) => {
    for (let i = 0; i < 9; i++) {
      const cx = 50 + rnd() * 156;
      const cy = 50 + rnd() * 30;
      const r = 28 + rnd() * 30;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 256, 128);
    }
  });
}

let shared: { glow: THREE.Texture; soft: THREE.Texture } | null = null;

export function sharedTextures(): { glow: THREE.Texture; soft: THREE.Texture } {
  if (!shared) shared = { glow: glowTexture(), soft: softTexture() };
  return shared;
}
