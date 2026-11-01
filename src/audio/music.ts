/**
 * Electronic background music, made live with the Web Audio API: no files to
 * download. Twelve tracks play one after another as a playlist in a random
 * order (a new order on every visit) and keep running through menus, games
 * and restarts. Each track is a small recipe (tempo, key, chords, drum and
 * bass style); the arrangement moves through intro, build, drop and break
 * sections, and the mood of the game (menu, countdown, flight, crash, pause)
 * opens or closes a filter over the whole mix.
 */

export type Mood = 'menu' | 'countdown' | 'flight' | 'boost' | 'down' | 'pause';

type Drums = 'four' | 'electro' | 'break' | 'half' | 'dnb' | 'trap';
type Bass = 'pump' | 'roll' | 'octave' | 'acid' | 'sub' | 'offbeat';
type Arp = 'up' | 'updown' | 'random' | 'pulse' | 'none';
type Lead = 'saw' | 'square' | 'triangle' | 'none';

export interface TrackDef {
  readonly id: string;
  readonly name: string;
  readonly bpm: number;
  /** MIDI note of the key's root, around octave 2. */
  readonly root: number;
  readonly scale: readonly number[];
  /** Scale degree of each bar's chord (the loop repeats). */
  readonly prog: readonly number[];
  readonly drums: Drums;
  readonly bass: Bass;
  readonly arp: Arp;
  readonly lead: Lead;
  readonly pad: boolean;
  /** Seeds the melody. */
  readonly seed: number;
  /** Brightness of bass and plucks (filter Hz). */
  readonly cutoff: number;
  /** 0..0.3: delays every second 16th. */
  readonly swing: number;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MIXO = [0, 2, 4, 5, 7, 9, 10];
const HARMONIC = [0, 2, 3, 5, 7, 8, 11];

export const TRACKS: readonly TrackDef[] = [
  { id: 'cloud-sea', name: 'Cloud Sea Drive', bpm: 122, root: 41, scale: LYDIAN, prog: [0, 4, 5, 3], drums: 'four', bass: 'pump', arp: 'up', lead: 'square', pad: true, seed: 11, cutoff: 900, swing: 0 },
  { id: 'storm-eye', name: 'Eye of the Storm', bpm: 128, root: 38, scale: MINOR, prog: [0, 5, 2, 6], drums: 'electro', bass: 'acid', arp: 'random', lead: 'saw', pad: true, seed: 23, cutoff: 700, swing: 0 },
  { id: 'frost-heights', name: 'Frost Signal', bpm: 110, root: 40, scale: DORIAN, prog: [0, 3, 6, 4], drums: 'half', bass: 'sub', arp: 'updown', lead: 'triangle', pad: true, seed: 37, cutoff: 1200, swing: 0.12 },
  { id: 'jet-stream', name: 'Jet Stream Runner', bpm: 140, root: 43, scale: MINOR, prog: [0, 6, 5, 4], drums: 'break', bass: 'roll', arp: 'pulse', lead: 'saw', pad: true, seed: 41, cutoff: 1000, swing: 0.08 },
  { id: 'aurora', name: 'Aurora Bloom', bpm: 100, root: 36, scale: LYDIAN, prog: [0, 1, 5, 4], drums: 'half', bass: 'sub', arp: 'updown', lead: 'triangle', pad: true, seed: 53, cutoff: 1400, swing: 0.16 },
  { id: 'orbit', name: 'Low Orbit', bpm: 124, root: 45, scale: MINOR, prog: [0, 5, 3, 4], drums: 'four', bass: 'octave', arp: 'updown', lead: 'square', pad: true, seed: 67, cutoff: 950, swing: 0 },
  { id: 'moon-shadow', name: 'Moon Shadow', bpm: 92, root: 35, scale: PHRYGIAN, prog: [0, 1, 0, 6], drums: 'trap', bass: 'sub', arp: 'random', lead: 'saw', pad: true, seed: 71, cutoff: 650, swing: 0.1 },
  { id: 'ring-world', name: 'Ring World Rush', bpm: 132, root: 39, scale: MIXO, prog: [0, 6, 3, 4], drums: 'four', bass: 'offbeat', arp: 'pulse', lead: 'square', pad: true, seed: 83, cutoff: 1100, swing: 0 },
  { id: 'nebula', name: 'Nebula Dreams', bpm: 116, root: 42, scale: DORIAN, prog: [0, 2, 3, 1], drums: 'break', bass: 'octave', arp: 'random', lead: 'triangle', pad: true, seed: 97, cutoff: 1300, swing: 0.14 },
  { id: 'lattice-core', name: 'Core Breach', bpm: 174, root: 36, scale: HARMONIC, prog: [0, 5, 6, 4], drums: 'dnb', bass: 'roll', arp: 'pulse', lead: 'saw', pad: true, seed: 101, cutoff: 800, swing: 0 },
  { id: 'menu', name: 'Hangar Lights', bpm: 104, root: 45, scale: DORIAN, prog: [0, 3, 5, 4], drums: 'half', bass: 'sub', arp: 'updown', lead: 'triangle', pad: true, seed: 7, cutoff: 1500, swing: 0.15 },
  { id: 'intro', name: 'Lift Off', bpm: 126, root: 40, scale: MAJOR, prog: [0, 5, 3, 4], drums: 'four', bass: 'pump', arp: 'up', lead: 'saw', pad: true, seed: 3, cutoff: 1200, swing: 0 },
];

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** How many bars a track plays before the next one comes in: two full arrangements, about two minutes. */
export function trackBars(def: TrackDef): number {
  return def.bpm >= 150 ? 96 : 64;
}

/** The tracks in a random order; `avoid` does not come first. */
export function shuffled(avoid: TrackDef | null = null, random: () => number = Math.random): TrackDef[] {
  const list = [...TRACKS];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  if (avoid && list[0] === avoid && list.length > 1) [list[0], list[1]] = [list[1], list[0]];
  return list;
}

/** Small seeded random numbers for melodies. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface Section {
  kick: boolean;
  snare: boolean;
  hats: 0 | 1 | 2;
  bass: boolean;
  arp: boolean;
  pad: boolean;
  lead: boolean;
  /** Snare roll in the last bar. */
  roll: boolean;
}

