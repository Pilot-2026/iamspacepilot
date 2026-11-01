import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Music, TRACKS, shuffled, trackBars } from '../src/audio/music';

/** Just enough of the Web Audio API for the music scheduler: every node accepts everything. */
function fakeNode(): Record<string, unknown> {
  const param = () => {
    const p: Record<string, unknown> = { value: 0 };
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues']) p[m] = () => p;
    return p;
  };
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === 'connect') return (n: unknown) => n;
      if (['gain', 'frequency', 'Q', 'detune', 'pan', 'delayTime'].includes(k)) return (t[k] = param());
      return () => undefined;
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
}

function fakeContext(): AudioContext & { currentTime: number } {
  const ctx = {
    currentTime: 0,
    state: 'running',
    sampleRate: 8000,
    destination: fakeNode(),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
  } as Record<string, unknown>;
  for (const m of ['createGain', 'createBiquadFilter', 'createDelay', 'createOscillator', 'createBufferSource', 'createStereoPanner']) ctx[m] = () => fakeNode();
  return ctx as unknown as AudioContext & { currentTime: number };
}

describe('music playlist', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Lets audio time and timers run on together. */
  function run(ctx: { currentTime: number }, seconds: number): void {
    for (let t = 0; t < seconds; t += 0.025) {
      ctx.currentTime += 0.025;
      vi.advanceTimersByTime(25);
    }
  }

  it('shuffles all tracks and never repeats the last one first', () => {
    for (let i = 0; i < 50; i++) {
      const list = shuffled(TRACKS[i % TRACKS.length]);
      expect(new Set(list.map((t) => t.id)).size).toBe(TRACKS.length);
      expect(list[0]).not.toBe(TRACKS[i % TRACKS.length]);
    }
  });

  it('plays one track after another and keeps going when asked to start again', () => {
    const ctx = fakeContext();
    const music = new Music(ctx, ctx.createBuffer(1, 100, 8000));
    const played: string[] = [];
    music.onTrack = (n) => played.push(n);
    music.start();
    music.start();
    expect(played.length).toBe(1);
    const first = music.current!;
    const length = (trackBars(first) * 4 * 60) / first.bpm;
    run(ctx, length - 2);
    expect(played.length).toBe(1);
    run(ctx, 3);
    expect(played.length).toBe(2);
    expect(music.current).not.toBe(first);
    music.dispose();
  });

  it('goes on with the same track after the music was off for a moment', () => {
    const ctx = fakeContext();
    const music = new Music(ctx, ctx.createBuffer(1, 100, 8000));
    const played: string[] = [];
    music.onTrack = (n) => played.push(n);
    music.start();
    run(ctx, 20);
    music.setEnabled(false);
    run(ctx, 5);
    music.setEnabled(true);
    expect(played).toEqual([played[0], played[0]]);
    music.dispose();
  });

  it('starts with a different track on different visits', () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 30; i++) firsts.add(shuffled()[0].id);
    expect(firsts.size).toBeGreaterThan(3);
  });
});
