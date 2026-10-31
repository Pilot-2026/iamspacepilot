import * as THREE from 'three';

/** Sky dome: gradient, sun glow, optional horizon band and lightning flash. */
export interface DomeOptions {
  top: number;
  mid: number;
  hor: number;
  bot: number;
  horY?: number;
  sunDir?: THREE.Vector3;
  sunCol?: number;
  bandCol?: number;
  bandY?: number;
  bandW?: number;
}

const domeVert = /* glsl */ `
varying vec3 vP;
void main() {
  vP = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const domeFrag = /* glsl */ `
uniform vec3 top, mid, hor, bot, sunDir, sunCol, bandCol;
uniform float horY, bandY, bandW, flash;
varying vec3 vP;
void main() {
  float y = vP.y - horY;
  vec3 c;
  if (y > 0.0) {
    c = mix(hor, mid, smoothstep(0.0, 0.28, y));
    c = mix(c, top, smoothstep(0.28, 0.9, y));
  } else {
    c = mix(hor, bot, smoothstep(0.0, 0.3, -y));
  }
  float s = max(dot(vP, sunDir), 0.0);
  c += sunCol * (pow(s, 60.0) * 1.0 + pow(s, 6.0) * 0.2);
  c += bandCol * exp(-pow((vP.y - bandY) * bandW, 2.0));
  c += vec3(0.5, 0.45, 0.75) * flash;
  gl_FragColor = vec4(c, 1.0);
}`;

export function makeDome(o: DomeOptions): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const uniforms = {
    top: { value: new THREE.Color(o.top) },
    mid: { value: new THREE.Color(o.mid) },
    hor: { value: new THREE.Color(o.hor) },
    bot: { value: new THREE.Color(o.bot) },
    sunDir: { value: (o.sunDir ?? new THREE.Vector3(0, -1, 0)).clone().normalize() },
    sunCol: { value: new THREE.Color(o.sunCol ?? 0) },
    bandCol: { value: new THREE.Color(o.bandCol ?? 0) },
    horY: { value: o.horY ?? 0 },
    bandY: { value: o.bandY ?? 0 },
    bandW: { value: o.bandW ?? 10 },
    flash: { value: 0 },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 48, 24),
    new THREE.ShaderMaterial({ uniforms, vertexShader: domeVert, fragmentShader: domeFrag, side: THREE.BackSide, depthWrite: false }),
  );
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Arena shield: a glowing grid on the arena boundary, clearly visible from
 * anywhere in the arena. Lines get thicker, brighter and turn red near the player.
 * The same material draws the deadly floor and ceiling.
 */
const shieldVert = /* glsl */ `
varying vec3 vW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const shieldFrag = /* glsl */ `
uniform vec3 uPlayer;
uniform vec3 uColor;
uniform vec3 uWarn;
uniform vec2 uCells;
uniform float uLine;
uniform float uFill;
uniform float uGlowR;
uniform float uPulse;
uniform float uTime;
uniform float uFloorY;
varying vec3 vW;
varying vec2 vUv;
void main() {
  if (vW.y < uFloorY) discard;
  vec2 c = vUv * uCells;
  vec2 g = abs(fract(c - 0.5) - 0.5) / max(fwidth(c), vec2(1e-4));
  float gd = min(g.x, g.y);
  float d = distance(vW, uPlayer);
  float near = 1.0 - smoothstep(0.0, uGlowR, d);
  float close = 1.0 - smoothstep(0.0, uGlowR * 0.45, d);
  // About 2 px wide lines, up to 6 px close to the player.
  float w = 1.0 + near * 2.0;
  float line = 1.0 - smoothstep(w, w + 1.2, gd);
  float viewD = distance(vW, cameraPosition);
  float far = 1.0 - smoothstep(120.0, 360.0, viewD) * 0.5;
  float pulse = uPulse * (0.5 + 0.5 * sin(uTime * 6.0));
  float a = line * (uLine * (1.0 + pulse) + near * 0.65) * far;
  a += uFill * (1.0 + pulse) + near * 0.16 + close * 0.14;
  vec3 col = mix(uColor, uWarn, close);
  gl_FragColor = vec4(col * (1.0 + near * 0.6), clamp(a, 0.0, 1.0));
}`;

