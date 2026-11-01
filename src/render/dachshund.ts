import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShipMesh } from './ships';

/**
 * The secret glider: a brown dachshund flying through the air. Smooth, many
 * polygons, with a coat that is dark on the back and tan underneath. It
 * gallops in the air, wags its short tail, lets its ears flap in the wind,
 * looks around (left, right, back over its shoulder) while it is not
 * shooting, and opens its mouth to spit bones instead of shots.
 * Forward is +Z, up is +Y, about as long as the other ships.
 */

const DARK = new THREE.Color(0x7a3510);
const COAT = new THREE.Color(0xb8611f);
const TAN = new THREE.Color(0xe7a462);

/** Colours a geometry from `bottom` (low y) over `mid` to `top` (high y). */
function shade(g: THREE.BufferGeometry, y0: number, y1: number, bottom: THREE.Color, mid: THREE.Color, top: THREE.Color): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0)));
    if (k < 0.5) c.copy(bottom).lerp(mid, k * 2);
    else c.copy(mid).lerp(top, (k - 0.5) * 2);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A sphere stretched to an ellipsoid and moved. */
function blob(rx: number, ry: number, rz: number, x: number, y: number, z: number, w = 32, h = 24): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return g;
}

/** A tapered tube along +Z from z0 to z1. */
function tubeZ(r0: number, r1: number, z0: number, z1: number, y = 0, sides = 28): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, sides, 4);
  g.rotateX(Math.PI / 2);
  g.translate(0, y, (z0 + z1) / 2);
  return g;
}

const merge = (list: THREE.BufferGeometry[]) => {
  // Same attributes everywhere (position, normal, uv), no index.
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = mergeGeometries(parts) as THREE.BufferGeometry;
  for (const g of list) g.dispose();
  for (const g of parts) g.dispose();
  // The parts keep their own smooth normals.
  return out;
};

export interface DogMesh extends ShipMesh {
  /** Moves legs, tail, ears, head and jaw. */
  animate(time: number, dt: number, speed: number, boosting: boolean): void;
  /** Opens the mouth: a bone flies. */
  bark(): void;
}

