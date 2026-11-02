import { Music, type Mood } from './music';

/** A pulsing whistle for one turning direction. */
interface TurnVoice {
  osc: OscillatorNode;
  lfo: OscillatorNode;
  gain: GainNode;
}

/**
 * The sound of a roll to one side: air whooshing over the spinning wings
 * (filtered noise and a growling tone whose filter, loudness and stereo
 * position swing with the spin) that spins up the longer the roll lasts.
 */
interface RollVoice {
  noise: AudioBufferSourceNode;
  tone: OscillatorNode;
  /** The spin: sweeps filters and pan, about twice per turn. */
  spin: OscillatorNode;
  /** A fast flutter on top. */
  flutter: OscillatorNode;
  gain: GainNode;
  /** When this roll started (audio clock), -1 while not rolling. */
  since: number;
}

/** The two roll sounds: right bright, rising and circling clockwise; left dark, falling and circling the other way. */
export const ROLL_VOICES = {
  right: { noiseHz: 2100, noiseSweep: 1300, toneHz: 196, toneTo: 330, cutHz: 1500, cutSweep: 1000, pan: 0.85, flutterHz: 17, spinHz: 1.25 },
  left: { noiseHz: 820, noiseSweep: 480, toneHz: 147, toneTo: 92, cutHz: 720, cutSweep: 420, pan: -0.85, flutterHz: 8, spinHz: 0.9 },
} as const;

/**
 * Steering sounds: a hiss panned to the side you turn to plus a whistle of
 * its own for each side (right high and fast pulsing, left low and slow),
 * a rising tone to climb, the same tone much deeper to dive, and for each
 * roll direction its own spinning whoosh.
 */
interface Maneuver {
  yawSrc: AudioBufferSourceNode;
  yawFilter: BiquadFilterNode;
  yawPan: StereoPannerNode;
  yawGain: GainNode;
  right: TurnVoice;
  left: TurnVoice;
  climb: OscillatorNode;
  climbGain: GainNode;
  diveSrc: AudioBufferSourceNode;
  diveFilter: BiquadFilterNode;
  diveGain: GainNode;
  /** The climbing tone's deep twin, with an overtone so phone speakers play it too. */
  diveTone: OscillatorNode;
  diveOver: OscillatorNode;
  diveToneGain: GainNode;
  rollR: RollVoice;
  rollL: RollVoice;
}

/** The layers of a shot (your own; other gliders' are quieter with distance). */
export const SHOT = {
  crack: 0.15,
  growl: 0.1,
  kick: 0.3,
  boom: 0.17,
  /** Level after the saturation, and of the echo. */
  bus: 0.4,
  echo: 0.3,
} as const;

/** Loudness of the steering sounds (gain at full deflection). */
export const STEER_GAIN = {
  /** Turning hiss and each side's whistle. */
  yaw: 0.05,
  turn: 0.026,
  /** Climbing tone (was 0.012). */
  climb: 0.024,
  /** Diving: the deep tone and its air rush. */
  dive: 0.04,
  diveRush: 0.05,
  /** Each roll direction's whoosh. */
  roll: 0.09,
} as const;

type SessionType = 'auto' | 'playback' | 'play-and-record' | 'ambient' | 'transient' | 'transient-solo';

/** Safari's audio session (iOS 16.4+): 'playback' keeps sounds on when the ring/silent switch is set to silent. */
function audioSession(): { type: SessionType } | null {
  return (navigator as Navigator & { audioSession?: { type: SessionType } }).audioSession ?? null;
}

let silentUrl = '';

/** A short silent WAV file. */
function silentWav(): string {
  if (silentUrl) return silentUrl;
  const n = 4000;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentUrl;
}