export interface ShieldOptions {
  color: number;
  cells: [number, number];
  line: number;
  fill: number;
  floorY: number;
}

export function shieldMaterial(o: ShieldOptions): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uPlayer: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(o.color) },
      uWarn: { value: new THREE.Color(0xff3b30) },
      uCells: { value: new THREE.Vector2(o.cells[0], o.cells[1]) },
      uLine: { value: o.line },
      uFill: { value: o.fill },
      uGlowR: { value: 45 },
      uPulse: { value: 0 },
      uTime: { value: 0 },
      uFloorY: { value: o.floorY },
    },
    vertexShader: shieldVert,
    fragmentShader: shieldFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return m;
}

/** Light wall: translucent band with bright edges and a flash where it is born. */
export const ribbonVert = /* glsl */ `
attribute float aSide;
attribute float aBirth;
uniform float uNow;
varying float vSide;
varying float vFlash;
varying float vDist;
void main() {
  vSide = aSide;
  vFlash = exp(-max(uNow - aBirth, 0.0) * 4.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

export const ribbonFrag = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uCore;
uniform float uFogFar;
uniform float uAdditive;
uniform float uDim;
varying float vSide;
varying float vFlash;
varying float vDist;
void main() {
  float e = abs(vSide);
  float edge = smoothstep(0.72, 0.97, e);
  float a = (uCore + edge * (1.0 - uCore)) * uDim;
  vec3 c = mix(uColor, vec3(1.0), clamp(edge * 0.55 + vFlash * 0.5, 0.0, 1.0));
  a = min(1.0, a + vFlash * 0.35);
  float d = clamp(vDist / uFogFar, 0.0, 1.0);
  a *= 1.0 - d * 0.75;
  c = mix(c, uFogColor, d * 0.6 * (1.0 - uAdditive));
  gl_FragColor = vec4(c, a);
}`;

/** Value noise and fbm, shared by the planet shaders. */
const noiseChunk = /* glsl */ `
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 0.17; a *= 0.5; } return s; }
`;

const planetVert = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vL = normal;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const planetFrag = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uRim;
uniform float uDay;
uniform float uKind;
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;
${noiseChunk}
void main() {
  vec3 n = normalize(vN);
  vec3 nL = normalize(vL);
  float d = dot(n, normalize(uSun));
  vec3 col;
  float city = 0.0;
  float earth = uKind < 0.5 ? 1.0 : 0.0;
  if (uKind < 0.5) {
    float h = fbm(nL * 1.8 + 0.5);
    float land = smoothstep(0.50, 0.53, h);
    float cl = smoothstep(0.55, 0.75, fbm(nL * 7.0 + 3.1));
    vec3 ground = mix(vec3(0.09, 0.20, 0.09), vec3(0.45, 0.38, 0.24), smoothstep(0.53, 0.7, h));
    col = mix(vec3(0.02, 0.08, 0.20), ground, land);
    col = mix(col, vec3(0.92, 0.94, 1.0), cl * 0.85);
    city = land * (1.0 - cl) * smoothstep(0.86, 0.95, noise(nL * 520.0));
  } else {
    float h = fbm(nL * 3.0 + 1.7);
    float maria = 1.0 - smoothstep(0.42, 0.47, h);
    float cr = noise(nL * 70.0);
    float crater = smoothstep(0.76, 0.79, cr) - smoothstep(0.79, 0.86, cr) * 0.7;
    col = vec3(0.56, 0.55, 0.53) * (0.72 + 0.4 * fbm(nL * 16.0)) * (1.0 - maria * 0.45) + crater * 0.09;
  }
  float day = smoothstep(-0.08, 0.22, d) * uDay;
  vec3 night = vec3(0.004, 0.008, 0.02) + vec3(0.01, 0.014, 0.02) * earth + vec3(1.0, 0.72, 0.38) * city;
  vec3 c = mix(night, col * (0.18 + max(d, 0.0)), day);
  c += vec3(1.0, 0.45, 0.2) * exp(-pow(d * 7.0, 2.0)) * 0.18 * uDay * earth;
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  c += uRim * rim * (0.35 + 0.65 * day);
  gl_FragColor = vec4(c, 1.0);
}`;

/** A planet: kind 0 = Earth-like, 1 = Moon. thetaLength < PI builds only the top cap. */
export function makePlanet(
  radius: number,
  cap: number,
  sunDir: THREE.Vector3,
  rim: number,
  day: number,
  kind: 0 | 1,
): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, cap < Math.PI ? 256 : 96, cap < Math.PI ? 48 : 64, 0, Math.PI * 2, 0, cap),
    new THREE.ShaderMaterial({
      uniforms: {
        uSun: { value: sunDir.clone().normalize() },
        uRim: { value: new THREE.Color(rim) },
        uDay: { value: day },
        uKind: { value: kind },
      },
      vertexShader: planetVert,
      fragmentShader: planetFrag,
    }),
  );
}

const giantFrag = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uC1;
uniform vec3 uC2;
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;
${noiseChunk}
void main() {
  vec3 n = normalize(vN);
  vec3 nL = normalize(vL);
  float band = 0.5 + 0.5 * sin(nL.y * 26.0 + fbm(nL * vec3(2.0, 14.0, 2.0)) * 5.0);
  vec3 col = mix(uC1, uC2, band);
  float d = max(dot(n, normalize(uSun)), 0.0);
  gl_FragColor = vec4(col * (0.1 + d * 1.1), 1.0);
}`;

