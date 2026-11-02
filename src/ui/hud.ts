import { boundaryDistance } from '../core/arena';
import { V3 } from '../core/math';
import { POWERS } from '../core/powerups';
import type { World } from '../core/world';
import { countTap } from '../input/input';
import { formatScore, formatTime } from './menu';

const local = new V3();
const tmp = new V3();

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

const EYE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>';

/** Which parts of the HUD a camera view keeps. */
export type HudView = 'normal' | 'cockpit' | 'clean';

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
  private readonly heat: HTMLElement;
  private readonly heatFill: HTMLElement;
  private readonly gunLabel: HTMLElement;
  private readonly hullEl: HTMLElement;
  private hullPips: HTMLElement[];
  private readonly specEl: HTMLElement;
  private readonly specFill: HTMLElement;
  private readonly specName: HTMLElement;
  private readonly powerEl: HTMLElement;
  private readonly powerName: HTMLElement;
  private readonly powerFill: HTMLElement;
  /** Touch special button: shows the cooldown. */
  specialButton: HTMLElement | null = null;
  private readonly hitMark: HTMLElement;
  private hitUntil = 0;
  private hurtUntil = 0;
  /** Red flash on all edges after a hit, fades out. */
  private damageFlash = 0;
  /** Distance to the nearest arena boundary while flying, used for the warning sound. */
  boundaryDist = 1e9;
  private readonly ctx: CanvasRenderingContext2D | null;
  private colors: number[] = [];
  private centerUntil = 0;
  private clock = 0;
  private tick = 0;
  private viewKind: HudView = 'normal';
  private readonly viewName: HTMLElement;
  private viewNameTimer = 0;
  /** Cockpit screens: flight data (left) and round data (right). The radar canvas is the third. */
  readonly cockpitLeft = document.createElement('canvas');
  readonly cockpitRight = document.createElement('canvas');
  /** Set when the cockpit screens were redrawn and need uploading. */
  readonly cockpitDirty = { side: false, radar: false };
  private levelText = '';
  private online = false;

  constructor(
    private readonly root: HTMLElement,
    onPause: () => void,
    onCheat: () => void,
    onView: () => void = () => undefined,
  ) {
    root.innerHTML = `
      <div class="h-edge l"></div><div class="h-edge r"></div><div class="h-edge t"></div><div class="h-edge b"></div>
      <div class="h-tl">
        <span class="h-k">Speed</span><span class="h-v" data-k="speed">0</span><span class="h-k">km/h</span>
        <div class="h-bar"><i></i></div><span class="h-k">Boost</span>
        <div class="h-gun"><span class="h-hull" aria-label="Hull"><i></i><i></i><i></i></span><span class="h-bar h-heat"><i></i></span><span class="h-k" data-k="gun">Gun</span></div>
        <div class="h-spec"><kbd>C</kbd><span class="h-bar h-specbar"><i></i></span><span class="h-k" data-k="spec">Special</span></div>
      </div>
      <div class="h-hitmark" aria-hidden="true">Hit</div>
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
      <button class="h-view" type="button" aria-label="Camera view (V)" title="Camera view (V)">${EYE_ICON}</button>
      <div class="h-viewname" hidden></div>
      <div class="h-alert" hidden></div>
      <div class="h-radio" aria-live="polite" hidden></div>
      <div class="h-power" hidden><span data-k="power"></span><span class="h-bar"><i></i></span></div>
      <div class="h-hint" hidden>Turn your phone sideways for the best view</div>`;
    const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    this.speed = q('[data-k="speed"]');
    this.bar = q('.h-bar');
    this.barFill = q('.h-bar i');
    this.heat = q('.h-heat');
    this.heatFill = q('.h-heat i');
    this.gunLabel = q('[data-k="gun"]');
    this.hullEl = q('.h-hull');
    this.hullPips = Array.from(this.hullEl.querySelectorAll('i'));
    this.specEl = q('.h-spec');
    this.specFill = q('.h-specbar i');
    this.specName = q('[data-k="spec"]');
    this.powerEl = q('.h-power');
    this.powerName = q('[data-k="power"]');
    this.powerFill = q('.h-power i');
    this.hitMark = q('.h-hitmark');
    this.alive = q('[data-k="alive"]');
    this.score = q('[data-k="score"]');
    // Five clicks on the score within 2.5 seconds: jump to the next level. Mouse only:
    // on phones and tablets cheats were too easy to trigger by accident.
    q('.h-score').addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
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
    const viewBtn = q('.h-view');
    viewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onView();
      viewBtn.blur();
    });
    // The eye button must not start the stick or a pinch below it.
    viewBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.viewName = q('.h-viewname');
    this.cockpitLeft.width = 512;
    this.cockpitLeft.height = 256;
    this.cockpitRight.width = 512;
    this.cockpitRight.height = 256;
  }

  /** Radar canvas, also shown on the cockpit's middle screen. */
  get radarCanvas(): HTMLCanvasElement {
    return this.radar;
  }

  /** A camera view hides parts of the HUD: the cockpit shows them on its screens, the clean view hides them. */
  setView(kind: HudView, name = ''): void {
    if (kind !== this.viewKind) {
      this.viewKind = kind;
      this.root.classList.toggle('v-cockpit', kind === 'cockpit');
      this.root.classList.toggle('v-clean', kind === 'clean');
      document.body.classList.toggle('v-clean', kind === 'clean');
      document.body.classList.toggle('v-cockpit', kind === 'cockpit');
      this.resizeRadar();
    }
    if (name) {
      this.viewName.textContent = name;
      this.viewName.hidden = false;
      this.viewName.classList.remove('show');
      void this.viewName.offsetWidth;
      this.viewName.classList.add('show');
      window.clearTimeout(this.viewNameTimer);
      this.viewNameTimer = window.setTimeout(() => (this.viewName.hidden = true), 1600);
    }
  }

  setup(world: World, colors: number[], player: number): void {
    this.colors = colors;
    const g = world.gliders[player];
    this.hullEl.innerHTML = '<i></i>'.repeat(g.ship.hull);
    this.hullPips = Array.from(this.hullEl.querySelectorAll('i'));
    this.specName.textContent = g.ship.special.name;
    this.level.textContent = `Level ${world.spec.index} · ${world.spec.name} · ${world.spec.altitude}`;
    this.levelText = `L${world.spec.index} · ${world.spec.name}`;
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
    this.online = on;
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
    // In the cockpit the radar is a screen on the dashboard and needs its own size.
    const w = this.viewKind === 'cockpit' ? 512 : Math.round((this.radar.clientWidth || 120) * dpr);
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

  /** Your shot hit someone. */
  hitMarker(): void {
    this.hitUntil = this.clock + 0.35;
    this.hitMark.classList.remove('show');
    void this.hitMark.offsetWidth;
    this.hitMark.classList.add('show');
  }

  /** You were hit: red flash and the hull blinks. */
  damage(): void {
    this.damageFlash = 1;
    this.hurtUntil = this.clock + 0.8;
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
    this.heatFill.style.width = `${Math.round(g.heat * 100)}%`;
    this.heat.classList.toggle('hot', g.overheated);
    const gun = g.overheated ? 'Gun hot' : 'Gun';
    if (this.gunLabel.textContent !== gun) this.gunLabel.textContent = gun;
    this.hullPips.forEach((pip, i) => pip.classList.toggle('on', i < g.hull));
    this.hullEl.classList.toggle('hurt', this.clock < this.hurtUntil);
    if (this.hitUntil && this.clock > this.hitUntil) {
      this.hitMark.classList.remove('show');
      this.hitUntil = 0;
    }
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.2);
    // Special: fills up while it recharges, glows when ready.
    const sp = g.ship.special;
    const wait = world.specialWait(g);
    const ready = wait <= 0;
    const fill = ready ? 1 : 1 - (wait * 60) / sp.cooldown;
    this.specFill.style.width = `${Math.round(fill * 100)}%`;
    this.specEl.classList.toggle('ready', ready && g.alive);
    if (this.specialButton) {
      this.specialButton.style.setProperty('--cool', fill.toFixed(3));
      this.specialButton.classList.toggle('ready', ready && g.alive);
    }
    // Power-up from a ring: name and the time left.
    const p = g.power;
    this.powerEl.hidden = !p || !g.alive;
    if (p && g.alive) {
      const spec = POWERS[p];
      if (this.powerName.textContent !== spec.name) {
        this.powerName.textContent = spec.name;
        this.powerEl.style.setProperty('--pc', `#${spec.color.toString(16).padStart(6, '0')}`);
      }
      const left = Math.max(0, g.powerUntil - world.tick) / spec.duration;
      this.powerFill.style.width = `${Math.round(left * 100)}%`;
    }
    this.updateWarnings(world, player);
    if (this.viewKind === 'cockpit') {
      if (this.tick % 2 === 0) {
        this.drawRadar(world, player);
        this.cockpitDirty.radar = true;
      }
      if (this.tick % 4 === 1) {
        this.drawCockpit(world, player, score, fill, ready);
        this.cockpitDirty.side = true;
      }
    } else if (this.viewKind === 'normal') {
      this.drawRadar(world, player);
    }
  }

  /** The two data screens of the cockpit. */
  private drawCockpit(world: World, player: number, score: number, specialFill: number, specialReady: boolean): void {
    const g = world.gliders[player];
    const accent = hex(this.colors[player % this.colors.length] ?? 0x7af0ff);
    const screen = (c: HTMLCanvasElement) => {
      const x = c.getContext('2d');
      if (!x) return null;
      const bg = x.createLinearGradient(0, 0, 0, 256);
      bg.addColorStop(0, '#0b0d18');
      bg.addColorStop(1, '#05060c');
      x.fillStyle = bg;
      x.fillRect(0, 0, 512, 256);
      // Scan lines and a frame in the pilot's colour.
      x.globalAlpha = 0.07;
      x.fillStyle = accent;
      for (let y = 0; y < 256; y += 4) x.fillRect(0, y, 512, 1);
      x.globalAlpha = 1;
      x.strokeStyle = accent;
      x.lineWidth = 3;
      x.strokeRect(6, 6, 500, 244);
      x.textBaseline = 'alphabetic';
      return x;
    };
    const label = (x: CanvasRenderingContext2D, t: string, px: number, py: number, align: CanvasTextAlign = 'left') => {
      x.font = '600 23px "Chakra Petch", ui-monospace, monospace';
      x.fillStyle = 'rgba(244,241,255,0.78)';
      x.textAlign = align;
      x.fillText(t.toUpperCase(), px, py);
    };
    const value = (x: CanvasRenderingContext2D, t: string, px: number, py: number, size: number, color = accent, align: CanvasTextAlign = 'left') => {
      x.font = `600 ${size}px "Chakra Petch", ui-monospace, monospace`;
      x.fillStyle = color;
      x.textAlign = align;
      x.shadowColor = color;
      x.shadowBlur = 12;
      x.fillText(t, px, py);
      x.shadowBlur = 0;
    };
    const bar = (x: CanvasRenderingContext2D, px: number, py: number, w: number, f: number, color: string) => {
      x.fillStyle = 'rgba(255,255,255,0.14)';
      x.fillRect(px, py, w, 12);
      x.fillStyle = color;
      x.shadowColor = color;
      x.shadowBlur = 10;
      x.fillRect(px, py, w * Math.max(0, Math.min(1, f)), 12);
      x.shadowBlur = 0;
    };

    // Left: speed, boost, hull, gun.
    const l = screen(this.cockpitLeft);
    if (l) {
      label(l, 'Speed', 24, 40);
      value(l, String(Math.round(g.alive ? g.speed * 12 : 0)), 24, 112, 78);
      label(l, 'km/h', 24, 140);
      label(l, g.boosting ? 'Boost ››' : 'Boost', 220, 40);
      bar(l, 220, 52, 268, g.energy, g.boosting ? '#ffffff' : accent);
      label(l, 'Hull', 220, 104);
      const n = g.ship.hull;
      const hurt = this.clock < this.hurtUntil && Math.floor(this.clock * 10) % 2 === 0;
      for (let i = 0; i < n; i++) {
        const cx = 232 + i * 34;
        l.beginPath();
        l.moveTo(cx, 116);
        l.lineTo(cx + 11, 128);
        l.lineTo(cx, 140);
        l.lineTo(cx - 11, 128);
        l.closePath();
        const on = i < g.hull;
        l.fillStyle = on ? (hurt ? '#ff4f4f' : accent) : 'rgba(255,255,255,0.15)';
        l.fill();
      }
      label(l, g.overheated ? 'Gun hot' : 'Gun', 220, 178);
      bar(l, 220, 190, 268, g.heat, g.overheated ? '#ff4f4f' : g.heat > 0.7 ? '#ffb02e' : accent);
      label(l, this.levelText, 24, 228);
    }

    // Right: score or round, pilots, time, special ability and bonus.
    const r = screen(this.cockpitRight);
    if (r) {
      label(r, this.online ? 'Round' : 'Score', 24, 40);
      value(r, this.online ? String(score) : formatScore(score), 24, 84, 40, '#ffffff');
      label(r, 'Pilots', 300, 40);
      value(r, `${world.aliveCount()}/${world.gliders.length}`, 300, 84, 40);
      label(r, 'Time', 24, 124);
      value(r, formatTime(world.flyTime), 24, 160, 32, '#ffffff');
      const sp = g.ship.special;
      label(r, `${sp.name}${specialReady && g.alive ? ' · ready (C)' : ''}`, 24, 198);
      bar(r, 24, 208, 464, specialFill, specialReady && g.alive ? '#ffffff' : accent);
      const p = g.power;
      if (p && g.alive) {
        const spec = POWERS[p];
        const left = Math.max(0, g.powerUntil - world.tick) / spec.duration;
        const col = hex(spec.color);
        label(r, 'Bonus', 300, 124);
        value(r, spec.name, 300, 156, 24, col);
        bar(r, 300, 166, 188, left, col);
      }
    }
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
      // Obstacles warn like the shield does.
      if (world.obstacles.length) {
        const od = world.obstacleDist(g.p.x, g.p.y, g.p.z);
        const o = world.obstacles[world.nearestObstacle];
        if (o && od < 14 && od < bd) {
          add(o.c.x - g.p.x, o.c.y - g.p.y, o.c.z - g.p.z, 1 - Math.max(0, od) / 14);
          alert = `Obstacle ${Math.max(0, Math.ceil(od))} m`;
          alertClose = od < 6;
        }
      }
    }
    if (this.alert.textContent !== alert) this.alert.textContent = alert;
    this.alert.hidden = !alert;
    this.alert.classList.toggle('close', alertClose);
    const set = (el: HTMLElement, v: number) => {
      const o = (Math.min(1, v) * 0.9).toFixed(2);
      if (el.style.opacity !== o) el.style.opacity = o;
    };
    const f = this.damageFlash;
    set(this.edges.l, Math.max(l, f));
    set(this.edges.r, Math.max(r, f));
    set(this.edges.t, Math.max(t, f));
    set(this.edges.b, Math.max(b, f));
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

    // Obstacles as seen from above: spheres as discs, rods as thick lines, rings as rings.
    ctx.fillStyle = 'rgba(220,220,235,0.3)';
    ctx.strokeStyle = 'rgba(235,235,250,0.55)';
    for (const o of world.obstacles) {
      const x = toX(o.c.x, o.c.z);
      const y = toY(o.c.x, o.c.z);
      const reach = o.reach * sc;
      if (x * x + y * y > (R + reach) * (R + reach)) continue;
      const shape = o.def.shape;
      if (shape.kind === 'sphere') {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2.5 * px, shape.r * sc), 0, Math.PI * 2);
        ctx.fill();
      } else if (shape.kind === 'capsule') {
        ctx.lineWidth = Math.max(3 * px, shape.r * 2 * sc);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(toX(o.c.x - o.a.x * shape.half, o.c.z - o.a.z * shape.half), toY(o.c.x - o.a.x * shape.half, o.c.z - o.a.z * shape.half));
        ctx.lineTo(toX(o.c.x + o.a.x * shape.half, o.c.z + o.a.z * shape.half), toY(o.c.x + o.a.x * shape.half, o.c.z + o.a.z * shape.half));
        ctx.stroke();
      } else {
        // Two directions across the ring's plane.
        const ax = o.a.x;
        const ay = o.a.y;
        const az = o.a.z;
        let ux = -az;
        let uz = ax;
        let uy = 0;
        if (ux * ux + uz * uz < 1e-6) {
          ux = 1;
          uz = 0;
        }
        const ul = Math.hypot(ux, uy, uz);
        ux /= ul;
        uz /= ul;
        const vx = ay * uz - az * uy;
        const vz = ax * uy - ay * ux;
        ctx.lineWidth = Math.max(2 * px, shape.r * 2 * sc);
        ctx.beginPath();
        for (let k = 0; k <= 24; k++) {
          const th = (k / 24) * Math.PI * 2;
          const wx = o.c.x + shape.R * (ux * Math.cos(th) + vx * Math.sin(th));
          const wz = o.c.z + shape.R * (uz * Math.cos(th) + vz * Math.sin(th));
          if (k === 0) ctx.moveTo(toX(wx, wz), toY(wx, wz));
          else ctx.lineTo(toX(wx, wz), toY(wx, wz));
        }
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';

    // Bonus rings, in the colour of their bonus.
    ctx.lineWidth = 2 * px;
    for (const rg of world.rings) {
      if (!rg.active) continue;
      ctx.strokeStyle = hex(POWERS[rg.power].color);
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
