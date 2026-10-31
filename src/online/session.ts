import type { CrashInfo } from '../core/types';
import type { World } from '../core/world';
import { hostGame, joinGame, updateGame, type Ticket } from '../net/games';
import type { Profile } from '../storage/profile';
import { LiveKitLink, type LinkStatus, type RadioEntry } from './livekit';
import { OnlineMatch, type MatchSettings, type Msg, type RoundResult } from './match';

export interface SessionEvents {
  /** Pilots, host, settings or the round state changed. */
  lobby(): void;
  /** Someone started or stopped talking, or a mute changed. */
  radio(): void;
  /** A remote pilot keyed their radio. */
  keyed(): void;
  roundStart(world: World, local: number): void;
  roundEnd(result: RoundResult): void;
  crash(id: number, crash: CrashInfo): void;
  /** The connection ended without the pilot leaving. */
  closed(reason: string): void;
}

export interface LobbyPilot extends RadioEntry {
  host: boolean;
  wins: number;
}

export type OpenResult = { ok: true; session: OnlineSession } | { ok: false; error: string };

/**
 * One online game from this device's point of view: the ticket from the
 * server, the LiveKit room (game data and voice), the match logic and the
 * public game list entry, which the host keeps up to date.
 */
export class OnlineSession {
  readonly code: string;
  isPublic: boolean;
  match!: OnlineMatch;
  private link!: LiveKitLink;
  /** Wins per pilot identity in this game. */
  readonly wins = new Map<string, number>();
  lastResult: RoundResult | null = null;
  /** A short line for the lobby, like "Reconnecting…". */
  notice = '';
  /** Pilots on another game version. */
  readonly outdated = new Set<string>();
  private queue: { from: string; msg: Msg }[] = [];
  private listedAsHost: boolean;
  private listingTimer = 0;
  private speakers = new Set<string>();
  private ended = false;

  private constructor(
    private readonly profile: Profile,
    ticket: Ticket,
    private readonly ev: SessionEvents,
    hosting: boolean,
  ) {
    this.code = ticket.code;
    this.isPublic = ticket.meta.public;
    this.listedAsHost = hosting;
  }

  /** Hosts a new game (no code) or joins one by code. */
  static async open(profile: Profile, code: string | null, ev: SessionEvents): Promise<OpenResult> {
    const o = profile.online;
    const res = code
      ? await joinGame({ callsign: profile.callsign, key: profile.pilotKey, code })
      : await hostGame({
          callsign: profile.callsign,
          key: profile.pilotKey,
          level: o.level,
          mode: o.mode,
          public: o.public,
          bots: o.bots,
          difficulty: o.difficulty,
        });
    if (!res.ok) return res;
    const t = res.ticket;
    const s = new OnlineSession(profile, t, ev, !code);
    try {
      s.link = await LiveKitLink.connect(t.url, t.token, {
        message: (from, msg) => (s.match ? s.match.receive(from, msg) : s.queue.push({ from, msg })),
        peers: () => s.match?.peersChanged(),
        radio: () => s.radioChanged(),
        status: (st, reason) => s.linkStatus(st, reason),
      });
    } catch (e) {
      console.warn('connect failed', e);
      return { ok: false, error: 'livekit' };
    }
    const settings: MatchSettings = {
      level: t.meta.level,
      mode: t.meta.mode,
      bots: t.meta.bots,
      difficulty: code ? 'pilot' : o.difficulty,
    };
    s.match = new OnlineMatch(s.link, { name: profile.callsign, assist: profile.settings.autoHorizon }, settings, {
      onLobby: () => s.lobbyChanged(),
      onRoundStart: (w, local) => {
        s.lastResult = null;
        s.markListing();
        ev.roundStart(w, local);
      },
      onRoundEnd: (r) => {
        s.lastResult = r;
        s.countWins(r);
        s.markListing();
        ev.roundEnd(r);
      },
      onCrash: (id, crash) => ev.crash(id, crash),
      onVersionMismatch: (name) => {
        s.outdated.add(name);
        ev.lobby();
      },
    });
    s.match.start();
    for (const q of s.queue.splice(0)) s.match.receive(q.from, q.msg);
    if (profile.online.openMic) s.link.setTalking(true);
    return { ok: true, session: s };
  }

