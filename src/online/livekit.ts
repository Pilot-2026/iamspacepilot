import type { Participant, RemoteParticipant, RemoteTrack, RemoteTrackPublication, Room } from 'livekit-client';
import type { Msg, Peer, Transport } from './match';

/**
 * One online game = one LiveKit room. Game messages travel as reliable data
 * packets, the voice radio as audio tracks in the same room.
 * livekit-client is loaded only when a pilot goes online.
 */

const TOPIC = 'g';
const enc = new TextEncoder();
const dec = new TextDecoder();

export type LinkStatus = 'connected' | 'reconnecting' | 'closed';

export interface LinkEvents {
  message(from: string, msg: Msg): void;
  /** Someone joined or left. */
  peers(): void;
  /** Who talks, mutes or has a microphone changed. */
  radio(): void;
  status(status: LinkStatus, reason?: string): void;
}

export interface RadioEntry {
  identity: string;
  name: string;
  local: boolean;
  speaking: boolean;
  /** Muted by this device. */
  muted: boolean;
  /** Has the microphone open right now. */
  live: boolean;
}

/** Callsign part of an identity like "NightHawk~a1b2c3". */
export const nameOf = (identity: string) => identity.split('~')[0];

/** When the participant joined, in milliseconds, as told by the server (so every device agrees). */
function joinedMs(p: Participant): number {
  const info = (p as unknown as { participantInfo?: { joinedAtMs?: bigint | number; joinedAt?: bigint | number } }).participantInfo;
  const ms = Number(info?.joinedAtMs ?? 0);
  if (ms > 0) return ms;
  const s = Number(info?.joinedAt ?? 0);
  return s > 0 ? s * 1000 : Date.now();
}

function closeReason(code: number | undefined): string {
  switch (code) {
    case 2:
      return 'You joined this game from another tab or device.';
    case 4:
      return 'You were removed from the game.';
    case 5:
    case 10:
      return 'The game was closed.';
    case 3:
      return 'The radio server restarted. Join again in a moment.';
    case 1:
      return '';
    default:
      return 'The connection to the game was lost.';
  }
}

export class LiveKitLink implements Transport {
  private readonly muted = new Set<string>();
  private readonly audioBox: HTMLElement;
  private wantTalk = false;
  private micBusy: Promise<void> = Promise.resolve();
  private closed = false;
  /** 'denied' or 'unavailable' when the microphone could not be opened. */
  micProblem = '';
  private readonly unlock = () => {
    if (!this.room.canPlaybackAudio) void this.room.startAudio().catch(() => undefined);
  };

  private constructor(
    private readonly room: Room,
    private readonly ev: LinkEvents,
    private readonly lk: typeof import('livekit-client'),
  ) {
    this.audioBox = document.createElement('div');
    this.audioBox.hidden = true;
    document.body.append(this.audioBox);
    // Browsers only play sound after a tap or key press.
    for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, this.unlock, { capture: true });
  }

  static async connect(url: string, token: string, ev: LinkEvents): Promise<LiveKitLink> {
    const lk = await import('livekit-client');
    const room = new lk.Room({
      adaptiveStream: false,
      dynacast: false,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      publishDefaults: { dtx: true, red: true },
    });
    const link = new LiveKitLink(room, ev, lk);
    link.wire();
    try {
      await room.connect(url, token, { autoSubscribe: true });
    } catch (e) {
      link.dispose();
      throw e;
    }
    link.unlock();
    return link;
  }

  private wire(): void {
    const E = this.lk.RoomEvent;
    const room = this.room;
    room.on(E.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== TOPIC || !participant) return;
      let msg: Msg;
      try {
        msg = JSON.parse(dec.decode(payload)) as Msg;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return;
      this.ev.message(participant.identity, msg);
    });
    room.on(E.ParticipantConnected, () => {
      this.ev.peers();
      this.ev.radio();
    });
    room.on(E.ParticipantDisconnected, () => {
      this.ev.peers();
      this.ev.radio();
    });
    room.on(E.ActiveSpeakersChanged, () => this.ev.radio());
    room.on(E.TrackMuted, () => this.ev.radio());
    room.on(E.TrackUnmuted, () => this.ev.radio());
    room.on(E.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
      if (track.kind !== 'audio') return;
      if (this.muted.has(p.identity)) {
        pub.setSubscribed(false);
        return;
      }
      const el = track.attach();
      this.audioBox.append(el);
      this.ev.radio();
    });
    room.on(E.TrackUnsubscribed, (track: RemoteTrack) => {
      for (const el of track.detach()) el.remove();
      this.ev.radio();
    });
    room.on(E.Reconnecting, () => this.ev.status('reconnecting'));
    room.on(E.Reconnected, () => {
      this.ev.status('connected');
      this.ev.peers();
    });
    room.on(E.Disconnected, (reason?: number) => {
      if (this.closed) return;
      this.dispose();
      this.ev.status('closed', closeReason(reason));
    });
  }

  get self(): string {
    return this.room.localParticipant.identity;
  }

  peers(): Peer[] {
    const list: Peer[] = [];
    const lp = this.room.localParticipant;
    list.push({ identity: lp.identity, name: lp.name || nameOf(lp.identity), joinedAt: joinedMs(lp) });
    for (const p of this.room.remoteParticipants.values()) {
      list.push({ identity: p.identity, name: p.name || nameOf(p.identity), joinedAt: joinedMs(p) });
    }
    return list;
  }

  send(msg: Msg): void {
    if (this.closed || this.room.state !== this.lk.ConnectionState.Connected) return;
    void this.room.localParticipant.publishData(enc.encode(JSON.stringify(msg)), { reliable: true, topic: TOPIC }).catch(() => undefined);
  }

  /** Push to talk. The first time, the browser asks for the microphone. */
  setTalking(on: boolean): void {
    if (this.closed || this.wantTalk === on) return;
    this.wantTalk = on;
    this.micBusy = this.micBusy.then(async () => {
      const want = this.wantTalk;
      const lp = this.room.localParticipant;
      if (lp.isMicrophoneEnabled === want) return;
      try {
        await lp.setMicrophoneEnabled(want);
        this.micProblem = '';
      } catch (e) {
        this.wantTalk = false;
        this.micProblem = e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable';
      }
      this.ev.radio();
    });
  }

  get talking(): boolean {
    return this.wantTalk;
  }

  /** Mutes or unmutes one pilot on this device only. */
  toggleMute(identity: string): void {
    const p = this.room.remoteParticipants.get(identity);
    const mute = !this.muted.has(identity);
    if (mute) this.muted.add(identity);
    else this.muted.delete(identity);
    if (p) for (const pub of p.audioTrackPublications.values()) pub.setSubscribed(!mute);
    this.ev.radio();
  }

  radio(): RadioEntry[] {
    const entry = (p: Participant, local: boolean): RadioEntry => ({
      identity: p.identity,
      name: p.name || nameOf(p.identity),
      local,
      speaking: p.isSpeaking,
      muted: this.muted.has(p.identity),
      live: p.isMicrophoneEnabled,
    });
    const list = [entry(this.room.localParticipant, true)];
    for (const p of this.room.remoteParticipants.values()) list.push(entry(p, false));
    return list;
  }

  /** True when the browser still blocks sound until the next tap. */
  get audioBlocked(): boolean {
    return !this.room.canPlaybackAudio;
  }

  leave(): void {
    if (this.closed) return;
    this.dispose();
    void this.room.disconnect().catch(() => undefined);
  }

  private dispose(): void {
    this.closed = true;
    for (const type of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(type, this.unlock, { capture: true });
    this.audioBox.remove();
  }
}
