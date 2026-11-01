import { LEVELS, LEVEL_ORDER } from '../core/levels';
import { SHIPS } from '../core/ships';
import type { Difficulty } from '../core/types';
import type { GameListing, ListResult } from '../net/games';
import { GAME_VERSION, MAX_PILOTS, type MatchSettings, type Mode } from '../online/match';
import type { OnlineSession } from '../online/session';
import type { OnlinePrefs } from '../storage/profile';
import { ARROW, esc, frame, ordinal } from './html';

/** The yellow screens of online play: game list, hosting, joining, lobby and round results. */

export const MODE_LABEL: Record<Mode, string> = { ffa: 'Free-for-all', teams: '2 teams' };
export const TEAM_NAMES = ['Sun', 'Ice'];
const DIFF_LABEL: Record<Difficulty, string> = { rookie: 'Rookie', pilot: 'Pilot', ace: 'Ace' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function listScreen(notice: string): string {
  return frame(
    `<p class="m-kicker">Online · up to ${MAX_PILOTS} pilots per game</p>
    <h2 class="m-title">Who is online?</h2>
    ${notice ? `<p class="m-error" role="status">${esc(notice)}</p>` : ''}
    <p class="m-text" id="on-count" aria-live="polite">Looking for pilots…</p>
    <div id="on-games" class="games"></div>
    <div class="m-list">
      <button class="mi primary" data-act="host-setup" data-focus>Host a game</button>
      <button class="mi" data-act="go" data-val="code">Join with code ${ARROW}</button>
      <button class="mi" data-act="back">Back ${ARROW}</button>
    </div>
    <p class="m-hint">Private games are not in this list. Ask their host for the code. Every game has live voice radio.</p>`,
  );
}

function gameCard(g: GameListing): string {
  const L = LEVELS[g.level];
  const full = g.players >= g.max;
  const old = g.protocol !== GAME_VERSION;
  const state = g.status === 'flying' ? `Round ${g.round} flying` : 'In the lobby';
  const btn = old
    ? '<button class="btn g-join" disabled>Other version</button>'
    : full
      ? '<button class="btn g-join" disabled>Full</button>'
      : `<button class="btn g-join" data-act="join" data-val="${esc(g.code)}" aria-label="Join ${esc(g.host)}'s game">Join</button>`;
  return `<div class="game">
    <div class="g-main">
      <span class="g-host">${esc(g.host)}</span>
      <span class="g-meta">L${L ? L.index : '?'} ${esc(L ? L.name : g.levelName)} · ${MODE_LABEL[g.mode] ?? g.mode}</span>
    </div>
    <div class="g-state"><span class="g-count">${g.players}/${g.max}</span><span>${state}</span></div>
    ${btn}
  </div>`;
}

/** Text for the pilot count and the list of games. */
export function gamesHtml(res: ListResult): { count: string; list: string } {
  if (!res.ok) {
    const count =
      res.error === 'not-configured'
        ? 'Online games are not set up on this server yet.'
        : res.error === 'offline'
          ? 'No connection. Check your internet.'
          : 'The game list is not reachable right now.';
    return { count, list: '' };
  }
  const games = res.games;
  const count =
    res.online === 0
      ? 'Nobody is online right now. Host a game and others can join.'
      : `${plural(res.online, 'pilot')} online${games.length ? ` · ${plural(games.length, 'open game')}` : ''}`;
  const list = games.length
    ? games.map(gameCard).join('')
    : `<p class="m-hint">${res.online ? 'All running games are private.' : 'No games yet.'} Host one: bots fly with you until others join.</p>`;
  return { count, list };
}

/** Level, mode, bots and difficulty rows. act is the prefix of the button actions. */
function settingsRows(act: string, s: MatchSettings, pub: boolean | null): string {
  const levels = LEVEL_ORDER.map((id) => {
    const L = LEVELS[id];
    return `<button data-act="${act}-level" data-val="${id}" aria-pressed="${s.level === id}"><span class="lv-n">${L.index}</span><span class="lv-name">${L.name}</span><span class="lv-alt">${L.altitude}</span></button>`;
  }).join('');
  const seg = (name: string, items: [string, string][], cur: string) =>
    `<div class="seg">${items.map(([v, l]) => `<button data-act="${act}-${name}" data-val="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
  return `<div>
    <div class="m-row"><span class="lbl">Level</span><div class="levels-grid">${levels}</div></div>
    <div class="m-row"><span class="lbl">Mode</span>${seg('mode', [['ffa', MODE_LABEL.ffa], ['teams', MODE_LABEL.teams]], s.mode)}</div>
    ${pub === null ? '' : `<div class="m-row"><span class="lbl">Game</span>${seg('public', [['on', 'Public'], ['off', 'Private']], pub ? 'on' : 'off')}</div>`}
    <div class="m-row"><span class="lbl">Bots</span>
      <div class="stepper">
        <button class="btn" data-act="${act}-bots" data-val="-1" aria-label="Fewer bots">−</button>
        <output aria-live="polite">${s.bots}</output>
        <button class="btn" data-act="${act}-bots" data-val="1" aria-label="More bots">+</button>
      </div>
    </div>
    <div class="m-row"><span class="lbl">Skill and speed</span>${seg('diff', (['rookie', 'pilot', 'ace'] as Difficulty[]).map((d) => [d, DIFF_LABEL[d]]), s.difficulty)}</div>
  </div>`;
}

export function hostScreen(o: OnlinePrefs): string {
  return frame(
    `<p class="m-kicker">Host a game</p>
    <h2 class="m-title">Your sky, your rules</h2>
    ${settingsRows('o', { level: o.level, mode: o.mode, bots: o.bots, difficulty: o.difficulty }, o.public)}
    <p class="m-hint">Public games show up under “who is online?”. Private games can only be joined with their code. Bots fill empty seats up to ${MAX_PILOTS} pilots, people always get a seat first. In team games your own team's walls let you through.</p>
    <div class="m-list">
      <button class="mi primary" data-act="host-go" data-focus>Open the game</button>
      <button class="mi" data-act="back">Back ${ARROW}</button>
    </div>`,
  );
}

export function codeScreen(): string {
  return frame(
    `<p class="m-kicker">Join with code</p>
    <h2 class="m-title">Enter the game code</h2>
    <p class="m-text">The host sees the code in their lobby. It has 5 letters or numbers.</p>
    <div>
      <label class="m-hint" for="gamecode">Game code</label>
      <input id="gamecode" class="m-input code" data-focus maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE">
      <p class="m-error" id="code-error" hidden></p>
    </div>
    <div class="m-list">
      <button class="mi primary" data-act="code-go">Join</button>
      <button class="mi" data-act="back">Back ${ARROW}</button>
    </div>`,
  );
}

export function consentScreen(): string {
  return frame(
    `<p class="m-kicker">Live voice radio</p>
    <h2 class="m-title">You are on the radio</h2>
    <p class="m-text">Every online game has live voice radio. All pilots in the game hear you while you talk, also pilots you do not know.</p>
    <ul class="m-points">
      <li>Hold <kbd>R</kbd> to talk, or <kbd>Y</kbd> on a gamepad. On a touch screen, tap the mic button.</li>
      <li>Mute any pilot with one tap. Only you stop hearing them.</li>
      <li>Be fair: no insults, no hate, no personal details.</li>
      <li>The radio is not recorded.</li>
    </ul>
    <p class="m-hint">Your browser asks for the microphone the first time you talk. Voice radio is for pilots aged 16 and over; younger pilots only with a parent's permission. By continuing you agree to the <a href="/privacy.html" target="_blank" rel="noopener">rules, privacy and terms</a>.</p>
    <div class="m-list">
      <button class="mi primary" data-act="consent-ok" data-focus>Agree and continue</button>
      <button class="mi" data-act="back">Back ${ARROW}</button>
    </div>`,
  );
}

export function connectingScreen(title: string, text: string, failed: boolean): string {
  return frame(
    `<p class="m-kicker">Online</p>
    <h2 class="m-title">${esc(title)}</h2>
    <p class="m-text" role="status">${esc(text)}</p>
    ${failed ? '' : '<div class="m-wait" aria-hidden="true"><i></i><i></i><i></i></div>'}
    <div class="m-list">
      <button class="mi${failed ? ' primary' : ''}" data-act="conn-cancel" data-focus>${failed ? 'Back to the list' : `Cancel ${ARROW}`}</button>
    </div>`,
  );
}

/** Headline of the results: from this pilot's point of view. */
function resultTitle(s: OnlineSession): string {
  const r = s.lastResult;
  if (!r) return '';
  const me = r.local;
  if (r.team >= 0) {
    const mine = me >= 0 ? r.pilots[me].team : -1;
    return mine === r.team ? 'Your team wins' : `Team ${TEAM_NAMES[r.team] ?? r.team + 1} wins`;
  }
  if (r.winner >= 0) return r.winner === me ? 'You win' : `${r.pilots[r.winner]?.name ?? 'A pilot'} wins`;
  const left = r.places.map((p, i) => (p === 1 ? i : -1)).filter((i) => i >= 0);
  if (left.length && left.every((i) => r.pilots[i]?.bot)) return 'The bots win';
  return 'Nobody made it';
}

function standings(s: OnlineSession): string {
  const r = s.lastResult;
  if (!r) return '';
  const order = r.pilots.map((_, i) => i).sort((a, b) => (r.places[a] || 99) - (r.places[b] || 99) || a - b);
  const teams = r.team >= 0 || r.pilots.some((p) => p.team >= 0);
  const rows = order
    .map((i) => {
      const p = r.pilots[i];
      const place = r.places[i] || 0;
      const wins = p.bot ? '' : String(s.wins.get(p.identity) ?? 0);
      return `<tr${i === r.local ? ' class="me"' : ''}><td class="num">${place ? ordinal(place) : '–'}</td><td>${esc(p.name)}${p.bot ? ' <span class="m-hint">bot</span>' : ''}</td>${teams ? `<td>${TEAM_NAMES[p.team] ?? ''}</td>` : ''}<td class="num">${wins}</td></tr>`;
    })
    .join('');
  return `<div class="keys-wrap"><table class="keys board"><thead><tr><th>Place</th><th>Pilot</th>${teams ? '<th>Team</th>' : ''}<th>Wins</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** The line about the next round, refreshed every second. */
export function nextLine(s: OnlineSession): string {
  const m = s.match;
  if (m.flying && m.local >= 0) return `Round ${m.round} is flying.`;
  if (m.running) return `Round ${m.round} is flying. You fly from the next round. Talk to the others on the radio meanwhile.`;
  const sec = m.secondsToNext();
  if (sec >= 0) return `Next round in ${sec} s`;
  if (s.isHost) return 'Start the round when everyone is in. Pilots can still join later.';
  return `Waiting for ${m.hostName() || 'the host'} to start the round.`;
}

/** Pilots in the room with their radio state. */
export function pilotsHtml(s: OnlineSession): string {
  const items = s
    .pilots()
    .map((p) => {
      const tags = `${p.host ? '<span class="tag">Host</span>' : ''}${p.local ? '<span class="tag">You</span>' : ''}`;
      const right = p.local
        ? `<span class="p-mic${p.live ? ' live' : ''}">${p.live ? 'Mic live' : 'Mic off'}</span>`
        : `<button class="btn p-mute" data-act="mute" data-val="${esc(p.identity)}" aria-pressed="${p.muted}" aria-label="${p.muted ? 'Unmute' : 'Mute'} ${esc(p.name)}">${p.muted ? 'Muted' : 'Mute'}</button>`;
      return `<li class="pilot${p.speaking && !p.muted ? ' speaking' : ''}">
        <span class="p-wave" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="p-name">${esc(p.name)}</span>
        <span class="p-tags">${tags}</span>
        <span class="p-wins">${esc(SHIPS[p.ship].name)}${p.wins ? ` · ${plural(p.wins, 'win')}` : ''}</span>
        ${right}
      </li>`;
    })
    .join('');
  return `<ul class="pilots">${items}</ul>`;
}

/** Microphone hint under the radio buttons. */
export function micLine(s: OnlineSession, touch: boolean): string {
  if (s.micProblem === 'denied') return 'The browser blocked the microphone. Allow it in the site settings to talk. You can still hear everyone.';
  if (s.micProblem) return 'No microphone found. You can still hear everyone.';
  if (s.audioBlocked) return 'Tap anywhere to hear the radio.';
  if (touch) return 'Tap Talk to open your mic, tap again to close it.';
  return 'Hold R to talk (Y on a gamepad), or use the Talk button.';
}

export function lobbyScreen(s: OnlineSession, prefs: OnlinePrefs, touch: boolean): string {
  const m = s.match;
  const set = m.settings;
  const L = LEVELS[set.level];
  const count = s.pilots().length;
  const title =
    (!m.running && resultTitle(s)) || (m.running ? (m.flying && m.local >= 0 ? `Round ${m.round}` : `Round ${m.round} is flying`) : m.round ? 'Lobby' : 'Ready for take-off');
  const outdated = [...s.outdated];
  const summary = `Level ${L.index} · ${L.name} · ${MODE_LABEL[set.mode]} · ${set.bots ? `up to ${plural(set.bots, 'bot')} (${DIFF_LABEL[set.difficulty]})` : 'no bots'}`;
  const host = s.isHost;
  const startLabel = m.secondsToNext() >= 0 ? 'Start now' : 'Start the round';
  return frame(
    `<p class="m-kicker">Game ${esc(s.code)} · ${s.isPublic ? 'Public' : 'Private'} · Host ${esc(m.hostName())}</p>
    <h2 class="m-title">${esc(title)}</h2>
    ${!m.running ? standings(s) : ''}
    <p class="m-text"><strong id="on-next">${esc(nextLine(s))}</strong></p>
    ${host && !m.running ? `<div class="m-list"><button class="mi primary" data-act="l-start" data-focus>${startLabel}</button></div>` : ''}
    <p class="m-error" id="on-notice"${s.notice ? '' : ' hidden'}>${esc(s.notice)}</p>
    ${outdated.length ? `<p class="m-error">${esc(outdated.join(', '))} ${outdated.length === 1 ? 'runs' : 'run'} another game version. Everyone should reload the page.</p>` : ''}
    <div class="m-row"><span class="lbl">Your ship</span><div class="seg"><button data-act="hangar" aria-pressed="true">${esc(SHIPS[m.ship].name)} · change</button></div></div>
    <h3 class="m-sub">On the radio · ${count}/${MAX_PILOTS}</h3>
    <div id="on-pilots">${pilotsHtml(s)}</div>
    <div class="m-row"><span class="lbl">Radio</span>
      <div class="seg">
        <button data-act="talk" aria-pressed="${s.talking}" id="on-talk">${s.talking ? 'Mic live' : 'Talk'}</button>
        <button data-act="openmic" data-val="${prefs.openMic ? 'off' : 'on'}" aria-pressed="${prefs.openMic}">Mic always on</button>
      </div>
    </div>
    <p class="m-hint" id="on-mic">${esc(micLine(s, touch))}</p>
    ${
      host && !m.running
        ? `<h3 class="m-sub">Next round</h3>${settingsRows('l', set, s.isPublic)}`
        : `<p class="m-hint">${m.running ? 'This round' : 'Next round'}: ${esc(summary)}. The host picks the level.</p>`
    }
    <div class="m-list">
      <button class="mi" data-act="invite" id="on-invite"${host && !m.running ? '' : ' data-focus'}>Invite with a link ${ARROW}</button>
      <button class="mi" data-act="leave">Leave the game ${ARROW}</button>
    </div>
    <p class="m-hint">Game code: <strong class="code-badge">${esc(s.code)}</strong></p>`,
  );
}

export function onlinePauseScreen(s: OnlineSession): string {
  const m = s.match;
  const alive = m.world && m.local >= 0 ? m.world.gliders[m.local].alive : false;
  return frame(
    `<p class="m-kicker">Game ${esc(s.code)} · Round ${m.round}</p>
    <h2 class="m-title">The round goes on</h2>
    <p class="m-text">${alive ? 'The others keep flying while this menu is open, and so does your glider. Go back quickly.' : 'The others keep flying while this menu is open.'}</p>
    <div class="m-list">
      <button class="mi primary" data-act="online-resume" data-focus>Back to the flight</button>
      <button class="mi" data-act="go" data-val="settings">Settings ${ARROW}</button>
      <button class="mi" data-act="leave">Leave the game ${ARROW}</button>
    </div>`,
  );
}

/** Clamps a bots value. */
export function clampBots(n: number): number {
  return Math.max(0, Math.min(MAX_PILOTS - 1, n));
}