/**
 * All sounds are made live with the Web Audio API, so there are no sound files
 * to download. The audio starts as early as the browser allows: right away
 * where that is permitted, otherwise with the first tap, click or key.
 * iPhones and iPads need extra care: audio must be resumed inside a real tap
 * (touchend or click, not touchstart), it can be interrupted (a call, Siri,
 * another app) and the silent switch would mute it.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private music: Music | null = null;
  private musicWanted: { start: boolean; on: boolean; volume: number; mood: Mood } = { start: false, on: true, volume: 0.6, mood: 'menu' };
  /** Silent looping audio element: on older iPhones it makes Web Audio ignore the silent switch. */
  private keepAlive: HTMLAudioElement | null = null;
  /** The radio microphone is (or was) on: the audio session must allow recording. */
  private capture = false;
  private listening = false;
  private playlistBegun = false;
  /** Called when a music track starts. */
  onTrack: ((name: string) => void) | null = null;
  private man: Maneuver | null = null;
  /** Last steering state, for the short thruster puffs. */
  private lastX = 0;
  private lastY = 0;
  private lastR = 0;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** Flight sound: only soft air rushing past, brighter when fast; no engine drone. */
  private engine: {
    wind: AudioBufferSourceNode;
    windFilter: BiquadFilterNode;
    windGain: GainNode;
    boosting: boolean;
  } | null = null;
  private volume = 0.8;
  /** Sound effects on (music has its own switch). */
  private effects = true;
  private nextWarn = 0;
  /** Input of the shot bus (saturation and echo), made on the first shot. */
  private shotIn: AudioNode | null = null;
  private nextShield = 0;

  /**
   * Creates the audio engine as soon as the page starts and listens for the
   * taps and keys that may switch audio on. Without a tap the music starts
   * at once only where the browser permits it.
   */
  init(): void {
    this.create();
    this.setSession();
    if (this.listening) return;
    this.listening = true;
    const go = () => this.unlock();
    for (const type of ['pointerup', 'touchend', 'click', 'keydown', 'mousedown']) window.addEventListener(type, go, { capture: true, passive: true });
  }

  /** Called from every tap and key: starts or restarts audio when the browser stopped it. */
  unlock(): void {
    if (!this.ctx) this.create();
    const ctx = this.ctx;
    if (!ctx) return;
    this.setSession();
    // 'interrupted' is Safari's state after a call or Siri.
    if (ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden) void ctx.resume().catch(() => undefined);
    if (!audioSession() && !this.keepAlive && /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
      try {
        const a = new Audio(silentWav());
        a.loop = true;
        a.setAttribute('playsinline', '');
        a.setAttribute('x-webkit-airplay', 'deny');
        (a as HTMLAudioElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = true;
        a.play().then(
          () => (this.keepAlive = a),
          () => undefined,
        );
      } catch {
        // Optional.
      }
    }
  }

  /** The radio microphone needs a recording audio session; without it 'playback' keeps the silent switch from muting the game. */
  setCapture(on: boolean): void {
    this.capture = on;
    this.setSession();
  }

  private setSession(): void {
    const s = audioSession();
    if (!s) return;
    const want: SessionType = this.capture ? 'play-and-record' : 'playback';
    try {
      if (s.type !== want) s.type = want;
    } catch {
      // Not supported here.
    }
  }

  private create(): void {
    if (this.ctx) return;
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.effects ? this.volume : 0;
    // A limiter on the effects: heavy shots and crashes stay loud without clipping.
    const limit = this.ctx.createDynamicsCompressor();
    limit.threshold.value = -8;
    limit.knee.value = 6;
    limit.ratio.value = 12;
    limit.attack.value = 0.003;
    limit.release.value = 0.2;
    this.master.connect(limit).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.music = new Music(this.ctx, this.noise);
    this.music.onTrack = (name) => this.onTrack?.(name);
    const w = this.musicWanted;
    this.music.setVolume(w.volume);
    this.music.setEnabled(w.on);
    this.music.setMood(w.mood);
    if (w.start) this.beginPlaylist();
  }

  /** The first track is random, and never the one the last visit started with. */
  private beginPlaylist(): void {
    const m = this.music;
    if (!m || this.playlistBegun) return;
    this.playlistBegun = true;
    const KEY = 'iamspacepilot.firstTrack';
    let last = '';
    try {
      last = localStorage.getItem(KEY) ?? '';
    } catch {
      // Storage may be blocked.
    }
    m.start(last);
    try {
      if (m.current) localStorage.setItem(KEY, m.current.id);
    } catch {
      // Storage may be blocked.
    }
  }

  // ---- music ----

  /** Starts the playlist (once); it then plays on through every screen. */
  startMusic(): void {
    this.musicWanted.start = true;
    this.beginPlaylist();
  }

  /** Next track of the playlist. */
  nextTrack(): void {
    this.music?.next();
  }

  setMusicEnabled(on: boolean): void {
    this.musicWanted.on = on;
    this.music?.setEnabled(on);
  }

  setMusicVolume(v: number): void {
    this.musicWanted.volume = v;
    this.music?.setVolume(v);
  }

  setMusicMood(m: Mood): void {
    if (this.musicWanted.mood === m) return;
    this.musicWanted.mood = m;
    this.music?.setMood(m);
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyEffects();
  }

  /** Sound effects on or off (the music and the radio voices are not affected). */
  setSoundsEnabled(on: boolean): void {
    this.effects = on;
    this.applyEffects();
  }

  private applyEffects(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.effects ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  /** Pauses all audio (hidden tab). */
  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
    this.keepAlive?.pause();
  }

  resume(): void {
    const ctx = this.ctx;
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);
    if (this.keepAlive?.paused) void this.keepAlive.play().catch(() => undefined);
  }

  startEngine(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.engine) return;
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 900;
    windFilter.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.master);
    wind.start(0, Math.random());
    this.engine = { wind, windFilter, windGain, boosting: false };
    this.man = this.makeManeuver(ctx, this.master, this.noise);
  }

  private makeManeuver(ctx: AudioContext, out: AudioNode, noise: AudioBuffer): Maneuver {
    const loop = () => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      return s;
    };
    const gain = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      return g;
    };
    const yawSrc = loop();
    const yawFilter = ctx.createBiquadFilter();
    yawFilter.type = 'bandpass';
    yawFilter.Q.value = 1.4;
    yawFilter.frequency.value = 1000;
    const yawPan = ctx.createStereoPanner();
    const yawGain = gain();
    yawSrc.connect(yawFilter).connect(yawPan).connect(yawGain).connect(out);
    // Each side has its own whistle: different pitch, different pulse, from its side.
    const turnVoice = (freq: number, pulse: number, pan: number): TurnVoice => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = pulse;
      const depth = ctx.createGain();
      depth.gain.value = 0.45;
      const trem = ctx.createGain();
      trem.gain.value = 0.55;
      lfo.connect(depth).connect(trem.gain);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      const g = gain();
      osc.connect(trem).connect(p).connect(g).connect(out);
      return { osc, lfo, gain: g };
    };
    const right = turnVoice(740, 9, 0.85);
    const left = turnVoice(392, 5, -0.85);
    const climb = ctx.createOscillator();
    climb.type = 'sine';
    climb.frequency.value = 260;
    const climbGain = gain();
    climb.connect(climbGain).connect(out);
    const diveSrc = loop();
    const diveFilter = ctx.createBiquadFilter();
    diveFilter.type = 'lowpass';
    diveFilter.frequency.value = 400;
    const diveGain = gain();
    diveSrc.connect(diveFilter).connect(diveGain);
    diveGain.connect(out);
    // Diving sounds like climbing, only much deeper: a sine about one and a half octaves lower that falls.
    const diveTone = ctx.createOscillator();
    diveTone.type = 'sine';
    diveTone.frequency.value = 180;
    const diveOver = ctx.createOscillator();
    diveOver.type = 'sine';
    diveOver.frequency.value = 360;
    const overGain = ctx.createGain();
    overGain.gain.value = 0.45;
    const diveToneGain = gain();
    diveTone.connect(diveToneGain);
    diveOver.connect(overGain).connect(diveToneGain);
    diveToneGain.connect(out);
    const rollVoice = (v: (typeof ROLL_VOICES)['right' | 'left']): RollVoice => {
      const spin = ctx.createOscillator();
      spin.frequency.value = v.spinHz;
      const sweep = (amount: number, param: AudioParam) => {
        const d = ctx.createGain();
        d.gain.value = amount;
        spin.connect(d).connect(param);
      };
      // Air over the wings: band-passed noise whose band swings with the spin.
      const noise = loop();
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 2.6;
      band.frequency.value = v.noiseHz;
      sweep(v.noiseSweep, band.frequency);
      const noiseLevel = ctx.createGain();
      noiseLevel.gain.value = 1.6;
      // A growl through a resonant filter that opens and closes with the spin: "vwomm vwomm".
      const tone = ctx.createOscillator();
      tone.type = 'sawtooth';
      tone.frequency.value = v.toneHz;
      const cut = ctx.createBiquadFilter();
      cut.type = 'lowpass';
      cut.Q.value = 7;
      cut.frequency.value = v.cutHz;
      sweep(v.cutSweep, cut.frequency);
      const toneLevel = ctx.createGain();
      toneLevel.gain.value = 0.5;
      // Flutter, and the sound circles around you in the direction of the roll.
      const flutter = ctx.createOscillator();
      flutter.frequency.value = v.flutterHz;
      const fl = ctx.createGain();
      fl.gain.value = 0.3;
      const trem = ctx.createGain();
      trem.gain.value = 0.7;
      flutter.connect(fl).connect(trem.gain);
      const pan = ctx.createStereoPanner();
      pan.pan.value = v.pan * 0.35;
      sweep(v.pan * 0.6, pan.pan);
      const g = gain();
      noise.connect(band).connect(noiseLevel).connect(trem);
      tone.connect(cut).connect(toneLevel).connect(trem);
      trem.connect(pan).connect(g).connect(out);
      return { noise, tone, spin, flutter, gain: g, since: -1 };
    };
    const rollR = rollVoice(ROLL_VOICES.right);
    const rollL = rollVoice(ROLL_VOICES.left);
    for (const n of [yawSrc, diveSrc, rollR.noise, rollL.noise]) n.start(0, Math.random());
    for (const n of [climb, diveTone, diveOver, right.osc, right.lfo, left.osc, left.lfo, rollR.tone, rollR.spin, rollR.flutter, rollL.tone, rollL.spin, rollL.flutter]) n.start();
    return { yawSrc, yawFilter, yawPan, yawGain, right, left, climb, climbGain, diveSrc, diveFilter, diveGain, diveTone, diveOver, diveToneGain, rollR, rollL };
  }

  /**
   * Steering sounds, every frame while flying. x: turn (right +), y: nose (up +), r: roll (right +).
   * Left and right each have their own whistle and come from that side; climbing
   * rises, diving is the same tone much deeper and falls.
   */
  maneuver(x: number, y: number, r: number): void {
    const m = this.man;
    const ctx = this.ctx;
    if (!m || !ctx) return;
    const t = ctx.currentTime;
    const ax = Math.abs(x);
    const G = STEER_GAIN;
    m.yawGain.gain.setTargetAtTime(G.yaw * ax, t, 0.08);
    m.yawFilter.frequency.setTargetAtTime(x > 0 ? 1600 + 600 * ax : 760 - 220 * ax, t, 0.08);
    m.yawPan.pan.setTargetAtTime(x > 0 ? 0.9 : x < 0 ? -0.9 : 0, t, 0.08);
    // Right: a high whistle that climbs and pulses fast. Left: a low one that sinks and pulses slowly.
    const rx = x > 0 ? x : 0;
    const lx = x < 0 ? -x : 0;
    m.right.gain.gain.setTargetAtTime(G.turn * rx, t, 0.06);
    m.right.osc.frequency.setTargetAtTime(740 + 220 * rx, t, 0.1);
    m.left.gain.gain.setTargetAtTime(G.turn * 1.15 * lx, t, 0.06);
    m.left.osc.frequency.setTargetAtTime(392 - 90 * lx, t, 0.1);
    const up = y > 0 ? y : 0;
    const down = y < 0 ? -y : 0;
    m.climbGain.gain.setTargetAtTime(G.climb * up, t, 0.08);
    m.climb.frequency.setTargetAtTime(520 + 260 * up, t, 0.1);
    m.diveGain.gain.setTargetAtTime(G.diveRush * down, t, 0.08);
    m.diveFilter.frequency.setTargetAtTime(500 + 700 * down, t, 0.1);
    m.diveToneGain.gain.setTargetAtTime(G.dive * down, t, 0.08);
    const deep = 180 - 60 * down;
    m.diveTone.frequency.setTargetAtTime(deep, t, 0.1);
    m.diveOver.frequency.setTargetAtTime(deep * 2, t, 0.1);
    this.rollSound(m.rollR, ROLL_VOICES.right, r > 0 ? r : 0, t);
    this.rollSound(m.rollL, ROLL_VOICES.left, r < 0 ? -r : 0, t);
    // A short thruster puff when a move starts.
    const on = (v: number, last: number) => Math.abs(v) > 0.45 && Math.abs(last) <= 0.45;
    if (on(x, this.lastX)) {
      this.puff(x > 0 ? 1250 : 650, x > 0 ? 0.9 : -0.9, x > 0 ? 1.4 : 0.8, 0.12);
      // And a short chirp: up for right, down for left.
      this.chirp(x > 0 ? 880 : 520, x > 0 ? 1320 : 330, x > 0 ? 0.9 : -0.9);
    }
    if (on(y, this.lastY)) this.puff(y > 0 ? 1800 : 300, 0, y > 0 ? 1.6 : 0.55, 0.11);
    // Rolls start with a swish of their own: right high and rising, left low and falling.
    if (on(r, this.lastR)) this.puff(r > 0 ? 2800 : 900, r > 0 ? 0.8 : -0.8, r > 0 ? 1.7 : 0.45, 0.13);
    this.lastX = x;
    this.lastY = y;
    this.lastR = r;
  }

  /** One side's roll: louder with the stick, spinning up (faster, higher or deeper) the longer it lasts. */
  private rollSound(v: RollVoice, spec: (typeof ROLL_VOICES)['right' | 'left'], amount: number, t: number): void {
    if (amount > 0.05) {
      if (v.since < 0) v.since = t;
    } else v.since = -1;
    const up = v.since < 0 ? 0 : Math.min(1, (t - v.since) / 1.1);
    v.gain.gain.setTargetAtTime(STEER_GAIN.roll * amount * (0.75 + 0.25 * up), t, amount > 0.05 ? 0.04 : 0.09);
    v.tone.frequency.setTargetAtTime(spec.toneHz + (spec.toneTo - spec.toneHz) * up, t, 0.12);
    v.spin.frequency.setTargetAtTime(spec.spinHz * (0.7 + 0.9 * up) * Math.max(0.4, amount), t, 0.15);
  }

  /** A short sliding tone, panned. */
  private chirp(from: number, to: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + 0.12);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(p).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.18);
  }

  /** Short filtered noise burst, panned, with the filter sliding by `slide`. */
  private puff(freq: number, pan: number, slide: number, level = 0.09): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(freq * slide, t + 0.16);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f).connect(p).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.2);
  }

  stopEngine(): void {
    const e = this.engine;
    const ctx = this.ctx;
    if (!e || !ctx) return;
    const t = ctx.currentTime;
    e.windGain.gain.setTargetAtTime(0, t, 0.08);
    e.wind.stop(t + 0.5);
    this.engine = null;
    const m = this.man;
    if (m) {
      for (const g of [m.yawGain, m.right.gain, m.left.gain, m.climbGain, m.diveGain, m.diveToneGain, m.rollR.gain, m.rollL.gain]) g.gain.setTargetAtTime(0, t, 0.05);
      for (const n of [m.yawSrc, m.diveSrc, m.climb, m.diveTone, m.diveOver, m.right.osc, m.right.lfo, m.left.osc, m.left.lfo]) n.stop(t + 0.4);
      for (const v of [m.rollR, m.rollL]) for (const n of [v.noise, v.tone, v.spin, v.flutter]) n.stop(t + 0.4);
      this.man = null;
    }
    this.lastX = this.lastY = this.lastR = 0;
  }

  /** Called every frame while flying. */
  updateEngine(speed: number, boosting: boolean, wallDist: number, shieldDist = 1e9): void {
    const e = this.engine;
    const ctx = this.ctx;
    if (!e || !ctx) return;
    const t = ctx.currentTime;
    // Soft air: higher and a little louder the faster you fly.
    e.windFilter.frequency.setTargetAtTime(700 + speed * 26 + (boosting ? 900 : 0), t, 0.25);
    e.windGain.gain.setTargetAtTime(0.012 + (speed / 38) * 0.03 + (boosting ? 0.015 : 0), t, 0.25);
    // Speeding up: a short rising whoosh.
    if (boosting && !e.boosting) this.whoosh();
    e.boosting = boosting;
    if (wallDist < 6 && t >= this.nextWarn) {
      this.tone(1046, 0.05, 'square', 0.05, t);
      this.nextWarn = t + 0.07 + (wallDist / 6) * 0.35;
    }
    // A lower, softer pulse warns of the shield, floor or ceiling.
    if (shieldDist < 20 && t >= this.nextShield) {
      this.tone(392, 0.11, 'triangle', 0.12, t);
      this.nextShield = t + 0.12 + (Math.max(0, shieldDist) / 20) * 0.6;
    }
  }

  /** A rising rush of air when you speed up. */
  private whoosh(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.65);
  }

  /** The dachshund spits a bone: a short "wuff". */
  bark(gain = 1): void {
    const ctx = this.ctx;
    if (!ctx || gain <= 0.01) return;
    const t = ctx.currentTime;
    this.tone(560, 0.1, 'sawtooth', 0.07 * gain, t, 240);
    this.tone(300, 0.12, 'square', 0.05 * gain, t + 0.01, 150);
    this.noiseBurst(0.1, 'bandpass', 1400, 500, 0.12 * gain, t);
  }

  /** Flying through a waterfall. */
  splash(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(0.45, 'bandpass', 2400, 500, 0.18, t);
    this.noiseBurst(0.25, 'highpass', 5000, 2500, 0.08, t + 0.03);
  }

  click(): void {
    this.tone(1400, 0.03, 'sine', 0.08);
  }

  count(): void {
    this.tone(520, 0.14, 'sine', 0.18);
  }

  go(): void {
    this.tone(880, 0.32, 'sine', 0.2, undefined, 1320);
  }

  ring(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [880, 1175, 1568].forEach((f, i) => this.tone(f, 0.16, 'sine', 0.12, t + i * 0.07));
  }

  /**
   * A glider explodes and crumbles: a deep, warm boom, a soft rumble that
   * rolls away and a scatter of small glassy pieces, panned all around.
   * Rounder than a bang: no bright hiss.
   */
  crash(loud: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = loud ? 1 : 0.3;
    this.tone(88, 1.0, 'sine', 0.34 * g, t, 32);
    this.tone(176, 0.5, 'sine', 0.09 * g, t, 66);
    this.noiseBurst(1.5, 'lowpass', 650, 55, 0.24 * g, t);
    this.noiseBurst(0.5, 'bandpass', 1100, 180, 0.07 * g, t + 0.02);
    // The pieces: many short, soft tinkles, most of them early, flying off to every side.
    const pieces = loud ? 26 : 12;
    for (let i = 0; i < pieces; i++) {
      const at = t + 0.06 + -Math.log(1 - Math.random() * 0.97) * 0.32;
      const f = 1500 + Math.random() * 2600;
      this.tinkle(f, 0.05 + Math.random() * 0.1, (0.022 + Math.random() * 0.032) * g, Math.random() * 2 - 1, at);
    }
  }

  /** A small glassy piece: a short sine with a quieter fifth above, panned. */
  private tinkle(freq: number, dur: number, gain: number, pan: number, when: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    p.connect(this.master);
    g.connect(p);
    for (const [f, lvl] of [
      [freq, 1],
      [freq * 1.5, 0.35],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, when);
      o.frequency.exponentialRampToValueAtTime(f * 0.92, when + dur);
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(g);
      o.start(when);
      o.stop(when + dur + 0.02);
    }
  }

  thunder(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(0.25, 'highpass', 2600, 1800, 0.35, t);
    this.noiseBurst(1.4, 'lowpass', 500, 90, 0.4, t + 0.05);
  }

  shieldWarning(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(330, 0.22, 'triangle', 0.14, t, 300);
    this.tone(330, 0.22, 'triangle', 0.14, t + 0.3, 300);
  }

  win(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.14, t + i * 0.11));
  }

  /** Shots go through their own bus: a little saturation for weight and a short, dark echo from the arena. */
  private shotBus(): AudioNode | null {
    if (this.shotIn) return this.shotIn;
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const drive = ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(2.4 * x) / Math.tanh(2.4);
    }
    drive.curve = curve;
    drive.oversample = '2x';
    const dry = ctx.createGain();
    dry.gain.value = SHOT.bus;
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.11;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = 1100;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    const wet = ctx.createGain();
    wet.gain.value = SHOT.echo;
    drive.connect(dry).connect(this.master);
    dry.connect(delay).connect(dark).connect(feedback).connect(delay);
    dark.connect(wet).connect(this.master);
    this.shotIn = drive;
    return drive;
  }

  /**
   * A shot leaves a gun: a hard crack, a falling growl, a deep kick with its
   * octave (so phone speakers carry it) and a rolling boom with an echo.
   * gain is lower for other gliders further away.
   */
  shot(gain = 1): void {
    const ctx = this.ctx;
    if (!ctx || gain <= 0.01) return;
    const out = this.shotBus() ?? undefined;
    const t = ctx.currentTime;
    const g = gain;
    this.noiseBurst(0.05, 'bandpass', 4200, 1300, SHOT.crack * g, t, out);
    this.growl(270, 52, 0.26, SHOT.growl * g, 2600, 180, t, out);
    this.tone(118, 0.32, 'sine', SHOT.kick * g, t, 34, out);
    this.tone(236, 0.17, 'sine', SHOT.kick * 0.35 * g, t, 68, out);
    this.noiseBurst(0.45, 'lowpass', 1500, 80, SHOT.boom * g, t + 0.012, out);
  }

  /** A sawtooth sliding from f0 to f1 through a low-pass that closes from c0 to c1. */
  private growl(f0: number, f1: number, dur: number, gain: number, c0: number, c1: number, when: number, out?: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.setValueAtTime(f0 * 0.993, when);
    o2.frequency.exponentialRampToValueAtTime(f1 * 0.99, when + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(c0, when);
    f.frequency.exponentialRampToValueAtTime(c1, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(f);
    o2.connect(f);
    f.connect(g).connect(out ?? this.master);
    for (const x of [o, o2]) {
      x.start(when);
      x.stop(when + dur + 0.02);
    }
  }

  /**
   * A shot hits a glider (louder when it is yours): a soft, round thud and a
   * clear ringing "dong", like a hit on a hull, not a harsh crack.
   */
  hit(onMe: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = onMe ? 1 : 0.4;
    this.noiseBurst(0.28, 'lowpass', 1000, 160, 0.17 * g, t);
    this.tone(210, 0.3, 'sine', 0.16 * g, t, 105);
    this.tone(660, 0.55, 'sine', 0.04 * g, t + 0.005);
    this.tone(990, 0.45, 'sine', 0.025 * g, t + 0.005);
  }

  /** Your shot hit someone. */
  hitConfirm(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(1900, 0.05, 'square', 0.05, t);
    this.tone(2550, 0.07, 'square', 0.05, t + 0.05);
  }

  overheat(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(320, 0.4, 'sawtooth', 0.07, t, 110);
  }

  /** A ship's special ability. */
  special(kind: 'burst' | 'afterburner' | 'phase' | 'shockwave', gain = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (kind === 'burst') {
      [0, 0.03, 0.06].forEach((d) => this.tone(1900 - d * 4000, 0.14, 'sawtooth', 0.06 * gain, t + d, 380));
    } else if (kind === 'afterburner') {
      this.noiseBurst(0.9, 'lowpass', 600, 2400, 0.35 * gain, t);
      this.tone(90, 0.8, 'sawtooth', 0.08 * gain, t, 160);
    } else if (kind === 'phase') {
      this.tone(420, 0.5, 'sine', 0.14 * gain, t, 1260);
      this.tone(630, 0.5, 'triangle', 0.08 * gain, t + 0.05, 1890);
    } else {
      this.noiseBurst(0.7, 'lowpass', 1800, 80, 0.55 * gain, t);
      this.tone(60, 0.7, 'sine', 0.3 * gain, t, 30);
    }
  }

  /** The shield takes a hit or a wall. */
  shieldPop(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(1400, 0.25, 'triangle', 0.12, t, 300);
    this.noiseBurst(0.25, 'highpass', 4000, 1500, 0.12, t);
  }

  /** Radio squelch: a short burst of static and a beep, like a real radio keying up. */
  radio(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(0.07, 'bandpass', 2600, 1700, 0.09, t);
    this.tone(on ? 1240 : 880, 0.07, 'square', 0.03, t + 0.03);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when?: number, slideTo?: number, out?: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = when ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(out ?? this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, when: number, out?: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(f0, when);
    filter.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(out ?? this.master);
    src.start(when, Math.random());
    src.stop(when + dur + 0.05);
  }
}