  get isHost(): boolean {
    return this.match.isHost;
  }

  get talking(): boolean {
    return this.link.talking;
  }

  get micProblem(): string {
    return this.link.micProblem;
  }

  get audioBlocked(): boolean {
    return this.link.audioBlocked;
  }

  /** Link that opens this game directly. */
  inviteLink(): string {
    return `${location.origin}/?join=${this.code}`;
  }

  /** Everybody in the room with radio state, host first. */
  pilots(): LobbyPilot[] {
    const host = this.match.hostIdentity;
    const order = new Map(this.link.peers().map((p) => [p.identity, p.joinedAt]));
    return this.link
      .radio()
      .map((r) => ({ ...r, host: r.identity === host, wins: this.wins.get(r.identity) ?? 0 }))
      .sort((a, b) => (order.get(a.identity) ?? 0) - (order.get(b.identity) ?? 0) || a.identity.localeCompare(b.identity));
  }

  /** Names of remote pilots talking right now. */
  speaking(): string[] {
    return this.link
      .radio()
      .filter((r) => r.speaking && !r.local && !r.muted)
      .map((r) => r.name);
  }

  setTalking(on: boolean): void {
    if (this.profile.online.openMic && !on) return;
    this.link.setTalking(on);
  }

  setOpenMic(on: boolean): void {
    this.profile.online.openMic = on;
    this.link.setTalking(on);
  }

  toggleMute(identity: string): void {
    this.link.toggleMute(identity);
  }

  /** Host: change what the next round looks like. */
  setSettings(patch: Partial<MatchSettings>): void {
    this.match.setSettings(patch);
  }

  setPublic(on: boolean): void {
    if (!this.isHost) return;
    this.isPublic = on;
    this.markListing();
    this.ev.lobby();
  }

  startRound(): void {
    this.match.startRound();
  }

  leave(): void {
    if (this.ended) return;
    this.ended = true;
    window.clearTimeout(this.listingTimer);
    this.link.leave();
  }

  private lobbyChanged(): void {
    if (this.isHost) this.markListing();
    this.ev.lobby();
  }

  private radioChanged(): void {
    const now = new Set(this.speaking());
    for (const n of now) {
      if (!this.speakers.has(n)) {
        this.ev.keyed();
        break;
      }
    }
    this.speakers = now;
    this.ev.radio();
  }

  private linkStatus(st: LinkStatus, reason?: string): void {
    if (st === 'reconnecting') this.notice = 'Connection lost. Reconnecting…';
    else if (st === 'connected') this.notice = '';
    if (st === 'closed') {
      if (this.ended) return;
      this.ended = true;
      window.clearTimeout(this.listingTimer);
      this.ev.closed(reason || 'The connection to the game was lost.');
      return;
    }
    this.ev.lobby();
  }

  private countWins(r: RoundResult): void {
    r.pilots.forEach((p, i) => {
      if (p.bot) return;
      const won = r.team >= 0 ? p.team === r.team : r.winner === i;
      if (won) this.wins.set(p.identity, (this.wins.get(p.identity) ?? 0) + 1);
    });
  }

  /** Host: update the public game list soon (bundled, at most every 1.5 s). */
  private markListing(): void {
    if (!this.isHost || this.listingTimer || this.ended) return;
    this.listingTimer = window.setTimeout(() => {
      this.listingTimer = 0;
      if (!this.isHost || this.ended) return;
      const m = this.match;
      const s = m.settings;
      void updateGame({
        callsign: this.profile.callsign,
        key: this.profile.pilotKey,
        code: this.code,
        level: s.level,
        mode: s.mode,
        bots: s.bots,
        public: this.isPublic,
        status: m.flying ? 'flying' : 'lobby',
        round: m.round,
        takeover: !this.listedAsHost,
      }).then((ok) => {
        if (ok) this.listedAsHost = true;
      });
    }, 1500);
  }
}