/** 32-bar arrangement: intro, build, drop, break, build, drop with lead. */
function section(bar: number): Section {
  const b = bar % 32;
  if (b < 4) return { kick: false, snare: false, hats: 1, bass: false, arp: false, pad: true, lead: false, roll: false };
  if (b < 8) return { kick: true, snare: false, hats: 1, bass: true, arp: true, pad: true, lead: false, roll: b === 7 };
  if (b < 16) return { kick: true, snare: true, hats: 2, bass: true, arp: true, pad: true, lead: false, roll: false };
  if (b < 20) return { kick: false, snare: false, hats: 1, bass: false, arp: false, pad: true, lead: true, roll: false };
  if (b < 24) return { kick: true, snare: false, hats: 1, bass: true, arp: true, pad: true, lead: true, roll: b === 23 };
  return { kick: true, snare: true, hats: 2, bass: true, arp: true, pad: true, lead: true, roll: false };
}

/** A running track: its own bus, so tracks can cross-fade. */
export class TrackPlayer {
  readonly bus: GainNode;
  private step = 0;
  private next = 0;
  private readonly melody: (number | null)[];
  private readonly acid: { on: boolean; accent: boolean; up: number }[];
  stopped = false;

  constructor(
    private readonly ctx: AudioContext,
    readonly def: TrackDef,
    out: AudioNode,
    private readonly send: AudioNode,
    private readonly noise: AudioBuffer,
    startBar = 0,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(out);
    this.next = ctx.currentTime + 0.08;
    this.step = startBar * 16;
    const r = rng(def.seed);
    // A two-bar phrase: scale steps, or rests.
    const rhythm = [0, 3, 6, 8, 10, 12, 14, 16, 19, 22, 24, 26, 28];
    this.melody = new Array(32).fill(null);
    let deg = 2 + Math.floor(r() * 3);
    for (const pos of rhythm) {
      if (r() < 0.22) continue;
      deg += Math.floor(r() * 5) - 2;
      deg = Math.max(0, Math.min(9, deg));
      this.melody[pos] = deg;
    }
    this.acid = Array.from({ length: 16 }, () => ({ on: r() < 0.7, accent: r() < 0.3, up: r() < 0.25 ? 12 : 0 }));
  }

