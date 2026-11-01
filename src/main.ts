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
import { DT } from './core/config';
import { ReplayRecorder, quantize } from './core/replay';
import { LEVELS, LEVEL_ORDER, nextLevel } from './core/levels';
import { OBSTACLE_NAMES } from './core/obstacles';
import { POWERS } from './core/powerups';
import { SHIPS, SHIP_ORDER } from './core/ships';
import { liveScore, playerFinished, soloScore, soloWorldSetup, type SoloScore, type SoloSetup } from './core/solo';
import { NEUTRAL_INPUT, type CrashInfo, type SimEvent } from './core/types';
import { World } from './core/world';
import { InputManager } from './input/input';
import { fetchBoard, onlineErrorText, submitScore } from './net/api';
import { gameErrorText, listGames } from './net/games';
import { countFlight, countVisit, fetchStats } from './net/stats';
import type { RoundResult } from './online/match';
import { OnlineSession, type SessionEvents } from './online/session';
import { ShipPreviews } from './render/preview';
import { MenuStage } from './render/stage';
import { GameView, VIEW_NAMES, VIEW_ORDER } from './render/view';
import { addLocalScore, loadProfile, saveProfile, type Profile } from './storage/profile';
import { Hud } from './ui/hud';
import { Menu, formatScore, type MenuScreen, type ResultInfo } from './ui/menu';
import { TEAM_NAMES } from './ui/online-screens';
import { TouchControls } from './ui/touch';

const PLAYER = 0;

