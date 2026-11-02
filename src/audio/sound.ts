import { Music, type Mood } from './music';

/** Steering sounds: a hiss panned to the side you turn to, a rising tone to climb, a deep rush to dive, a whirr to roll. */
interface Maneuver {
  yawSrc: AudioBufferSourceNode;
  yawFilter: BiquadFilterNode;
  yawPan: StereoPannerNode;
  yawGain: GainNode;
  climb: OscillatorNode;
  climbGain: GainNode;
  diveSrc: AudioBufferSourceNode;
  diveFilter: BiquadFilterNode;
  diveSub: OscillatorNode;
  diveGain: GainNode;
  roll: OscillatorNode;
  rollPan: StereoPannerNode;
  rollGain: GainNode;
  lfo: OscillatorNode;
}

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
    this.master.connect(this.ctx.destination);
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
    const climb = ctx.createOscillator();
    climb.type = 'sine';
    climb.frequency.value = 260;
    const climbGain = gain();
    climb.connect(climbGain).connect(out);
    const diveSrc = loop();
    const diveFilter = ctx.createBiquadFilter();
    diveFilter.type = 'lowpass';
    diveFilter.frequency.value = 400;
    // No low hum when diving: just air, a little deeper than the turns.
    const diveSub = ctx.createOscillator();
    diveSub.type = 'sine';
    diveSub.frequency.value = 220;
    const diveGain = gain();
    diveSrc.connect(diveFilter).connect(diveGain);
    diveGain.connect(out);
    const roll = ctx.createOscillator();
    roll.type = 'square';
    roll.frequency.value = 150;
    const rollFilter = ctx.createBiquadFilter();
    rollFilter.type = 'bandpass';
    rollFilter.frequency.value = 900;
    const rollPan = ctx.createStereoPanner();
    const rollGain = gain();
    // A fast tremolo makes the roll whirr.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 14;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    lfo.connect(lfoGain).connect(trem.gain);
    roll.connect(rollFilter).connect(trem).connect(rollPan).connect(rollGain).connect(out);
    for (const n of [yawSrc, diveSrc]) n.start(0, Math.random());
    for (const n of [climb, diveSub, roll, lfo]) n.start();
    return { yawSrc, yawFilter, yawPan, yawGain, climb, climbGain, diveSrc, diveFilter, diveSub, diveGain, roll, rollPan, rollGain, lfo };
  }

  /**
   * Steering sounds, every frame while flying. x: turn (right +), y: nose (up +), r: roll (right +).
   * Left and right sound different and come from that side; climbing rises, diving rushes low.
   */
  maneuver(x: number, y: number, r: number): void {
    const m = this.man;
    const ctx = this.ctx;
    if (!m || !ctx) return;
    const t = ctx.currentTime;
    const ax = Math.abs(x);
    m.yawGain.gain.setTargetAtTime(0.035 * ax, t, 0.08);
    m.yawFilter.frequency.setTargetAtTime(x > 0 ? 1500 + 500 * ax : 820 - 200 * ax, t, 0.08);
    m.yawPan.pan.setTargetAtTime(x > 0 ? 0.7 : x < 0 ? -0.7 : 0, t, 0.08);
    const up = y > 0 ? y : 0;
    const down = y < 0 ? -y : 0;
    m.climbGain.gain.setTargetAtTime(0.012 * up, t, 0.08);
    m.climb.frequency.setTargetAtTime(520 + 260 * up, t, 0.1);
    m.diveGain.gain.setTargetAtTime(0.04 * down, t, 0.08);
    m.diveFilter.frequency.setTargetAtTime(600 + 900 * down, t, 0.1);
    const ar = Math.abs(r);
    m.rollGain.gain.setTargetAtTime(0.012 * ar, t, 0.05);
    m.roll.frequency.setTargetAtTime(130 + 80 * ar, t, 0.08);
    m.rollPan.pan.setTargetAtTime(r * 0.6, t, 0.08);
    // A short thruster puff when a move starts.
    const on = (v: number, last: number) => Math.abs(v) > 0.45 && Math.abs(last) <= 0.45;
    if (on(x, this.lastX)) this.puff(x > 0 ? 1250 : 650, x > 0 ? 0.75 : -0.75, x > 0 ? 1.4 : 0.8);
    if (on(y, this.lastY)) this.puff(y > 0 ? 1800 : 380, 0, y > 0 ? 1.6 : 0.6);
    if (on(r, this.lastR)) this.puff(2600, r > 0 ? 0.5 : -0.5, r > 0 ? 1.3 : 0.75);
    this.lastX = x;
    this.lastY = y;
    this.lastR = r;
  }

  /** Short filtered noise burst, panned, with the filter sliding by `slide`. */
  private puff(freq: number, pan: number, slide: number): void {
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
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.015);
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
      for (const g of [m.yawGain, m.climbGain, m.diveGain, m.rollGain]) g.gain.setTargetAtTime(0, t, 0.05);
      for (const n of [m.yawSrc, m.diveSrc, m.climb, m.diveSub, m.roll, m.lfo]) n.stop(t + 0.4);
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

  crash(loud: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = loud ? 0.7 : 0.18;
    this.noiseBurst(loud ? 0.9 : 0.5, 'lowpass', 3200, 160, g, t);
    this.tone(70, loud ? 0.6 : 0.3, 'sine', g * 0.8, t, 32);
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

  /** A shot leaves a gun. gain is lower for other gliders further away. */
  shot(gain = 1): void {
    const ctx = this.ctx;
    if (!ctx || gain <= 0.01) return;
    const t = ctx.currentTime;
    // A deep, punchy shot: a falling growl, a thump and a short burst of air.
    this.tone(340, 0.16, 'sawtooth', 0.045 * gain, t, 80);
    this.tone(130, 0.14, 'sine', 0.13 * gain, t, 48);
    this.noiseBurst(0.09, 'lowpass', 1800, 260, 0.08 * gain, t);
  }

  /** A shot hits a glider: loud when it is yours. */
  hit(onMe: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(0.2, 'bandpass', 2200, 500, onMe ? 0.42 : 0.16, t);
    this.tone(190, 0.22, 'square', onMe ? 0.12 : 0.05, t, 80);
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

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when?: number, slideTo?: number): void {
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
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, when: number): void {
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
    g.connect(this.master);
    src.start(when, Math.random());
    src.stop(when + dur + 0.05);
  }
}
