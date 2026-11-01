import { clamp } from '../core/math';
import type { PilotInput } from '../core/types';
import type { TouchControls } from '../ui/touch';

const DEAD = 0.15;

/** Records a tap and reports true on the fifth tap within 2.5 seconds. */
export function countTap(taps: number[], now = performance.now()): boolean {
  taps.push(now);
  while (taps.length && now - taps[0] > 2500) taps.shift();
  if (taps.length >= 5) {
    taps.length = 0;
    return true;
  }
  return false;
}
const dead = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

/**
 * Merges keyboard, gamepad and touch into one pilot input per tick.
 * Keys ramp up smoothly so tapping gives small corrections.
 */
export class InputManager {
  /** Flight mode: arrow up lowers the nose, like in a plane. */
  invertPitch = true;
  /** Key code -> when its last keydown arrived and whether it was a repeat. */
  private readonly keys = new Map<string, { at: number; repeat: boolean }>();
  private metaHeld = false;
  private kx = 0;
  private ky = 0;
  private kr = 0;
  private padPause = false;
  /** Left mouse button held on the 3D view. */
  private mouseFire = false;
  private readonly out: PilotInput = { steerX: 0, steerY: 0, roll: 0, boost: false, fire: false, special: false };

  private readonly cheatTaps: number[] = [];

  constructor(
    private readonly touch: TouchControls,
    private readonly onPauseKey: () => void,
    private readonly onCheat: () => void,
  ) {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (!e.repeat) this.onPauseKey();
        return;
      }
      if ((e.code === 'Digit1' || e.code === 'Numpad1') && !e.repeat) {
        if (countTap(this.cheatTaps)) this.onCheat();
        return;
      }
      if (e.code === 'MetaLeft' || e.code === 'MetaRight') this.metaHeld = true;
      if (this.capturing) {
        // While flying, keys must not scroll the page or trigger browser shortcuts (Command is boost).
        if (e.metaKey || e.ctrlKey || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      }
      this.keys.set(e.code, { at: performance.now(), repeat: e.repeat });
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'MetaLeft' || e.code === 'MetaRight') {
        // On a Mac the browser does not report keys let go while Command was held: forget them.
        this.metaHeld = false;
        for (const code of [...this.keys.keys()]) if (!/^(Shift|Alt|Control|Meta)/.test(code)) this.keys.delete(code);
      }
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.metaHeld = false;
      this.mouseFire = false;
    });
    // Mouse: hold the left button on the 3D view to fire.
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.capturing && (e.target as HTMLElement | null)?.id === 'scene') this.mouseFire = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
    });
  }

  /** True while flying: arrow keys and space must not scroll the page. */
  capturing = false;

  reset(): void {
    this.keys.clear();
    this.metaHeld = false;
    this.mouseFire = false;
    this.kx = 0;
    this.ky = 0;
    this.kr = 0;
  }

  /** Push to talk: R, or Y / d-pad up on a gamepad. */
  talkHeld(): boolean {
    if (this.key('KeyR')) return true;
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) if (pad && (pad.buttons[3]?.pressed || pad.buttons[12]?.pressed)) return true;
    return false;
  }

  private key(...codes: string[]): boolean {
    const now = performance.now();
    for (const c of codes) {
      const k = this.keys.get(c);
      if (!k) continue;
      // While Command is held, a key counts as held only while it keeps repeating.
      if (this.metaHeld && !c.startsWith('Meta') && now - k.at > (k.repeat ? 220 : 650)) continue;
      return true;
    }
    return false;
  }

  /** Reads all devices for one simulation tick. */
  sample(dt: number): PilotInput {
    const tx = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
    const ty = (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0);
    const tr = (this.key('KeyE') ? 1 : 0) - (this.key('KeyQ') ? 1 : 0);
    const ramp = (cur: number, target: number) => {
      const rate = target === 0 ? 9 : 5;
      const d = target - cur;
      const step = rate * dt;
      return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
    };
    this.kx = ramp(this.kx, tx);
    this.ky = ramp(this.ky, ty);
    this.kr = ramp(this.kr, tr);

    let px = 0;
    let py = 0;
    let pr = 0;
    let pb = false;
    let pf = false;
    let ps = false;
    let pause = false;
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      px += dead(pad.axes[0] ?? 0);
      py -= dead(pad.axes[1] ?? 0);
      if (pad.buttons[4]?.pressed) pr -= 1;
      if (pad.buttons[5]?.pressed) pr += 1;
      if ((pad.buttons[7]?.value ?? 0) > 0.3 || pad.buttons[0]?.pressed) pb = true;
      if ((pad.buttons[6]?.value ?? 0) > 0.3 || pad.buttons[2]?.pressed) pf = true;
      if (pad.buttons[1]?.pressed) ps = true;
      if (pad.buttons[9]?.pressed) pause = true;
    }
    if (pause && !this.padPause) this.onPauseKey();
    this.padPause = pause;

    const t = this.touch.state;
    const sy = clamp(this.ky + py + t.steerY, -1, 1);
    this.out.steerX = clamp(this.kx + px + t.steerX, -1, 1);
    this.out.steerY = this.invertPitch ? -sy : sy;
    this.out.roll = clamp(this.kr + pr + t.roll, -1, 1);
    // Boost: Command (Mac), or Shift on any keyboard.
    this.out.boost = this.key('MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight') || pb || t.boost;
    // Fire: Space, F or the left mouse button.
    this.out.fire = this.key('Space', 'KeyF') || this.mouseFire || pf || t.fire;
    // Special ability: C, B on a gamepad or the touch button.
    this.out.special = this.key('KeyC') || ps || t.special;
    return this.out;
  }
}