type SoundMode = 'all' | 'music' | 'sounds' | 'off';
const SOUND_MODES: [SoundMode, string][] = [
  ['all', 'Music + sounds'],
  ['music', 'Music only'],
  ['sounds', 'Sounds only'],
  ['off', 'All off'],
];
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
  private musicButton: HTMLButtonElement;
  private soundMenu: HTMLElement | null = null;
  private trackToast: HTMLElement | null = null;
  private toastTimer = 0;
  private previews: ShipPreviews | null = null;
  /** Ships flying behind the menus, and the intro. */
  private stage: MenuStage | null = null;
  /** Start screen: which level world shines through, and for how long already. */
  private showLevel = 0;
  private showTime = 0;
  private showAcc = 0;
  private world: World | null = null;
  private state: State = 'menu';
  private acc = 0;
  private last = 0;
  private endAt = 0;
  private wakeLock: { release(): Promise<void> } | null = null;
  /** The current round's setup, the recording of the player's inputs and the final score. */
  private solo: SoloSetup | null = null;
  private recorder = new ReplayRecorder();
  private final: { score: SoloScore; ticks: number } | null = null;
  /** Index of this device's glider in the current world. */
  private local = PLAYER;
  /** Online game in progress, or null in solo. */
  private session: OnlineSession | null = null;
  /** Counts join attempts, so a cancelled one is ignored when it finishes. */
  private joining = 0;
  /** Talk button in the lobby (toggle). */
  private talkToggle = false;
  private lastTalk = false;
  /** Online: when the round results appear. */
  private resultsAt = 0;
  /** Online: keeps the game running while the tab is in the background. */
  private bgTimer = 0;
  private bgLast = 0;

  constructor() {
    const $ = (id: string) => document.getElementById(id) as HTMLElement;
    this.touch = new TouchControls($('touch'));
    this.touch.hide();
    this.hud = new Hud($('hud'), () => this.pause(), () => this.cheat(), () => this.cycleView());
    this.hud.hide();
    this.input = new InputManager(this.touch, () => this.togglePause(), () => this.cheat(), () => this.toggleMusic());
    this.input.onView = () => this.cycleView();
    this.input.onShipCheat = () => this.shipCheat();
    this.touch.onShipCheat = () => this.shipCheat();
    this.input.onDogCheat = () => this.toggleDog();
    // 99999 shows the visit statistics (from any menu).
    this.input.onStats = () => {
      if (this.state === 'menu' && this.menu.visible) this.menu.showStats();
    };
    this.touch.onDogCheat = () => this.toggleDog();
    this.input.onLook = (z, yaw, pitch) => this.look(z, yaw, pitch);
    this.touch.onLook = (z, yaw, pitch) => this.look(z, yaw, pitch);
    this.touch.onLookReset = () => this.view?.resetLook();
    this.musicButton = this.makeMusicButton();
    this.sound.onTrack = (name) => this.showTrack(name);
    // Music starts straight away where the browser allows it, otherwise with the first tap or key.
    this.sound.init();
    this.sound.startMusic();
    this.blockZoom();
    this.hud.specialButton = this.touch.specialButton;
    this.menu = new Menu($('menu'), this.profile, {
      launch: () => this.launch(),
      resume: () => this.resume(),
      restart: () => this.launch(),
      next: () => this.goNext(),
      quit: () => this.quit(),
      settingsChanged: () => this.applySettings(),
      click: () => {
        this.sound.unlock();
        this.sound.click();
      },
      loadBoard: (level) => fetchBoard(level),
      loadStats: () => fetchStats(),
      screen: (screen) => this.menuScreen(screen),
      ships: (canvases) => {
        if (!canvases.length && !this.previews) return;
        this.previews ??= new ShipPreviews();
        this.previews.attach(canvases);
      },
      online: {
        list: () => listGames(),
        host: () => void this.goOnline(null),
        join: (code) => void this.goOnline(code),
        cancel: () => this.cancelOnline(),
        session: () => this.session,
        leave: () => this.leaveOnline(),
        resumeFlight: () => this.resume(),
        toggleTalk: () => {
          this.talkToggle = !this.talkToggle;
        },
        touch: () => isTouchDevice(),
      },
    });

    try {
      this.view = new GameView($('scene') as HTMLCanvasElement);
      this.view.setCockpitScreens(this.hud.cockpitLeft, this.hud.cockpitRight, this.hud.radarCanvas);
      this.view.onSplash = () => this.sound.splash();
      this.view.setDogMode(this.profile.dog);
    } catch {
      this.view = null;
    }

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.visibilityChanged());
    window.addEventListener('pagehide', () => this.session?.leave());
    // Command is boost: Command+W or Command+R during a flight must not close or reload the game by accident.
    window.addEventListener('beforeunload', (e) => {
      if (this.state === 'playing' || this.state === 'paused' || this.state === 'ending' || this.session) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    // Touch can appear on hybrid laptops at any time.
    window.addEventListener('touchstart', () => {
      if (this.state === 'playing' && !this.touch.visible) {
        this.touch.show();
        this.hud.setTouch(true);
        this.view?.setTouchLayout(true);
      }
    });

    this.applySettings();
    this.resize();
    // An invite link (?join=CODE) opens that game straight away (after the intro).
    const code = new URLSearchParams(location.search).get('join')?.toUpperCase() ?? '';
    if (code) history.replaceState(null, '', location.pathname);
    if (!this.view) {
      this.menu.show('nogl');
    } else {
      try {
        this.stage = new MenuStage($('stage') as HTMLCanvasElement);
      } catch {
        this.stage = null;
      }
      this.showLevel = Math.floor(Math.random() * LEVEL_ORDER.length);
      // First a play button: its tap allows the music, which then plays from the very first frame of the intro.
      this.menu.showGate(() => {
        this.sound.unlock();
        this.menu.showIntro(() => {
          this.menu.show(this.profile.callsign ? 'main' : 'callsign');
          if (/^[A-Z0-9]{5}$/.test(code)) this.menu.joinFromLink(code);
        });
      });
    }
    requestAnimationFrame((t) => this.frame(t));
    countVisit();
  }

  private applySettings(): void {
    const s = this.profile.settings;
    this.sound.setVolume(s.volume);
    this.sound.setMusicEnabled(s.music);
    this.sound.setMusicVolume(s.musicVolume);
    this.sound.setSoundsEnabled(s.sounds);
    this.updateMusicButton();
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
    // Space fires: it must not press a menu button that still has focus.
    (document.activeElement as HTMLElement | null)?.blur?.();
    const p = this.profile;
    this.solo = {
      level: p.solo.level,
      seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0,
      bots: p.solo.bots,
      difficulty: p.solo.difficulty,
      assist: p.settings.autoHorizon,
      ship: p.ship,
    };
    this.world = new World(soloWorldSetup(this.solo, p.callsign || 'You'));
    this.recorder = new ReplayRecorder();
    this.final = null;
    this.local = PLAYER;
    this.view.load(this.world, PLAYER);
    const colors = this.world.gliders.map((_, i) => this.view!.colorOf(i));
    this.hud.setup(this.world, colors, PLAYER);
    this.hud.setOnline(false);
    this.touch.setTalk(false);
    this.menu.hide();
    this.hud.show();
    if (isTouchDevice()) this.touch.show();
    else this.touch.hide();
    this.hud.setTouch(this.touch.visible);
    this.startView();
    this.input.reset();
    this.input.capturing = true;
    this.acc = 0;
    this.endAt = 0;
    this.state = 'playing';
    this.sound.resume();
    this.sound.startEngine();
    this.goFullscreen();
    this.requestWakeLock();
    countFlight(this.solo.level, 'solo');
  }

  // ---- camera views ----

  /** Every round starts with the view from behind the ship. */
  private startView(): void {
    this.view?.setView('chase');
    this.view?.setTouchLayout(this.touch.visible);
    this.hud.setView('normal');
  }

  /** Eye button, V or the gamepad's back button: the next camera view. */
  private cycleView(): void {
    const view = this.view;
    if (!view || !this.world || this.state === 'menu') return;
    const mode = view.nextView();
    this.hud.setView(this.hudView(), `${VIEW_ORDER.indexOf(mode) + 1}/${VIEW_ORDER.length} · ${VIEW_NAMES[mode]}`);
    this.sound.click();
  }

  /** Which parts of the HUD the current view keeps. */
  private hudView(): 'normal' | 'cockpit' | 'clean' {
    const view = this.view;
    if (!view) return 'normal';
    if (view.view === 'clean') return 'clean';
    if (view.view === 'cockpit') {
      const g = this.world?.gliders[this.local];
      return g?.alive ? 'cockpit' : 'normal';
    }
    return 'normal';
  }

  /** Pinch, drag, wheel or right stick: zoom and look around the ship. */
  private look(zoomMul: number, dYaw: number, dPitch: number): void {
    if (!this.world || (this.state !== 'playing' && this.state !== 'ending')) return;
    this.view?.look(zoomMul, dYaw, dPitch);
  }

  /** The HUD after the frame: cockpit screens and which parts are shown. */
  private afterHud(): void {
    this.hud.setView(this.hudView());
    const d = this.hud.cockpitDirty;
    if (d.side || d.radar) this.view?.refreshCockpit(d.side, d.radar);
    d.side = false;
    d.radar = false;
  }

  /** Phones and tablets must not zoom the page: not with a double tap, not with two fingers. */
  private blockZoom(): void {
    const stop = (e: Event) => e.preventDefault();
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, stop, { passive: false });
    document.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length > 1) e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener('dblclick', stop, { passive: false });
  }

  /** Menu screen changed: ship stage behind it, and the worlds behind the start screen. */
  private menuScreen(screen: MenuScreen | null): void {
    this.stage?.setMode(screen === 'intro' ? 'intro' : screen === 'gate' || !screen ? 'off' : 'menu');
    const view = this.view;
    if (!view) return;
    if (screen === 'main' && this.state === 'menu') {
      if (!view.showing) {
        view.showcase(LEVEL_ORDER[this.showLevel % LEVEL_ORDER.length]);
        this.showTime = 0;
      }
    } else if (view.showing) {
      view.clear();
    }
  }

  /** Renders the level world behind the start screen (30 times a second) and moves on to the next level now and then. */
  private frameShowcase(dt: number): void {
    const view = this.view;
    if (!view || !view.showing) return;
    this.showTime += dt;
    if (this.showTime > 12) {
      this.showLevel++;
      view.showcase(LEVEL_ORDER[this.showLevel % LEVEL_ORDER.length]);
      this.showTime = 0;
    }
    this.showAcc += dt;
    if (this.showAcc < 1 / 30) return;
    view.renderShowcase(this.showAcc);
    this.showAcc = 0;
  }

  // ---- music ----

  private makeMusicButton(): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'music-btn';
    b.setAttribute('aria-haspopup', 'true');
    b.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.6" fill="currentColor"/><circle cx="17.5" cy="16" r="2.6" fill="currentColor"/><path class="off" d="M3 3l18 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><span class="music-lbl">Music on</span>';
    // A small menu: music and sounds, music only, sounds only, all off.
    const menu = document.createElement('div');
    menu.className = 'sound-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.innerHTML = SOUND_MODES.map(([mode, label]) => `<button type="button" role="menuitemradio" data-mode="${mode}">${label}</button>`).join('');
    const close = () => {
      menu.hidden = true;
      b.setAttribute('aria-expanded', 'false');
    };
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.sound.unlock();
      menu.hidden = !menu.hidden;
      b.setAttribute('aria-expanded', String(!menu.hidden));
      b.blur();
    });
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = (e.target as HTMLElement).closest('[data-mode]') as HTMLElement | null;
      if (!btn) return;
      this.setSoundMode(btn.dataset.mode as SoundMode);
      close();
    });
    menu.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    window.addEventListener('pointerdown', () => close());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') close();
    });
    const app = document.getElementById('app');
    app?.append(b, menu);
    this.soundMenu = menu;
    const toast = document.createElement('div');
    toast.className = 'music-toast';
    toast.hidden = true;
    app?.append(toast);
    this.trackToast = toast;
    return b;
  }

  /** Music and sounds, music only, sounds only or all off. */
  private setSoundMode(mode: SoundMode): void {
    const s = this.profile.settings;
    s.music = mode === 'all' || mode === 'music';
    s.sounds = mode === 'all' || mode === 'sounds';
    saveProfile(this.profile);
    this.applySettings();
    this.menu.refreshSettings();
  }

  /** M key or the music button: music on or off. */
  private toggleMusic(): void {
    const s = this.profile.settings;
    s.music = !s.music;
    saveProfile(this.profile);
    this.sound.setMusicEnabled(s.music);
    this.updateMusicButton();
    this.menu.refreshSettings();
  }

  private updateMusicButton(): void {
    const b = this.musicButton;
    if (!b) return;
    const s = this.profile.settings;
    const mode: SoundMode = s.music && s.sounds ? 'all' : s.music ? 'music' : s.sounds ? 'sounds' : 'off';
    const label = SOUND_MODES.find(([m]) => m === mode)?.[1] ?? '';
    b.setAttribute('aria-pressed', String(s.music));
    b.setAttribute('aria-label', `Sound: ${label}`);
    b.title = `Sound: ${label} (M switches the music)`;
    const lbl = b.querySelector('.music-lbl');
    if (lbl) lbl.textContent = label;
    this.soundMenu?.querySelectorAll<HTMLElement>('[data-mode]').forEach((el) => el.setAttribute('aria-checked', String(el.dataset.mode === mode)));
  }

  /** Shows the name of a new music track for a moment. */
  private showTrack(name: string): void {
    if (!this.profile.settings.music) return;
    this.showToast(`♪ ${name}`);
  }

  /** A short note at the bottom right. */
  private showToast(text: string): void {
    const t = this.trackToast;
    if (!t) return;
    t.textContent = text;
    t.hidden = false;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.hidden = true), 3200);
  }

  /** Music mood: muffled in pauses and after a crash, open in flight. */
  private updateMusicMood(): void {
    const w = this.world;
    document.body.classList.toggle('flying', this.state !== 'menu');
    if (this.state === 'menu' || !w) {
      this.sound.setMusicMood('menu');
      return;
    }
    if (this.state === 'paused') {
      this.sound.setMusicMood(this.session ? 'flight' : 'pause');
      return;
    }
    const g = w.gliders[this.local];
    if (w.phase === 'countdown') this.sound.setMusicMood('countdown');
    else if (!g || !g.alive) this.sound.setMusicMood('down');
    else this.sound.setMusicMood(g.boosting ? 'boost' : 'flight');
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
    if (this.session) {
      // Online the round goes on: only a menu opens over it.
      this.menu.show('online-pause');
      return;
    }
    this.sound.stopEngine();
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
    if (!this.session) {
      this.acc = 0;
      this.last = performance.now();
    }
    this.sound.resume();
    const g = this.world?.gliders[this.local];
    if (g?.alive) this.sound.startEngine();
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
    this.updateMusicMood();
    if (this.state === 'menu') this.frameShowcase(dt);
    if (this.session) {
      this.frameOnline(now, dt);
      return;
    }
    const w = this.world;
    const view = this.view;
    if (!w || !view || (this.state !== 'playing' && this.state !== 'ending')) return;

    this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < 8) {
      // Inputs are rounded and recorded so the server can replay this flight exactly.
      const inp = quantize(this.input.sample(DT));
      if (!this.final) this.recorder.push(inp);
      view.capturePrev();
      w.step([inp]);
      if (!this.final && this.solo && playerFinished(w, PLAYER)) {
        this.final = { score: soloScore(w, PLAYER, this.solo.difficulty), ticks: this.recorder.length };
      }
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
    this.hud.update(w, PLAYER, dt, portrait, this.solo ? liveScore(w, PLAYER, this.solo.difficulty) : 0);
    this.afterHud();
    const g = w.gliders[PLAYER];
    if (g.alive && w.phase !== 'countdown') {
      this.sound.updateEngine(g.speed, g.boosting, g.wallDist, this.hud.boundaryDist);
      if (this.state === 'playing') this.sound.maneuver(g.input.steerX, g.input.steerY, g.input.roll);
    }

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
        case 'power':
          if (e.id === this.local) {
            this.hud.message(POWERS[e.power].name, POWERS[e.power].text, 1.4);
            this.sound.ring();
          }
          break;
        case 'special':
          if (e.id === this.local) {
            this.hud.message(w.gliders[e.id].ship.special.name, '', 0.8);
            this.sound.special(e.kind);
          } else if (e.kind === 'shockwave') {
            this.sound.special(e.kind, 0.4);
          }
          break;
        case 'shield':
          if (e.id === this.local) this.sound.shieldPop();
          break;
        case 'jam':
          if (e.id === this.local) {
            this.hud.message('Gun jammed', 'Shockwave', 1.2);
            this.sound.overheat();
          }
          break;
        case 'bolt-strike':
          this.sound.thunder();
          break;
        case 'shot': {
          if (e.id === this.local && this.profile.dog) {
            this.sound.bark();
          } else if (e.id === this.local) {
            this.sound.shot(1);
          } else {
            const me = w.gliders[this.local];
            const d = Math.sqrt(w.gliders[e.id].p.distSq(me.p));
            if (d < 140) this.sound.shot(0.3 * (1 - d / 140));
          }
          break;
        }
        case 'hit':
          if (e.id === this.local && e.shield) {
            this.sound.shieldPop();
          } else if (e.id === this.local) {
            this.hud.damage();
            this.sound.hit(true);
          } else if (e.by === this.local) {
            this.hud.hitMarker();
            this.sound.hitConfirm();
          } else {
            this.sound.hit(false);
          }
          break;
        case 'overheat':
          if (e.id === this.local) this.sound.overheat();
          break;
        case 'crash': {
          const g = w.gliders[e.id];
          this.sound.crash(e.id === this.local);
          this.hud.feed(this.crashLine(w, g.name, e.id, e.crash));
          if (e.id === this.local) {
            this.hud.message('Crashed', this.causeText(w, e.crash, true), 2);
            this.sound.stopEngine();
            this.touch.hide();
            this.endAt = performance.now() + 2200;
            this.state = 'ending';
          }
          break;
        }
        case 'over':
          if (e.winner === this.local) {
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
        return c.by === id ? `${name} hit their own wall` : `${name} hit ${w.gliders[c.by]?.name ?? 'a'}'s wall`;
      case 'collision':
        return `${name} collided with ${w.gliders[c.by]?.name ?? 'another glider'}`;
      case 'shield':
        return `${name} hit the shield`;
      case 'floor':
        return `${name} fell into ${w.spec.floorName}`;
      case 'ceiling':
        return `${name} hit the ceiling`;
      case 'lightning':
        return `${name} was struck by lightning`;
      case 'core':
        return `${name} flew into the core`;
      case 'obstacle':
        return `${name} crashed into ${this.obstacleName(w, c)}`;
      case 'shot':
        return `${name} was shot down by ${w.gliders[c.by]?.name ?? 'a pilot'}`;
      case 'left':
        return `${name} left the game`;
    }
  }

  private causeText(w: World, c: CrashInfo, short = false): string {
    switch (c.kind) {
      case 'wall': {
        if (c.by === this.local) return short ? 'Your own wall' : 'You flew into your own wall.';
        const n = w.gliders[c.by]?.name ?? 'a pilot';
        return short ? `${n}'s wall` : `You hit ${n}'s wall.`;
      }
      case 'collision': {
        const n = w.gliders[c.by]?.name ?? 'another glider';
        return short ? `Collided with ${n}` : `You collided with ${n}.`;
      }
      case 'shield':
        return short ? 'Arena shield' : 'You hit the arena shield.';
      case 'floor':
        return short ? `Into ${w.spec.floorName}` : `You fell into ${w.spec.floorName}.`;
      case 'ceiling':
        return short ? 'Ceiling' : 'You hit the ceiling.';
      case 'lightning':
        return short ? 'Lightning' : 'Lightning struck you.';
      case 'core':
        return short ? 'The core' : 'You flew into the core.';
      case 'obstacle': {
        const n = this.obstacleName(w, c);
        return short ? `Into ${n}` : `You crashed into ${n}.`;
      }
      case 'shot': {
        const n = w.gliders[c.by]?.name ?? 'a pilot';
        return short ? `Shot down by ${n}` : `${n} shot you down.`;
      }
      case 'left':
        return short ? 'Left the game' : 'You left the game.';
    }
  }

  private obstacleName(w: World, c: CrashInfo): string {
    const o = w.obstacles[c.seg];
    return (o && OBSTACLE_NAMES[o.def.look]) || 'an obstacle';
  }

  /** Starts the level after the current one. */
  private goNext(): void {
    const next = nextLevel(this.profile.solo.level);
    if (!next) return;
    this.profile.solo.level = next;
    saveProfile(this.profile);
    this.launch();
  }

  /**
   * Cheat: press 1 five times, or tap the score five times, to jump straight
   * to the next level (after the last one back to the first). The current
   * round is dropped without a score.
   */
  private cheat(): void {
    if (this.session) return;
    if (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'ending') return;
    const cur = this.profile.solo.level;
    const next = nextLevel(cur) ?? LEVEL_ORDER[0];
    this.profile.unlocked = Math.max(this.profile.unlocked, LEVELS[next].index);
    this.profile.solo.level = next;
    saveProfile(this.profile);
    this.endAt = 0;
    this.sound.stopEngine();
    this.launch();
    this.hud.message(`Level ${LEVELS[next].index}`, LEVELS[next].name, 1.6);
  }

  /** Cheat: 33333 (or five taps in the top left corner) turns your glider into a flying dachshund, and back. */
  private toggleDog(): void {
    this.profile.dog = !this.profile.dog;
    saveProfile(this.profile);
    this.view?.setDogMode(this.profile.dog);
    const text = this.profile.dog ? '🐶 Dachshund on' : 'Dachshund off';
    if (this.state === 'menu') this.showToast(text);
    else this.hud.message(this.profile.dog ? 'Dachshund' : 'Glider', this.profile.dog ? 'Spits bones · 33333 to switch back' : '', 1.6);
  }

  /** Cheat: 2222 (or five taps in the top right corner) restarts the round with the next ship. */
  private shipCheat(): void {
    if (this.session) return;
    if (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'ending') return;
    const next = SHIP_ORDER[(SHIP_ORDER.indexOf(this.profile.ship) + 1) % SHIP_ORDER.length];
    this.profile.ship = next;
    saveProfile(this.profile);
    this.endAt = 0;
    this.sound.stopEngine();
    this.launch();
    this.hud.message(SHIPS[next].name, SHIPS[next].special.name, 1.6);
  }

  private finish(): void {
    const w = this.world;
    const solo = this.solo;
    if (!w || !solo) return;
    this.endAt = 0;
    const g = w.gliders[PLAYER];
    const score = this.final?.score ?? soloScore(w, PLAYER, solo.difficulty);
    const id = w.spec.id;
    const rec = this.profile.records[id] ?? { bestTime: 0, wins: 0, flights: 0 };
    rec.flights += 1;
    if (score.won) rec.wins += 1;
    if (score.time > rec.bestTime) rec.bestTime = score.time;
    this.profile.records[id] = rec;
    const localRank = addLocalScore(this.profile, id, {
      score: score.score,
      time: score.time,
      won: score.won,
      place: score.place,
      pilots: score.pilots,
      difficulty: solo.difficulty,
      bots: solo.bots,
      date: new Date().toISOString(),
    });
    saveProfile(this.profile);

    // Winning opens the next level.
    const next = score.won ? nextLevel(id) : null;
    let unlockedNow = false;
    if (score.won && next && LEVELS[next].index > this.profile.unlocked) {
      this.profile.unlocked = LEVELS[next].index;
      unlockedNow = true;
    }
    saveProfile(this.profile);

    const result: ResultInfo = {
      next: next ? LEVELS[next] : null,
      unlockedNow,
      score,
      difficulty: solo.difficulty,
      cause: score.won ? 'Every other pilot is down. The sky is yours.' : g.crash ? this.causeText(w, g.crash) : '',
      level: w.spec,
      localRank,
    };
    this.state = 'menu';
    this.input.capturing = false;
    this.sound.stopEngine();
    this.hud.hide();
    this.touch.hide();
    const canPost = !!this.final && !!this.profile.callsign;
    this.menu.setOnlineStatus(canPost ? 'Posting your score to the online leaderboard…' : '');
    this.menu.show('result', result);
    this.releaseWakeLock();
    if (canPost && this.final) this.post(solo, this.final);
  }

  /** Sends the finished flight to the online leaderboard. */
  private post(solo: SoloSetup, final: { score: SoloScore; ticks: number }): void {
    void submitScore({
      callsign: this.profile.callsign,
      key: this.profile.pilotKey,
      setup: solo,
      replay: this.recorder.encode(final.ticks),
      score: final.score.score,
    }).then((res) => {
      if (!res.ok) {
        this.menu.setOnlineStatus(onlineErrorText(res.error));
      } else if (res.improved) {
        this.menu.setOnlineStatus(res.rank === 1 ? 'Online: you lead the leaderboard.' : `Online: #${res.rank} of all pilots.`);
      } else {
        this.menu.setOnlineStatus(`Your online best here is ${formatScore(res.best)}, #${res.rank} of all pilots.`);
      }
    });
  }

  // ---------- Online ----------

  /** Hosts a new game (code null) or joins one. */
  private async goOnline(code: string | null): Promise<void> {
    if (!this.view || this.session) return;
    this.sound.unlock();
    const token = ++this.joining;
    this.menu.connecting(code ? `Joining game ${code}` : 'Opening your game', 'Connecting to the radio…');
    const res = await OnlineSession.open(this.profile, code, this.sessionEvents());
    if (token !== this.joining) {
      if (res.ok) res.session.leave();
      return;
    }
    if (!res.ok) {
      this.menu.connecting(code ? 'Could not join' : 'Could not open the game', gameErrorText(res.error), true);
      return;
    }
    this.session = res.session;
    this.talkToggle = false;
    this.lastTalk = false;
    this.menu.show('lobby');
  }

  private cancelOnline(): void {
    this.joining++;
    this.menu.showList();
  }

  private sessionEvents(): SessionEvents {
    return {
      lobby: () => this.menu.onlineChanged(),
      radio: () => {
        this.menu.radioChanged();
        const s = this.session;
        this.hud.radio(s ? s.speaking() : [], s ? s.talking : false);
      },
      keyed: () => this.sound.radio(true),
      roundStart: (w, local) => this.startOnlineRound(w, local),
      roundEnd: (r) => this.endOnlineRound(r),
      crash: (id, crash) => this.onlineCrash(id, crash),
      closed: (reason) => this.leaveOnline(reason),
    };
  }

  private startOnlineRound(w: World, local: number): void {
    const view = this.view;
    if (!view || !this.session) return;
    if (local < 0) {
      // Joined just after the round was set up: fly the next one.
      this.menu.onlineChanged();
      return;
    }
    this.world = w;
    this.local = local;
    this.solo = null;
    countFlight(w.spec.id, 'online');
    this.final = null;
    (document.activeElement as HTMLElement | null)?.blur?.();
    view.load(w, local);
    const colors = w.gliders.map((_, i) => view.colorOf(i));
    this.hud.setup(w, colors, local);
    this.hud.setOnline(true);
    const s = this.session;
    this.hud.radio(s.speaking(), s.talking);
    this.menu.hide();
    this.hud.show();
    if (isTouchDevice()) this.touch.show();
    else this.touch.hide();
    this.touch.setTalk(true);
    this.touch.setTalking(this.talkToggle);
    this.touch.setSpectating(false);
    this.hud.setTouch(this.touch.visible);
    this.startView();
    this.input.reset();
    this.input.capturing = true;
    this.acc = 0;
    this.endAt = 0;
    this.resultsAt = 0;
    this.state = 'playing';
    this.sound.resume();
    this.sound.startEngine();
    this.goFullscreen();
    this.requestWakeLock();
    const g = w.gliders[local];
    if (w.teams) this.hud.message(`Team ${TEAM_NAMES[g.team] ?? ''}`, `Round ${s.match.round} · your team's walls let you through`, 2.2);
    if (document.hidden) s.match.dropOut();
  }

  private onlineCrash(id: number, crash: CrashInfo): void {
    const w = this.world;
    if (!w || !this.view || w !== this.session?.match.world) return;
    this.view.crashAt(id);
    const g = w.gliders[id];
    this.sound.crash(id === this.local);
    this.hud.feed(this.crashLine(w, g.name, id, crash));
    if (id === this.local) {
      this.hud.message('Crashed', `${this.causeText(w, crash, true)} · watching the rest`, 2.4);
      this.sound.stopEngine();
      this.touch.setSpectating(true);
    }
  }

  private endOnlineRound(r: RoundResult): void {
    const w = this.world;
    if (!w || w !== this.session?.match.world || this.state === 'menu') {
      this.menu.onlineChanged();
      return;
    }
    const me = r.local;
    const won = me >= 0 && (r.team >= 0 ? r.pilots[me]?.team === r.team : r.winner === me);
    if (won) {
      this.hud.message(r.team >= 0 ? 'Your team wins' : 'You win', 'Last pilot flying', 2);
      this.sound.win();
    } else {
      this.hud.message('Round over', '', 1.6);
    }
    this.resultsAt = performance.now() + 2200;
  }

  /** The yellow results screen; the next round starts from there. */
  private showOnlineResults(): void {
    this.resultsAt = 0;
    this.state = 'menu';
    this.input.capturing = false;
    this.sound.stopEngine();
    this.hud.hide();
    this.touch.hide();
    this.view?.clear();
    this.world = null;
    this.menu.show('lobby');
    this.releaseWakeLock();
  }

  /** Leaves the online game, optionally telling why. */
  private leaveOnline(notice = ''): void {
    this.joining++;
    const s = this.session;
    this.session = null;
    s?.leave();
    window.clearInterval(this.bgTimer);
    this.bgTimer = 0;
    this.local = PLAYER;
    this.state = 'menu';
    this.input.capturing = false;
    this.sound.stopEngine();
    this.sound.resume();
    this.hud.hide();
    this.hud.setOnline(false);
    this.touch.setTalk(false);
    this.touch.hide();
    this.view?.clear();
    this.world = null;
    this.resultsAt = 0;
    this.endAt = 0;
    this.menu.showList(notice);
    this.sound.setCapture(false);
    this.releaseWakeLock();
  }

  /** Push to talk from the T key, a gamepad, the touch mic button or the lobby button. */
  private updateTalk(): void {
    const s = this.session;
    if (!s) return;
    if (this.state === 'menu' && this.touch.state.talk !== this.talkToggle) this.touch.setTalking(this.talkToggle);
    const touchTalk = this.touch.visible && this.touch.state.talk;
    if (this.state === 'playing') this.talkToggle = touchTalk;
    const want = this.input.talkHeld() || this.talkToggle || touchTalk;
    if (want === this.lastTalk) return;
    this.lastTalk = want;
    // iPhone: the microphone needs a recording audio session, set before the mic opens.
    if (want) this.sound.setCapture(true);
    s.setTalking(want);
    this.sound.radio(want);
  }

  private frameOnline(now: number, dt: number): void {
    const s = this.session as OnlineSession;
    this.updateTalk();
    s.match.update();
    this.menu.tick();
    const w = this.world;
    const view = this.view;
    if (!w || !view || w !== s.match.world || this.state === 'menu') return;
    this.stepOnline(dt, true);
    view.render(this.acc / DT, dt);
    const portrait = isTouchDevice() && window.innerHeight > window.innerWidth;
    this.hud.update(w, this.local, dt, portrait, s.match.round);
    this.afterHud();
    const g = w.gliders[this.local];
    if (g.alive && w.phase !== 'countdown') {
      this.sound.updateEngine(g.speed, g.boosting, g.wallDist, this.hud.boundaryDist);
      if (this.state === 'playing') this.sound.maneuver(g.input.steerX, g.input.steerY, g.input.roll);
    }
    if (this.resultsAt && now >= this.resultsAt) this.showOnlineResults();
  }

  /** Advances the online round by the time that passed. Others keep flying, so ticks are never skipped. */
  private stepOnline(dt: number, visible: boolean): void {
    const s = this.session;
    const w = this.world;
    if (!s || !w || w !== s.match.world) return;
    this.acc = Math.min(this.acc + dt, 5);
    let steps = 0;
    const max = visible ? 20 : 400;
    while (this.acc >= DT && steps < max) {
      const inp = this.state === 'playing' && visible ? quantize(this.input.sample(DT)) : NEUTRAL_INPUT;
      if (visible) this.view?.capturePrev();
      s.match.step(inp);
      if (visible && s.match.world === w) {
        const evs = w.events.filter((e) => e.type !== 'crash' && e.type !== 'over' && e.type !== 'ring');
        if (evs.length) {
          this.view?.handleEvents(evs);
          this.onEvents(w, evs);
        }
      }
      this.acc -= DT;
      steps++;
    }
  }

  /** Online the game cannot pause: in the background your glider drops out, the host keeps the round going. */
  private visibilityChanged(): void {
    if (document.hidden) this.sound.suspend();
    else this.sound.resume();
    const s = this.session;
    if (!s) {
      if (document.hidden && this.state === 'playing') this.pause();
      return;
    }
    if (document.hidden) {
      s.match.dropOut();
      s.setTalking(false);
      this.lastTalk = false;
      this.bgLast = performance.now();
      window.clearInterval(this.bgTimer);
      this.bgTimer = window.setInterval(() => {
        const now = performance.now();
        const dt = (now - this.bgLast) / 1000;
        this.bgLast = now;
        s.match.update();
        this.stepOnline(dt, false);
      }, 250);
    } else {
      window.clearInterval(this.bgTimer);
      this.bgTimer = 0;
      this.last = performance.now();
    }
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
