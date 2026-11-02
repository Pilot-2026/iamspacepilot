import * as THREE from 'three';

/**
 * A ship that crumbles: its real model breaks into its triangles (big ones
 * are cut smaller first), and every piece flies off in its own direction,
 * tumbling, glowing hot at first, then shrinking and fading. All the motion
 * runs on the GPU; the pieces of one material are one draw call.
 */

/** Seconds until the last piece is gone. */
export const SHATTER_LIFE = 2.8;
/** Triangles bigger than this (m²) are cut into four, up to MAX_CUTS times. */
const MAX_AREA = 0.18;
const MAX_CUTS = 3;
/** Pieces per ship at most (cutting stops there). */
const MAX_PIECES = 6000;

const ROTATE = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aVel;
attribute vec3 aAxis;
attribute float aSpin;
uniform float uTime;
uniform float uLife;
vec3 shRotate(vec3 v, vec3 a, float ang) {
  float c = cos(ang), s = sin(ang);
  return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c);
}
`;

/** Moves each triangle about its own centre: out along its path (slowed by drag), turning, shrinking. */
function patch(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = (material.userData.uTime ??= { value: 0 });
    shader.uniforms.uLife = { value: SHATTER_LIFE };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ROTATE}`)
      .replace(
        '#include <beginnormal_vertex>',
        'vec3 objectNormal = shRotate(vec3(normal), aAxis, aSpin * uTime);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `float shFly = (1.0 - exp(-uTime * 1.25)) / 1.25;
float shSize = 1.0 - smoothstep(uLife * 0.4, uLife, uTime);
vec3 transformed = aCenter + aVel * shFly + shRotate(position - aCenter, aAxis, aSpin * uTime) * shSize;`,
      );
    // Hot at first: the pieces glow orange and cool down.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.62, 0.25), 0.75 * exp(-uTime * 2.4));',
      );
  };
  material.customProgramCacheKey = () => 'shatter';
}

type Tri = number[]; // 9 positions, then optional 9 colours

function area(t: Tri): number {
  const ax = t[3] - t[0];
  const ay = t[4] - t[1];
  const az = t[5] - t[2];
  const bx = t[6] - t[0];
  const by = t[7] - t[1];
  const bz = t[8] - t[2];
  return 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
}

/** Cuts a triangle into four at its edge midpoints (positions and colours alike). */
function cut(t: Tri, stride: number): Tri[] {
  const v = (i: number) => t.slice(i * stride, i * stride + stride);
  const mid = (a: number[], b: number[]) => a.map((x, k) => (x + b[k]) / 2);
  const a = v(0);
  const b = v(1);
  const c = v(2);
  const ab = mid(a, b);
  const bc = mid(b, c);
  const ca = mid(c, a);
  const join = (p: number[], q: number[], r: number[]) => [...p, ...q, ...r];
  return [join(a, ab, ca), join(ab, b, bc), join(ca, bc, c), join(ab, bc, ca)];
}

interface Batch {
  material: THREE.Material;
  colors: boolean;
  tris: Tri[];
}

export class Shatter {
  readonly object = new THREE.Group();
  private age = 0;
  private readonly materials: THREE.Material[] = [];

  /**
   * ship: the model (already placed in the world), center: where it was,
   * velocity: how it was flying, so the cloud of pieces keeps some of it.
   */
  constructor(ship: THREE.Object3D, center: THREE.Vector3, velocity: THREE.Vector3) {
    ship.updateWorldMatrix(true, true);
    const batches = new Map<THREE.Material, Batch>();
    const p = new THREE.Vector3();
    const meshes: THREE.Mesh[] = [];
    let total = 0;
    ship.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (o as THREE.Sprite).isSprite) return;
      const pos = mesh.geometry.getAttribute('position');
      if (!pos) return;
      meshes.push(mesh);
      total += (mesh.geometry.index ? mesh.geometry.index.count : pos.count) / 3;
    });
    // Very detailed models already crumble into tiny bits: a random part of them is plenty (and quick to build).
    const keep = Math.min(1, MAX_PIECES / Math.max(1, total));
    let count = 0;
    for (const mesh of meshes) {
      const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!src || !src.isMaterial) continue;
      const geo = mesh.geometry;
      const pos = geo.getAttribute('position');
      const index = geo.index;
      const col = (src as THREE.MeshStandardMaterial).vertexColors ? geo.getAttribute('color') : undefined;
      let b = batches.get(src);
      if (!b) {
        b = { material: src, colors: !!col, tris: [] };
        batches.set(src, b);
      }
      const tris = (index ? index.count : pos.count) / 3;
      for (let tri = 0; tri < tris; tri++) {
        if (keep < 1 && Math.random() > keep) continue;
        const t: Tri = [];
        for (let k = 0; k < 3; k++) {
          const v = index ? index.getX(tri * 3 + k) : tri * 3 + k;
          p.fromBufferAttribute(pos, v).applyMatrix4(mesh.matrixWorld);
          t.push(p.x, p.y, p.z);
        }
        if (b.colors) {
          for (let k = 0; k < 3; k++) {
            const v = index ? index.getX(tri * 3 + k) : tri * 3 + k;
            if (col) t.push(col.getX(v), col.getY(v), col.getZ(v));
            else t.push(1, 1, 1);
          }
        }
        b.tris.push(t);
        count++;
      }
    }

    // Crumble: cut the biggest pieces while there is room for more.
    for (let pass = 0; pass < MAX_CUTS && count < MAX_PIECES; pass++) {
      for (const b of batches.values()) {
        const stride = b.colors ? 6 : 3;
        const next: Tri[] = [];
        for (const t of b.tris) {
          if (count < MAX_PIECES && area(t) > MAX_AREA) {
            next.push(...cut(t, stride));
            count += 3;
          } else next.push(t);
        }
        b.tris = next;
      }
    }

    for (const b of batches.values()) this.build(b, center, velocity);
  }

  private build(b: Batch, center: THREE.Vector3, velocity: THREE.Vector3): void {
    const n = b.tris.length;
    if (!n) return;
    const pos = new Float32Array(n * 9);
    const col = b.colors ? new Float32Array(n * 9) : null;
    const cen = new Float32Array(n * 9);
    const vel = new Float32Array(n * 9);
    const axis = new Float32Array(n * 9);
    const spin = new Float32Array(n * 3);
    b.tris.forEach((t, i) => {
      const cx = (t[0] + t[3] + t[6]) / 3;
      const cy = (t[1] + t[4] + t[7]) / 3;
      const cz = (t[2] + t[5] + t[8]) / 3;
      // Outwards from the middle of the ship, scattered, in every direction.
      let dx = cx - center.x + (Math.random() - 0.5) * 2.2;
      let dy = cy - center.y + (Math.random() - 0.5) * 2.2;
      let dz = cz - center.z + (Math.random() - 0.5) * 2.2;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const speed = 5 + Math.random() * Math.random() * 26;
      dx = (dx / dl) * speed + velocity.x * 0.55;
      dy = (dy / dl) * speed + velocity.y * 0.55;
      dz = (dz / dl) * speed + velocity.z * 0.55;
      let ax = Math.random() - 0.5;
      let ay = Math.random() - 0.5;
      let az = Math.random() - 0.5;
      const al = Math.hypot(ax, ay, az) || 1;
      ax /= al;
      ay /= al;
      az /= al;
      const sp = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 11);
      for (let k = 0; k < 3; k++) {
        const o = i * 9 + k * 3;
        pos[o] = t[k * 3];
        pos[o + 1] = t[k * 3 + 1];
        pos[o + 2] = t[k * 3 + 2];
        if (col) {
          col[o] = t[9 + k * 3];
          col[o + 1] = t[9 + k * 3 + 1];
          col[o + 2] = t[9 + k * 3 + 2];
        }
        cen[o] = cx;
        cen[o + 1] = cy;
        cen[o + 2] = cz;
        vel[o] = dx;
        vel[o + 1] = dy;
        vel[o + 2] = dz;
        axis[o] = ax;
        axis[o + 1] = ay;
        axis[o + 2] = az;
        spin[i * 3 + k] = sp;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aCenter', new THREE.BufferAttribute(cen, 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
    geo.setAttribute('aAxis', new THREE.BufferAttribute(axis, 3));
    geo.setAttribute('aSpin', new THREE.BufferAttribute(spin, 1));
    geo.computeVertexNormals();
    const m = b.material.clone();
    m.side = THREE.DoubleSide;
    m.transparent = true;
    m.userData.baseOpacity = b.material.opacity;
    patch(m);
    this.materials.push(m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    this.object.add(mesh);
  }

  /** Advances the pieces; false when they are all gone. */
  update(dt: number): boolean {
    this.age += dt;
    const fade = 1 - Math.max(0, (this.age - SHATTER_LIFE * 0.6) / (SHATTER_LIFE * 0.4));
    for (const m of this.materials) {
      ((m.userData.uTime ??= { value: 0 }) as { value: number }).value = this.age;
      m.opacity = (m.userData.baseOpacity as number) * Math.max(0, fade);
    }
    return this.age < SHATTER_LIFE;
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const c of this.object.children) (c as THREE.Mesh).geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
