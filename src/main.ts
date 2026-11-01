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
import { POWERS } from './core/powerups';
import { liveScore, playerFinished, soloScore, soloWorldSetup, type SoloScore, type SoloSetup } from './core/solo';
import { NEUTRAL_INPUT, type CrashInfo, type SimEvent } from './core/types';
import { World } from './core/world';
import { InputManager } from './input/input';
import { fetchBoard, onlineErrorText, submitScore } from './net/api';
import { gameErrorText, listGames } from './net/games';
import type { RoundResult } from './online/match';
import { OnlineSession, type SessionEvents } from './online/session';
import { ShipPreviews } from './render/preview';
import { GameView } from './render/view';
import { addLocalScore, loadProfile, saveProfile, type Profile } from './storage/profile';
import { Hud } from './ui/hud';
import { Menu, formatScore, type ResultInfo } from './ui/menu';
import { TEAM_NAMES } from './ui/online-screens';
import { TouchControls } from './ui/touch';

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
  private musicButton: HTMLButtonElement;
  private trackToast: HTMLElement | null = null;
  private toastTimer = 0;
  private previews: ShipPreviews | null = null;
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
    this.hud = new Hud($('hud'), () => this.pause(), () => this.cheat());
    this.hud.hide();
    this.input = new InputManager(this.touch, () => this.togglePause(), () => this.cheat(), () => this.toggleMusic());
    this.musicButton = this.makeMusicButton();
    this.sound.onTrack = (name) => this.showTrack(name);
    this.sound.playMusic('menu');
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
      }
    });

    this.applySettings();
    this.resize();
    if (!this.view) this.menu.show('nogl');
    else this.menu.show(this.profile.callsign ? 'main' : 'callsign');
    // An invite link (?join=CODE) opens that game straight away.
    const code = new URLSearchParams(location.search).get('join')?.toUpperCase() ?? '';
    if (code) history.replaceState(null, '', location.pathname);
    if (this.view && /^[A-Z0-9]{5}$/.test(code)) this.menu.joinFromLink(code);
    requestAnimationFrame((t) => this.frame(t));
  }

  private applySettings(): void {
    const s = this.profile.settings;
    this.sound.setVolume(s.volume);
    this.sound.setMusicEnabled(s.music);
    this.sound.setMusicVolume(s.musicVolume);
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
    this.input.reset();
    this.input.capturing = true;
    this.acc = 0;
    this.endAt = 0;
    this.state = 'playing';
    this.sound.resume();
    this.sound.startEngine();
    this.sound.playMusic(this.world.spec.id);
    this.goFullscreen();
    this.requestWakeLock();
  }

  // ---- music ----

  private makeMusicButton(): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'music-btn';
    b.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.6" fill="currentColor"/><circle cx="17.5" cy="16" r="2.6" fill="currentColor"/><path class="off" d="M3 3l18 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.sound.unlock();
      this.toggleMusic();
      b.blur();
    });
    document.getElementById('app')?.append(b);
    const toast = document.createElement('div');
    toast.className = 'music-toast';
    toast.hidden = true;
    document.getElementById('app')?.append(toast);
    this.trackToast = toast;
    return b;
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
    const on = this.profile.settings.music;
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Music on (M)' : 'Music off (M)');
    b.title = on ? 'Music on (M)' : 'Music off (M)';
  }

  /** Shows the name of a new music track for a moment. */
  private showTrack(name: string): void {
    const t = this.trackToast;
    if (!t || !this.profile.settings.music) return;
    t.textContent = `♪ ${name}`;
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
    this.sound.playMusic('menu');
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
          if (e.id === this.local) {
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
      case 'shot': {
        const n = w.gliders[c.by]?.name ?? 'a pilot';
        return short ? `Shot down by ${n}` : `${n} shot you down.`;
      }
      case 'left':
        return short ? 'Left the game' : 'You left the game.';
    }
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
    this.input.reset();
    this.input.capturing = true;
    this.acc = 0;
    this.endAt = 0;
    this.resultsAt = 0;
    this.state = 'playing';
    this.sound.resume();
    this.sound.startEngine();
    this.sound.playMusic(w.spec.id);
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
    this.sound.playMusic('menu');
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
