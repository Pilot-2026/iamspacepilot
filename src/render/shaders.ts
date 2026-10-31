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

/** Arena shield lattice: almost invisible, glows up near the player. */
const latticeVert = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const latticeFrag = /* glsl */ `
uniform vec3 uPlayer;
uniform vec3 uColor;
uniform float uBase;
uniform float uGlowR;
uniform float uPulse;
varying vec3 vW;
void main() {
  float g = 1.0 - smoothstep(0.0, uGlowR, distance(vW, uPlayer));
  float a = uBase * (1.0 + uPulse) + g * 0.85;
  gl_FragColor = vec4(uColor * (0.7 + g * 0.9), a);
}`;

export function latticeMaterial(color: number, base: number, glowR: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPlayer: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(color) },
      uBase: { value: base },
      uGlowR: { value: glowR },
      uPulse: { value: 0 },
    },
    vertexShader: latticeVert,
    fragmentShader: latticeFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
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
