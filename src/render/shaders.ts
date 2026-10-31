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
