import { LEVELS, LEVEL_ORDER, type LevelSpec } from '../core/levels';
import { DIFFICULTY_FACTOR, POINTS, type SoloScore } from '../core/solo';
import type { Difficulty, LevelId } from '../core/types';
import { onlineErrorText, type BoardResult } from '../net/api';
import type { ListResult } from '../net/games';
import type { OnlineSession } from '../online/session';
import { LOCAL_TOP, saveProfile, validateCallsign, type Profile, type Quality } from '../storage/profile';
import { ARROW, esc, frame, ordinal, wordmark } from './html';
import {
  clampBots,
  codeScreen,
  connectingScreen,
  consentScreen,
  gamesHtml,
  hostScreen,
  listScreen,
  lobbyScreen,
  micLine,
  nextLine,
  onlinePauseScreen,
  pilotsHtml,
} from './online-screens';

export interface ResultInfo {
  score: SoloScore;
  /** The level that comes next, if this one was won and there is one. */
  next: LevelSpec | null;
  /** True when this win just opened the next level. */
  unlockedNow: boolean;
  difficulty: Difficulty;
  cause: string;
  level: LevelSpec;
  /** Place on this device's highscore list, 0 if not on it. */
  localRank: number;
}

export interface MenuHandlers {
  launch(): void;
  resume(): void;
  restart(): void;
  next(): void;
  quit(): void;
  settingsChanged(): void;
  click(): void;
  loadBoard(level: LevelId): Promise<BoardResult>;
  online: OnlineHandlers;
}

export interface OnlineHandlers {
  list(): Promise<ListResult>;
  /** Opens a new game with the host settings from the profile. */
  host(): void;
  join(code: string): void;
  cancel(): void;
  session(): OnlineSession | null;
  leave(): void;
  resumeFlight(): void;
  /** Talk button in the lobby: toggles the microphone. */
  toggleTalk(): void;
  touch(): boolean;
}

type Screen =
  | 'callsign'
  | 'main'
  | 'solo'
  | 'howto'
  | 'settings'
  | 'online'
  | 'host'
  | 'code'
  | 'consent'
  | 'connecting'
  | 'lobby'
  | 'online-pause'
  | 'board'
  | 'pause'
  | 'result'
  | 'nogl';

const DIFFICULTY_LABEL: Record<Difficulty, string> = { rookie: 'Rookie', pilot: 'Pilot', ace: 'Ace' };

