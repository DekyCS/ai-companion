// Going stale and learning tastes. Both are code-only numbers; the model sees at most
// a few words ("done a lot lately", "has come to like the trains").

import { beliefs as beliefCfg, habit, NEEDS, taste, type Effects } from '../config.ts';
import type { Belief, State, Taste } from '../state.ts';
import { dayOf } from '../time.ts';
import type { ActionDef } from '../world/actions.ts';
import { PLACES, type PlaceId } from '../world/places.ts';

/** Actions too basic to go stale or to be learned as a taste. */
export const ROUTINE = new Set(['sleep', 'nap', 'snack']);

const fam = (s: State, key: string) => s.familiarity[key] ?? 0;

/** How much of its usual benefit an action gives right now: 1 when fresh, lower when overdone. */
export function staleFactor(s: State, def: ActionDef): number {
  if (!s.features.habituation || ROUTINE.has(def.id)) return 1;
  return Math.pow(1 + fam(s, `a:${def.id}`) + habit.topicWeight * fam(s, `t:${def.topic}`), -habit.exponent);
}

/** Experiment: Pino-style fixed penalty. Anything done in the last day appeals 7 times less, however often. */
export function penaltyFactor(s: State, def: ActionDef): number {
  if (!s.features.fixedPenalty || ROUTINE.has(def.id)) return 1;
  const since = s.t - habit.fixedWindowMin;
  const lately = s.history.some((h) => h.kind === 'done' && h.actionId === def.id && h.end > since);
  return lately ? 1 / habit.fixedPenalty : 1;
}

