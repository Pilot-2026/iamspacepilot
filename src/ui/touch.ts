/**
 * Touch controls: a floating stick appears wherever the left thumb lands.
 * Boost and the two roll buttons sit in an arc around the right thumb.
 */
export interface TouchState {
  steerX: number;
  steerY: number;
  roll: number;
  boost: boolean;
  /** Online: radio microphone open (tap to switch). */
  talk: boolean;
}

const MIC_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

const ROLL_LEFT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/></svg>';
const ROLL_RIGHT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>';

type Hold = 'boost' | 'roll-l' | 'roll-r';

export class TouchControls {
  readonly state: TouchState = { steerX: 0, steerY: 0, roll: 0, boost: false, talk: false };
  private readonly talkBtn: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons: Record<Hold, HTMLElement>;
  private stickId = -1;
  private ox = 0;
  private oy = 0;
  private readonly holds = new Map<number, Hold>();
  private readonly radius = 54;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <div class="t-stick"><i class="t-knob"></i></div>
      <div class="t-btn t-roll-l" data-hold="roll-l" aria-label="Roll left">${ROLL_LEFT_ICON}</div>
      <div class="t-btn t-roll-r" data-hold="roll-r" aria-label="Roll right">${ROLL_RIGHT_ICON}</div>
      <div class="t-btn t-boost" data-hold="boost">Boost</div>
      <div class="t-btn t-talk" data-talk aria-label="Talk on the radio" hidden>${MIC_ICON}</div>`;
    this.talkBtn = root.querySelector('.t-talk') as HTMLElement;
    this.stick = root.querySelector('.t-stick') as HTMLElement;
    this.knob = root.querySelector('.t-knob') as HTMLElement;
    this.buttons = {
      boost: root.querySelector('.t-boost') as HTMLElement,
      'roll-l': root.querySelector('.t-roll-l') as HTMLElement,
      'roll-r': root.querySelector('.t-roll-r') as HTMLElement,
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
  }

  /** Online games get a radio button. */
  setTalk(on: boolean): void {
    this.talkBtn.hidden = !on;
    if (!on) this.setTalking(false);
  }

  setTalking(on: boolean): void {
    this.state.talk = on;
    this.talkBtn.classList.toggle('on', on);
  }

  /** After a crash only the radio button stays. */
  setSpectating(on: boolean): void {
    this.root.classList.toggle('spectating', on);
    if (on) {
      const talk = this.state.talk;
      this.reset();
      this.setTalking(talk);
    }
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  reset(): void {
    this.stickId = -1;
    this.holds.clear();
    this.state.steerX = 0;
    this.state.steerY = 0;
    this.state.roll = 0;
    this.state.boost = false;
    this.stick.classList.remove('active');
    this.knob.style.transform = '';
    for (const b of Object.values(this.buttons)) b.classList.remove('on');
    this.placeStickHome();
  }

  private placeStickHome(): void {
    const h = this.root.clientHeight || window.innerHeight;
    const w = this.root.clientWidth || window.innerWidth;
    this.stick.style.left = `${Math.max(90, w * 0.12)}px`;
    this.stick.style.top = `${h - Math.max(100, h * 0.24)}px`;
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    if ((e.target as HTMLElement).closest('[data-talk]')) {
      this.setTalking(!this.state.talk);
      return;
    }
    const target = (e.target as HTMLElement).closest('[data-hold]') as HTMLElement | null;
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers refuse capture for synthetic events; tracking still works.
    }
    if (target) {
      const hold = target.dataset.hold as Hold;
      this.holds.set(e.pointerId, hold);
      this.applyHolds();
      return;
    }
    if (this.stickId === -1 && e.clientX < this.root.clientWidth * 0.55) {
      this.stickId = e.pointerId;
      const r = this.root.getBoundingClientRect();
      this.ox = e.clientX;
      this.oy = e.clientY;
      this.stick.style.left = `${e.clientX - r.left}px`;
      this.stick.style.top = `${e.clientY - r.top}px`;
      this.stick.classList.add('active');
      this.updateStick(e.clientX, e.clientY);
    }
  }

  private move(e: PointerEvent): void {
    if (e.pointerId === this.stickId) this.updateStick(e.clientX, e.clientY);
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = -1;
      this.state.steerX = 0;
      this.state.steerY = 0;
      this.knob.style.transform = '';
      this.stick.classList.remove('active');
      this.placeStickHome();
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
    this.state.roll = (active.has('roll-r') ? 1 : 0) - (active.has('roll-l') ? 1 : 0);
    for (const [k, el] of Object.entries(this.buttons)) el.classList.toggle('on', active.has(k as Hold));
  }
}