/** A dachshund; the collar tag glows in the pilot's colour. */
export function makeDog(color: number): DogMesh {
  const group = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  const nose = new THREE.MeshStandardMaterial({ color: 0x120a08, roughness: 0.22, metalness: 0.1 });
  const eye = new THREE.MeshStandardMaterial({ color: 0x1b0d06, roughness: 0.08, metalness: 0.2 });
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mouth = new THREE.MeshStandardMaterial({ color: 0x5a0d14, roughness: 0.6 });
  const tongue = new THREE.MeshStandardMaterial({ color: 0xe46a7c, roughness: 0.45 });
  const collar = new THREE.MeshStandardMaterial({ color: 0xc4141c, roughness: 0.5 });
  const glowMat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const geos: THREE.BufferGeometry[] = [];
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
    geos.push(g);
    return new THREE.Mesh(g, m);
  };

  // ---- Body: long, round, deep chest in front, round rump behind.
  const prof: [number, number][] = [
    [0.0, -1.98],
    [0.26, -1.9],
    [0.46, -1.68],
    [0.56, -1.3],
    [0.58, -0.6],
    [0.6, 0.1],
    [0.64, 0.7],
    [0.66, 1.15],
    [0.6, 1.5],
    [0.44, 1.8],
    [0.0, 1.95],
  ];
  const torso = new THREE.LatheGeometry(
    prof.map(([r, y]) => new THREE.Vector2(r, y)),
    48,
  );
  torso.rotateX(Math.PI / 2);
  torso.scale(0.8, 1, 1);
  const body = merge([torso, blob(0.48, 0.58, 0.78, 0, -0.2, 0.95), blob(0.52, 0.55, 0.6, 0, 0.04, -1.3)]);
  shade(body, -0.8, 0.62, TAN, COAT, DARK);
  group.add(mesh(body, fur));

  // ---- Neck and head turn together at the shoulders to look around.
  const neck = new THREE.Group();
  neck.position.set(0, 0.28, 1.45);
  group.add(neck);
  const NECK_TILT = 0.78;
  const neckGeo = new THREE.CylinderGeometry(0.33, 0.44, 1.05, 32, 3);
  neckGeo.translate(0, 0.5, 0);
  neckGeo.rotateX(NECK_TILT);
  shade(neckGeo, -0.3, 0.9, TAN, COAT, DARK);
  neck.add(mesh(neckGeo, fur));
  const band = mesh(new THREE.TorusGeometry(0.43, 0.065, 12, 40), collar);
  band.position.set(0, 0.24 * Math.cos(NECK_TILT), 0.24 * Math.sin(NECK_TILT));
  band.rotation.x = NECK_TILT + Math.PI / 2;
  neck.add(band);
  const tag = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 20), glowMat);
  tag.rotation.x = Math.PI / 2 + 0.3;
  tag.position.set(0, band.position.y - 0.42, band.position.z + 0.2);
  neck.add(tag);

  const head = new THREE.Group();
  head.position.set(0, Math.cos(NECK_TILT) * 0.98, Math.sin(NECK_TILT) * 0.98);
  neck.add(head);
  const skull = blob(0.38, 0.36, 0.46, 0, 0.08, 0.1);
  const muzzle = tubeZ(0.27, 0.17, 0.25, 1.0, -0.02);
  const tip = blob(0.17, 0.16, 0.14, 0, -0.02, 1.0, 24, 18);
  const brow = blob(0.3, 0.16, 0.22, 0, 0.22, 0.38, 24, 16);
  const headGeo = merge([skull, muzzle, tip, brow]);
  shade(headGeo, -0.28, 0.45, TAN, COAT, DARK);
  head.add(mesh(headGeo, fur));
  const noseMesh = mesh(blob(0.12, 0.09, 0.1, 0, 0.05, 1.12, 20, 14), nose);
  head.add(noseMesh);
  // Inside of the mouth, seen when the jaw opens.
  head.add(mesh(blob(0.13, 0.07, 0.36, 0, -0.13, 0.64, 18, 12), mouth));
  for (const s of [1, -1]) {
    const e = mesh(blob(0.075, 0.075, 0.06, s * 0.21, 0.18, 0.44, 18, 14), eye);
    const hl = mesh(blob(0.022, 0.022, 0.015, s * 0.23, 0.21, 0.49, 8, 6), shine);
    // Tan spots above the eyes, like a real black-and-tan... here brown-and-tan.
    const spot = blob(0.07, 0.035, 0.05, s * 0.19, 0.29, 0.43, 14, 10);
    shade(spot, -1, 1, TAN, TAN, TAN);
    head.add(e, hl, mesh(spot, fur));
  }
  // Lower jaw with the tongue, hinged under the cheeks.
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.15, 0.36);
  head.add(jaw);
  const jawGeo = tubeZ(0.19, 0.12, 0.0, 0.62, 0, 22);
  jawGeo.scale(1, 0.55, 1);
  jawGeo.translate(0, -0.04, 0);
  shade(jawGeo, -0.15, 0.05, TAN, TAN, COAT);
  jaw.add(mesh(jawGeo, fur));
  const tongueMesh = mesh(blob(0.1, 0.03, 0.26, 0, 0.01, 0.34, 18, 10), tongue);
  jaw.add(tongueMesh);
  // Long floppy ears.
  const ears: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.3, 0.26, 0.02);
    const g = blob(0.07, 0.42, 0.25, s * 0.05, -0.36, 0.02, 24, 18);
    shade(g, -0.8, 0.05, COAT, DARK, DARK);
    ear.add(mesh(g, fur));
    head.add(ear);
    ears.push(ear);
  }

  // ---- Short legs: thigh, knee, lower leg and paw.
  interface Leg {
    hip: THREE.Group;
    knee: THREE.Group;
    front: boolean;
    side: number;
  }
  const legs: Leg[] = [];
  const makeLeg = (x: number, y: number, z: number, front: boolean) => {
    const hip = new THREE.Group();
    hip.position.set(x, y, z);
    const r = front ? 0.15 : 0.2;
    const up = new THREE.CapsuleGeometry(r, 0.3, 8, 20);
    up.translate(0, -0.2, 0);
    shade(up, -0.45, 0.1, COAT, COAT, DARK);
    hip.add(mesh(up, fur));
    const knee = new THREE.Group();
    knee.position.set(0, -0.42, 0);
    hip.add(knee);
    const low = new THREE.CapsuleGeometry(0.11, 0.26, 8, 16);
    low.translate(0, -0.18, 0);
    shade(low, -0.35, 0.05, TAN, COAT, COAT);
    knee.add(mesh(low, fur));
    const paw = blob(0.14, 0.08, 0.19, 0, -0.38, 0.06, 20, 12);
    shade(paw, -1, 1, TAN, TAN, TAN);
    knee.add(mesh(paw, fur));
    group.add(hip);
    legs.push({ hip, knee, front, side: Math.sign(x) });
  };
  makeLeg(0.32, -0.38, 1.12, true);
  makeLeg(-0.32, -0.38, 1.12, true);
  makeLeg(0.34, -0.3, -1.2, false);
  makeLeg(-0.34, -0.3, -1.2, false);

  // ---- Short tail that never stops wagging.
  const wag = new THREE.Group();
  wag.position.set(0, 0.3, -1.85);
  group.add(wag);
  const tilt = new THREE.Group();
  tilt.rotation.x = -0.7;
  wag.add(tilt);
  const tailGeo = new THREE.CylinderGeometry(0.035, 0.12, 0.9, 18, 4);
  tailGeo.translate(0, 0.45, 0);
  shade(tailGeo, 0, 0.9, COAT, DARK, DARK);
  tilt.add(mesh(tailGeo, fur));

  // ---- Behaviour.
  let barkAt = -10;
  let now = 0;
  let yaw = 0;
  let pitch = 0;
  let open = 0;
  // Looking around while not shooting: [start s, yaw, pitch] over a 7 s cycle.
  const LOOK: [number, number, number][] = [
    [0, 0, -0.05],
    [1.3, 1.1, 0],
    [2.4, 0, -0.05],
    [3.0, -1.1, 0],
    [4.1, 0, 0],
    [4.6, 2.5, 0.25],
    [6.2, 0, -0.05],
  ];
  const ease = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-dt * rate));

  return {
    group,
    solids: [fur, nose, eye, mouth, tongue, collar],
    glowMat,
    flames: [],
    flame: 1,
    bark() {
      barkAt = now;
    },
    animate(time, dt, speed, boosting) {
      now = time;
      const since = time - barkAt;
      const shooting = since < 0.8;
      // Head: straight ahead while shooting, otherwise looking left, right and back.
      let ty = 0;
      let tp = -0.08;
      if (!shooting) {
        const c = time % 7;
        for (const [at, y, p] of LOOK) {
          if (c >= at) {
            ty = y;
            tp = p;
          }
        }
      }
      yaw = ease(yaw, ty, shooting ? 12 : 4, dt);
      pitch = ease(pitch, tp, 5, dt);
      neck.rotation.y = yaw * 0.45;
      head.rotation.set(pitch, yaw * 0.55, yaw * 0.08);
      // Mouth: wide open for a bone, a little open and panting while running.
      const wantOpen = since < 0.22 ? 0.7 : 0.1 + 0.05 * Math.sin(time * 9);
      open = ease(open, wantOpen, since < 0.22 ? 30 : 10, dt);
      jaw.rotation.x = open;
      tongueMesh.position.z = 0.34 + (since < 0.22 ? 0 : 0.05 * Math.sin(time * 9));
      // Gallop through the air: front legs together, hind legs together, half a stride apart.
      const f = 1.9 + (speed / 24) * 0.9 + (boosting ? 0.6 : 0);
      const ph = time * Math.PI * 2 * f;
      for (const l of legs) {
        const p = ph + (l.front ? 0 : Math.PI) + (l.side > 0 ? 0 : 0.35);
        const swing = Math.sin(p) * (l.front ? 0.95 : 0.85);
        l.hip.rotation.x = swing;
        const lift = Math.max(0, Math.cos(p));
        l.knee.rotation.x = l.front ? -lift * 1.0 : lift * 0.9;
      }
      group.position.y = Math.sin(ph * 2) * 0.05;
      group.rotation.x = Math.sin(ph) * 0.05;
      // Tail wags fast, ears flap in the wind.
      wag.rotation.y = Math.sin(time * 17) * 0.7;
      ears.forEach((ear, i) => {
        const s = i === 0 ? 1 : -1;
        ear.rotation.x = -0.75 - (boosting ? 0.35 : 0) + Math.sin(time * 11 + i) * 0.16;
        ear.rotation.z = s * (0.3 + Math.sin(time * 7 + i * 2) * 0.1);
      });
    },
    free() {
      for (const g of geos) g.dispose();
      shine.dispose();
    },
  };
}

let boneGeo: THREE.BufferGeometry | null = null;

/** A bone, lying along +Z, shared by all bone shots. */
export function boneGeometry(): THREE.BufferGeometry {
  if (boneGeo) return boneGeo;
  const parts = [tubeZ(0.13, 0.13, -0.66, 0.66, 0, 14)];
  for (const z of [-0.68, 0.68]) for (const x of [-0.14, 0.14]) parts.push(blob(0.22, 0.2, 0.2, x, 0, z, 16, 12));
  boneGeo = merge(parts);
  return boneGeo;
}
