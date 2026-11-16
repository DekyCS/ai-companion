// How repetitive is a long run? Compared against the AutoPersonas 40-day baselines
// (arXiv 2607.08252): rolling 5-day category repetition 95.2–97.6%, top-3 share 57.1%,
// top-5 share 75.4%, theme repetition 79–88%.

import { completeDays, dayReport } from './report.ts';
import { reportDay, type Sim } from './sim.ts';
import type { Completed } from './state.ts';
import { actionDef } from './world/actions.ts';

export interface LongMetrics {
  days: number;
  eventsPerDay: number;
  /** The paper's metric: events in days D-4..D whose category already appeared on any day up to D-5. */
  paperRepetition: number;
  top3Category: number;
  top5Category: number;
  top3Action: number;
  top5Action: number;
  /** Share of a day's action pairs (A then B) that also happened the day before. 1 = same routine daily. */
  dayOverlap: number;
  /** Share of events that are exactly something that already happened (same action and same detail or outcome). */
  exactRepeat: number;
  /** Mean action entropy per 5-day window, in bits. */
  entropy: number;
  /** Share of days passing every plausibility check. */
  plausible: number;
  moodMean: number;
  /** Share of hours spent grumpy or worse. */
  lowMood: number;
  /** Things found, new paths seen and things made, per week. */
  newPerWeek: number;
}

const isEvent = (r: Completed) => r.kind === 'done' && r.actionId !== 'idle' && r.actionId !== 'sleep';

function topShare(keys: string[], k: number): number {
  const counts = new Map<string, number>();
  for (const x of keys) counts.set(x, (counts.get(x) ?? 0) + 1);
  const top = [...counts.values()].sort((a, b) => b - a).slice(0, k).reduce((a, b) => a + b, 0);
  return keys.length ? top / keys.length : 0;
}

function entropy(keys: string[]): number {
  const counts = new Map<string, number>();
  for (const x of keys) counts.set(x, (counts.get(x) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / keys.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function measure(sim: Sim, runStart: number, runEnd: number): LongMetrics {
  const days = completeDays(sim, runStart, runEnd);
  const byDay = new Map<number, Completed[]>();
  for (const d of days) byDay.set(d, []);
  for (const r of sim.log) {
    if (!isEvent(r)) continue;
    byDay.get(reportDay(r.start))?.push(r);
  }
  const events = days.flatMap((d) => byDay.get(d) ?? []);
  const topic = (r: Completed) => actionDef(r.actionId).topic;

  const paper: number[] = [];
  for (const D of days) {
    if (D < (days[0] as number) + 5) continue;
    const prior = new Set(days.filter((d) => d <= D - 5).flatMap((d) => (byDay.get(d) ?? []).map(topic)));
    const window = days.filter((d) => d > D - 5 && d <= D).flatMap((d) => byDay.get(d) ?? []);
    if (window.length) paper.push(window.filter((r) => prior.has(topic(r))).length / window.length);
  }

  const pairs = (rs: Completed[]) => new Set(rs.slice(1).map((r, i) => `${(rs[i] as Completed).actionId}>${r.actionId}`));
  const overlap: number[] = [];
  for (let i = 1; i < days.length; i++) {
    const today = pairs(byDay.get(days[i] as number) ?? []);
    const yesterday = pairs(byDay.get(days[i - 1] as number) ?? []);
    if (today.size) overlap.push([...today].filter((p) => yesterday.has(p)).length / today.size);
  }

  const seen = new Set<string>();
  let repeats = 0;
  for (const r of events) {
    const key = `${r.actionId}|${(r.detail || r.outcome).toLowerCase()}`;
    if (seen.has(key)) repeats += 1;
    seen.add(key);
  }

  const windows: number[] = [];
  for (let i = 0; i + 5 <= days.length; i += 5) {
    windows.push(entropy(days.slice(i, i + 5).flatMap((d) => (byDay.get(d) ?? []).map((r) => r.actionId))));
  }

  const reports = days.map((d) => dayReport(sim, d));
  const hours = sim.hours.filter((h) => days.includes(reportDay(h.t)));
  const s = sim.s;
  // Every find or sight ever taken from the pools, plus everything made.
  const newThings = s.world.used.length - s.world.findsLeft.length - s.world.sightsLeft.length + s.made.length;

  return {
    days: days.length,
    eventsPerDay: events.length / Math.max(1, days.length),
    paperRepetition: mean(paper),
    top3Category: topShare(events.map(topic), 3),
    top5Category: topShare(events.map(topic), 5),
    top3Action: topShare(events.map((r) => r.actionId), 3),
    top5Action: topShare(events.map((r) => r.actionId), 5),
    dayOverlap: mean(overlap),
    exactRepeat: events.length ? repeats / events.length : 0,
    entropy: mean(windows),
    plausible: reports.filter((r) => r.checks.every((c) => c.ok)).length / Math.max(1, reports.length),
    moodMean: mean(hours.map((h) => h.mood)),
    lowMood: hours.length ? hours.filter((h) => h.mood < 38).length / hours.length : 0,
    newPerWeek: (Math.max(0, newThings) / Math.max(1, days.length)) * 7,
  };
}
