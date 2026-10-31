import { clamp } from '../core/math';
import type { PilotInput } from '../core/types';
import type { TouchControls } from '../ui/touch';

const DEAD = 0.15;
const dead = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

/**
 * Merges keyboard, gamepad and touch into one pilot input per tick.
 * Keys ramp up smoothly so tapping gives small corrections.
 */
export class InputManager {
  invertPitch = false;
  private readonly keys = new Set<string>();
  private kx = 0;
  private ky = 0;
  private kr = 0;
  private padPause = false;
  private readonly out: PilotInput = { steerX: 0, steerY: 0, roll: 0, boost: false };

  constructor(
    private readonly touch: TouchControls,
    private readonly onPauseKey: () => void,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (!e.repeat) this.onPauseKey();
        return;
      }
      if (this.capturing && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** True while flying: arrow keys and space must not scroll the page. */
  capturing = false;

  reset(): void {
    this.keys.clear();
    this.kx = 0;
    this.ky = 0;
    this.kr = 0;
  }

  private key(...codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
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
    let pause = false;
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      px += dead(pad.axes[0] ?? 0);
      py -= dead(pad.axes[1] ?? 0);
      if (pad.buttons[4]?.pressed) pr -= 1;
      if (pad.buttons[5]?.pressed) pr += 1;
      if ((pad.buttons[7]?.value ?? 0) > 0.3 || pad.buttons[0]?.pressed) pb = true;
      if (pad.buttons[9]?.pressed) pause = true;
    }
    if (pause && !this.padPause) this.onPauseKey();
    this.padPause = pause;

    const t = this.touch.state;
    const sy = clamp(this.ky + py + t.steerY, -1, 1);
    this.out.steerX = clamp(this.kx + px + t.steerX, -1, 1);
    this.out.steerY = this.invertPitch ? -sy : sy;
    this.out.roll = clamp(this.kr + pr + t.roll, -1, 1);
    this.out.boost = this.key('Space') || pb || t.boost;
    return this.out;
  }
}
