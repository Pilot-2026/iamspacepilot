/**
 * All sounds are made live with the Web Audio API, so there are no sound files
 * to download. Browsers only allow audio after the first tap or click, so
 * unlock() is called from a button press.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: {
    osc1: OscillatorNode;
    osc2: OscillatorNode;
    filter: BiquadFilterNode;
    gain: GainNode;
    wind: AudioBufferSourceNode;
    windFilter: BiquadFilterNode;
    windGain: GainNode;
  } | null = null;
  private volume = 0.8;
  private nextWarn = 0;
  private nextShield = 0;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Pauses all audio (menus, hidden tab). */
  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  startEngine(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.engine) return;
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 70;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 140.6;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 900;
    windFilter.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.master);
    osc1.start();
    osc2.start();
    wind.start();
    gain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.3);
    this.engine = { osc1, osc2, filter, gain, wind, windFilter, windGain };
  }

  stopEngine(): void {
    const e = this.engine;
    const ctx = this.ctx;
    if (!e || !ctx) return;
    const t = ctx.currentTime;
    e.gain.gain.setTargetAtTime(0, t, 0.08);
    e.windGain.gain.setTargetAtTime(0, t, 0.08);
    e.osc1.stop(t + 0.5);
    e.osc2.stop(t + 0.5);
    e.wind.stop(t + 0.5);
    this.engine = null;
  }

  /** Called every frame while flying. */
  updateEngine(speed: number, boosting: boolean, wallDist: number, shieldDist = 1e9): void {
    const e = this.engine;
    const ctx = this.ctx;
    if (!e || !ctx) return;
    const t = ctx.currentTime;
    const f = 48 + speed * 1.6;
    e.osc1.frequency.setTargetAtTime(f, t, 0.1);
    e.osc2.frequency.setTargetAtTime(f * 2.006, t, 0.1);
    e.filter.frequency.setTargetAtTime(boosting ? 1800 : 650, t, 0.15);
    e.gain.gain.setTargetAtTime(boosting ? 0.07 : 0.05, t, 0.15);
    e.windFilter.frequency.setTargetAtTime(600 + speed * 22, t, 0.2);
    e.windGain.gain.setTargetAtTime(0.02 + (speed / 38) * 0.06, t, 0.2);
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
    this.tone(1650, 0.12, 'sawtooth', 0.06 * gain, t, 420);
    this.noiseBurst(0.05, 'highpass', 3600, 2400, 0.035 * gain, t);
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
