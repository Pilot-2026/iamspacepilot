import { LEVELS, LEVEL_ORDER, type LevelSpec } from '../core/levels';
import type { Difficulty, LevelId } from '../core/types';
import { saveProfile, validateCallsign, type Profile, type Quality } from '../storage/profile';

export interface ResultInfo {
  won: boolean;
  place: number;
  pilots: number;
  time: number;
  best: number;
  newBest: boolean;
  cause: string;
  level: LevelSpec;
}

export interface MenuHandlers {
  launch(): void;
  resume(): void;
  restart(): void;
  quit(): void;
  settingsChanged(): void;
  click(): void;
}

type Screen = 'callsign' | 'main' | 'solo' | 'howto' | 'settings' | 'online' | 'board' | 'pause' | 'result' | 'nogl';

const ARROW =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';

const ART = `
<div class="m-art" aria-hidden="true">
  <svg viewBox="0 0 600 800" preserveAspectRatio="xMidYMid meet">
    <path class="flow" pathLength="1000" d="M-20 700 C140 640 120 460 260 430 S520 470 470 300 S300 120 560 70"/>
    <path class="flow thin" pathLength="1000" d="M-20 744 C160 690 150 500 290 470 S560 500 500 330 S330 150 600 100"/>
    <polygon class="flow-head" points="573.7,67.4 551.9,80.7 548.5,63.1"/>
  </svg>
</div>`;

const DIFFICULTY_LABEL: Record<Difficulty, string> = { rookie: 'Rookie', pilot: 'Pilot', ace: 'Ace' };

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function wordmark(tag = 'h1'): string {
  return `<${tag} class="wordmark" aria-label="iamSpacePilot"><span class="w1">iam</span><span class="w2">Space</span><span class="w3">Pilot</span></${tag}>`;
}

/** The yellow menu screens. */
export class Menu {
  private screen: Screen = 'main';
  private back: Screen | null = null;
  private result: ResultInfo | null = null;
  private padPrev = { up: false, down: false, a: false, b: false };
  /** Where Settings returns to: the main menu or the pause menu. */
  private settingsReturn: Screen = 'main';

  constructor(
    private readonly root: HTMLElement,
    private readonly profile: Profile,
    private readonly h: MenuHandlers,
  ) {
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

  show(screen: Screen, result?: ResultInfo): void {
    if (result) this.result = result;
    this.screen = screen;
    this.root.hidden = false;
    this.root.innerHTML = this.render(screen);
    this.root.scrollTop = 0;
    const first =
      (this.root.querySelector('[data-focus]') as HTMLElement | null) ??
      (this.root.querySelector('.mi:not([aria-disabled="true"])') as HTMLElement | null);
    first?.focus({ preventScroll: true });
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
    } else if (e.key === 'Escape' && this.screen !== 'pause') {
      e.stopPropagation();
      this.goBack();
    } else if (e.key === 'Enter' && (e.target as HTMLElement).id === 'callsign') {
      e.preventDefault();
      this.submitCallsign();
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
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
        if (val === 'settings') this.settingsReturn = this.screen === 'pause' ? 'pause' : 'main';
        this.show(val as Screen);
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
    this.show(this.back === 'settings' ? 'settings' : 'main');
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
        return this.soonScreen(
          'Online flights',
          'Online is coming',
          'Up to 8 pilots per match. Public or private rooms. Free-for-all or two teams of four. Live voice radio with everyone in the match.',
        );
      case 'board':
        return this.soonScreen(
          'Leaderboard',
          'Leaderboard is coming',
          'Best times and wins of every pilot, open for everyone to see. Records will be checked by the server before they count.',
        );
      case 'pause':
        return this.pauseScreen();
      case 'result':
        return this.resultScreen();
      case 'nogl':
        return this.noGlScreen();
    }
  }

  private frame(inner: string, foot = ''): string {
    return `<section class="m-screen"><div class="m-col">${inner}${foot ? `<div class="m-foot">${foot}</div>` : ''}</div>${ART}</section>`;
  }

