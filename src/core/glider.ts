import { FLIGHT, DT, TAIL_OFFSET } from './config';
import { AXIS_FWD, AXIS_UP, Quat, V3, clamp } from './math';
import type { BotBrain } from './bot';
import type { CrashInfo, PilotInput } from './types';

export interface Glider {
  readonly id: number;
  readonly name: string;
  readonly isBot: boolean;
  /** Auto-horizon assist: levels the glider slowly when the pilot is not rolling. */
  readonly assist: boolean;
  alive: boolean;
  readonly p: V3;
  readonly pPrev: V3;
  /** Flight frame: turned by yaw, pitch and free roll. */
  readonly qb: Quat;
  /** Full orientation: flight frame plus the bank into the current turn. */
  readonly q: Quat;
  bank: number;
  speed: number;
  energy: number;
  boosting: boolean;
  crashTick: number;
  crash: CrashInfo | null;
  /** Final placing, 0 while still flying. */
  place: number;
  /** Distance to the nearest wall in range, or a large number. */
  wallDist: number;
  readonly near: V3;
  hasNear: boolean;
  brain: BotBrain | null;
  /** The input used in the last tick. */
  readonly input: PilotInput;
}

const tq = new Quat();
const tf = new V3();
const tu = new V3();

/**
 * Flight model B: free flight like a plane, tuned for arcade play.
 * Left/right turns the glider in its own frame and banks it into the turn.
 * Up/down lifts or lowers the nose. Roll turns the whole frame, and with it the wall.
 */
export function integrateGlider(g: Glider, inp: PilotInput): void {
  const sx = clamp(inp.steerX, -1, 1);
  const sy = clamp(inp.steerY, -1, 1);
  const sr = clamp(inp.roll, -1, 1);
  g.input.steerX = sx;
  g.input.steerY = sy;
  g.input.roll = sr;
  g.input.boost = inp.boost;

  // Turn right = rotate about local +Y by a negative angle.
  if (sx !== 0) g.qb.multiply(tq.setAxisAngle(0, 1, 0, -sx * FLIGHT.yawRate * DT));
  // Nose up = rotate about local +X by a negative angle.
  if (sy !== 0) g.qb.multiply(tq.setAxisAngle(1, 0, 0, -sy * FLIGHT.pitchRate * DT));
  // Roll right = rotate about local +Z by a positive angle.
  if (sr !== 0) {
    g.qb.multiply(tq.setAxisAngle(0, 0, 1, sr * FLIGHT.rollRate * DT));
  } else if (g.assist) {
    autoHorizon(g);
  }
  g.qb.normalize();

  g.bank += (sx * FLIGHT.bankMax - g.bank) * FLIGHT.bankLerp;
  g.q.copy(g.qb).multiply(tq.setAxisAngle(0, 0, 1, g.bank));

  const boost = inp.boost && g.energy > 0.02;
  g.boosting = boost;
  g.energy = clamp(g.energy + (boost ? -FLIGHT.boostDrain : FLIGHT.boostRegen), 0, 1);
  const target = boost ? FLIGHT.boostSpeed : FLIGHT.cruiseSpeed;
  g.speed += (target - g.speed) * FLIGHT.speedLerp;

  g.pPrev.copy(g.p);
  g.q.rotate(AXIS_FWD, tf);
  g.p.addScaled(tf, g.speed * DT);
}

/** Rolls the flight frame back towards world-up, without touching pitch. */
function autoHorizon(g: Glider): void {
  g.qb.rotate(AXIS_FWD, tf);
  g.qb.rotate(AXIS_UP, tu);
  const fy = tf.y;
  let wx = -tf.x * fy;
  let wy = 1 - fy * fy;
  let wz = -tf.z * fy;
  const wl2 = wx * wx + wy * wy + wz * wz;
  if (wl2 < 0.02) return; // flying almost straight up or down
  const wl = Math.sqrt(wl2);
  wx /= wl;
  wy /= wl;
  wz /= wl;
  const cx = tu.y * wz - tu.z * wy;
  const cy = tu.z * wx - tu.x * wz;
  const cz = tu.x * wy - tu.y * wx;
  let s = tf.x * cx + tf.y * cy + tf.z * cz;
  const c = tu.x * wx + tu.y * wy + tu.z * wz;
  if (c < 0) s = s >= 0 ? 1 : -1;
  const max = FLIGHT.autoHorizonRate * DT;
  const step = clamp(s * FLIGHT.autoHorizonGain * DT, -max, max);
  g.qb.multiply(tq.setAxisAngle(0, 0, 1, step));
}

/** Where the wall leaves the glider. */
export function tailPoint(g: Glider, out: V3): V3 {
  g.q.rotate(AXIS_FWD, out);
  return out.scale(-TAIL_OFFSET).add(g.p);
}
