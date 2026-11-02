import { MIC_OFF_ICON, MIC_ON_ICON, eventTime, micLabel } from './mic';

/**
 * Touch controls: a floating stick appears wherever the right thumb lands.
 * Boost, roll, fire, the special and online the radio microphone sit in an
 * arc around the left thumb.
 * Two fingers (not on a button) move the camera: pinch to zoom, drag to look
 * around the ship, a quick two-finger tap puts the camera back.
 */
export interface TouchState {
  steerX: number;
  steerY: number;
  roll: number;
  boost: boolean;
  fire: boolean;
  special: boolean;
}

const ROLL_LEFT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/></svg>';
const ROLL_RIGHT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>';

type Hold = 'boost' | 'roll-l' | 'roll-r' | 'fire' | 'special';

export class TouchControls {
  readonly state: TouchState = { steerX: 0, steerY: 0, roll: 0, boost: false, fire: false, special: false };
  private readonly talkBtn: HTMLElement;
  /** The finger on the microphone button, -1 if none. */
  private micId = -1;
  private micShown = '';
  /** Online radio: the microphone button was pressed or let go, with the time of the touch. */
  onMic: (down: boolean, at: number) => void = () => undefined;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons: Record<Hold, HTMLElement>;
  private stickId = -1;
  private ox = 0;
  private oy = 0;
  private readonly holds = new Map<number, Hold>();
  private readonly radius = 54;
  /** When the stick finger landed and where, to tell a stick from the start of a pinch. */
  private stickAt = 0;
  private stickMoved = 0;
  /** Fingers that are neither the stick nor on a button. */
  private readonly free = new Map<number, { x: number; y: number }>();
  /** Two fingers moving the camera. */
  private pinch: { a: number; b: number; pts: Map<number, { x: number; y: number }>; d: number; mx: number; my: number; at: number; moved: number } | null = null;
  /** Camera: zoom factor (< 1 comes closer), turn and tilt in radians. */
  onLook: (zoomMul: number, dYaw: number, dPitch: number) => void = () => undefined;
  onLookReset: () => void = () => undefined;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <div class="t-stick"><i class="t-knob"></i></div>
      <div class="t-btn t-roll-l" data-hold="roll-l" aria-label="Roll left">${ROLL_LEFT_ICON}</div>
      <div class="t-btn t-roll-r" data-hold="roll-r" aria-label="Roll right">${ROLL_RIGHT_ICON}</div>
      <div class="t-btn t-boost" data-hold="boost">Boost</div>
      <div class="t-btn t-fire" data-hold="fire">Fire</div>
      <div class="t-btn t-special" data-hold="special">Special</div>
      <div class="t-btn t-talk" data-talk role="button" aria-label="Radio: hold to talk, tap three times to keep the microphone on" hidden>${MIC_ON_ICON}${MIC_OFF_ICON}<b class="t-mic-txt">MIC OFF</b><span class="t-cap">Locked</span></div>`;
    this.talkBtn = root.querySelector('.t-talk') as HTMLElement;
    this.stick = root.querySelector('.t-stick') as HTMLElement;
    this.knob = root.querySelector('.t-knob') as HTMLElement;
    this.buttons = {
      boost: root.querySelector('.t-boost') as HTMLElement,
      'roll-l': root.querySelector('.t-roll-l') as HTMLElement,
      'roll-r': root.querySelector('.t-roll-r') as HTMLElement,
      fire: root.querySelector('.t-fire') as HTMLElement,
      special: root.querySelector('.t-special') as HTMLElement,
    };
    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.move(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', (e) => this.up(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.placeStickHome();
  }

  show(): void {
    this.root.hidden = false;
    this.placeStickHome();
  }

  hide(): void {
    this.root.hidden = true;
    this.reset();
    this.releaseMic();
  }

  /** Online games get a radio button. */
  setTalk(on: boolean): void {
    this.talkBtn.hidden = !on;
    if (!on) {
      this.releaseMic();
      this.setMic(false, false);
    }
  }

  /** Lights the radio button: MIC ON in red while talking, a ring and "Locked" while it is kept on. */
  setMic(live: boolean, open: boolean): void {
    const key = `${live}${open}`;
    if (key === this.micShown) return;
    this.micShown = key;
    this.talkBtn.classList.toggle('on', live);
    this.talkBtn.classList.toggle('open', open);
    this.talkBtn.setAttribute('aria-pressed', String(live));
    const txt = this.talkBtn.querySelector('.t-mic-txt');
    if (txt) txt.textContent = micLabel(live);
  }

  /** After a crash only the radio button stays. */
  setSpectating(on: boolean): void {
    this.root.classList.toggle('spectating', on);
    if (on) this.reset();
  }

  private releaseMic(at = performance.now()): void {
    if (this.micId === -1) return;
    this.micId = -1;
    this.onMic(false, at);
  }

  /** The special button, so the HUD can show its cooldown. */
  get specialButton(): HTMLElement {
    return this.buttons.special;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  reset(): void {
    this.stickId = -1;
    this.holds.clear();
    this.free.clear();
    this.pinch = null;
    this.state.steerX = 0;
    this.state.steerY = 0;
    this.state.roll = 0;
    this.state.boost = false;
    this.state.fire = false;
    this.state.special = false;
    this.stick.classList.remove('active');
    this.knob.style.transform = '';
    for (const b of Object.values(this.buttons)) b.classList.remove('on');
    this.placeStickHome();
  }

  private placeStickHome(): void {
    const h = this.root.clientHeight || window.innerHeight;
    const w = this.root.clientWidth || window.innerWidth;
    this.stick.style.left = `${w - Math.max(90, w * 0.12)}px`;
    this.stick.style.top = `${h - Math.max(100, h * 0.24)}px`;
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers refuse capture for synthetic events; tracking still works.
    }
    if ((e.target as HTMLElement).closest('[data-talk]')) {
      // One finger at a time on the microphone; it talks for as long as it stays down.
      if (this.micId !== -1) return;
      this.micId = e.pointerId;
      this.onMic(true, eventTime(e));
      return;
    }
    const target = (e.target as HTMLElement).closest('[data-hold]') as HTMLElement | null;
    if (target) {
      const hold = target.dataset.hold as Hold;
      this.holds.set(e.pointerId, hold);
      this.applyHolds();
      return;
    }
    const here = { x: e.clientX, y: e.clientY };
    if (this.pinch) return;
    // A second free finger, or a second finger right after the stick finger: that is a pinch.
    const other = this.free.keys().next();
    if (!other.done) {
      const id = other.value;
      this.startPinch(id, this.free.get(id) ?? here, e.pointerId, here);
      this.free.delete(id);
      return;
    }
    if (this.stickId !== -1 && performance.now() - this.stickAt < 260 && this.stickMoved < 14) {
      const id = this.stickId;
      const at = { x: this.ox, y: this.oy };
      this.releaseStick();
      this.startPinch(id, at, e.pointerId, here);
      return;
    }
    if (this.stickId === -1 && e.clientX > this.root.clientWidth * 0.45) {
      this.stickId = e.pointerId;
      this.stickAt = performance.now();
      this.stickMoved = 0;
      const r = this.root.getBoundingClientRect();
      this.ox = e.clientX;
      this.oy = e.clientY;
      this.stick.style.left = `${e.clientX - r.left}px`;
      this.stick.style.top = `${e.clientY - r.top}px`;
      this.stick.classList.add('active');
      this.updateStick(e.clientX, e.clientY);
      return;
    }
    this.free.set(e.pointerId, here);
  }

  private startPinch(a: number, pa: { x: number; y: number }, b: number, pb: { x: number; y: number }): void {
    const pts = new Map([
      [a, { ...pa }],
      [b, { ...pb }],
    ]);
    this.pinch = { a, b, pts, d: Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y)), mx: (pa.x + pb.x) / 2, my: (pa.y + pb.y) / 2, at: performance.now(), moved: 0 };
  }

  private move(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickMoved = Math.max(this.stickMoved, Math.hypot(e.clientX - this.ox, e.clientY - this.oy));
      this.updateStick(e.clientX, e.clientY);
      return;
    }
    const f = this.free.get(e.pointerId);
    if (f) {
      f.x = e.clientX;
      f.y = e.clientY;
      return;
    }
    const p = this.pinch;
    const pt = p?.pts.get(e.pointerId);
    if (!p || !pt) return;
    pt.x = e.clientX;
    pt.y = e.clientY;
    const pa = p.pts.get(p.a) as { x: number; y: number };
    const pb = p.pts.get(p.b) as { x: number; y: number };
    const d = Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y));
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2;
    const unit = Math.PI / Math.max(320, Math.min(window.innerWidth, window.innerHeight));
    const dx = mx - p.mx;
    const dy = my - p.my;
    p.moved += Math.abs(d - p.d) + Math.hypot(dx, dy);
    this.onLook(p.d / d, -dx * unit * 1.3, dy * unit);
    p.d = d;
    p.mx = mx;
    p.my = my;
  }

  private releaseStick(): void {
    this.stickId = -1;
    this.state.steerX = 0;
    this.state.steerY = 0;
    this.knob.style.transform = '';
    this.stick.classList.remove('active');
    this.placeStickHome();
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.micId) {
      // The touch's own time: a slow frame between finger down and up must not turn a tap into a hold.
      this.releaseMic(eventTime(e));
      return;
    }
    if (e.pointerId === this.stickId) this.releaseStick();
    this.free.delete(e.pointerId);
    const p = this.pinch;
    if (p && p.pts.has(e.pointerId)) {
      // A quick two-finger tap puts the camera back to normal.
      if (performance.now() - p.at < 320 && p.moved < 16) this.onLookReset();
      const rest = p.a === e.pointerId ? p.b : p.a;
      const pt = p.pts.get(rest);
      this.pinch = null;
      if (pt && e.type !== 'pointercancel') this.free.set(rest, pt);
    }
    if (this.holds.delete(e.pointerId)) this.applyHolds();
  }

  private updateStick(x: number, y: number): void {
    let dx = x - this.ox;
    let dy = y - this.oy;
    const l = Math.hypot(dx, dy);
    if (l > this.radius) {
      dx = (dx / l) * this.radius;
      dy = (dy / l) * this.radius;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Small dead zone so a resting thumb does not steer.
    const dz = (v: number) => (Math.abs(v) < 0.08 ? 0 : v);
    this.state.steerX = dz(dx / this.radius);
    this.state.steerY = dz(-dy / this.radius);
  }

  private applyHolds(): void {
    const active = new Set(this.holds.values());
    this.state.boost = active.has('boost');
    this.state.fire = active.has('fire');
    this.state.special = active.has('special');
    this.state.roll = (active.has('roll-r') ? 1 : 0) - (active.has('roll-l') ? 1 : 0);
    for (const [k, el] of Object.entries(this.buttons)) el.classList.toggle('on', active.has(k as Hold));
  }
}
