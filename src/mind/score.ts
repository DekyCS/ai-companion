// Code's opinion of every option: Sims-style need scoring. The model never sees these numbers.

import { habit, mind, NEEDS, type Effects, type NeedId } from '../config.ts';
import type { Rng } from '../rng.ts';
import type { State } from '../state.ts';
import { ACTIONS, type ActionDef, type Ctx } from '../world/actions.ts';
import { travelMinutes, type PlaceId } from '../world/places.ts';
import { familiarityOf, noveltyFactor, penaltyFactor, practiceMult, staleEffects, staleFactor, tasteMult, unfamiliarNovelty } from './habit.ts';

/** Attenuation: a point of need matters more the lower the need is. */
export const atten = (x: number) => 100 / (Math.max(0, x) + 5);

export interface Option {
  def: ActionDef;
  place: PlaceId;
  travel: number;
  /** When the action would start. */
  at: number;
  score: number;
  /** Needs this option mostly helps, best first. */
  helps: NeedId[];
  note: string;
  /** How overdone it is lately (0 = not at all). */
  familiarity: number;
}

export type Tier = 'exhausted' | 'starving' | null;

/** Must-do states override choice: only actions that fix the need are allowed. */
export function tier(s: State): Tier {
  if (s.needs.rest < mind.tiers.exhaustedBelow) return 'exhausted';
  if (s.needs.fullness < mind.tiers.starvingBelow) return 'starving';
  return null;
}

export function placeOf(def: ActionDef, s: State): PlaceId {
  return def.place === 'here' ? s.place : def.place;
}

/** What an option is expected to do to each need. */
export function expectedEffects(def: ActionDef, c: Ctx): Effects {
  if (def.estimate) return def.estimate(c);
  const out: Effects = { ...def.effects };
  const extra = def.expect?.(c) ?? {};
  for (const n of NEEDS) if (extra[n]) out[n] = (out[n] ?? 0) + (extra[n] as number);
  return out;
}

/** Sum over needs of weight × (how much the need hurts now − how much it would hurt after). */
export function needScore(s: State, e: Effects): { total: number; byNeed: Partial<Record<NeedId, number>> } {
  let total = 0;
  const byNeed: Partial<Record<NeedId, number>> = {};
  for (const n of NEEDS) {
    const d = e[n];
    if (!d) continue;
    const now = s.needs[n];
    const after = Math.min(100, Math.max(0, now + d));
    const raw = (atten(now) - atten(after)) * s.personality.weight[n];
    const gain = raw < 0 ? raw * mind.costWeight : raw;
    byNeed[n] = gain;
    total += gain;
  }
  return { total, byNeed };
}

function fixesTier(t: Tier, e: Effects): boolean {
  if (t === 'exhausted') return (e.rest ?? 0) >= 10;
  if (t === 'starving') return (e.fullness ?? 0) >= 10;
  return true;
}

/**
 * Every action Khina could start now, with code's score.
 * Masked (recently done), impossible, and wrong-tier actions are left out.
 * In a must-do state the mask is lifted: survival beats boredom.
 */
export function options(s: State, rng: Rng): Option[] {
  const t = tier(s);
  if (t) {
    const urgent = collect(s, rng, t, false);
    if (urgent.length) return urgent;
  }
  const normal = collect(s, rng, null, true);
  if (normal.length) return normal;
  return collect(s, rng, null, false);
}

function collect(s: State, rng: Rng, t: Tier, useMask: boolean): Option[] {
  const masked = new Set(useMask ? s.recent.slice(0, mind.maskLength) : []);
  const parts: { o: Omit<Option, 'score'>; pressing: number; free: number; practice: number; mult: number }[] = [];
  for (const def of ACTIONS) {
    const place = placeOf(def, s);
    const travel = travelMinutes(s.place, place);
    const c: Ctx = { s, rng, at: s.t + travel };
    if (masked.has(def.id)) continue;
    if (def.blocked?.(c)) continue;
    const fresh = expectedEffects(def, c);
    if (!fixesTier(t, fresh)) continue;
    // Going stale: overdone things appeal less and feel less new. Unfamiliar things promise something new.
    const stale = staleFactor(s, def);
    const e = staleEffects(fresh, noveltyFactor(def, stale));
    const curiosity = unfamiliarNovelty(s, def, place);
    if (curiosity) e.novelty = (e.novelty ?? 0) + curiosity;
    if (def.effort === 'hard' && s.energy < 20) continue;

    const { total, byNeed } = needScore(s, e);
    // Going stale, tastes and practice shape the appeal, but never what a pressing need asks for:
    // lonely, any chat is welcome; hungry, a favourite pastime does not beat food.
    const pressing = NEEDS.reduce((a, n) => a + (s.needs[n] < habit.pressingBelow ? (byNeed[n] ?? 0) : 0), 0);
    let mult = 1;
    if (def.effort === 'hard' && s.energy < 50) mult *= s.energy / 50;
    mult *= def.scoreMult?.(c) ?? 1;
    mult *= 1 / (1 + travel / 25);

    const helps = (Object.keys(byNeed) as NeedId[])
      .filter((n) => (byNeed[n] ?? 0) > 0)
      .sort((a, b) => (byNeed[b] ?? 0) - (byNeed[a] ?? 0));
    parts.push({
      o: { def, place, travel, at: c.at, helps, note: def.note?.(c) ?? '', familiarity: familiarityOf(s, def) },
      pressing,
      free: (total - pressing) * stale * penaltyFactor(s, def) * tasteMult(s, def, place),
      practice: practiceMult(s, def),
      mult,
    });
  }
  // Practice ranks pastimes against each other, not against the body: across what is on offer, the
  // practice pull averages 1, so a well-practised pastime never crowds out food.
  const meanPractice = parts.reduce((a, p) => a + p.practice, 0) / (parts.length || 1);
  const out: Option[] = [];
  for (const p of parts) {
    const score = (p.pressing + p.free * (p.practice / meanPractice)) * p.mult;
    if (score > 0) out.push({ ...p.o, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The best few options, dropping ones too weak to bother mentioning. */
export function shortlist(opts: Option[]): Option[] {
  const best = opts[0]?.score ?? 0;
  return opts.filter((o) => o.score >= best * mind.shortlistMinRatio).slice(0, mind.shortlistMax);
}