/** The actions done most over the last day or so. */
export function habits(s: State, n = 3): string[] {
  return Object.entries(s.familiarity)
    .filter(([k, v]) => k.startsWith('a:') && v >= 1.5 && !ROUTINE.has(k.slice(2)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k.slice(2));
}

/**
 * The factor for how new an action feels. Exploring is exempt: each new path leads somewhere
 * different, so it stays new until the woods run out of paths (which the action itself handles).
 */
export function noveltyFactor(def: ActionDef, stale: number): number {
  return def.topic === 'exploring' ? 1 : stale;
}

/** Scales the positive novelty of an effect table by the stale factor: the same old thing is not new. */
export function staleEffects(e: Effects, factor: number): Effects {
  if (factor >= 1) return e;
  const out: Effects = {};
  for (const n of NEEDS) {
    const v = e[n];
    if (v === undefined) continue;
    out[n] = v > 0 && habit.staleNeeds.includes(n) ? v * factor : v;
  }
  return out;
}

export function familiarityOf(s: State, def: ActionDef): number {
  return fam(s, `a:${def.id}`);
}

/** Novelty from doing something unfamiliar, in a place not visited lately. */
export function unfamiliarNovelty(s: State, def: ActionDef, place: PlaceId): number {
  if (!s.features.habituation || ROUTINE.has(def.id)) return 0;
  const a = habit.unfamiliarNovelty / Math.pow(1 + fam(s, `a:${def.id}`), habit.unfamiliarFalloff);
  const p = (habit.unfamiliarNovelty / 2) / Math.pow(1 + fam(s, `p:${place}`), habit.unfamiliarFalloff);
  return a + p;
}

export function recordUse(s: State, def: ActionDef, place: PlaceId): void {
  if (!s.features.habituation) return;
  const f = s.familiarity;
  f[`a:${def.id}`] = fam(s, `a:${def.id}`) + 1;
  f[`t:${def.topic}`] = fam(s, `t:${def.topic}`) + habit.topicShare;
  f[`p:${place}`] = fam(s, `p:${place}`) + habit.placeShare;
}

/** Familiarity fades with a half-life of about a pet-day; tastes fade far more slowly. */
export function decay(s: State, minutes: number): void {
  const k = Math.pow(0.5, minutes / habit.halfLifeMin);
  for (const key of Object.keys(s.familiarity)) {
    const v = (s.familiarity[key] as number) * k;
    if (v < 0.01) delete s.familiarity[key];
    else s.familiarity[key] = v;
  }
  const kf = Math.pow(0.5, minutes / (taste.fastHalfLifeDays * 1440));
  const ks = Math.pow(0.5, minutes / (taste.slowHalfLifeDays * 1440));
  const kp = Math.pow(0.5, minutes / (taste.practiceHalfLifeDays * 1440));
  for (const t of Object.values(s.tastes)) {
    t.fast *= kf;
    t.slow *= ks;
    if (t.practice) t.practice *= kp;
  }
}

/** After an action: remember how it actually felt, as taste and as evidence for beliefs. */
export function recordFeeling(s: State, def: ActionDef, place: PlaceId, felt: number): void {
  const v = Math.max(-taste.clampExperience, Math.min(taste.clampExperience, felt));
  const day = dayOf(s.t);
  for (const key of keysFor(def, place)) {
    const ev = (s.evidence[key] ??= {});
    const d = (ev[day] ??= { sum: 0, n: 0 });
    d.sum += v;
    d.n += 1;
    if (!s.features.tastes) continue;
    const t: Taste = (s.tastes[key] ??= { fast: 0, slow: 0, n: 0 });
    t.fast += taste.fastRate * (v - t.fast);
    t.slow += taste.slowRate * (v - t.slow);
    t.n += 1;
    if (!taste.practicePerDay || t.practiceDay !== day) t.practice = (t.practice ?? 0) + 1;
    t.practiceDay = day;
  }
}

function keysFor(def: ActionDef, place: PlaceId): string[] {
  return ROUTINE.has(def.id) ? [] : [`a:${def.id}`, `p:${place}`];
}

export function tasteValue(s: State, key: string): number {
  const t = s.tastes[key];
  return t ? t.fast + t.slow : 0;
}

/** Score multiplier from learned likes for the action and its place. */
export function tasteMult(s: State, def: ActionDef, place: PlaceId): number {
  if (!s.features.tastes || ROUTINE.has(def.id)) return 1;
  const v = tasteValue(s, `a:${def.id}`) + 0.5 * tasteValue(s, `p:${place}`);
  return Math.min(taste.maxMult, Math.max(taste.minMult, Math.exp(taste.scoreGain * v)));
}

/** Pull of practice: things done often lately become acquired tastes. Scoring evens it out across options. */
export function practiceMult(s: State, def: ActionDef): number {
  if (!s.features.tastes || ROUTINE.has(def.id)) return 1;
  return Math.min(taste.practiceMax, Math.pow(1 + (s.tastes[`a:${def.id}`]?.practice ?? 0), taste.practiceGain));
}

/** This copy's own habits: its few most-practised actions. */
export function ownHabits(s: State): Set<string> {
  const cfg = taste.habitWords;
  return new Set(
    Object.entries(s.tastes)
      .filter(([k, t]) => k.startsWith('a:') && k !== 'a:idle' && (t.practice ?? 0) >= cfg.habitAt)
      .sort((a, b) => (b[1].practice ?? 0) - (a[1].practice ?? 0))
      .slice(0, cfg.top)
      .map(([k]) => k.slice(2)),
  );
}

/** Words for Claude about how much this copy does an option: its own habit, or hardly ever. */
export function habitNote(s: State, def: ActionDef, own: Set<string>): string {
  if (!s.features.habitWords || !s.features.tastes || ROUTINE.has(def.id) || def.id === 'idle') return '';
  if (own.has(def.id)) return "one of Khina's habits";
  const cfg = taste.habitWords;
  if (dayOf(s.t) >= cfg.rareFromDay && (s.tastes[`a:${def.id}`]?.practice ?? 0) < cfg.rareBelow) return 'Khina hardly ever does this';
  return '';
}

/** The few actions Khina currently likes most (experienced at least 3 times). */
export function favourites(s: State, n = 3): string[] {
  return Object.entries(s.tastes)
    .filter(([k, t]) => k.startsWith('a:') && t.n >= 3 && t.fast + t.slow > 0)
    .sort((a, b) => b[1].fast + b[1].slow - (a[1].fast + a[1].slow))
    .slice(0, n)
    .map(([k]) => k.slice(2));
}

/**
 * Beliefs come from code's counts, never from the model: a key needs mood to have gone the
 * same way on several distinct days. The model may only reword them.
 */
export function computeBeliefs(s: State, label: (key: string) => string): Belief[] {
  const today = dayOf(s.t);
  const out: Belief[] = [];
  for (const [key, byDay] of Object.entries(s.evidence)) {
    const days = Object.entries(byDay).filter(([d]) => today - Number(d) < beliefCfg.windowDays);
    if (days.length < beliefCfg.minDays) continue;
    const means = days.map(([, x]) => x.sum / x.n);
    const pos = means.filter((m) => m >= beliefCfg.dayThreshold).length;
    const neg = means.filter((m) => m <= -beliefCfg.dayThreshold).length;
    const polarity = pos >= beliefCfg.minDays && pos / days.length >= beliefCfg.agreement
      ? 'likes'
      : neg >= beliefCfg.minDays && neg / days.length >= beliefCfg.agreement
        ? 'dislikes'
        : null;
    if (!polarity) continue;
    const support = polarity === 'likes' ? pos : neg;
    out.push({ key, polarity, days: support, of: days.length, text: beliefText(key, polarity, label) });
  }
  return out.sort((a, b) => b.days - a.days);
}

export function beliefText(key: string, polarity: 'likes' | 'dislikes', label: (key: string) => string): string {
  const what = label(key);
  return polarity === 'likes' ? `Khina has come to like ${what}.` : `Khina is not keen on ${what}.`;
}

/** Words for an evidence key: "waiting for the train", "the stream". */
export function keyLabel(key: string, doing: (id: string) => string): string {
  if (key.startsWith('p:')) return PLACES[key.slice(2) as PlaceId]?.short ?? key;
  return doing(key.slice(2));
}

/** How an action felt: what happened, plus a small share of the relief from needs. */
export function feltValue(eventValue: number, needRelief: number): number {
  return eventValue + taste.reliefShare * needRelief;
}
