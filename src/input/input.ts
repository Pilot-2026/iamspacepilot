import { clamp } from '../core/math';
import type { PilotInput } from '../core/types';
import type { TouchControls } from '../ui/touch';

const DEAD = 0.15;

/** Records a tap and reports true on the fifth (or `need`-th) tap within 2.5 seconds. */
export function countTap(taps: number[], now = performance.now(), need = 5): boolean {
  taps.push(now);
  while (taps.length && now - taps[0] > 2500) taps.shift();
  if (taps.length >= need) {
    taps.length = 0;
    return true;
  }
  return false;
}
const dead = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

/** Mouse steering: full deflection this far from the middle (share of the smaller screen side). */
export const MOUSE_RANGE = 0.3;
/** Mouse steering: no steering this close to the middle (share of the range). */
export const MOUSE_DEAD = 0.07;

/**
 * Mouse steering: the cursor's offset from the middle of the screen, as a
 * stick (x right, y up), at most 1 long, with a small dead zone and a gentle
 * curve for fine corrections near the middle.
 */
export function mouseStick(mx: number, my: number, w: number, h: number): { x: number; y: number } {
  const r = Math.max(1, Math.min(w, h) * MOUSE_RANGE);
  let x = (mx - w / 2) / r;
  let y = (h / 2 - my) / r;
  const m = Math.hypot(x, y);
  if (m < MOUSE_DEAD) return { x: 0, y: 0 };
  const c = Math.min(1, m);
  const k = ((c - MOUSE_DEAD) / (1 - MOUSE_DEAD)) ** 1.25 / m;
  x *= k;
  y *= k;
  return { x, y };
}

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
  private padView = false;
  /** Left mouse button held on the 3D view. */
  private mouseFire = false;
  /** Right mouse button dragging the camera around the ship. */
  private dragLook: { x: number; y: number } | null = null;
  /**
   * Mouse steering (computer): fly where the mouse points. The right button
   * boosts and the middle button fires the special instead of moving the camera.
   */
  mouseSteer = false;
  /** Last mouse position, and whether the mouse has been seen at all. */
  private mx = 0;
  private my = 0;
  private mouseSeen = false;
  private mouseBoost = false;
  private mouseSpecial = false;
  /** V or the gamepad's back button: next camera view. */
  onView: () => void = () => undefined;
  /** Camera: zoom factor (< 1 comes closer), turn and tilt in radians. */
  onLook: (zoomMul: number, dYaw: number, dPitch: number) => void = () => undefined;
  private readonly out: PilotInput = { steerX: 0, steerY: 0, roll: 0, boost: false, fire: false, special: false };

  private readonly cheatTaps: number[] = [];
  private readonly shipTaps: number[] = [];
  private readonly dogTaps: number[] = [];
  private readonly statTaps: number[] = [];
  /** Cheat 33333: the dachshund on or off. */
  onDogCheat: () => void = () => undefined;
  /** 99999: the visit statistics. */
  onStats: () => void = () => undefined;
  /** Cheat 2222: the next ship. */
  onShipCheat: () => void = () => undefined;

  constructor(
    private readonly touch: TouchControls,
    private readonly onPauseKey: () => void,
    private readonly onCheat: () => void,
    private readonly onMusicKey: () => void = () => undefined,
  ) {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (!e.repeat) this.onPauseKey();
        return;
      }
      if (e.code === 'KeyM' && !e.repeat) {
        this.onMusicKey();
        return;
      }
      if (e.code === 'KeyV' && !e.repeat && this.capturing && !e.metaKey && !e.ctrlKey) {
        this.onView();
        return;
      }
      if ((e.code === 'Digit1' || e.code === 'Numpad1') && !e.repeat) {
        if (countTap(this.cheatTaps)) this.onCheat();
        return;
      }
      if ((e.code === 'Digit3' || e.code === 'Numpad3') && !e.repeat) {
        if (countTap(this.dogTaps)) this.onDogCheat();
        return;
      }
      if ((e.code === 'Digit9' || e.code === 'Numpad9') && !e.repeat) {
        if (countTap(this.statTaps)) this.onStats();
        return;
      }
      if ((e.code === 'Digit2' || e.code === 'Numpad2') && !e.repeat) {
        if (countTap(this.shipTaps)) this.onShipCheat();
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
      this.mouseBoost = false;
      this.mouseSpecial = false;
    });
    // Mouse steering follows the cursor everywhere on the page.
    window.addEventListener('mousemove', (e) => {
      this.mx = e.clientX;
      this.my = e.clientY;
      this.mouseSeen = true;
    });
    // Mouse: hold the left button on the 3D view to fire.
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.capturing && (e.target as HTMLElement | null)?.id === 'scene') this.mouseFire = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) {
        this.dragLook = null;
        this.mouseBoost = false;
      }
      if (e.button === 1) this.mouseSpecial = false;
    });
    // Right mouse button drags the camera around the ship, the wheel (or a trackpad pinch) zooms.
    const onView = (t: EventTarget | null) => {
      const id = (t as HTMLElement | null)?.id;
      return id === 'scene' || id === 'touch';
    };
    window.addEventListener('mousedown', (e) => {
      if (!this.capturing || !onView(e.target)) return;
      if (this.mouseSteer) {
        // Mouse steering: right button boosts, middle button fires the special.
        if (e.button === 2) this.mouseBoost = true;
        if (e.button === 1) {
          e.preventDefault();
          this.mouseSpecial = true;
        }
        return;
      }
      if (e.button === 2) this.dragLook = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mousemove', (e) => {
      const d = this.dragLook;
      if (!d) return;
      const unit = Math.PI / Math.max(320, Math.min(window.innerWidth, window.innerHeight));
      this.onLook(1, -(e.clientX - d.x) * unit * 1.3, (e.clientY - d.y) * unit);
      d.x = e.clientX;
      d.y = e.clientY;
    });
    window.addEventListener('contextmenu', (e) => {
      if (onView(e.target)) e.preventDefault();
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.capturing || !onView(e.target)) return;
        e.preventDefault();
        const k = e.ctrlKey ? 0.012 : 0.0015;
        this.onLook(Math.exp(Math.max(-60, Math.min(60, e.deltaY * (e.deltaMode === 1 ? 33 : 1))) * k), 0, 0);
      },
      { passive: false },
    );
  }

  /** True while flying: arrow keys and space must not scroll the page. */
  capturing = false;

  reset(): void {
    this.keys.clear();
    this.metaHeld = false;
    this.mouseFire = false;
    this.mouseBoost = false;
    this.mouseSpecial = false;
    this.dragLook = null;
    this.kx = 0;
    this.ky = 0;
    this.kr = 0;
  }

  /** Mouse steering stick right now (x right, y up), for the aim ring; null when mouse steering is not active. */
  mouseAim(): { x: number; y: number; mx: number; my: number } | null {
    if (!this.mouseSteer || !this.capturing || !this.mouseSeen) return null;
    const s = mouseStick(this.mx, this.my, window.innerWidth, window.innerHeight);
    return { x: s.x, y: s.y, mx: this.mx, my: this.my };
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
    let view = false;
    let lx = 0;
    let ly = 0;
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      if (pad.buttons[8]?.pressed) view = true;
      lx += dead(pad.axes[2] ?? 0);
      ly += dead(pad.axes[3] ?? 0);
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
    if (view && !this.padView && this.capturing) this.onView();
    this.padView = view;
    // The right stick looks around the ship.
    if (lx || ly) this.onLook(1, -lx * 2.2 * dt, ly * 1.6 * dt);

    const t = this.touch.state;
    const sy = clamp(this.ky + py + t.steerY, -1, 1);
    // Mouse steering: the glider turns towards the cursor (mouse up = nose up, whatever the flight mode).
    const ms = this.mouseSteer && this.capturing && this.mouseSeen ? mouseStick(this.mx, this.my, window.innerWidth, window.innerHeight) : null;
    this.out.steerX = clamp(this.kx + px + t.steerX + (ms ? ms.x : 0), -1, 1);
    this.out.steerY = clamp((this.invertPitch ? -sy : sy) + (ms ? ms.y : 0), -1, 1);
    this.out.roll = clamp(this.kr + pr + t.roll, -1, 1);
    // Boost: Command (Mac), or Shift on any keyboard.
    this.out.boost = this.key('MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight') || pb || t.boost || this.mouseBoost;
    // Fire: Space, F or the left mouse button.
    this.out.fire = this.key('Space', 'KeyF') || this.mouseFire || pf || t.fire;
    // Special ability: C, B on a gamepad or the touch button.
    this.out.special = this.key('KeyC') || ps || t.special || this.mouseSpecial;
    return this.out;
  }
}
