// The village's sound, made on the spot with WebAudio: nothing is downloaded.
// Wind (filtered noise that gusts), rain when it is wet, the stream louder as you get near it,
// birds by day, crickets on dry nights, and soft footsteps. Off until the visitor turns it on.

export interface SoundScene {
  dt: number;
  /** 0 at night, 1 in full daylight. */
  daylight: number;
  weather: 'clear' | 'cloudy' | 'drizzle' | 'rain' | 'fog';
  /** 1 calm, up to about 2.2 in rain (from the look). */
  wind: number;
  /** Metres from the camera to the nearest water. */
  streamDist: number;
}

export interface Sound {
  readonly on: boolean;
  /** Turns sound on or off (must be called from a click the first time). Returns the new state. */
  toggle(): Promise<boolean>;
  update(s: SoundScene): void;
  /** One footstep, `dist` metres from the camera; `size` 0.5 for one of Khina's hops, 0.7 for the hedgehog. */
  step(dist: number, size: number): void;
  /** Live node count, for checking the graph. */
  nodes(): number;
}

const KEY = 'khina.sound';
const MASTER = 0.55;

function remembered(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
function remember(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode: fine */
  }
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createSound(): Sound {
  let ctx: AudioContext | null = null;
  let on = false;
  let live = 0; // short-lived nodes playing now (chirps, steps)
  let master: GainNode;
  let windGain: GainNode, windFilter: BiquadFilterNode;
  let rainGain: GainNode, rainFilter: BiquadFilterNode;
  let streamGain: GainNode, streamA: BiquadFilterNode, streamB: BiquadFilterNode;
  let birdBus: GainNode, nightBus: GainNode;
  let noiseBuf: AudioBuffer;
  const steady = 13; // the always-on nodes built in build()
  let clock = 0;
  let nextBird = 2;
  let nextCricket = [0.3, 0.7, 1.1];
  let nextBabble = 0;
  let state = { daylight: 1, wet: 0, dark: false };

  function noise(seconds: number): AudioBuffer {
    // Pinkish noise (Voss-like smoothing of white): softer than white, fine for wind and water.
    const len = Math.floor(ctx!.sampleRate * seconds);
    const buf = ctx!.createBuffer(1, len, ctx!.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029591;
      b1 = 0.985 * b1 + w * 0.032534;
      b2 = 0.95 * b2 + w * 0.048056;
      d[i] = (b0 + b1 + b2 + w * 0.05) * 0.9;
    }
    return buf;
  }

  function loop(buf: AudioBuffer, offset: number): AudioBufferSourceNode {
    const src = ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(0, offset);
    return src;
  }

  function build() {
    ctx = new AudioContext();
    noiseBuf = noise(4);
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // Wind: low-passed noise whose level and brightness gust.
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    loop(noiseBuf, 0).connect(windFilter).connect(windGain).connect(master);

    // Rain: brighter noise, louder in rain than drizzle.
    rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 2600;
    rainFilter.Q.value = 0.35;
    rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    loop(noiseBuf, 1.3).connect(rainFilter).connect(rainGain).connect(master);

    // The stream: two band-passes that wander, for a burble rather than a hiss.
    streamA = ctx.createBiquadFilter();
    streamA.type = 'bandpass';
    streamA.frequency.value = 900;
    streamA.Q.value = 1.4;
    streamB = ctx.createBiquadFilter();
    streamB.type = 'bandpass';
    streamB.frequency.value = 1700;
    streamB.Q.value = 2.2;
    streamGain = ctx.createGain();
    streamGain.gain.value = 0;
    const src = loop(noiseBuf, 2.6);
    src.connect(streamA).connect(streamGain);
    src.connect(streamB).connect(streamGain);
    streamGain.connect(master);

    birdBus = ctx.createGain();
    birdBus.gain.value = 0.5;
    birdBus.connect(master);
    nightBus = ctx.createGain();
    nightBus.gain.value = 0.16;
    nightBus.connect(master);

    addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) void ctx.suspend();
      else if (on) void ctx.resume();
    });
  }

  /** A short-lived voice: oscillator → envelope → pan → bus; tidies itself up when done. */
  function voice(bus: AudioNode, at: number, pan: number, make: (osc: OscillatorNode, env: GainNode, t: number) => number) {
    const c = ctx!;
    const osc = c.createOscillator();
    const env = c.createGain();
    env.gain.value = 0;
    const p = c.createStereoPanner();
    p.pan.value = pan;
    osc.connect(env).connect(p).connect(bus);
    const end = make(osc, env, at);
    osc.start(at);
    osc.stop(end + 0.05);
    live += 3;
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
      p.disconnect();
      live -= 3;
    };
  }

  // A few bird calls, loosely after real ones.
  const BIRDS: ((t: number, pan: number, vol: number) => void)[] = [
    // Robin-ish: a quick run of falling, wobbling notes.
    (t, pan, vol) => {
      const n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const f = 3400 + Math.random() * 1600;
        voice(birdBus, t + i * 0.13, pan, (o, e, at) => {
          o.type = 'sine';
          o.frequency.setValueAtTime(f, at);
          o.frequency.exponentialRampToValueAtTime(f * 0.72, at + 0.09);
          e.gain.setValueAtTime(0, at);
          e.gain.linearRampToValueAtTime(vol, at + 0.012);
          e.gain.exponentialRampToValueAtTime(0.0008, at + 0.1);
          return at + 0.1;
        });
      }
    },
    // Wren-ish trill: one fast-warbling note.
    (t, pan, vol) => {
      const dur = 0.5 + Math.random() * 0.5;
      voice(birdBus, t, pan, (o, e, at) => {
        o.type = 'sine';
        o.frequency.setValueAtTime(3800, at);
        const steps = Math.floor(dur / 0.035);
        for (let i = 1; i <= steps; i++) o.frequency.setValueAtTime(i % 2 ? 4300 : 3600, at + i * 0.035);
        e.gain.setValueAtTime(0, at);
        e.gain.linearRampToValueAtTime(vol * 0.7, at + 0.04);
        e.gain.setValueAtTime(vol * 0.7, at + dur - 0.06);
        e.gain.linearRampToValueAtTime(0, at + dur);
        return at + dur;
      });
    },
    // Wood pigeon: soft low "hoo-hoo, hoo".
    (t, pan, vol) => {
      [0, 0.55, 0.95, 1.7].forEach((dt, i) => {
        voice(birdBus, t + dt, pan, (o, e, at) => {
          o.type = 'triangle';
          const f = i === 1 ? 560 : 500;
          o.frequency.setValueAtTime(f, at);
          o.frequency.linearRampToValueAtTime(f * 0.93, at + 0.32);
          e.gain.setValueAtTime(0, at);
          e.gain.linearRampToValueAtTime(vol * 0.55, at + 0.08);
          e.gain.linearRampToValueAtTime(0, at + 0.34);
          return at + 0.34;
        });
      });
    },
    // Tit-ish "see-saw": two alternating notes, repeated.
    (t, pan, vol) => {
      const hi = 5200 + Math.random() * 600;
      for (let i = 0; i < 4; i++) {
        voice(birdBus, t + i * 0.22, pan, (o, e, at) => {
          o.type = 'sine';
          o.frequency.setValueAtTime(i % 2 ? hi * 0.78 : hi, at);
          e.gain.setValueAtTime(0, at);
          e.gain.linearRampToValueAtTime(vol * 0.6, at + 0.015);
          e.gain.linearRampToValueAtTime(0, at + 0.11);
          return at + 0.11;
        });
      }
    },
  ];

  function cricket(t: number, pan: number, f: number) {
    voice(nightBus, t, pan, (o, e, at) => {
      o.type = 'sine';
      o.frequency.value = f;
      // Three quick pulses.
      for (let i = 0; i < 3; i++) {
        const s = at + i * 0.045;
        e.gain.setValueAtTime(0, s);
        e.gain.linearRampToValueAtTime(0.5, s + 0.006);
        e.gain.linearRampToValueAtTime(0, s + 0.03);
      }
      return at + 0.16;
    });
  }

  return {
    get on() {
      return on;
    },
    async toggle() {
      on = !on;
      remember(on);
      if (on && !ctx) build();
      if (ctx) {
        if (on) await ctx.resume().catch(() => undefined);
        const g = master.gain;
        g.cancelScheduledValues(ctx.currentTime);
        g.setTargetAtTime(on ? MASTER : 0, ctx.currentTime, 0.4);
        if (!on) setTimeout(() => !on && void ctx?.suspend(), 1500);
      }
      return on;
    },
    update(s) {
      if (!ctx || !on || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      clock += s.dt;
      const wet = s.weather === 'rain' ? 1 : s.weather === 'drizzle' ? 0.45 : 0;
      state = { daylight: s.daylight, wet, dark: s.daylight < 0.2 };

      // Wind gusts: two slow waves multiplied, so calm spells and gusts both happen.
      const gust = 0.5 + 0.5 * Math.sin(clock * 0.21) * Math.sin(clock * 0.067 + 1.3);
      const w = Math.min(2.2, s.wind);
      windGain.gain.setTargetAtTime(0.05 + 0.1 * gust * w, now, 0.5);
      windFilter.frequency.setTargetAtTime(260 + 420 * gust * (0.6 + 0.4 * w), now, 0.6);

      rainGain.gain.setTargetAtTime(0.16 * wet, now, 1.2);

      const near = smooth(28, 2.5, s.streamDist);
      streamGain.gain.setTargetAtTime(0.32 * near, now, 0.4);
      nextBabble -= s.dt;
      if (near > 0.01 && nextBabble <= 0) {
        nextBabble = 0.12 + Math.random() * 0.25;
        streamA.frequency.setTargetAtTime(650 + Math.random() * 700, now, 0.08);
        streamB.frequency.setTargetAtTime(1400 + Math.random() * 1200, now, 0.06);
      }

      // Birds by day: fewer in drizzle, none in rain.
      nextBird -= s.dt;
      if (nextBird <= 0) {
        const lively = smooth(0.25, 0.7, state.daylight) * (1 - wet * 0.9);
        nextBird = 1.5 + Math.random() * 5 / Math.max(0.2, lively);
        if (lively > 0.05 && Math.random() < lively) {
          const call = BIRDS[Math.floor(Math.random() * BIRDS.length)]!;
          call(now + 0.05, Math.random() * 1.6 - 0.8, 0.05 + Math.random() * 0.05);
        }
      }

      // Crickets on dry nights: a few, each keeping its own pace and place.
      if (state.dark && wet === 0) {
        nextCricket = nextCricket.map((n, i) => {
          n -= s.dt;
          if (n > 0) return n;
          cricket(now + 0.02, [-0.6, 0.15, 0.7][i]!, [4300, 4650, 4900][i]!);
          return 0.55 + i * 0.13 + Math.random() * 0.25;
        });
      }
    },
    step(dist, size) {
      if (!ctx || !on || ctx.state !== 'running') return;
      const vol = (0.09 * size) / (1 + dist * dist * 0.08);
      if (vol < 0.004) return;
      const c = ctx;
      const at = c.currentTime + 0.01;
      const src = c.createBufferSource();
      src.buffer = noiseBuf;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = (state.wet ? 1400 : 900) * (1.3 - size * 0.4);
      const env = c.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(vol, at + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0005, at + 0.07);
      src.connect(f).connect(env).connect(master);
      src.start(at, Math.random() * 3, 0.09);
      live += 3;
      src.onended = () => {
        src.disconnect();
        f.disconnect();
        env.disconnect();
        live -= 3;
      };
    },
    nodes() {
      return ctx ? steady + live : 0;
    },
  };
}

/** The round sound button: icon only, remembers the choice, resumes on the next tap if autoplay was blocked. */
export function mountSoundButton(btn: HTMLButtonElement, sound: Sound) {
  const ICON_ON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  const ICON_OFF =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
  const show = () => {
    btn.innerHTML = sound.on ? ICON_ON : ICON_OFF;
    btn.setAttribute('aria-pressed', String(sound.on));
    btn.setAttribute('aria-label', sound.on ? 'Sound on' : 'Sound off');
    btn.title = sound.on ? 'Sound on' : 'Sound off';
  };
  btn.hidden = false;
  btn.addEventListener('click', () => void sound.toggle().then(show));
  show();
  // Sound was on last time: browsers only let audio start after a tap, so start on the first one.
  if (remembered()) {
    const start = (e: Event) => {
      removeEventListener('pointerdown', start, true);
      removeEventListener('keydown', start, true);
      if (e.target instanceof Node && btn.contains(e.target)) return; // the button's own click decides
      if (!sound.on) void sound.toggle().then(show);
    };
    addEventListener('pointerdown', start, true);
    addEventListener('keydown', start, true);
    btn.setAttribute('aria-label', 'Sound off (tap anywhere to turn it back on)');
  }
}
