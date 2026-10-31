import { boundaryDistance } from '../core/arena';
import { V3 } from '../core/math';
import type { World } from '../core/world';
import { countTap } from '../input/input';
import { formatScore, formatTime } from './menu';

const local = new V3();
const tmp = new V3();

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** Flight display: speed, boost, pilots, time, radar, warnings and messages. */
export class Hud {
  private readonly speed: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly alive: HTMLElement;
  private readonly score: HTMLElement;
  private readonly scoreTaps: number[] = [];
  private readonly time: HTMLElement;
  private readonly level: HTMLElement;
  private readonly center: HTMLElement;
  private readonly feedEl: HTMLElement;
  private readonly radar: HTMLCanvasElement;
  private readonly edges: Record<'l' | 'r' | 't' | 'b', HTMLElement>;
  private readonly hint: HTMLElement;
  private readonly alert: HTMLElement;
  private readonly radioEl: HTMLElement;
  private readonly scoreLabel: HTMLElement;
  /** Distance to the nearest arena boundary while flying, used for the warning sound. */
  boundaryDist = 1e9;
  private readonly ctx: CanvasRenderingContext2D | null;
  private colors: number[] = [];
  private centerUntil = 0;
  private clock = 0;
  private tick = 0;

  constructor(
    private readonly root: HTMLElement,
    onPause: () => void,
    onCheat: () => void,
  ) {
    root.innerHTML = `
      <div class="h-edge l"></div><div class="h-edge r"></div><div class="h-edge t"></div><div class="h-edge b"></div>
      <div class="h-tl">
        <span class="h-k">Speed</span><span class="h-v" data-k="speed">0</span><span class="h-k">km/h</span>
        <div class="h-bar"><i></i></div><span class="h-k">Boost</span>
      </div>
      <div class="h-level"></div>
      <div class="h-tr">
        <button class="h-score" type="button" aria-label="Score"><span class="h-k" data-k="score-label">Score</span><span class="h-v" data-k="score">0</span></button>
        <span class="h-k">Pilots</span><span class="h-v" data-k="alive">0/0</span>
        <span class="h-k">Time</span><span class="h-v" data-k="time">0:00.0</span>
      </div>
      <div class="h-center" aria-live="polite"></div>
      <div class="h-feed"></div>
      <canvas class="h-radar" width="240" height="240" aria-hidden="true"></canvas>
      <button class="h-pause" type="button" aria-label="Pause">II</button>
      <div class="h-alert" hidden></div>
      <div class="h-radio" aria-live="polite" hidden></div>
      <div class="h-hint" hidden>Turn your phone sideways for the best view</div>`;
    const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    this.speed = q('[data-k="speed"]');
    this.bar = q('.h-bar');
    this.barFill = q('.h-bar i');
    this.alive = q('[data-k="alive"]');
    this.score = q('[data-k="score"]');
    // Five taps on the score within 2.5 seconds: jump to the next level.
    q('.h-score').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (countTap(this.scoreTaps)) onCheat();
    });
    this.time = q('[data-k="time"]');
    this.level = q('.h-level');
    this.center = q('.h-center');
    this.feedEl = q('.h-feed');
    this.radar = q<HTMLCanvasElement>('.h-radar');
    this.hint = q('.h-hint');
    this.alert = q('.h-alert');
    this.radioEl = q('.h-radio');
    this.scoreLabel = q('[data-k="score-label"]');
    this.edges = { l: q('.h-edge.l'), r: q('.h-edge.r'), t: q('.h-edge.t'), b: q('.h-edge.b') };
    this.ctx = this.radar.getContext('2d');
    q('.h-pause').addEventListener('click', onPause);
  }

  setup(world: World, colors: number[], player: number): void {
    this.colors = colors;
    this.level.textContent = `L${world.spec.index} · ${world.spec.name} · ${world.spec.altitude}`;
    this.feedEl.innerHTML = '';
    this.center.classList.remove('show');
    this.root.style.setProperty('--hud', hex(colors[player % colors.length]));
    this.clock = 0;
    this.resizeRadar();
  }

  show(): void {
    this.root.hidden = false;
  }

  /** Online rounds show the round number where solo shows the score. */
  setOnline(on: boolean): void {
    this.scoreLabel.textContent = on ? 'Round' : 'Score';
    this.root.classList.toggle('online', on);
    if (!on) this.radio([], false);
  }

  /** Who is talking on the radio right now, and whether your own mic is open. */
  radio(speaking: string[], talking: boolean): void {
    const lines: string[] = [];
    if (talking) lines.push('<div class="r-me"><i></i>You are live</div>');
    for (const n of speaking.slice(0, 4)) {
      const d = document.createElement('span');
      d.textContent = n;
      lines.push(`<div><i></i>${d.innerHTML}</div>`);
    }
    const html = lines.join('');
    if (this.radioEl.innerHTML !== html) this.radioEl.innerHTML = html;
    this.radioEl.hidden = lines.length === 0;
  }

  /** Moves radar and feed out of the way of the thumbs. */
  setTouch(on: boolean): void {
    this.root.classList.toggle('touch', on);
    this.resizeRadar();
  }

  hide(): void {
    this.root.hidden = true;
  }

  resizeRadar(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round((this.radar.clientWidth || 120) * dpr);
    if (this.radar.width !== w) {
      this.radar.width = w;
      this.radar.height = w;
    }
  }

  message(text: string, sub = '', seconds = 1.2): void {
    this.center.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.center.classList.add('show');
    this.centerUntil = this.clock + seconds;
  }

  feed(text: string): void {
    const d = document.createElement('div');
    d.textContent = text;
    this.feedEl.prepend(d);
    while (this.feedEl.children.length > 4) this.feedEl.lastElementChild?.remove();
    window.setTimeout(() => {
      d.style.opacity = '0';
      window.setTimeout(() => d.remove(), 700);
    }, 5000);
  }

  update(world: World, player: number, dt: number, portraitTouch: boolean, score: number): void {
    this.clock += dt;
    if (this.centerUntil && this.clock > this.centerUntil) {
      this.center.classList.remove('show');
      this.centerUntil = 0;
    }
    this.hint.hidden = !portraitTouch;
    const g = world.gliders[player];
    this.tick++;
    if (this.tick % 4 === 0) {
      this.speed.textContent = String(Math.round(g.alive ? g.speed * 12 : 0));
      this.alive.textContent = `${world.aliveCount()}/${world.gliders.length}`;
      this.score.textContent = formatScore(score);
      this.time.textContent = formatTime(world.flyTime);
    }
    this.barFill.style.width = `${Math.round(g.energy * 100)}%`;
    this.bar.classList.toggle('boosting', g.boosting);
    this.updateWarnings(world, player);
    this.drawRadar(world, player);
  }

  /** Screen edges glow red on the side where a wall or the shield is close. */
  private updateWarnings(world: World, player: number): void {
    const g = world.gliders[player];
    let l = 0;
    let r = 0;
    let t = 0;
    let b = 0;
    let alert = '';
    let alertClose = false;
    this.boundaryDist = 1e9;
    const add = (wx: number, wy: number, wz: number, strength: number) => {
      tmp.set(wx, wy, wz).normalize();
      g.qb.rotateInverse(tmp, local);
      // Local +X is the pilot's left.
      if (local.x > 0) l = Math.max(l, local.x * strength);
      else r = Math.max(r, -local.x * strength);
      if (local.y > 0) t = Math.max(t, local.y * strength);
      else b = Math.max(b, -local.y * strength);
    };
    if (g.alive && world.phase !== 'countdown') {
      if (g.hasNear && g.wallDist < 6) {
        add(g.near.x - g.p.x, g.near.y - g.p.y, g.near.z - g.p.z, 1 - g.wallDist / 6);
      }
      const arena = world.spec.arena;
      const R = world.radius();
      const bd = boundaryDistance(arena, R, g.p);
      this.boundaryDist = bd;
      if (bd < 25) {
        const s = 1 - Math.max(0, bd) / 25;
        const floorD = g.p.y - arena.floorY;
        const ceilD = arena.ceilY - g.p.y;
        let what = 'Shield';
        if (floorD <= bd + 0.01) {
          add(0, -1, 0, s);
          what = world.spec.floorLabel;
        } else if (ceilD <= bd + 0.01) {
          add(0, 1, 0, s);
          what = 'Ceiling';
        } else if (arena.kind === 'dome') add(g.p.x, g.p.y, g.p.z, s);
        else add(g.p.x, 0, g.p.z, s);
        alert = `${what} ${Math.max(0, Math.ceil(bd))} m`;
        alertClose = bd < 10;
      }
    }
    if (this.alert.textContent !== alert) this.alert.textContent = alert;
    this.alert.hidden = !alert;
    this.alert.classList.toggle('close', alertClose);
    const set = (el: HTMLElement, v: number) => {
      const o = (Math.min(1, v) * 0.9).toFixed(2);
      if (el.style.opacity !== o) el.style.opacity = o;
    };
    set(this.edges.l, l);
    set(this.edges.r, r);
    set(this.edges.t, t);
    set(this.edges.b, b);
  }

  private drawRadar(world: World, player: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = this.radar.width;
    const h = W / 2;
    const px = W / 240;
    const R = h - 4 * px;
    const range = 150;
    const sc = R / range;
    const me = world.gliders[player];
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.translate(h, h);
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6,5,14,0.6)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,241,255,0.3)';
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
    ctx.clip();
    ctx.strokeStyle = 'rgba(244,241,255,0.12)';
    ctx.lineWidth = px;
    for (const f of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(0, 0, R * f, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Heading-up view: forward is up on the radar.
    me.qb.rotate(new V3(0, 0, 1), tmp);
    let fx = tmp.x;
    let fz = tmp.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    const rx = -fz;
    const rz = fx;
    const toX = (x: number, z: number) => ((x - me.p.x) * rx + (z - me.p.z) * rz) * sc;
    const toY = (x: number, z: number) => -((x - me.p.x) * fx + (z - me.p.z) * fz) * sc;

    // Arena shield at the current altitude.
    const arena = world.spec.arena;
    const Rw = world.radius();
    const ring = arena.kind === 'dome' ? Math.sqrt(Math.max(0, Rw * Rw - me.p.y * me.p.y)) : Rw;
    ctx.strokeStyle = 'rgba(255,90,90,0.55)';
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.arc(toX(0, 0), toY(0, 0), ring * sc, 0, Math.PI * 2);
    ctx.stroke();

    // Walls as dotted trails.
    world.trails.forEach((tr, gi) => {
      ctx.fillStyle = hex(this.colors[gi % this.colors.length]);
      ctx.globalAlpha = 0.45;
      for (let i = 0; i < tr.count; i += 3) {
        const x = toX(tr.px[i], tr.pz[i]);
        const y = toY(tr.px[i], tr.pz[i]);
        if (x * x + y * y > R * R) continue;
        ctx.fillRect(x - px, y - px, 2 * px, 2 * px);
      }
    });
    ctx.globalAlpha = 1;

    // Boost rings.
    ctx.strokeStyle = '#ffc36b';
    ctx.lineWidth = 1.5 * px;
    for (const rg of world.rings) {
      if (!rg.active) continue;
      ctx.beginPath();
      ctx.arc(toX(rg.c.x, rg.c.z), toY(rg.c.x, rg.c.z), 3 * px, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Lightning.
    ctx.fillStyle = '#e8ddff';
    for (const bolt of world.bolts) {
      const k = Math.floor(bolt.x.length / 2);
      ctx.beginPath();
      ctx.arc(toX(bolt.x[k], bolt.z[k]), toY(bolt.x[k], bolt.z[k]), (world.tick >= bolt.strikeTick ? 5 : 3) * px, 0, Math.PI * 2);
      ctx.fill();
    }

    // Other gliders with an altitude stem: up = above you.
    world.gliders.forEach((g, gi) => {
      if (gi === player || !g.alive) return;
      const x = toX(g.p.x, g.p.z);
      const y = toY(g.p.x, g.p.z);
      const dy = (g.p.y - me.p.y) * sc * 1.2;
      const c = hex(this.colors[gi % this.colors.length]);
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - dy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - dy, 4.5 * px, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -8 * px);
    ctx.lineTo(5.5 * px, 6 * px);
    ctx.lineTo(-5.5 * px, 6 * px);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
