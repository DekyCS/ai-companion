// Do copies of Khina that start identical become different individuals?
// Every copy starts with the same personality, world and needs; only chance differs.
// The test: learn each copy's habits from one stretch of days, then see whether its later days
// can be picked out from the other copies' later days. Chance level is 1 / number of copies.

import { ROUTINE } from './mind/habit.ts';
import { reportDay, type Sim } from './sim.ts';
import { ACTION_IDS } from './world/actions.ts';

/** Actions that say something about the individual: not sleep, snacks, naps or sitting idle. */
const CHOSEN = ACTION_IDS.filter((id) => !ROUTINE.has(id) && id !== 'idle');
const INDEX = new Map(CHOSEN.map((id, i) => [id, i]));

export interface Window {
  trainFrom: number;
  trainTo: number;
  testFrom: number;
  testTo: number;
}

/** Skip the first quarter (everyone starts the same), learn from the next part, test on the rest. */
export function defaultWindow(days: number): Window {
  const warm = Math.floor(days / 4);
  const trainTo = warm + Math.floor((days - warm) / 2);
  return { trainFrom: warm + 1, trainTo, testFrom: trainTo + 1, testTo: days };
}

export interface CopyProfile {
  /** Counts of chosen actions per day, keyed by day number. */
  byDay: Map<number, number[]>;
  /** Taste per action (fast + slow), when tastes are on. */
  tastes: number[] | null;
  learned: string[];
}

export function profile(sim: Sim): CopyProfile {
  const byDay = new Map<number, number[]>();
  for (const r of sim.log) {
    if (r.kind !== 'done') continue;
    const i = INDEX.get(r.actionId);
    if (i === undefined) continue;
    const d = reportDay(r.start);
    const v = byDay.get(d) ?? new Array<number>(CHOSEN.length).fill(0);
    v[i] = (v[i] ?? 0) + 1;
    byDay.set(d, v);
  }
  const t = sim.s.tastes;
  const hasTastes = Object.keys(t).length > 0;
  return {
    byDay,
    tastes: hasTastes ? CHOSEN.map((id) => (t[`a:${id}`] ? t[`a:${id}`]!.fast + t[`a:${id}`]!.slow : 0)) : null,
    learned: sim.s.learned.map((l) => l.text),
  };
}

export interface Individuality {
  copies: number;
  chance: number;
  /** Share of later days correctly matched to their own copy using earlier days. */
  identified: number;
  /** Same, matching 3-day blocks instead of single days (less noise). */
  identifiedBlocks: number;
  /** How different two copies' later habits are (Jensen-Shannon divergence, bits, 0 to 1). */
  between: number;
  /** How much one copy differs from its own earlier self. */
  within: number;
  /** Mean correlation of taste between copies: 1 = same tastes, 0 = unrelated. Null when tastes are off. */
  tasteAgreement: number | null;
  /** Each copy's three most chosen actions in the later days. */
  favourites: string[][];
  learned: string[][];
}

const sum = (vs: number[][]) => vs.reduce((a, v) => a.map((x, i) => x + (v[i] ?? 0)), new Array<number>(CHOSEN.length).fill(0));
const days = (p: CopyProfile, from: number, to: number) =>
  [...Array(to - from + 1).keys()].map((k) => p.byDay.get(from + k) ?? new Array<number>(CHOSEN.length).fill(0));

function cosine(a: number[], b: number[]): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] ?? 0) * (b[i] ?? 0);
    aa += (a[i] ?? 0) ** 2;
    bb += (b[i] ?? 0) ** 2;
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

function dist(v: number[]): number[] {
  const total = v.reduce((a, b) => a + b, 0) || 1;
  return v.map((x) => x / total);
}

export function jsd(a: number[], b: number[]): number {
  const p = dist(a);
  const q = dist(b);
  let out = 0;
  for (let i = 0; i < p.length; i++) {
    const m = ((p[i] ?? 0) + (q[i] ?? 0)) / 2;
    if (p[i]) out += 0.5 * p[i]! * Math.log2(p[i]! / m);
    if (q[i]) out += 0.5 * q[i]! * Math.log2(q[i]! / m);
  }
  return out;
}

function pearson(a: number[], b: number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

function matchRate(centroids: number[][], samples: { copy: number; v: number[] }[]): number {
  let right = 0;
  for (const smp of samples) {
    const scores = centroids.map((c) => cosine(smp.v, c));
    const best = scores.indexOf(Math.max(...scores));
    if (best === smp.copy) right++;
  }
  return samples.length ? right / samples.length : 0;
}

export function individuality(profiles: CopyProfile[], w: Window): Individuality {
  const train = profiles.map((p) => sum(days(p, w.trainFrom, w.trainTo)));
  const testDays = profiles.flatMap((p, copy) => days(p, w.testFrom, w.testTo).map((v) => ({ copy, v })));
  const blocks = profiles.flatMap((p, copy) => {
    const ds = days(p, w.testFrom, w.testTo);
    const out: { copy: number; v: number[] }[] = [];
    for (let i = 0; i + 3 <= ds.length; i += 3) out.push({ copy, v: sum(ds.slice(i, i + 3)) });
    return out;
  });
  const test = profiles.map((p) => sum(days(p, w.testFrom, w.testTo)));

  const pairs: [number, number][] = [];
  for (let i = 0; i < profiles.length; i++) for (let j = i + 1; j < profiles.length; j++) pairs.push([i, j]);
  const between = pairs.reduce((a, [i, j]) => a + jsd(test[i]!, test[j]!), 0) / (pairs.length || 1);
  const within = profiles.reduce((a, _, i) => a + jsd(train[i]!, test[i]!), 0) / profiles.length;

  const tastes = profiles.map((p) => p.tastes);
  const tasteAgreement = tastes.every((t) => t)
    ? pairs.reduce((a, [i, j]) => a + pearson(tastes[i]!, tastes[j]!), 0) / (pairs.length || 1)
    : null;

  return {
    copies: profiles.length,
    chance: 1 / profiles.length,
    identified: matchRate(train, testDays),
    identifiedBlocks: matchRate(train, blocks),
    between,
    within,
    tasteAgreement,
    favourites: test.map((v) =>
      v
        .map((n, i) => ({ id: CHOSEN[i]!, n }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 3)
        .map((x) => x.id),
    ),
    learned: profiles.map((p) => p.learned),
  };
}