  get stepDur(): number {
    return 60 / this.def.bpm / 4;
  }

  /** The bar being scheduled now. */
  get bar(): number {
    return Math.floor(this.step / 16);
  }

  /** Schedules everything that starts before `until`. */
  schedule(until: number): void {
    while (this.next < until) {
      const swing = this.step % 2 === 1 ? this.def.swing * this.stepDur : 0;
      this.play(this.step, this.next + swing);
      this.next += this.stepDur;
      this.step++;
    }
  }

  fadeTo(v: number, seconds: number): void {
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setValueAtTime(this.bus.gain.value, t);
    this.bus.gain.linearRampToValueAtTime(v, t + seconds);
  }

  /** Note of scale degree d (any integer) above the root plus octave o. */
  private note(d: number, o = 0): number {
    const s = this.def.scale;
    const n = s.length;
    const oct = Math.floor(d / n);
    return this.def.root + s[((d % n) + n) % n] + 12 * (oct + o);
  }

  private play(step: number, t: number): void {
    const d = this.def;
    const bar = Math.floor(step / 16);
    const i = step % 16;
    const sec = section(bar);
    const chord = d.prog[bar % d.prog.length];
    // Drums.
    if (sec.kick && kickAt(d.drums, i)) this.kick(t);
    if (sec.snare && snareAt(d.drums, i)) this.snare(t, 1);
    if (sec.roll && i >= 8 && (i % 2 === 0 || i >= 12)) this.snare(t, 0.25 + (i - 8) / 12);
    if (sec.hats > 0) {
      const open = d.drums !== 'trap' && i % 4 === 2;
      if (sec.hats === 2 || i % 2 === 0) this.hat(t, open ? 0.16 : 0.035, open ? 0.06 : i % 2 === 0 ? 0.05 : 0.03);
      if (d.drums === 'trap' && sec.hats === 2 && (i === 13 || i === 14 || i === 15)) this.hat(t + this.stepDur / 2, 0.03, 0.03);
    }
    // Bass.
    if (sec.bass) {
      const root = this.note(chord, 0);
      switch (d.bass) {
        case 'pump':
          if (i % 4 === 2) this.bass(t, root, this.stepDur * 1.6, 0.9);
          break;
        case 'offbeat':
          if (i % 4 === 2 || i === 0) this.bass(t, root, this.stepDur * 1.5, 0.9);
          break;
        case 'octave':
          if (i % 2 === 0) this.bass(t, root + (i % 4 === 2 ? 12 : 0), this.stepDur * 1.7, 0.85);
          break;
        case 'roll':
          this.bass(t, root + (i % 4 === 3 ? 12 : 0), this.stepDur * 0.9, i % 4 === 0 ? 1 : 0.7);
          break;
        case 'acid': {
          const a = this.acid[i];
          if (a.on) this.bass(t, root + a.up, this.stepDur * 0.95, a.accent ? 1.1 : 0.7, true);
          break;
        }
        case 'sub':
          if (i === 0 || i === 10) this.bass(t, root, this.stepDur * (i === 0 ? 9 : 5), 1);
          break;
      }
    }
    // Arpeggio from the chord.
    if (sec.arp && d.arp !== 'none') {
      const tones = [0, 2, 4, 7].map((k) => this.note(chord + k, 2));
      let n: number | null = null;
      if (d.arp === 'up') n = tones[i % 4];
      else if (d.arp === 'updown') n = tones[[0, 1, 2, 3, 2, 1][i % 6]];
      else if (d.arp === 'pulse') n = i % 2 === 0 ? tones[0] : i % 4 === 1 ? tones[2] : null;
      else n = tones[(i * 7 + bar * 3) % 4];
      if (n !== null) this.pluck(t, n, this.stepDur * 1.5);
    }
    // Pad: one long chord per bar.
    if (sec.pad && d.pad && i === 0) {
      this.pad(t, [this.note(chord, 1), this.note(chord + 2, 1), this.note(chord + 4, 1)], this.stepDur * 16);
    }
    // Lead melody.
    if (sec.lead && d.lead !== 'none') {
      const pos = (bar % 2) * 16 + i;
      const m = this.melody[pos];
      if (m !== null) {
        let len = 1;
        while (len < 4 && this.melody[pos + len] == null && pos + len < 32) len++;
        this.lead(t, this.note(chord + m, 2), this.stepDur * len * 0.9);
      }
    }
  }