  private callsignScreen(): string {
    const first = !this.profile.callsign;
    this.back = first ? null : 'settings';
    return this.frame(
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
    return this.frame(
      `${wordmark()}
      <p class="m-kicker">Welcome back, ${name}</p>
      <nav class="m-list" aria-label="Main menu">
        <button class="mi" data-act="go" data-val="solo">Solo flight ${ARROW}</button>
        <button class="mi" data-act="go" data-val="online">Online <span class="tag">Soon</span></button>
        <button class="mi" data-act="go" data-val="board">Leaderboard <span class="tag">Soon</span></button>
        <button class="mi" data-act="go" data-val="howto">How to fly ${ARROW}</button>
        <button class="mi" data-act="go" data-val="settings">Settings ${ARROW}</button>
      </nav>`,
      `<span>Solo test build · v0.1</span><span>Fly free. Leave light behind.</span>`,
    );
  }

  private soloScreen(): string {
    this.back = 'main';
    const p = this.profile.solo;
    const rec = this.profile.records[p.level];
    const levelButtons = LEVEL_ORDER.map((id) => {
      const L = LEVELS[id];
      return `<button data-act="level" data-val="${id}" aria-pressed="${p.level === id}">${L.name} · ${L.altitude}</button>`;
    }).join('');
    const diffButtons = (['rookie', 'pilot', 'ace'] as Difficulty[])
      .map((d) => `<button data-act="difficulty" data-val="${d}" aria-pressed="${p.difficulty === d}">${DIFFICULTY_LABEL[d]}</button>`)
      .join('');
    const record = rec
      ? `Best on ${LEVELS[p.level].name}: ${formatTime(rec.bestTime)} · ${rec.wins} ${rec.wins === 1 ? 'win' : 'wins'} in ${rec.flights} ${rec.flights === 1 ? 'flight' : 'flights'}`
      : `No flights on ${LEVELS[p.level].name} yet.`;
    return this.frame(
      `<p class="m-kicker">Solo flight</p>
      <h2 class="m-title">Last pilot flying wins</h2>
      <div>
        <div class="m-row"><span class="lbl">Level</span><div class="seg">${levelButtons}</div></div>
        <div class="m-row"><span class="lbl">Opponents</span>
          <div class="stepper">
            <button class="btn" data-act="bots" data-val="-1" aria-label="Fewer opponents">−</button>
            <output aria-live="polite">${p.bots}</output>
            <button class="btn" data-act="bots" data-val="1" aria-label="More opponents">+</button>
          </div>
        </div>
        <div class="m-row"><span class="lbl">Difficulty</span><div class="seg">${diffButtons}</div></div>
      </div>
      <p class="m-hint">${record}</p>
      <div class="m-list">
        <button class="mi primary" data-act="launch" data-focus>Launch</button>
        <button class="mi" data-act="back">Back ${ARROW}</button>
      </div>`,
    );
  }

  private howtoScreen(): string {
    this.back = 'main';
    return this.frame(
      `<p class="m-kicker">How to fly</p>
      <h2 class="m-title">Stay in the air. Make them hit your wall.</h2>
      <p class="m-text">Your glider leaves a wall of light. Every wall is deadly, yours too. So are the arena shield and the floor below. The shield closes in after 30 seconds. The last pilot flying wins.</p>
      <p class="m-text">The wall turns with your glider. Fly level and it stands upright. Roll 90° and it lies flat like a floor. Keep rolling and it twists into a spiral. Fly close along a wall to recharge your boost.</p>
      <div class="keys-wrap">
        <table class="keys">
          <thead><tr><th>Action</th><th>Keyboard</th><th>Gamepad</th><th>Touch</th></tr></thead>
          <tbody>
            <tr><td>Turn</td><td><kbd>A</kbd> <kbd>D</kbd> or <kbd>←</kbd> <kbd>→</kbd></td><td>Left stick</td><td>Left thumb stick</td></tr>
            <tr><td>Nose up, down</td><td><kbd>W</kbd> <kbd>S</kbd> or <kbd>↑</kbd> <kbd>↓</kbd></td><td>Left stick</td><td>Left thumb stick</td></tr>
            <tr><td>Roll</td><td><kbd>Q</kbd> <kbd>E</kbd></td><td>LB, RB</td><td>Roll buttons</td></tr>
            <tr><td>Boost</td><td><kbd>Space</kbd></td><td>RT or A</td><td>Boost button</td></tr>
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
    return this.frame(
      `<p class="m-kicker">Settings</p>
      <h2 class="m-title">Settings</h2>
      <div>
        <div class="m-row"><span class="lbl">Callsign</span>
          <div class="seg"><button data-act="rename" aria-pressed="false">${esc(this.profile.callsign || 'Set callsign')}</button></div></div>
        <div class="m-row"><label for="volume">Sound</label>
          <input id="volume" class="m-range" type="range" min="0" max="100" step="5" value="${Math.round(s.volume * 100)}"></div>
        <div class="m-row"><span class="lbl">Invert pitch</span>${seg('invert', [['off', 'Off'], ['on', 'On']], s.invertPitch ? 'on' : 'off')}</div>
        <div class="m-row"><span class="lbl">Auto-horizon</span>${seg('assist', [['off', 'Off'], ['on', 'On']], s.autoHorizon ? 'on' : 'off')}</div>
        <div class="m-row"><span class="lbl">Graphics</span>${seg('quality', [['auto', 'Auto'], ['low', 'Low'], ['high', 'High']], s.quality)}</div>
      </div>
      <p class="m-hint">Auto-horizon levels your glider slowly when you are not rolling. Invert pitch swaps nose up and down.</p>
      <div class="m-list"><button class="mi" data-act="back">Back ${ARROW}</button></div>`,
    );
  }

  private soonScreen(kicker: string, title: string, text: string): string {
    this.back = 'main';
    return this.frame(
      `<p class="m-kicker">${kicker}</p>
      <h2 class="m-title">${title}</h2>
      <p class="m-text">${text}</p>
      <div class="m-list"><button class="mi" data-act="back">Back ${ARROW}</button></div>`,
    );
  }

  private pauseScreen(): string {
    this.back = null;
    return this.frame(
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
    const place = r.won ? '1st' : `${r.place}${['th', 'st', 'nd', 'rd'][r.place > 3 ? 0 : r.place]}`;
    return this.frame(
      `<p class="m-kicker">${esc(r.level.name)} · ${r.pilots} pilots</p>
      <h2 class="m-title">${r.won ? 'Last pilot flying' : 'Crashed'}</h2>
      <p class="m-text">${esc(r.cause)}</p>
      <dl class="stats">
        <div><dt>Time</dt><dd>${formatTime(r.time)}</dd></div>
        <div><dt>Place</dt><dd>${place}</dd></div>
        <div><dt>${r.newBest ? 'New best' : 'Best'}</dt><dd>${formatTime(r.best)}</dd></div>
      </dl>
      <div class="m-list">
        <button class="mi primary" data-act="restart" data-focus>Fly again</button>
        <button class="mi" data-act="quit">Main menu ${ARROW}</button>
      </div>`,
    );
  }

  private noGlScreen(): string {
    this.back = null;
    return this.frame(
      `${wordmark()}
      <h2 class="m-title">3D graphics are switched off</h2>
      <p class="m-text">This game needs WebGL. Every current browser supports it, but it can be turned off. Check that hardware acceleration is enabled in your browser settings, then reload the page.</p>`,
    );
  }
}
