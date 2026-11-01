import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShipId } from '../core/ships';

/**
 * The four ship models, built from simple low-poly parts after Andreas
 * Schmoelzer's designs: faceted gold hull, black crystal canopy and glowing
 * light strips. Local axes: +Z forward, +Y up, +X left. About 7 m long.
 *
 * Parts are merged per material, so a ship costs three draw calls plus its
 * engine glows.
 */

type Part = THREE.BufferGeometry;

const Y = new THREE.Vector3(0, 1, 0);

/** Position-only, non-indexed copy (flat shading needs no normals), so all parts merge. */
function prep(g: Part): Part {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== 'position') out.deleteAttribute(name);
  return out;
}

/** A cone from base to tip with the given base radius. scaleX flattens it into a fin. */
function spike(base: [number, number, number], tip: [number, number, number], r: number, sides = 4, scaleX = 1): Part {
  const b = new THREE.Vector3(...base);
  const t = new THREE.Vector3(...tip);
  const dir = t.clone().sub(b);
  const len = dir.length();
  const g = new THREE.ConeGeometry(r, len, sides, 1);
  g.translate(0, len / 2, 0);
  if (scaleX !== 1) g.scale(scaleX, 1, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, dir.normalize()));
  g.translate(b.x, b.y, b.z);
  return g;
}

/** Body of revolution around Z from (radius, z) pairs, front first. */
function lathe(profile: [number, number][], sides: number, sx = 1, sy = 1): Part {
  const pts = profile.map(([r, z]) => new THREE.Vector2(r, z));
  const g = new THREE.LatheGeometry(pts, sides);
  g.rotateX(Math.PI / 2);
  g.rotateZ(Math.PI / sides);
  g.scale(sx, sy, 1);
  return g;
}

/** A flat part from an outline in the (x, z) plane, thickness t, with chamfered edges. */
function plate(outline: [number, number][], t: number, y = 0): Part {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const bevel = Math.min(t * 0.45, 0.08);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, t - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 2,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y - t / 2 + bevel, 0);
  return g;
}