  // ---- voices ----

  private out(gain: number, t: number, attack: number, dur: number, toSend = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.bus);
    if (toSend > 0) {
      const s = this.ctx.createGain();
      s.gain.value = toSend;
      g.connect(s);
      s.connect(this.send);
    }
    return g;
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(this.out(0.9, t, 0.003, 0.34));
    o.start(t);
    o.stop(t + 0.36);
  }

  private snare(t: number, vel: number): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.8;
    n.connect(f);
    f.connect(this.out(0.32 * vel, t, 0.002, 0.18, 0.15));
    n.start(t, Math.random());
    n.stop(t + 0.2);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    o.connect(this.out(0.18 * vel, t, 0.002, 0.1));
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, dur: number, gain: number): void {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    n.connect(f);
    f.connect(this.out(gain, t, 0.001, dur));
    n.start(t, Math.random());
    n.stop(t + dur + 0.02);
  }

  private bass(t: number, midi: number, dur: number, vel: number, acid = false): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midiHz(midi);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midiHz(midi - 12);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = acid ? 9 : 2;
    const c = this.def.cutoff;
    f.frequency.setValueAtTime(c * (acid ? 3.5 * vel : 2.2), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(120, c * 0.35), t + dur * 0.8);
    o.connect(f);
    const g = this.out(0.16 * vel, t, 0.006, dur);
    f.connect(g);
    sub.connect(this.out(0.22 * vel, t, 0.006, dur));
    o.start(t);
    sub.start(t);
    o.stop(t + dur + 0.05);
    sub.stop(t + dur + 0.05);
  }

  private pluck(t: number, midi: number, dur: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = midiHz(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(this.def.cutoff * 4, t);
    f.frequency.exponentialRampToValueAtTime(this.def.cutoff * 0.6, t + dur);
    o.connect(f);
    f.connect(this.out(0.045, t, 0.004, dur, 0.5));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(t: number, notes: number[], dur: number): void {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1800, t + dur * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.5);
    g.gain.setValueAtTime(0.05, t + dur - 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
    f.connect(g);
    g.connect(this.bus);
    const s = ctx.createGain();
    s.gain.value = 0.3;
    g.connect(s);
    s.connect(this.send);
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.4);
      }
    }
  }

  private lead(t: number, midi: number, dur: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = this.def.lead === 'saw' ? 'sawtooth' : this.def.lead === 'square' ? 'square' : 'triangle';
    o.frequency.value = midiHz(midi);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibGain = ctx.createGain();
    vibGain.gain.value = 4;
    vib.connect(vibGain);
    vibGain.connect(o.detune);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = this.def.lead === 'triangle' ? 5000 : 2600;
    o.connect(f);
    f.connect(this.out(this.def.lead === 'triangle' ? 0.09 : 0.05, t, 0.02, dur + 0.15, 0.45));
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.2);
    vib.stop(t + dur + 0.2);
  }
}

function kickAt(d: Drums, i: number): boolean {
  switch (d) {
    case 'four':
      return i % 4 === 0;
    case 'electro':
      return i === 0 || i === 6 || i === 8 || i === 11;
    case 'break':
      return i === 0 || i === 7 || i === 10;
    case 'half':
      return i === 0 || i === 10;
    case 'dnb':
      return i === 0 || i === 10;
    case 'trap':
      return i === 0 || i === 7 || i === 11;
  }
}

function snareAt(d: Drums, i: number): boolean {
  switch (d) {
    case 'half':
    case 'trap':
      return i === 8;
    default:
      return i === 4 || i === 12;
  }
}

