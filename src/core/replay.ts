import type { PilotInput } from './types';

/**
 * Flight recording: one input per tick. Inputs are rounded to steps of 1/100
 * before the simulation uses them, so a recording reproduces the flight exactly.
 * Encoding: runs of identical ticks as [count (varint), steerX, steerY, roll (int8), flags (uint8: 1 boost, 2 fire, 4 special)].
 */

export const MAX_REPLAY_TICKS = 60 * 60 * 10;

/** Rounds an input in place to the recorded precision. */
export function quantize(inp: PilotInput): PilotInput {
  inp.steerX = q(inp.steerX) / 100;
  inp.steerY = q(inp.steerY) / 100;
  inp.roll = q(inp.roll) / 100;
  return inp;
}

function q(v: number): number {
  const c = v < -1 ? -1 : v > 1 ? 1 : v;
  return Math.round(c * 100);
}

export class ReplayRecorder {
  private readonly x: number[] = [];
  private readonly y: number[] = [];
  private readonly r: number[] = [];
  private readonly b: number[] = [];

  get length(): number {
    return this.x.length;
  }

  /** Records an input that was already quantized. */
  push(inp: PilotInput): void {
    if (this.x.length >= MAX_REPLAY_TICKS) return;
    this.x.push(q(inp.steerX));
    this.y.push(q(inp.steerY));
    this.r.push(q(inp.roll));
    this.b.push((inp.boost ? 1 : 0) | (inp.fire ? 2 : 0) | (inp.special ? 4 : 0));
  }

  /** Base64 of the first `ticks` inputs. */
  encode(ticks = this.length): string {
    const n = Math.min(ticks, this.length);
    const out: number[] = [];
    let i = 0;
    while (i < n) {
      let j = i + 1;
      while (j < n && this.x[j] === this.x[i] && this.y[j] === this.y[i] && this.r[j] === this.r[i] && this.b[j] === this.b[i]) j++;
      let count = j - i;
      while (count >= 0x80) {
        out.push((count & 0x7f) | 0x80);
        count >>>= 7;
      }
      out.push(count);
      out.push(this.x[i] & 0xff, this.y[i] & 0xff, this.r[i] & 0xff, this.b[i]);
      i = j;
    }
    let bin = '';
    for (let k = 0; k < out.length; k += 0x4000) bin += String.fromCharCode(...out.slice(k, k + 0x4000));
    return btoa(bin);
  }
}

/** Turns a recording back into inputs. Returns null for anything malformed. */
export function decodeReplay(data: string, maxTicks = MAX_REPLAY_TICKS): PilotInput[] | null {
  let bin: string;
  try {
    bin = atob(data);
  } catch {
    return null;
  }
  const inputs: PilotInput[] = [];
  let i = 0;
  const s8 = (v: number) => (v > 127 ? v - 256 : v);
  while (i < bin.length) {
    let count = 0;
    let shift = 0;
    for (;;) {
      if (i >= bin.length || shift > 28) return null;
      const c = bin.charCodeAt(i++);
      count |= (c & 0x7f) << shift;
      if (!(c & 0x80)) break;
      shift += 7;
    }
    if (count <= 0 || i + 4 > bin.length) return null;
    const x = s8(bin.charCodeAt(i++));
    const y = s8(bin.charCodeAt(i++));
    const r = s8(bin.charCodeAt(i++));
    const f = bin.charCodeAt(i++);
    if (x < -100 || x > 100 || y < -100 || y > 100 || r < -100 || r > 100 || f > 7) return null;
    if (inputs.length + count > maxTicks) return null;
    const inp: PilotInput = { steerX: x / 100, steerY: y / 100, roll: r / 100, boost: (f & 1) === 1, fire: (f & 2) === 2, special: (f & 4) === 4 };
    for (let k = 0; k < count; k++) inputs.push(inp);
  }
  return inputs;
}