/** An elongated eight-sided crystal (canopies). */
function gem(c: [number, number, number], len: number, w: number, h: number): Part {
  const [x, y, z] = c;
  const v = [
    [0, 0, len * 0.55],
    [0, 0, -len * 0.45],
    [w / 2, 0, 0.05],
    [-w / 2, 0, 0.05],
    [0, h, -0.05],
    [0, -h * 0.35, 0],
  ].map(([a, b, d]) => [a + x, b + y, d + z]);
  const faces = [
    [0, 2, 4],
    [0, 4, 3],
    [1, 4, 2],
    [1, 3, 4],
    [0, 5, 2],
    [0, 3, 5],
    [1, 2, 5],
    [1, 5, 3],
  ];
  const pos: number[] = [];
  for (const f of faces) for (const i of f) pos.push(...v[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function box(size: [number, number, number], at: [number, number, number], rot: [number, number, number] = [0, 0, 0]): Part {
  const g = new THREE.BoxGeometry(...size);
  g.rotateX(rot[0]);
  g.rotateY(rot[1]);
  g.rotateZ(rot[2]);
  g.translate(...at);
  return g;
}

/** A thin box from point a to point b: light strips along edges. */
function strip(a: [number, number, number], b: [number, number, number], w = 0.07, h = 0.05): Part {
  const pa = new THREE.Vector3(...a);
  const pb = new THREE.Vector3(...b);
  const d = pb.clone().sub(pa);
  const g = new THREE.BoxGeometry(w, h, d.length());
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize()));
  const m = pa.add(pb).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

/** Three short parallel slits ("III" vents). */
function slits(at: [number, number, number], along: [number, number, number], n = 3, len = 0.32, gap = 0.13): Part[] {
  const out: Part[] = [];
  const dir = new THREE.Vector3(...along).normalize();
  const side = new THREE.Vector3().crossVectors(dir, Y).normalize();
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * gap;
    const c = new THREE.Vector3(...at).addScaledVector(side, o);
    const a = c.clone().addScaledVector(dir, -len / 2);
    const b = c.clone().addScaledVector(dir, len / 2);
    out.push(strip([a.x, a.y, a.z], [b.x, b.y, b.z], 0.05, 0.04));
  }
  return out;
}

function torus(radius: number, tube: number, radial: number, tubular: number, at: [number, number, number], flat = false): Part {
  const g = new THREE.TorusGeometry(radius, tube, radial, tubular);
  if (flat) g.rotateX(Math.PI / 2);
  g.translate(...at);
  return g;
}

/** Mirror copy of a part across the x = 0 plane (left becomes right). */
function mirror(g: Part): Part {
  const m = g.clone();
  m.scale(-1, 1, 1);
  // Flip the winding so faces still point outwards.
  const src = (m.index ? m.toNonIndexed() : m).getAttribute('position') as THREE.BufferAttribute;
  const arr = src.array as Float32Array;
  for (let i = 0; i < arr.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const t = arr[i + 3 + k];
      arr[i + 3 + k] = arr[i + 6 + k];
      arr[i + 6 + k] = t;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return out;
}

/** Adds a part and its mirror image. */
function both(list: Part[], g: Part): void {
  list.push(g, mirror(prep(g)));
}

/**
 * A claw blade in the (x, z) plane around (cx, cz): its centre line runs from
 * radius r0 at angle a0 to radius r1 at angle a1; it is widest at `peak` (0..1)
 * and pointed at both ends.
 */
function claw(cx: number, cz: number, r0: number, r1: number, a0: number, a1: number, width: number, peak: number, t: number, y = 0, steps = 12): Part {
  const outer: [number, number][] = [];
  const inner: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const a = a0 + (a1 - a0) * u;
    const rc = r0 + (r1 - r0) * u;
    const w = width * (u < peak ? Math.sin((u / peak) * Math.PI * 0.5) : Math.pow(Math.cos(((u - peak) / (1 - peak)) * Math.PI * 0.5), 0.8));
    outer.push([cx + Math.cos(a) * (rc + w * 0.65), cz + Math.sin(a) * (rc + w * 0.65)]);
    inner.push([cx + Math.cos(a) * (rc - w * 0.35), cz + Math.sin(a) * (rc - w * 0.35)]);
  }
  return plate([...outer, ...inner.reverse().slice(1, -1)], t, y);
}

/** Glow line along the inside of a claw blade. */
function clawEdge(cx: number, cz: number, r0: number, r1: number, a0: number, a1: number, y: number): Part {
  const parts: Part[] = [];
  let prev: [number, number, number] | null = null;
  for (let i = 2; i <= 9; i++) {
    const u = i / 12;
    const a = a0 + (a1 - a0) * u;
    const rc = r0 + (r1 - r0) * u;
    const p: [number, number, number] = [cx + Math.cos(a) * rc, y, cz + Math.sin(a) * rc];
    if (prev) parts.push(strip(prev, p, 0.07, 0.03));
    prev = p;
  }
  return mergeGeometries(parts.map(prep)) as Part;
}

interface Model {
  gold: Part[];
  dark: Part[];
  glow: Part[];
  /** Engine nozzles, for the flame glows. */
  engines: [number, number, number][];
  /** Size of the engine glow sprite. */
  flame: number;
}

function trident(): Model {
  const gold: Part[] = [];
  const dark: Part[] = [];
  const glow: Part[] = [];
  gold.push(
    lathe(
      [
        [0.04, 2.7],
        [0.34, 2.0],
        [0.56, 0.9],
        [0.62, -0.4],
        [0.5, -1.7],
        [0.42, -2.1],
      ],
      6,
      1,
      0.72,
    ),
  );
  // The trident: a long centre spike and two side prongs, plus small chin prongs.
  gold.push(spike([0, 0, 2.3], [0, -0.02, 4.7], 0.17, 4));
  both(gold, spike([0.42, -0.06, 1.4], [0.82, -0.12, 3.8], 0.12, 4));
  both(gold, spike([0.24, -0.3, 1.1], [0.46, -0.46, 2.8], 0.09, 4));
  // Forward fins beside the cockpit.
  both(gold, spike([0.48, 0.16, 0.6], [1.25, 0.34, 1.95], 0.11, 4, 0.6));
  dark.push(gem([0, 0.36, 1.05], 1.35, 0.44, 0.32));
  // Long scythe blades on both sides, held by struts: one tip points forward, one back.
  const blade = claw(-1.6, -1.0, 4.35, 4.35, 0.68, -0.78, 0.62, 0.45, 0.16, 0.0, 14);
  blade.rotateZ(0.08);
  both(gold, blade);
  both(gold, box([2.05, 0.14, 0.42], [1.55, 0.02, -0.95]));
  both(gold, box([0.5, 0.12, 0.3], [2.55, 0.03, 0.4], [0, 0.5, 0]));
  both(glow, clawEdge(-1.6, -1.0, 4.35, 4.35, 0.68, -0.78, 0.14));
  // Dorsal fins: a big swept fin at the back and a smaller one in the middle.
  gold.push(spike([0, 0.3, -1.1], [0, 1.95, -3.3], 0.42, 4, 0.32));
  gold.push(spike([0, 0.36, 0.1], [0, 1.15, -1.2], 0.3, 4, 0.32));
  both(gold, spike([0.32, 0.3, -1.55], [0.95, 1.0, -2.75], 0.13, 4));
  // Engine with glowing bands.
  gold.push(
    lathe(
      [
        [0.4, -1.85],
        [0.5, -2.15],
        [0.5, -2.95],
        [0.4, -3.2],
      ],
      8,
    ),
  );
  glow.push(torus(0.51, 0.05, 4, 16, [0, 0, -2.35]), torus(0.51, 0.05, 4, 16, [0, 0, -2.7]));
  glow.push(lathe([[0.3, -3.22], [0.02, -3.25]], 8));
  // Light slits on the body.
  both(glow, strip([0.6, 0.06, 0.3], [0.58, 0.06, -0.6], 0.04, 0.1));
  both(glow, strip([0.3, 0.3, 1.75], [0.18, 0.36, 2.2], 0.04, 0.04));
  return { gold, dark, glow, engines: [[0, 0, -3.3]], flame: 2.6 };
}

function manta(): Model {
  const gold: Part[] = [];
  const dark: Part[] = [];
  const glow: Part[] = [];
  // The manta wing: one wide plate from wingtip to wingtip.
  const half: [number, number][] = [
    [0.7, 2.3],
    [1.6, 1.15],
    [2.6, 0.25],
    [3.35, -0.35],
    [3.15, -0.85],
    [2.4, -1.05],
    [1.6, -1.15],
    [1.0, -1.6],
    [0.5, -2.25],
  ];
  const outline: [number, number][] = [[0, 3.3], ...half, [0, -2.0], ...half.slice().reverse().map(([x, z]) => [-x, z] as [number, number])];
  gold.push(plate(outline, 0.16, 0));
  // Horns at the wingtips, curving forward and up.
  both(gold, spike([3.25, 0.02, -0.4], [3.6, 0.72, 0.85], 0.2, 4));
  // Raised centre body.
  gold.push(
    lathe(
      [
        [0.05, 3.15],
        [0.42, 2.4],
        [0.64, 1.2],
        [0.7, -0.2],
        [0.6, -1.6],
        [0.45, -2.3],
      ],
      6,
      1,
      0.62,
    ),
  );
  dark.push(gem([0, 0.4, 1.75], 1.15, 0.46, 0.3));
  // Dorsal fins: one in the middle, one on each wing.
  gold.push(spike([0, 0.38, 0.35], [0, 1.25, -1.55], 0.32, 4, 0.34));
  both(gold, spike([1.3, 0.08, -0.15], [1.65, 0.86, -1.35], 0.24, 4, 0.4));
  // Twin engine pod on top.
  for (const x of [0.34, -0.34]) {
    gold.push(
      lathe(
        [
          [0.16, -0.55],
          [0.31, -0.85],
          [0.31, -2.35],
          [0.24, -2.55],
        ],
        8,
      ).translate(x, 0.45, 0),
    );
    for (const z of [-1.05, -1.45, -1.85]) glow.push(box([0.34, 0.05, 0.16], [x, 0.77, z]));
    glow.push(lathe([[0.2, -2.56], [0.02, -2.6]], 8).translate(x, 0.45, 0));
  }
  // Vents and edge lights.
  for (const s of [1, -1]) {
    glow.push(...slits([2.25 * s, 0.11, -0.15], [0.55 * s, 0, 1]));
    glow.push(...slits([0.95 * s, 0.17, 1.15], [0.2 * s, 0, 1], 2, 0.4, 0.12));
    glow.push(strip([0.95 * s, 0.1, 1.85], [2.85 * s, 0.1, 0.05], 0.06, 0.03));
    glow.push(strip([2.55 * s, 0.1, -0.95], [1.65 * s, 0.1, -1.08], 0.06, 0.03));
  }
  return {
    gold,
    dark,
    glow,
    engines: [
      [0.34, 0.45, -2.65],
      [-0.34, 0.45, -2.65],
    ],
    flame: 2.0,
  };
}

function halo(): Model {
  const gold: Part[] = [];
  const dark: Part[] = [];
  const glow: Part[] = [];
  gold.push(
    lathe(
      [
        [0.04, 3.2],
        [0.26, 2.6],
        [0.5, 1.4],
        [0.56, 0],
        [0.5, -1.4],
        [0.42, -2.2],
      ],
      6,
      1,
      0.8,
    ),
  );
  gold.push(spike([0, 0, 2.9], [0, 0, 3.95], 0.12, 4));
  dark.push(gem([0, 0.34, 1.35], 1.25, 0.4, 0.3));
  // The hoop around the body.
  gold.push(torus(0.8, 0.15, 6, 16, [0, 0, -0.1]));
  glow.push(torus(0.8, 0.045, 4, 24, [0, 0, 0.07]));
  // The halo: a flat ring around the ship with four crescent blades, like a spinning saw.
  glow.push(torus(2.05, 0.06, 4, 48, [0, 0, 0], true));
  gold.push(torus(2.05, 0.1, 4, 48, [0, -0.06, 0], true));
  const blades: [number, number, number, number, number][] = [
    // start angle, sweep, radius at start, radius at the tip, width
    [Math.PI * 0.35, 2.1, 2.2, 3.55, 0.85],
    [Math.PI * 1.35, 2.1, 2.2, 3.55, 0.85],
    [Math.PI * 0.95, 1.2, 2.15, 2.95, 0.5],
    [Math.PI * 1.95, 1.2, 2.15, 2.95, 0.5],
  ];
  for (const [a0, sweep, r0, r1, width] of blades) {
    gold.push(claw(0, 0, r0, r1, a0, a0 + sweep, width, 0.3, 0.15, 0, 14));
    glow.push(clawEdge(0, 0, r0 + 0.1, r1, a0, a0 + sweep, 0.1));
    // Strut from the ring to the blade.
    const sx = Math.cos(a0 + sweep * 0.12);
    const sz = Math.sin(a0 + sweep * 0.12);
    gold.push(strip([sx * 1.95, 0, sz * 1.95], [sx * 2.35, 0, sz * 2.35], 0.24, 0.12));
  }
  // Small fins near the hoop and on the back.
  both(gold, spike([0.32, 0.34, -0.5], [0.62, 1.05, -1.45], 0.13, 4));
  both(gold, spike([0.55, -0.12, -0.25], [1.3, -0.32, -1.25], 0.13, 4));
  // Engine: dark band, gold housing, glowing vents.
  dark.push(
    lathe(
      [
        [0.42, -2.0],
        [0.46, -2.15],
        [0.46, -2.45],
      ],
      8,
    ),
  );
  gold.push(
    lathe(
      [
        [0.46, -2.45],
        [0.5, -2.6],
        [0.5, -2.95],
        [0.36, -3.1],
      ],
      8,
    ),
  );
  for (const s of [1, -1]) glow.push(...slits([0.5 * s, 0.05, -2.75], [0, 0, 1], 3, 0.24, 0.1));
  glow.push(lathe([[0.3, -3.12], [0.02, -3.15]], 8));
  for (const s of [1, -1]) glow.push(...slits([0.32 * s, 0.33, 0.3], [0.15 * s, 0, 1], 3, 0.26, 0.09));
  return { gold, dark, glow, engines: [[0, 0, -3.2]], flame: 2.4 };
}

function bulwark(): Model {
  const gold: Part[] = [];
  const dark: Part[] = [];
  const glow: Part[] = [];
  // Heavy armoured hull.
  gold.push(
    lathe(
      [
        [0.35, 2.75],
        [1.05, 2.25],
        [1.35, 1.0],
        [1.4, -0.6],
        [1.15, -1.6],
        [0.9, -2.0],
      ],
      6,
      1.05,
      0.72,
    ),
  );
  // Armour plates on the flanks.
  both(gold, box([0.3, 0.55, 1.6], [1.25, 0.15, 0.6], [0, 0.12, 0.25]));
  // Front: a dark face with two upright glowing grilles.
  dark.push(box([0.9, 0.5, 0.1], [0, -0.1, 2.7]));
  for (const x of [0.22, -0.22]) glow.push(box([0.1, 0.42, 0.05], [x, -0.1, 2.77]));
  gold.push(box([1.1, 0.14, 0.5], [0, 0.22, 2.45], [-0.25, 0, 0]));
  dark.push(gem([0, 0.6, 1.2], 1.25, 0.66, 0.4));
  // Short thick wings with bent tips and forward spikes.
  const wing = plate(
    [
      [1.2, 0.95],
      [2.2, 0.55],
      [2.6, 0.1],
      [2.65, -0.6],
      [2.1, -0.95],
      [1.2, -1.05],
    ],
    0.34,
    0,
  );
  wing.rotateZ(-0.12);
  both(gold, wing);
  both(gold, spike([2.5, -0.22, 0.25], [2.68, -0.1, 1.45], 0.22, 4));
  both(gold, box([0.26, 0.55, 0.95], [2.68, -0.42, -0.25]));
  for (const s of [1, -1]) {
    glow.push(...slits([1.85 * s, 0.1, 0.25], [0, 0, 1], 3, 0.36, 0.1));
    glow.push(strip([2.82 * s, -0.4, 0.15], [2.82 * s, -0.4, -0.6], 0.04, 0.1));
    glow.push(strip([1.3 * s, 0.05, 0.45], [1.3 * s, 0.05, -0.6], 0.04, 0.12));
  }
  // Three tall dorsal fins.
  gold.push(spike([0, 0.55, 0.45], [0, 2.25, -1.55], 0.42, 4, 0.3));
  both(gold, spike([0.58, 0.5, 0.05], [0.75, 1.65, -1.45], 0.3, 4, 0.35));
  for (const s of [1, -1]) glow.push(...slits([0.58 * s, 0.75, -0.35], [0, 0.7, -1], 2, 0.3, 0.1));
  // Twin engines.
  for (const x of [0.85, -0.85]) {
    gold.push(
      lathe(
        [
          [0.5, -0.8],
          [0.74, -1.15],
          [0.74, -2.6],
          [0.64, -2.95],
          [0.48, -3.05],
        ],
        8,
      ).translate(x, 0.32, 0),
    );
    dark.push(lathe([[0.7, -1.85], [0.7, -2.05]], 8).translate(x, 0.32, 0));
    glow.push(torus(0.75, 0.06, 4, 16, [x, 0.32, -1.5]), torus(0.75, 0.06, 4, 16, [x, 0.32, -2.35]));
    glow.push(lathe([[0.42, -3.07], [0.02, -3.1]], 8).translate(x, 0.32, 0));
  }
  return {
    gold,
    dark,
    glow,
    engines: [
      [0.85, 0.32, -3.15],
      [-0.85, 0.32, -3.15],
    ],
    flame: 3.0,
  };
}

const BUILDERS: Record<ShipId, () => Model> = { trident, manta, halo, bulwark };

interface Built {
  gold: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  engines: THREE.Vector3[];
  flame: number;
}

const cache = new Map<ShipId, Built>();

function built(id: ShipId): Built {
  let b = cache.get(id);
  if (!b) {
    const m = BUILDERS[id]();
    const merge = (list: Part[]) => mergeGeometries(list.map(prep)) as THREE.BufferGeometry;
    b = {
      gold: merge(m.gold),
      dark: merge(m.dark),
      glow: merge(m.glow),
      engines: m.engines.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      flame: m.flame,
    };
    cache.set(id, b);
  }
  return b;
}

export interface ShipMesh {
  readonly group: THREE.Group;
  /** Gold and canopy materials, for the phase shimmer. */
  readonly solids: THREE.MeshStandardMaterial[];
  readonly glowMat: THREE.MeshBasicMaterial;
  /** Engine glow sprites. */
  readonly flames: THREE.Sprite[];
  readonly flame: number;
  /** Frees geometry that belongs to this model alone. */
  free?(): void;
}

/** A ship of the given model; light strips and engines glow in the pilot's colour. */
export function makeShip(id: ShipId, color: number, glowTexture: THREE.Texture): ShipMesh {
  const b = built(id);
  const group = new THREE.Group();
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xf6c21c, emissive: 0x5a3f00, metalness: 0.22, roughness: 0.42, flatShading: true });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x15121c, emissive: 0x050308, metalness: 0.75, roughness: 0.16, flatShading: true });
  const glowMat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const gold = new THREE.Mesh(b.gold, goldMat);
  const dark = new THREE.Mesh(b.dark, darkMat);
  const glow = new THREE.Mesh(b.glow, glowMat);
  for (const m of [gold, dark, glow]) m.userData.sharedGeometry = true;
  group.add(gold, dark, glow);
  const flames = b.engines.map((p) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    s.position.copy(p);
    s.scale.setScalar(b.flame);
    group.add(s);
    return s;
  });
  return { group, solids: [goldMat, darkMat], glowMat, flames, flame: b.flame };
}

/** Frees the materials of a ship (the geometry is shared and stays). */
export function disposeShip(s: ShipMesh): void {
  s.free?.();
  for (const m of s.solids) m.dispose();
  s.glowMat.dispose();
  for (const f of s.flames) f.material.dispose();
}