/** Plays the playlist: one track at a time, cross-faded, through a mood filter and a volume control. */
export class Music {
  private readonly master: GainNode;
  private readonly mood: BiquadFilterNode;
  private readonly send: GainNode;
  private player: TrackPlayer | null = null;
  private readonly fading: TrackPlayer[] = [];
  private timer = 0;
  private enabled = true;
  private volume = 0.6;
  /** The playlist and the track playing now. */
  private order: TrackDef[] = [];
  private pos = 0;
  private started = false;
  /** Where the track was when the music was switched off. */
  private resumeBar = 0;
  /** Called when a new track starts, with its name. */
  onTrack: ((name: string) => void) | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly noise: AudioBuffer,
  ) {
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.mood = ctx.createBiquadFilter();
    this.mood.type = 'lowpass';
    this.mood.frequency.value = 18000;
    this.mood.Q.value = 0.7;
    this.mood.connect(this.master);
    // Shared echo for plucks, pads and the lead.
    this.send = ctx.createGain();
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.36;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    this.send.connect(delay);
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay);
    tone.connect(this.mood);
    this.timer = window.setInterval(() => this.tick(), 25);
    this.applyLevel();
  }

  /** Starts the playlist once, with a random first track (not `avoid`). After that it simply keeps playing. */
  start(avoid = ''): void {
    if (this.started) return;
    this.started = true;
    this.order = shuffled(TRACKS.find((t) => t.id === avoid) ?? null);
    this.pos = 0;
    this.resumeBar = 0;
    if (this.enabled) this.startTrack(0, 2);
  }

  /** The track playing now (or paused while the music is off). */
  get current(): TrackDef | null {
    return this.started ? this.order[this.pos] : null;
  }

  /** Skips to the next track of the playlist. */
  next(): void {
    if (!this.started) return;
    this.pos++;
    if (this.pos >= this.order.length) {
      this.order = shuffled(this.order[this.order.length - 1]);
      this.pos = 0;
    }
    this.resumeBar = 0;
    if (this.enabled) this.startTrack(0, 2.5);
  }

  private startTrack(bar: number, fadeIn: number): void {
    const def = this.order[this.pos];
    this.fadeOut(5);
    const p = new TrackPlayer(this.ctx, def, this.mood, this.send, this.noise, bar);
    p.fadeTo(1, fadeIn);
    this.player = p;
    this.onTrack?.(def.name);
  }

  /** Lets the current track fade away while it keeps playing. */
  private fadeOut(seconds: number): void {
    const old = this.player;
    if (!old) return;
    this.player = null;
    old.fadeTo(0, seconds);
    old.stopped = true;
    this.fading.push(old);
    window.setTimeout(() => {
      old.bus.disconnect();
      const k = this.fading.indexOf(old);
      if (k >= 0) this.fading.splice(k, 1);
    }, seconds * 1000 + 400);
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on && this.player) {
      // Remember the place: switched on again, the track goes on from there.
      this.resumeBar = Math.floor(this.player.bar / 4) * 4;
      this.fadeOut(0.4);
    } else if (on && this.started) {
      const def = this.order[this.pos];
      if (this.resumeBar >= trackBars(def)) this.next();
      else this.startTrack(this.resumeBar, 1);
    }
    this.applyLevel();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyLevel();
  }

  private applyLevel(): void {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.enabled ? this.volume * 0.55 : 0, t, 0.2);
  }

  /** How open the mix sounds: muffled in pauses and after a crash, bright in flight. */
  setMood(m: Mood): void {
    const t = this.ctx.currentTime;
    const f = this.mood.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    switch (m) {
      case 'menu':
        f.setTargetAtTime(5200, t, 0.4);
        break;
      case 'countdown':
        f.setValueAtTime(600, t);
        f.exponentialRampToValueAtTime(18000, t + 3);
        break;
      case 'flight':
        f.setTargetAtTime(14000, t, 0.25);
        break;
      case 'boost':
        f.setTargetAtTime(19000, t, 0.1);
        break;
      case 'down':
        f.setTargetAtTime(1300, t, 0.3);
        break;
      case 'pause':
        f.setTargetAtTime(700, t, 0.2);
        break;
    }
  }

  private tick(): void {
    if (this.ctx.state !== 'running') return;
    const until = this.ctx.currentTime + 0.15;
    const p = this.player;
    if (p) {
      p.schedule(until);
      // The track has played its length: the next one comes in while this one fades.
      if (p.bar >= trackBars(p.def)) this.next();
    }
    for (const f of this.fading) f.schedule(until);
  }

  dispose(): void {
    window.clearInterval(this.timer);
    this.master.disconnect();
  }
}