/** A banded gas giant for the sky. */
export function makeGiant(radius: number, sunDir: THREE.Vector3, c1: number, c2: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 48),
    new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sunDir.clone().normalize() }, uC1: { value: new THREE.Color(c1) }, uC2: { value: new THREE.Color(c2) } },
      vertexShader: planetVert,
      fragmentShader: giantFrag,
    }),
  );
}

const planetRingVert = /* glsl */ `
varying float vR;
void main() {
  vR = length(position.xy);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const planetRingFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uInner;
uniform float uOuter;
varying float vR;
void main() {
  float t = clamp((vR - uInner) / (uOuter - uInner), 0.0, 1.0);
  float bands = 0.55 + 0.45 * sin(t * 70.0) * sin(t * 13.0 + 1.3);
  float gap = smoothstep(0.55, 0.57, t) * (1.0 - smoothstep(0.6, 0.62, t));
  float edge = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.92, 1.0, t));
  float a = bands * edge * (1.0 - gap * 0.9) * 0.75;
  gl_FragColor = vec4(uColor * (0.7 + 0.3 * bands), a);
}`;

/** Flat banded ring around a giant planet. */
export function makePlanetRing(inner: number, outer: number, color: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 160, 1),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uInner: { value: inner }, uOuter: { value: outer } },
      vertexShader: planetRingVert,
      fragmentShader: planetRingFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
}

const auroraVert = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  p.z += sin(p.x * 0.018 + uTime * 0.25) * 20.0 + sin(p.x * 0.047 - uTime * 0.18) * 8.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const auroraFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uLow;
uniform vec3 uHigh;
varying vec2 vUv;
void main() {
  float rays = 0.55 + 0.45 * sin(vUv.x * 190.0 + sin(vUv.x * 23.0 + uTime * 0.6) * 3.0);
  float h = vUv.y;
  float a = smoothstep(0.0, 0.14, h) * (1.0 - smoothstep(0.32, 1.0, h)) * rays;
  a *= smoothstep(0.0, 0.1, vUv.x) * (1.0 - smoothstep(0.9, 1.0, vUv.x));
  vec3 c = mix(uLow, uHigh, smoothstep(0.15, 0.85, h));
  gl_FragColor = vec4(c, a * 0.5);
}`;

/** Material for northern-light curtains. Advance uTime every frame. */
export function auroraMaterial(low: number, high: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLow: { value: new THREE.Color(low) }, uHigh: { value: new THREE.Color(high) } },
    vertexShader: auroraVert,
    fragmentShader: auroraFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}
