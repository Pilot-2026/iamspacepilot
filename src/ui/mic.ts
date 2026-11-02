/**
 * The radio microphone button: hold it to talk, tap it three times in a row
 * to keep the microphone open, tap it once more to close it again.
 *
 * Several things can press it at the same time (the touch button, the HUD
 * button, the R key, a gamepad); it counts as one press until all let go.
 * Pure logic without the DOM, so it can be tested.
 */

/** A press shorter than this is a tap. */
export const MIC_TAP_MS = 380;
/** Three taps within this time keep the microphone open. */
export const MIC_TRIPLE_MS = 1500;

export type MicSource = 'touch' | 'hud' | 'key';

export class MicGesture {
  private readonly pressed = new Set<MicSource>();
  private downAt = 0;
  private taps: number[] = [];
  /** This press started while the microphone was kept open: letting go closes it. */
  private closing = false;
  latched = false;

  /** Talking right now: held down or kept open. */
  get on(): boolean {
    return this.latched || this.pressed.size > 0;
  }

  get held(): boolean {
    return this.pressed.size > 0;
  }

  down(src: MicSource, now: number): void {
    if (this.pressed.has(src)) return;
    this.pressed.add(src);
    if (this.pressed.size > 1) return;
    this.downAt = now;
    this.closing = this.latched;
  }

  up(src: MicSource, now: number): void {
    if (!this.pressed.delete(src) || this.pressed.size > 0) return;
    if (this.closing) {
      this.closing = false;
      this.latched = false;
      this.taps = [];
      return;
    }
    if (now - this.downAt > MIC_TAP_MS) {
      // A long press is push to talk and starts the tap count again.
      this.taps = [];
      return;
    }
    this.taps = this.taps.filter((t) => now - t < MIC_TRIPLE_MS);
    this.taps.push(now);
    if (this.taps.length >= 3) {
      this.taps = [];
      this.latched = true;
    }
  }

  /** For a source that is polled (keys): presses and releases on a change. */
  set(src: MicSource, held: boolean, now: number): void {
    if (held) this.down(src, now);
    else this.up(src, now);
  }

  /** Keep open or close, from the lobby's talk button. */
  setLatched(on: boolean): void {
    this.latched = on;
    this.taps = [];
    this.closing = false;
  }

  /** Lets go of everything still pressed (the app went to the background, the controls were hidden), keeps the latch. */
  release(): void {
    this.pressed.clear();
    this.closing = false;
  }

  reset(): void {
    this.release();
    this.setLatched(false);
  }
}

/**
 * When an input event happened, on the performance.now() clock. A slow frame
 * between finger down and up must not turn a tap into a hold; browsers that
 * still give other times fall back to now.
 */
export function eventTime(e: Event): number {
  const now = performance.now();
  const t = e.timeStamp;
  return t > 0 && t <= now + 50 && now - t < 5000 ? t : now;
}
