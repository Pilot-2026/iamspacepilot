import '@fontsource/unbounded/300.css';
import '@fontsource/unbounded/600.css';
import '@fontsource/unbounded/800.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import './ui/styles.css';

import { Sound } from './audio/sound';
import { COUNTDOWN_TICKS, DT, TICK_RATE } from './core/config';
import type { CrashInfo, SimEvent } from './core/types';
import { World, type PilotSetup } from './core/world';
import { InputManager } from './input/input';
import { GameView } from './render/view';
import { loadProfile, saveProfile, type Profile } from './storage/profile';
import { Hud } from './ui/hud';
import { Menu, type ResultInfo } from './ui/menu';
import { TouchControls } from './ui/touch';

const BOT_NAMES = ['Vega', 'Orion', 'Lumen', 'Nova', 'Polaris', 'Zirrus', 'Skyla'];
const PLAYER = 0;
const isTouchDevice = () =>
  (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;

type State = 'menu' | 'playing' | 'paused' | 'ending';

class App {
  private readonly profile: Profile = loadProfile();
  private readonly sound = new Sound();
  private readonly menu: Menu;
  private readonly hud: Hud;
  private readonly touch: TouchControls;
  private readonly input: InputManager;
  private view: GameView | null = null;
  private world: World | null = null;
  private state: State = 'menu';
  private acc = 0;
  private last = 0;
  private endAt = 0;
  private wakeLock: { release(): Promise<void> } | null = null;

  constructor() {
    const $ = (id: string) => document.getElementById(id) as HTMLElement;
    this.touch = new TouchControls($('touch'));
    this.touch.hide();
    this.hud = new Hud($('hud'), () => this.pause());
    this.hud.hide();
    this.input = new InputManager(this.touch, () => this.togglePause());
    this.menu = new Menu($('menu'), this.profile, {
      launch: () => this.launch(),
      resume: () => this.resume(),
      restart: () => this.launch(),
      quit: () => this.quit(),
      settingsChanged: () => this.applySettings(),
      click: () => {
        this.sound.unlock();
        this.sound.click();
      },
    });

    try {
      this.view = new GameView($('scene') as HTMLCanvasElement);
    } catch {
      this.view = null;
    }

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    // Touch can appear on hybrid laptops at any time.
    window.addEventListener('touchstart', () => {
      if (this.state === 'playing' && !this.touch.visible) {
        this.touch.show();
        this.hud.setTouch(true);
      }
    });

    this.applySettings();
    this.resize();
    if (!this.view) this.menu.show('nogl');
    else this.menu.show(this.profile.callsign ? 'main' : 'callsign');
    requestAnimationFrame((t) => this.frame(t));
  }

  private applySettings(): void {
    const s = this.profile.settings;
    this.sound.setVolume(s.volume);
    this.input.invertPitch = s.invertPitch;
    if (this.view) {
      const dpr = window.devicePixelRatio || 1;
      const ratio = s.quality === 'low' ? 1 : s.quality === 'high' ? Math.min(dpr, 2) : Math.min(dpr, isTouchDevice() ? 1.5 : 2);
      this.view.setPixelRatio(ratio);
      this.resize();
    }
  }

  private resize(): void {
    this.view?.resize(window.innerWidth, window.innerHeight);
    this.hud.resizeRadar();
  }

  private launch(): void {
    if (!this.view) return;
    this.sound.unlock();
    const p = this.profile;
    const pilots: PilotSetup[] = [
      { name: p.callsign || 'You', isBot: false, assist: p.settings.autoHorizon, skill: p.solo.difficulty },
    ];
    for (let i = 0; i < p.solo.bots; i++) {
      pilots.push({ name: BOT_NAMES[i % BOT_NAMES.length], isBot: true, assist: true, skill: p.solo.difficulty });
    }
    this.world = new World({ level: p.solo.level, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0, pilots });
    this.view.load(this.world, PLAYER);
    const colors = this.world.gliders.map((_, i) => this.view!.colorOf(i));
    this.hud.setup(this.world, colors, PLAYER);
    this.menu.hide();
    this.hud.show();
    if (isTouchDevice()) this.touch.show();
    else this.touch.hide();
    this.hud.setTouch(this.touch.visible);
    this.input.reset();
    this.input.capturing = true;
    this.acc = 0;
    this.endAt = 0;
    this.state = 'playing';
    this.sound.resume();
    this.sound.startEngine();
    this.goFullscreen();
    this.requestWakeLock();
  }

  private togglePause(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused' && this.menu.visible) this.resume();
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.capturing = false;
    this.touch.reset();
    this.sound.suspend();
    this.menu.show('pause');
    this.releaseWakeLock();
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.menu.hide();
    this.state = 'playing';
    this.input.reset();
    this.input.capturing = true;
    this.touch.reset();
    this.acc = 0;
    this.last = performance.now();
    this.sound.resume();
    this.requestWakeLock();
  }

  private quit(): void {
    this.state = 'menu';
    this.input.capturing = false;
    this.sound.stopEngine();
    this.sound.resume();
    this.hud.hide();
    this.touch.hide();
    this.view?.clear();
    this.world = null;
    this.menu.show('main');
    this.releaseWakeLock();
  }

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    if (this.menu.visible) this.menu.pollGamepad();
    const w = this.world;
    const view = this.view;
    if (!w || !view || (this.state !== 'playing' && this.state !== 'ending')) return;

    this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < 8) {
      const inp = this.input.sample(DT);
      view.capturePrev();
      w.step([inp]);
      if (w.events.length) {
        view.handleEvents(w.events);
        this.onEvents(w, w.events);
      }
      this.acc -= DT;
      steps++;
    }
    if (steps === 8) this.acc = 0;

    view.render(this.acc / DT, dt);
    const portrait = isTouchDevice() && window.innerHeight > window.innerWidth;
    this.hud.update(w, PLAYER, dt, portrait);
    const g = w.gliders[PLAYER];
    if (g.alive && w.phase !== 'countdown') this.sound.updateEngine(g.speed, g.boosting, g.wallDist);

    if (this.endAt && now >= this.endAt) this.finish();
  }

  private onEvents(w: World, events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'count':
          this.hud.message(String(e.n), 'Get ready', 0.9);
          this.sound.count();
          break;
        case 'go':
          this.hud.message('Go', '', 0.8);
          this.sound.go();
          break;
        case 'shrink':
          this.hud.message('Shield closing', 'The arena is shrinking', 2);
          this.sound.shieldWarning();
          break;
        case 'ring':
          if (e.id === PLAYER) {
            this.hud.message('Boost +', '', 0.6);
            this.sound.ring();
          }
          break;
        case 'bolt-strike':
          this.sound.thunder();
          break;
        case 'crash': {
          const g = w.gliders[e.id];
          this.sound.crash(e.id === PLAYER);
          this.hud.feed(this.crashLine(w, g.name, e.id, e.crash));
          if (e.id === PLAYER) {
            this.hud.message('Crashed', this.causeText(w, e.crash, true), 2);
            this.sound.stopEngine();
            this.touch.hide();
            this.endAt = performance.now() + 2200;
            this.state = 'ending';
          }
          break;
        }
        case 'over':
          if (e.winner === PLAYER) {
            this.hud.message('You win', 'Last pilot flying', 2.2);
            this.sound.win();
            this.endAt = performance.now() + 2600;
            this.state = 'ending';
          }
          break;
        default:
          break;
      }
    }
  }

  private crashLine(w: World, name: string, id: number, c: CrashInfo): string {
    switch (c.kind) {
      case 'wall':
        return c.by === id ? `${name} hit their own wall` : `${name} hit ${w.gliders[c.by].name}'s wall`;
      case 'collision':
        return `${name} collided with ${w.gliders[c.by].name}`;
      case 'shield':
        return `${name} hit the shield`;
      case 'floor':
        return `${name} fell into ${w.spec.floorName}`;
      case 'ceiling':
        return `${name} hit the storm ceiling`;
      case 'lightning':
        return `${name} was struck by lightning`;
    }
  }

  private causeText(w: World, c: CrashInfo, short = false): string {
    switch (c.kind) {
      case 'wall':
        if (c.by === PLAYER) return short ? 'Your own wall' : 'You flew into your own wall.';
        return short ? `${w.gliders[c.by].name}'s wall` : `You hit ${w.gliders[c.by].name}'s wall.`;
      case 'collision':
        return short ? `Collided with ${w.gliders[c.by].name}` : `You collided with ${w.gliders[c.by].name}.`;
      case 'shield':
        return short ? 'Arena shield' : 'You hit the arena shield.';
      case 'floor':
        return short ? `Into ${w.spec.floorName}` : `You fell into ${w.spec.floorName}.`;
      case 'ceiling':
        return short ? 'Storm ceiling' : 'You hit the storm ceiling.';
      case 'lightning':
        return short ? 'Lightning' : 'Lightning struck you.';
    }
  }

  private finish(): void {
    const w = this.world;
    if (!w) return;
    this.endAt = 0;
    const g = w.gliders[PLAYER];
    const won = w.winner === PLAYER && g.alive;
    const time = g.alive ? w.flyTime : Math.max(0, (g.crashTick - COUNTDOWN_TICKS) / TICK_RATE);
    const id = w.spec.id;
    const rec = this.profile.records[id] ?? { bestTime: 0, wins: 0, flights: 0 };
    rec.flights += 1;
    if (won) rec.wins += 1;
    const newBest = time > rec.bestTime;
    if (newBest) rec.bestTime = time;
    this.profile.records[id] = rec;
    saveProfile(this.profile);

    const result: ResultInfo = {
      won,
      place: won ? 1 : g.place || w.aliveCount() + 1,
      pilots: w.gliders.length,
      time,
      best: rec.bestTime,
      newBest,
      cause: won ? 'Every other pilot is down. The sky is yours.' : g.crash ? this.causeText(w, g.crash) : '',
      level: w.spec,
    };
    this.state = 'menu';
    this.input.capturing = false;
    this.sound.stopEngine();
    this.hud.hide();
    this.touch.hide();
    this.menu.show('result', result);
    this.releaseWakeLock();
  }

  private goFullscreen(): void {
    if (!isTouchDevice()) return;
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement) return;
    try {
      const p = el.requestFullscreen?.({ navigationUI: 'hide' });
      if (p) {
        p.then(() => {
          const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          o?.lock?.('landscape').catch(() => undefined);
        }).catch(() => undefined);
      }
    } catch {
      // Fullscreen is optional.
    }
  }

  private requestWakeLock(): void {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (!nav.wakeLock || this.wakeLock) return;
    nav.wakeLock
      .request('screen')
      .then((l) => {
        this.wakeLock = l;
      })
      .catch(() => undefined);
  }

  private releaseWakeLock(): void {
    const l = this.wakeLock;
    this.wakeLock = null;
    l?.release().catch(() => undefined);
  }
}

new App();
