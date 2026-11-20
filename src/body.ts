// Khina's body: needs drop, thoughts fade, mood and energy drift. No model involved.

import { body, NEEDS, type Effects, type NeedId } from './config.ts';
import type { State, Thought } from './state.ts';
import { dayOf, isNight } from './time.ts';

export const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

function approach(current: number, target: number, maxStep: number): number {
  if (Math.abs(target - current) <= maxStep) return target;
  return current + Math.sign(target - current) * maxStep;
}

/** Advance the body by one game minute. `perMinute` is what the current activity does each minute. */
export function tickBody(s: State, perMinute: Effects | null, asleep: boolean): void {
  const night = isNight(s.t);
  for (const n of NEEDS) {
    let decay = (asleep ? body.decayAsleep[n] : body.decayAwake[n]) * s.personality.decay[n];
    if (n === 'rest' && !asleep && night) decay *= body.nightRestFactor;
    s.needs[n] = clamp(s.needs[n] - decay / 60 + (perMinute?.[n] ?? 0));
    s.pastLine[n] = s.needs[n] < body.line ? s.pastLine[n] + 1 : 0;
  }
  s.thoughts = s.thoughts.filter((th) => th.until > s.t);

  const target = moodTarget(s);
  const step = (target > s.mood ? body.moodUpPerHour : body.moodDownPerHour) / 60;
  s.mood = approach(s.mood, target, step);
  s.energy = approach(s.energy, energyTarget(s), body.energyPerHour / 60);
}

export function applyEffects(s: State, e: Effects): void {
  for (const n of NEEDS) if (e[n]) s.needs[n] = clamp(s.needs[n] + (e[n] as number));
}

export function addThought(s: State, th: { key: string; text: string; value: number; hours: number; who?: string }): void {
  s.thoughts = s.thoughts.filter((x) => x.key !== th.key);
  s.thoughts.push({ key: th.key, text: th.text, value: th.value, at: s.t, until: s.t + Math.round(th.hours * 60), ...(th.who ? { who: th.who } : {}) });
}

// What a need past the line sounds like in Khina's head, from mild to bad.
const NEED_VOICE: Record<NeedId, [string[], string[]]> = {
  fullness: [
    ['Tummy is grumbling.', 'Could do with something to eat.', 'Thinking about clover. A lot.'],
    ['Starving.', 'So hungry it hurts.', 'Empty all the way down.'],
  ],
  rest: [
    ['Eyes keep drifting shut.', 'Ears keep drooping.', 'Could flop down anywhere.'],
    ['So tired everything is blurry.', 'Can barely keep going.', 'Running on nothing.'],
  ],
  calm: [
    ['Jumpy. Cannot settle.', 'Ears keep swivelling at nothing.', 'Everything is a bit much.'],
    ['Everything is too much.', 'A back foot keeps wanting to thump.', 'Want to press flat under something and stay there.'],
  ],
  company: [
    ['Not a word from anyone in ages.', 'Quiet on my own today.', 'Would not mind seeing a face.'],
    ['Lonely. Properly lonely.', 'Nobody, all day.', 'Starting to talk to the furniture.'],
  ],
  novelty: [
    ['Same old, same old.', 'Nothing new ever happens here.', 'Bored.'],
    ['Bored to the tips of my ears.', 'If nothing changes soon I will scream.', 'Every day is the same day.'],
  ],
  making: [
    ['Paws want to make something.', 'Have not made anything in a while.', 'Itchy to build something.'],
    ['Really need to make something.', 'Head is full of things that want to be made.', 'Paws will not stop fidgeting.'],
  ],
};

const NEED_GOOD: Partial<Record<NeedId, string>> = {
  fullness: 'Belly is nicely full.',
  rest: 'Feeling rested.',
  calm: 'Feeling settled.',
  company: 'Good to have seen people today.',
  novelty: 'Plenty new to think about today.',
  making: 'Made something today. That feels right.',
};

/** Thoughts that come from the needs themselves. Recomputed every minute, never stored. */
export function needThoughts(s: State): (Thought & { need: NeedId })[] {
  const out: (Thought & { need: NeedId })[] = [];
  const day = dayOf(s.t);
  for (const n of NEEDS) {
    const v = s.needs[n];
    if (v < body.line) {
      const hours = s.pastLine[n] / 60;
      const nt = body.needThought;
      const bad = v < body.critical;
      const value = -(Math.min(nt.cap, nt.base + nt.perHour * hours) + (bad ? nt.criticalExtra : 0));
      const voices = NEED_VOICE[n][bad ? 1 : 0];
      const text = voices[(day + n.length) % voices.length] as string;
      out.push({ key: `need:${n}`, need: n, text, value, at: s.t - s.pastLine[n], until: Infinity });
    } else if (v >= 85 && NEED_GOOD[n] && !(n === 'rest' && s.activity?.actionId === 'sleep')) {
      out.push({ key: `need:${n}`, need: n, text: NEED_GOOD[n] as string, value: 2, at: s.t, until: Infinity });
    }
  }
  return out;
}

export function moodTarget(s: State): number {
  let v = s.personality.moodBase;
  for (const th of needThoughts(s)) v += th.value;
  for (const th of s.thoughts) v += th.value;
  return clamp(v);
}

/** Being tired drains energy; being rattled winds Khina up. */
export function energyTarget(s: State): number {
  const rattled = s.needs.calm < 25 ? 12 : 0;
  return clamp(0.7 * s.needs.rest + 0.3 * s.needs.fullness + rattled);
}

// Words, never numbers, are what the model sees.

export function moodWord(m: number): string {
  if (m < 20) return 'miserable';
  if (m < 38) return 'grumpy';
  if (m < 50) return 'a bit low';
  if (m < 62) return 'alright';
  if (m < 78) return 'content';
  return 'happy';
}

export function energyWord(e: number): string {
  if (e < 15) return 'spent';
  if (e < 35) return 'sluggish';
  if (e < 60) return 'steady';
  if (e < 80) return 'lively';
  return 'buzzing';
}

const BANDS: Record<NeedId, [string, string, string]> = {
  fullness: ['starving', 'hungry', 'peckish'],
  rest: ['exhausted', 'tired', 'a bit worn'],
  calm: ['frazzled', 'on edge', 'a bit unsettled'],
  company: ['lonely', 'missing company', 'could use a chat'],
  novelty: ['bored stiff', 'bored', 'restless for something new'],
  making: ['itching to make something', 'wanting to make something', 'a slight urge to make something'],
};

/** The pressing needs in words, worst first. Needs that are fine are left out. */
export function pressingWords(s: State): string[] {
  return NEEDS.filter((n) => s.needs[n] < 60)
    .sort((a, b) => s.needs[a] - s.needs[b])
    .map((n) => {
      const v = s.needs[n];
      const [crit, low, mild] = BANDS[n];
      return v < body.critical ? crit : v < body.line ? low : mild;
    });
}
