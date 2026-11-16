// Bounded memory. A new memory gets a slot only by beating the weakest one, each kind of
// thing has its own small allowance, and recall can only add so much. Code decides all of it.

import { memoryCfg } from '../config.ts';
import type { Rng } from '../rng.ts';
import type { Memory, State } from '../state.ts';
import { dayOf } from '../time.ts';

export function worth(m: Memory, now: number): number {
  const half = m.tier === 'long' ? memoryCfg.longHalfLifeDays : memoryCfg.shortHalfLifeDays;
  const ageDays = (now - m.t) / 1440;
  const recur = Math.min(m.days.length - 1, 3) * 0.5;
  return m.salience * Math.pow(0.5, ageDays / half) + 0.5 * Math.min(m.recalls, memoryCfg.recallCap) + recur;
}

export interface NewMemory {
  text: string;
  where: string;
  category: string;
  salience: number;
}

/** Offers a memory. Returns what happened, for the log. */
export function remember(s: State, n: NewMemory): 'added' | 'recurred' | 'replaced' | 'rejected' {
  if (!s.features.memory || n.salience < memoryCfg.minSalience) return 'rejected';
  const day = dayOf(s.t);
  const same = s.memories.find((m) => m.text === n.text && m.category === n.category);
  if (same) {
    if (!same.days.includes(day)) same.days.push(day);
    same.salience = Math.max(same.salience, n.salience) + 0.5;
    same.t = s.t;
    return 'recurred';
  }
  const m: Memory = {
    id: s.nextMemoryId++, t: s.t, text: n.text, where: n.where, category: n.category,
    salience: n.salience, recalls: 0, lastRecalled: -Infinity, tier: 'short', days: [day],
  };
  const short = s.memories.filter((x) => x.tier === 'short');
  const sameKind = short.filter((x) => x.category === n.category);
  // One kind of thing may only hold a few slots; within it, the strongest stay.
  const pool = sameKind.length >= memoryCfg.perCategory ? sameKind : short.length >= memoryCfg.shortSlots ? short : null;
  if (!pool) {
    s.memories.push(m);
    return 'added';
  }
  const weakest = pool.reduce((a, b) => (worth(a, s.t) <= worth(b, s.t) ? a : b));
  if (worth(m, s.t) <= worth(weakest, s.t)) return 'rejected';
  s.memories[s.memories.indexOf(weakest)] = m;
  return 'replaced';
}

/**
 * Memories to show in a decision prompt: one by worth, and sometimes an old one at random,
 * never one shown in the last half day. This is what keeps one memory from coming back hundreds of times.
 */
export function recall(s: State, rng: Rng, max = 2): Memory[] {
  if (!s.features.memory) return [];
  const rested = s.memories.filter((m) => s.t - m.lastRecalled >= memoryCfg.recallRestMin && m.t < s.t - 60);
  if (rested.length === 0) return [];
  const out: Memory[] = [];
  const first = rng.weighted(rested, (m) => worth(m, s.t));
  out.push(first);
  const old = rested.filter((m) => m !== first && dayOf(m.t) < dayOf(s.t) - 1);
  if (out.length < max && old.length && rng.chance(0.35)) out.push(rng.pick(old));
  for (const m of out) {
    m.recalls += 1;
    m.lastRecalled = s.t;
  }
  return out;
}

/** Short memories that have earned a chance at long-term: recurred on two days, or strong and a day old. */
export function promotionCandidates(s: State): Memory[] {
  return s.memories
    .filter((m) => m.tier === 'short' && s.t - m.t >= 0 && (m.days.length >= 2 || m.salience >= 5))
    .sort((a, b) => worth(b, s.t) - worth(a, s.t));
}

export function promote(s: State, ids: number[]): Memory[] {
  const done: Memory[] = [];
  for (const id of ids.slice(0, memoryCfg.promotePerNight)) {
    const m = s.memories.find((x) => x.id === id && x.tier === 'short');
    if (!m) continue;
    const long = s.memories.filter((x) => x.tier === 'long');
    if (long.length >= memoryCfg.longSlots) {
      const weakest = long.reduce((a, b) => (worth(a, s.t) <= worth(b, s.t) ? a : b));
      if (worth(weakest, s.t) >= worth(m, s.t)) continue;
      s.memories.splice(s.memories.indexOf(weakest), 1);
    }
    m.tier = 'long';
    done.push(m);
  }
  return done;
}

/** Nightly forgetting: faded short memories go, plus any the sleeper chose to drop. */
export function forget(s: State, dropIds: number[] = []): Memory[] {
  const gone = s.memories.filter(
    (m) => m.tier === 'short' && (worth(m, s.t) < memoryCfg.forgetBelow || dropIds.includes(m.id)),
  );
  s.memories = s.memories.filter((m) => !gone.includes(m));
  return gone;
}