export function formatScore(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

/** The yellow menu screens. */
export class Menu {
  private screen: Screen = 'main';
  private back: Screen | null = null;
  private result: ResultInfo | null = null;
  private padPrev = { up: false, down: false, a: false, b: false };
  private boardLevel: LevelId;
  private onlineStatus = '';
  /** Where Settings returns to: the main menu or the pause menu. */
  private settingsReturn: Screen = 'main';
  /** Online: what to do once the pilot agreed to the radio rules. */
  private afterConsent: (() => void) | null = null;
  private listTimer = 0;
  private listNotice = '';
  private connect = { title: '', text: '', failed: false };
  private lastNext = '';
  private onlineCount = -1;
  /** Invite link opened before a callsign was chosen. */
  private pendingJoin = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly profile: Profile,
    private readonly h: MenuHandlers,
  ) {
    this.boardLevel = profile.solo.level;
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('input', (e) => this.onInput(e));
    root.addEventListener('keydown', (e) => this.onKey(e));
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
  }

  get current(): Screen {
    return this.screen;
  }

  show(screen: Screen, result?: ResultInfo): void {
    if (result) this.result = result;
    if (screen !== 'online') this.stopList();
    this.screen = screen;
    this.root.hidden = false;
    this.root.innerHTML = this.render(screen);
    this.root.scrollTop = 0;
    const first =
      (this.root.querySelector('[data-focus]') as HTMLElement | null) ??
      (this.root.querySelector('.mi:not([aria-disabled="true"])') as HTMLElement | null);
    first?.focus({ preventScroll: true });
    if (screen === 'board') this.loadBoard();
    if (screen === 'online') this.startList();
    if (screen === 'main') this.loadCount();
  }

  /** "who is online?" shows the number of pilots online next to it. */
  private loadCount(): void {
    void this.h.online.list().then((res) => {
      this.onlineCount = res.ok ? res.online : -1;
      const el = this.root.querySelector('#wio-count');
      if (el && this.screen === 'main') {
        el.textContent = res.ok && res.online > 0 ? `${res.online} online` : '';
        (el as HTMLElement).hidden = !(res.ok && res.online > 0);
      }
    });
  }

  /** Invite link: joins that game, after the callsign and the radio rules if needed. */
  joinFromLink(code: string): void {
    if (!this.profile.callsign) {
      this.pendingJoin = code;
      return;
    }
    this.listNotice = '';
    this.show('online');
    this.withConsent(() => this.h.online.join(code));
  }

  /** Shows the game list and keeps it fresh while it is on screen. */
  showList(notice = ''): void {
    this.listNotice = notice;
    this.show('online');
  }

  private startList(): void {
    this.stopList();
    const load = () => {
      void this.h.online.list().then((res) => {
        if (this.screen !== 'online') return;
        const { count, list } = gamesHtml(res);
        const c = this.root.querySelector('#on-count');
        const l = this.root.querySelector('#on-games');
        if (c) c.textContent = count;
        if (l) {
          // Keep the focused Join button focused across refreshes.
          const focused = (document.activeElement as HTMLElement | null)?.dataset.val;
          l.innerHTML = list;
          if (focused) (l.querySelector(`[data-val="${focused}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
        }
      });
    };
    load();
    this.listTimer = window.setInterval(load, 4000);
  }

  private stopList(): void {
    if (this.listTimer) window.clearInterval(this.listTimer);
    this.listTimer = 0;
  }

  /** Online: progress while joining. */
  connecting(title: string, text: string, failed = false): void {
    this.connect = { title, text, failed };
    this.show('connecting');
  }

  /** Online: something in the lobby changed. Redraws it and keeps the focus. */
  onlineChanged(): void {
    if (this.root.hidden || this.screen !== 'lobby') return;
    const a = document.activeElement as HTMLElement | null;
    const act = a?.dataset.act;
    const val = a?.dataset.val;
    const top = this.root.scrollTop;
    this.root.innerHTML = this.render('lobby');
    this.root.scrollTop = top;
    if (act) {
      const sel = val ? `[data-act="${act}"][data-val="${CSS.escape(val)}"]` : `[data-act="${act}"]`;
      (this.root.querySelector(sel) as HTMLElement | null)?.focus({ preventScroll: true });
    }
  }

  /** Online: who talks changed. Updates only the pilot list and the mic line. */
  radioChanged(): void {
    if (this.root.hidden || this.screen !== 'lobby') return;
    const s = this.h.online.session();
    if (!s) return;
    const box = this.root.querySelector('#on-pilots');
    if (box) {
      const focused = (document.activeElement as HTMLElement | null)?.dataset.val;
      box.innerHTML = pilotsHtml(s);
      if (focused) (box.querySelector(`[data-val="${CSS.escape(focused)}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
    }
    const mic = this.root.querySelector('#on-mic');
    if (mic) mic.textContent = micLine(s, this.h.online.touch());
    const talk = this.root.querySelector('#on-talk');
    if (talk) {
      talk.setAttribute('aria-pressed', String(s.talking));
      talk.textContent = s.talking ? 'Mic live' : 'Talk';
    }
    const n = this.root.querySelector('#on-notice') as HTMLElement | null;
    if (n) {
      n.textContent = s.notice;
      n.hidden = !s.notice;
    }
  }

  /** Called every frame: keeps the next-round countdown current. */
  tick(): void {
    if (this.root.hidden || this.screen !== 'lobby') return;
    const s = this.h.online.session();
    if (!s) return;
    const line = nextLine(s);
    if (line === this.lastNext) return;
    this.lastNext = line;
    const el = this.root.querySelector('#on-next');
    if (el) el.textContent = line;
    const start = this.root.querySelector('[data-act="l-start"]');
    if (start) start.textContent = s.match.secondsToNext() >= 0 ? 'Start now' : 'Start the round';
  }

  /** Updates the online line on the result screen once the server answers. */
  setOnlineStatus(text: string): void {
    this.onlineStatus = text;
    const el = this.root.querySelector('#online-status');
    if (el) el.textContent = text;
  }

  private loadBoard(): void {
    const level = this.boardLevel;
    void this.h.loadBoard(level).then((res) => {
      if (this.screen !== 'board' || this.boardLevel !== level) return;
      const box = this.root.querySelector('#board-online');
      if (box) box.innerHTML = this.onlineTable(res);
    });
  }

  /** Lets a gamepad move through the menu: stick or d-pad, A to choose, B to go back. */
  pollGamepad(): void {
    if (!this.visible || typeof navigator.getGamepads !== 'function') return;
    let up = false;
    let down = false;
    let a = false;
    let b = false;
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      const ay = pad.axes[1] ?? 0;
      up ||= !!pad.buttons[12]?.pressed || ay < -0.6;
      down ||= !!pad.buttons[13]?.pressed || ay > 0.6;
      a ||= !!pad.buttons[0]?.pressed;
      b ||= !!pad.buttons[1]?.pressed;
    }
    if (up && !this.padPrev.up) this.moveFocus(-1);
    if (down && !this.padPrev.down) this.moveFocus(1);
    if (a && !this.padPrev.a) (document.activeElement as HTMLElement | null)?.click();
    if (b && !this.padPrev.b) this.goBack();
    this.padPrev = { up, down, a, b };
  }

  private focusables(): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')).filter(
      (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
    );
  }

  private moveFocus(dir: number): void {
    const list = this.focusables();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next = list[(i + dir + list.length) % list.length];
    next.focus();
  }

  private goBack(): void {
    if (this.screen === 'pause') {
      this.h.resume();
      return;
    }
    if (this.screen === 'online-pause') {
      this.h.online.resumeFlight();
      return;
    }
    if (this.screen === 'connecting') {
      this.h.click();
      this.h.online.cancel();
      return;
    }
    if (this.back) {
      this.h.click();
      this.show(this.back);
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'range') return;
      e.preventDefault();
      this.moveFocus(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape' && this.screen !== 'pause' && this.screen !== 'online-pause') {
      e.stopPropagation();
      this.goBack();
    } else if (e.key === 'Enter' && (e.target as HTMLElement).id === 'callsign') {
      e.preventDefault();
      this.submitCallsign();
    } else if (e.key === 'Enter' && (e.target as HTMLElement).id === 'gamecode') {
      e.preventDefault();
      this.submitCode();
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.id === 'gamecode') {
      const v = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (v !== t.value) t.value = v;
      return;
    }
    if (t.id === 'volume') {
      this.profile.settings.volume = Number(t.value) / 100;
      this.h.settingsChanged();
    }
  }

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!el || el.getAttribute('aria-disabled') === 'true') return;
    const act = el.dataset.act ?? '';
    const val = el.dataset.val ?? '';
    const p = this.profile;
    this.h.click();
    switch (act) {
      case 'go':
        if (val === 'settings') this.settingsReturn = this.screen === 'pause' || this.screen === 'online-pause' ? this.screen : 'main';
        if (val === 'online') this.listNotice = '';
        this.show(val as Screen);
        break;
      case 'host-setup':
        this.show('host');
        break;
      case 'o-level':
        p.online.level = val as LevelId;
        this.refreshHost();
        break;
      case 'o-mode':
        p.online.mode = val === 'teams' ? 'teams' : 'ffa';
        this.refreshHost();
        break;
      case 'o-public':
        p.online.public = val === 'on';
        this.refreshHost();
        break;
      case 'o-bots':
        p.online.bots = clampBots(p.online.bots + Number(val));
        this.refreshHost();
        break;
      case 'o-diff':
        p.online.difficulty = val as Difficulty;
        this.refreshHost();
        break;
      case 'host-go':
        this.withConsent(() => this.h.online.host());
        break;
      case 'join':
        this.withConsent(() => this.h.online.join(val));
        break;
      case 'code-go':
        this.submitCode();
        break;
      case 'consent-ok': {
        p.online.voiceOk = true;
        this.save();
        const next = this.afterConsent;
        this.afterConsent = null;
        if (next) next();
        else this.show('online');
        break;
      }
      case 'conn-cancel':
        this.h.online.cancel();
        break;
      case 'l-level':
      case 'l-mode':
      case 'l-bots':
      case 'l-diff':
      case 'l-public':
        this.lobbySetting(act, val);
        break;
      case 'l-start':
        this.h.online.session()?.startRound();
        break;
      case 'mute':
        this.h.online.session()?.toggleMute(val);
        break;
      case 'talk':
        this.h.online.toggleTalk();
        break;
      case 'openmic':
        this.h.online.session()?.setOpenMic(val === 'on');
        this.save();
        this.onlineChanged();
        break;
      case 'invite':
        this.invite(el);
        break;
      case 'leave':
        this.h.online.leave();
        break;
      case 'online-resume':
        this.h.online.resumeFlight();
        break;
      case 'back':
        this.goBack();
        break;
      case 'callsign-ok':
        this.submitCallsign();
        break;
      case 'level':
        p.solo.level = val as LevelId;
        this.save();
        this.show('solo');
        break;
      case 'bots':
        p.solo.bots = Math.max(1, Math.min(7, p.solo.bots + Number(val)));
        this.save();
        this.show('solo');
        break;
      case 'difficulty':
        p.solo.difficulty = val as Difficulty;
        this.save();
        this.show('solo');
        break;
      case 'launch':
        this.h.launch();
        break;
      case 'resume':
        this.h.resume();
        break;
      case 'restart':
        this.h.restart();
        break;
      case 'next':
        this.h.next();
        break;
      case 'quit':
        this.h.quit();
        break;
      case 'invert':
        p.settings.invertPitch = val === 'on';
        this.settingsChanged();
        break;
      case 'assist':
        p.settings.autoHorizon = val === 'on';
        this.settingsChanged();
        break;
      case 'quality':
        p.settings.quality = val as Quality;
        this.settingsChanged();
        break;
      case 'rename':
        this.back = 'settings';
        this.show('callsign');
        break;
      case 'board-level':
        this.boardLevel = val as LevelId;
        this.show('board');
        break;
      case 'board':
        this.boardLevel = (this.result?.level.id ?? this.boardLevel) as LevelId;
        this.show('board');
        break;
    }
  }

  /** Shows the radio rules once before the first online game. */
  private withConsent(next: () => void): void {
    if (!this.profile.callsign) {
      this.back = 'online';
      this.show('callsign');
      return;
    }
    if (this.profile.online.voiceOk) {
      next();
      return;
    }
    this.afterConsent = next;
    this.show('consent');
  }

  private refreshHost(): void {
    this.save();
    const a = document.activeElement as HTMLElement | null;
    const act = a?.dataset.act;
    const val = a?.dataset.val;
    const top = this.root.scrollTop;
    this.root.innerHTML = this.render('host');
    this.root.scrollTop = top;
    if (act) (this.root.querySelector(`[data-act="${act}"][data-val="${val}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private lobbySetting(act: string, val: string): void {
    const s = this.h.online.session();
    if (!s || !s.isHost) return;
    const cur = s.match.settings;
    if (act === 'l-level') s.setSettings({ level: val as LevelId });
    else if (act === 'l-mode') s.setSettings({ mode: val === 'teams' ? 'teams' : 'ffa' });
    else if (act === 'l-bots') s.setSettings({ bots: clampBots(cur.bots + Number(val)) });
    else if (act === 'l-diff') s.setSettings({ difficulty: val as Difficulty });
    else if (act === 'l-public') s.setPublic(val === 'on');
    // Remember the choice for the next game this pilot hosts.
    const o = this.profile.online;
    const now = s.match.settings;
    o.level = now.level;
    o.mode = now.mode;
    o.bots = now.bots;
    o.difficulty = now.difficulty;
    o.public = s.isPublic;
    this.save();
  }

  private submitCode(): void {
    const input = this.root.querySelector('#gamecode') as HTMLInputElement | null;
    const err = this.root.querySelector('#code-error') as HTMLElement | null;
    if (!input || !err) return;
    const code = input.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      err.textContent = 'A game code has 5 letters or numbers.';
      err.hidden = false;
      input.focus();
      return;
    }
    this.withConsent(() => this.h.online.join(code));
  }

  private invite(el: HTMLElement): void {
    const s = this.h.online.session();
    if (!s) return;
    const url = s.inviteLink();
    const done = (text: string) => {
      el.firstChild && (el.firstChild.textContent = text);
      window.setTimeout(() => {
        if (el.isConnected && el.firstChild) el.firstChild.textContent = 'Invite with a link ';
      }, 2500);
    };
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
    if (this.h.online.touch() && nav.share) {
      void nav.share({ title: 'iamSpacePilot', text: `Fly with me: game ${s.code}`, url }).catch(() => undefined);
      return;
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => done('Link copied '),
        () => done(`Code ${s.code} `),
      );
    } else {
      done(`Code ${s.code} `);
    }
  }

  private settingsChanged(): void {
    this.save();
    this.h.settingsChanged();
    const focusedVal = (document.activeElement as HTMLElement | null)?.dataset.val;
    const focusedAct = (document.activeElement as HTMLElement | null)?.dataset.act;
    this.show('settings');
    if (focusedAct) (this.root.querySelector(`[data-act="${focusedAct}"][data-val="${focusedVal}"]`) as HTMLElement | null)?.focus();
  }

  private save(): void {
    saveProfile(this.profile);
  }

  private submitCallsign(): void {
    const input = this.root.querySelector('#callsign') as HTMLInputElement | null;
    const err = this.root.querySelector('#callsign-error') as HTMLElement | null;
    if (!input || !err) return;
    const problem = validateCallsign(input.value);
    if (problem) {
      err.textContent = problem;
      err.hidden = false;
      input.focus();
      return;
    }
    this.profile.callsign = input.value.trim();
    this.save();
    if (this.pendingJoin) {
      const code = this.pendingJoin;
      this.pendingJoin = '';
      this.joinFromLink(code);
      return;
    }
    this.show(this.back === 'settings' ? 'settings' : this.back === 'online' ? 'online' : 'main');
  }

  private render(s: Screen): string {
    switch (s) {
      case 'callsign':
        return this.callsignScreen();
      case 'main':
        return this.mainScreen();
      case 'solo':
        return this.soloScreen();
      case 'howto':
        return this.howtoScreen();
      case 'settings':
        return this.settingsScreen();
      case 'online':
        this.back = 'main';
        return listScreen(this.listNotice);
      case 'host':
        this.back = 'online';
        return hostScreen(this.profile.online);
      case 'code':
        this.back = 'online';
        return codeScreen();
      case 'consent':
        this.back = 'online';
        return consentScreen();
      case 'connecting':
        this.back = null;
        return connectingScreen(this.connect.title, this.connect.text, this.connect.failed);
      case 'lobby': {
        this.back = null;
        const sess = this.h.online.session();
        this.lastNext = '';
        return sess ? lobbyScreen(sess, this.profile.online, this.h.online.touch()) : listScreen('');
      }
      case 'online-pause': {
        this.back = null;
        const sess = this.h.online.session();
        return sess ? onlinePauseScreen(sess) : listScreen('');
      }
      case 'board':
        return this.boardScreen();
      case 'pause':
        return this.pauseScreen();
      case 'result':
        return this.resultScreen();
      case 'nogl':
        return this.noGlScreen();
    }
  }

  private callsignScreen(): string {
    const first = !this.profile.callsign;
    this.back = first ? null : 'settings';
    return frame(
      `${wordmark()}
      <p class="m-kicker">${first ? 'Pilot registration' : 'Settings'}</p>
      <h2 class="m-title">Choose your callsign</h2>
      <p class="m-text">Your pilot name. Other pilots will see it when online flights arrive. 3 to 16 letters, numbers, - or _.</p>
      <div>
        <label class="m-hint" for="callsign">Callsign</label>
        <input id="callsign" class="m-input" data-focus maxlength="16" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(this.profile.callsign)}" placeholder="e.g. NightHawk">
        <p class="m-error" id="callsign-error" hidden></p>
      </div>
      <div class="m-list">
        <button class="mi primary" data-act="callsign-ok">${first ? 'Continue' : 'Save callsign'}</button>
        ${first ? '' : `<button class="mi" data-act="back">Back ${ARROW}</button>`}
      </div>`,
    );
  }

  private mainScreen(): string {
    this.back = null;
    const name = esc(this.profile.callsign || 'pilot');
    return frame(
      `<header class="m-hero">
        ${wordmark()}
        <p class="m-tagline">Up here, every pilot leaves a line of light behind. Some last a heartbeat, some last forever. Fly brave, fly free – the sky remembers you.</p>
        <p class="m-credit">A game by Andreas Schmoelzer<br>entirely made with AI</p>
      </header>
      <p class="m-kicker">Welcome back, ${name}</p>
      <nav class="m-list" aria-label="Main menu">
        <button class="mi" data-act="go" data-val="solo">Solo flight ${ARROW}</button>
        <button class="mi wio" data-act="go" data-val="online">who is online? <span class="tag" id="wio-count"${this.onlineCount > 0 ? '' : ' hidden'}>${this.onlineCount > 0 ? `${this.onlineCount} online` : ''}</span></button>
        <button class="mi" data-act="go" data-val="board">Leaderboard ${ARROW}</button>
        <button class="mi" data-act="go" data-val="howto">How to fly ${ARROW}</button>
        <button class="mi" data-act="go" data-val="settings">Settings ${ARROW}</button>
      </nav>`,
      `<span>v0.5 · Solo and online</span><span>Fly free. Leave light behind.</span>`,
    );
  }

  private soloScreen(): string {
    this.back = 'main';
    const p = this.profile.solo;
    const rec = this.profile.records[p.level];
    const top = this.profile.highscores[p.level]?.[0];
    const open = this.profile.unlocked;
    const levelButtons = LEVEL_ORDER.map((id) => {
      const L = LEVELS[id];
      const locked = L.index > open;
      return `<button data-act="level" data-val="${id}" aria-pressed="${p.level === id}"${locked ? ' disabled' : ''}><span class="lv-n">${L.index}</span><span class="lv-name">${L.name}</span>${locked ? '<span class="lv-lock">Locked</span>' : `<span class="lv-alt">${L.altitude}</span>`}</button>`;
    }).join('');
    const diffButtons = (['rookie', 'pilot', 'ace'] as Difficulty[])
      .map((d) => `<button data-act="difficulty" data-val="${d}" aria-pressed="${p.difficulty === d}">${DIFFICULTY_LABEL[d]}</button>`)
      .join('');
    const record = rec
      ? `Highscore on ${LEVELS[p.level].name}: ${top ? formatScore(top.score) : '–'} · ${rec.wins} ${rec.wins === 1 ? 'win' : 'wins'} in ${rec.flights} ${rec.flights === 1 ? 'flight' : 'flights'}`
      : `No flights on ${LEVELS[p.level].name} yet. Harder difficulty scores more: Rookie ×1, Pilot ×1.5, Ace ×2.`;
    return frame(
      `<p class="m-kicker">Solo flight</p>
      <h2 class="m-title">Last pilot flying wins</h2>
      <div>
        <div class="m-row"><span class="lbl">Level</span><div class="levels-grid">${levelButtons}</div></div>
        <div class="m-row"><span class="lbl">Opponents</span>
          <div class="stepper">
            <button class="btn" data-act="bots" data-val="-1" aria-label="Fewer opponents">−</button>
            <output aria-live="polite">${p.bots}</output>
            <button class="btn" data-act="bots" data-val="1" aria-label="More opponents">+</button>
          </div>
        </div>
        <div class="m-row"><span class="lbl">Difficulty</span><div class="seg">${diffButtons}</div></div>
      </div>
      <p class="m-hint">${record} Win a level to open the next one (${open} of ${LEVEL_ORDER.length} open).</p>
      <div class="m-list">
        <button class="mi primary" data-act="launch" data-focus>Launch</button>
        <button class="mi" data-act="back">Back ${ARROW}</button>
      </div>`,
    );
  }

  private howtoScreen(): string {
    this.back = 'main';
    return frame(
      `<p class="m-kicker">How to fly</p>
      <h2 class="m-title">Stay in the air. Make them hit your wall.</h2>
      <p class="m-text">Your glider leaves a wall of light. Every wall is deadly, yours too. So are the arena shield and the floor below. The shield closes in after 30 seconds. The last pilot flying wins.</p>
      <p class="m-text">The wall turns with your glider. Fly level and it stands upright. Roll 90° and it lies flat like a floor. Keep rolling and it twists into a spiral. Fly close along a wall to recharge your boost.</p>
      <p class="m-text">Your gun fires shots that fly straight through walls and only hit other gliders. They curve a little towards a glider in front of them. Three hits bring a glider down, a ring repairs one hit. Hold the trigger too long and the gun overheats.</p>
      <div class="keys-wrap">
        <table class="keys">
          <thead><tr><th>Action</th><th>Keyboard</th><th>Gamepad</th><th>Touch</th></tr></thead>
          <tbody>
            <tr><td>Turn</td><td><kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd></td><td>Left stick</td><td>Left thumb stick</td></tr>
            <tr><td>Nose down, up (flight mode)</td><td><kbd>↑</kbd> <kbd>↓</kbd> or <kbd>W</kbd> <kbd>S</kbd></td><td>Left stick</td><td>Left thumb stick</td></tr>
            <tr><td>Roll</td><td><kbd>Q</kbd> <kbd>E</kbd></td><td>LB, RB</td><td>Roll buttons</td></tr>
            <tr><td>Fire</td><td><kbd>Space</kbd> or left click</td><td>LT or X</td><td>Fire button</td></tr>
            <tr><td>Boost</td><td><kbd>⌘ Command</kbd> or <kbd>Shift</kbd></td><td>RT or A</td><td>Boost button</td></tr>
            <tr><td>Talk (online)</td><td>Hold <kbd>R</kbd></td><td>Y or d-pad up</td><td>Mic button</td></tr>
            <tr><td>Pause</td><td><kbd>Esc</kbd> or <kbd>P</kbd></td><td>Start</td><td>II button</td></tr>
          </tbody>
        </table>
      </div>
      <div class="m-list"><button class="mi" data-act="back">Back ${ARROW}</button></div>`,
    );
  }

  private settingsScreen(): string {
    this.back = this.settingsReturn;
    const s = this.profile.settings;
    const seg = (act: string, items: [string, string][], cur: string) =>
      `<div class="seg">${items.map(([v, l]) => `<button data-act="${act}" data-val="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
    return frame(
      `<p class="m-kicker">Settings</p>
      <h2 class="m-title">Settings</h2>
      <div>
        <div class="m-row"><span class="lbl">Callsign</span>
          <div class="seg"><button data-act="rename" aria-pressed="false">${esc(this.profile.callsign || 'Set callsign')}</button></div></div>
        <div class="m-row"><label for="volume">Sound</label>
          <input id="volume" class="m-range" type="range" min="0" max="100" step="5" value="${Math.round(s.volume * 100)}"></div>
        <div class="m-row"><span class="lbl">Flight mode</span>${seg('invert', [['on', 'On: ↑ nose down'], ['off', 'Off: ↑ nose up']], s.invertPitch ? 'on' : 'off')}</div>
        <div class="m-row"><span class="lbl">Auto-horizon</span>${seg('assist', [['off', 'Off'], ['on', 'On']], s.autoHorizon ? 'on' : 'off')}</div>
        <div class="m-row"><span class="lbl">Graphics</span>${seg('quality', [['auto', 'Auto'], ['low', 'Low'], ['high', 'High']], s.quality)}</div>
      </div>
      <p class="m-hint">Flight mode steers like a plane: arrow up (or stick forward) lowers the nose. Auto-horizon levels your ship slowly when you are not rolling.</p>
      <div class="m-list"><button class="mi" data-act="back">Back ${ARROW}</button></div>`,
    );
  }

  private pauseScreen(): string {
    this.back = null;
    return frame(
      `<p class="m-kicker">${esc(LEVELS[this.profile.solo.level].name)}</p>
      <h2 class="m-title">Paused</h2>
      <div class="m-list">
        <button class="mi primary" data-act="resume">Resume</button>
        <button class="mi" data-act="restart">Restart ${ARROW}</button>
        <button class="mi" data-act="go" data-val="settings">Settings ${ARROW}</button>
        <button class="mi" data-act="quit">Main menu ${ARROW}</button>
      </div>`,
    );
  }

  private resultScreen(): string {
    this.back = null;
    const r = this.result;
    if (!r) return this.mainScreen();
    const sc = r.score;
    const parts = [`${sc.time.toFixed(1)} s × ${POINTS.perSecond}`];
    if (sc.outlasted) parts.push(`${sc.outlasted} outlasted × ${POINTS.perPilotOutlasted}`);
    if (sc.cutoffs) parts.push(`${sc.cutoffs} hit your wall × ${POINTS.perCutoff}`);
    if (sc.shotDowns) parts.push(`${sc.shotDowns} shot down × ${POINTS.perShotDown}`);
    if (sc.hits) parts.push(`${sc.hits} ${sc.hits === 1 ? 'hit' : 'hits'} × ${POINTS.perHit}`);
    if (sc.rings) parts.push(`${sc.rings} ${sc.rings === 1 ? 'ring' : 'rings'} × ${POINTS.perRing}`);
    if (sc.won) parts.push(`win ${POINTS.win}`);
    const factor = DIFFICULTY_FACTOR[r.difficulty];
    const local =
      r.localRank === 1
        ? 'New highscore on this device.'
        : r.localRank > 0
          ? `${ordinal(r.localRank)} best on this device.`
          : `Not in this device's top ${LOCAL_TOP}.`;
    return frame(
      `<p class="m-kicker">${esc(r.level.name)} · ${sc.pilots} pilots · ${DIFFICULTY_LABEL[r.difficulty]}</p>
      <h2 class="m-title">${sc.won ? 'Last pilot flying' : 'Crashed'}</h2>
      <p class="m-text">${esc(r.cause)}</p>
      <dl class="stats">
        <div><dt>Score</dt><dd>${formatScore(sc.score)}</dd></div>
        <div><dt>Time</dt><dd>${formatTime(sc.time)}</dd></div>
        <div><dt>Place</dt><dd>${sc.won ? '1st' : ordinal(sc.place)}</dd></div>
      </dl>
      <p class="m-hint">(${parts.join(' + ')}) × ${factor} for ${DIFFICULTY_LABEL[r.difficulty]}</p>
      <p class="m-text"><strong>${local}</strong> <span id="online-status">${esc(this.onlineStatus)}</span></p>
      ${sc.won && r.unlockedNow && r.next ? `<p class="m-text"><strong>Level ${r.next.index} is open: ${esc(r.next.name)}.</strong></p>` : ''}
      ${sc.won && !r.next ? '<p class="m-text"><strong>You beat all ten levels. You are a Space Pilot.</strong></p>' : ''}
      <div class="m-list">
        ${
          sc.won && r.next
            ? `<button class="mi primary" data-act="next" data-focus>Next: ${esc(r.next.name)}</button>
        <button class="mi" data-act="restart">Fly again ${ARROW}</button>`
            : '<button class="mi primary" data-act="restart" data-focus>Fly again</button>'
        }
        <button class="mi" data-act="board">Leaderboard ${ARROW}</button>
        <button class="mi" data-act="quit">Main menu ${ARROW}</button>
      </div>`,
    );
  }

  private boardScreen(): string {
    this.back = 'main';
    const level = this.boardLevel;
    const tabs = LEVEL_ORDER.map(
      (id) => `<button data-act="board-level" data-val="${id}" aria-pressed="${id === level}">${LEVELS[id].name}</button>`,
    ).join('');
    const local = this.profile.highscores[level] ?? [];
    const localRows = local
      .map(
        (e, i) =>
          `<tr><td class="num">${i + 1}</td><td class="num">${formatScore(e.score)}</td><td class="num">${formatTime(e.time)}</td><td>${e.won ? 'Win' : `${ordinal(e.place)} of ${e.pilots}`}</td><td>${DIFFICULTY_LABEL[e.difficulty]}</td><td>${esc(e.date.slice(0, 10))}</td></tr>`,
      )
      .join('');
    const localTable = local.length
      ? `<div class="keys-wrap"><table class="keys board"><thead><tr><th>#</th><th>Score</th><th>Time</th><th>Result</th><th>Difficulty</th><th>Date</th></tr></thead><tbody>${localRows}</tbody></table></div>`
      : '<p class="m-hint">No flights on this level yet.</p>';
    return frame(
      `<p class="m-kicker">Leaderboard</p>
      <h2 class="m-title">Highscores</h2>
      <div class="seg">${tabs}</div>
      <h3 class="m-sub">All pilots</h3>
      <div id="board-online"><p class="m-hint">Loading the online leaderboard…</p></div>
      <h3 class="m-sub">This device</h3>
      ${localTable}
      <p class="m-hint">Score: ${POINTS.perSecond} per second in the air, ${POINTS.perPilotOutlasted} per pilot you outlast, ${POINTS.perCutoff} per pilot that hits your wall, ${POINTS.perShotDown} per pilot you shoot down, ${POINTS.perHit} per hit, ${POINTS.perRing} per ring, ${POINTS.win} for a win. Then times 1 for Rookie, 1.5 for Pilot, 2 for Ace. Online scores are checked by replaying your flight on the server.</p>
      <div class="m-list"><button class="mi" data-act="back">Back ${ARROW}</button></div>`,
    );
  }

  private onlineTable(res: BoardResult): string {
    if (!res.ok) return `<p class="m-hint">${esc(onlineErrorText(res.error))}</p>`;
    if (!res.rows.length) return '<p class="m-hint">No online scores yet. Fly a round to be the first.</p>';
    const me = this.profile.callsign.toLowerCase();
    const rows = res.rows
      .map(
        (r, i) =>
          `<tr${r.callsign.toLowerCase() === me ? ' class="me"' : ''}><td class="num">${i + 1}</td><td>${esc(r.callsign)}</td><td class="num">${formatScore(r.score)}</td><td class="num">${formatTime(r.time)}</td><td>${esc(DIFFICULTY_LABEL[r.difficulty as Difficulty] ?? r.difficulty)}</td></tr>`,
      )
      .join('');
    return `<div class="keys-wrap"><table class="keys board"><thead><tr><th>#</th><th>Pilot</th><th>Score</th><th>Time</th><th>Difficulty</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  private noGlScreen(): string {
    this.back = null;
    return frame(
      `${wordmark()}
      <h2 class="m-title">3D graphics are switched off</h2>
      <p class="m-text">This game needs WebGL. Every current browser supports it, but it can be turned off. Check that hardware acceleration is enabled in your browser settings, then reload the page.</p>`,
    );
  }
}
