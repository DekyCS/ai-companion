// Turns a finished run into day.md: the diary, plausibility checks, and an hour-by-hour table.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { energyWord, moodWord } from './body.ts';
import { NEEDS, NEED_NAMES, type NeedId } from './config.ts';
import type { MindStats } from './mind/decide.ts';
import { reportDay, type DayStats, type HourSnap, type Sim } from './sim.ts';
import type { Completed, NightPage } from './state.ts';
import { clock, DAY, weekday } from './time.ts';
import { actionDef } from './world/actions.ts';
import { PLACES } from './world/places.ts';

export interface Check {
  name: string;
  value: string;
  target: string;
  ok: boolean;
}

export interface DayReport {
  day: number;
  title: string;
  records: Completed[];
  stats: DayStats;
  meals: number;
  places: number;
  distinct: number;
  maxRepeat: number;
  worstNeed: { need: NeedId; minutes: number };
  origins: Record<string, number>;
  checks: Check[];
}

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;

/** Report days that the run covered from 06:00 to 06:00. */
export function completeDays(sim: Sim, runStart: number, runEnd: number): number[] {
  const out: number[] = [];
  for (const d of sim.days.keys()) {
    const end = d * DAY + 360;
    const start = end - DAY;
    if (end <= runEnd && start + 60 >= runStart - 60) out.push(d);
  }
  return out.sort((a, b) => a - b);
}

export function dayReport(sim: Sim, day: number): DayReport {
  const records = sim.log.filter((r) => reportDay(r.start) === day);
  const stats = sim.days.get(day) as DayStats;
  const done = records.filter((r) => r.kind === 'done');
  const meals = done.filter((r) => actionDef(r.actionId).topic === 'food').length;
  const places = new Set(done.map((r) => r.place)).size;
  const distinct = new Set(done.filter((r) => r.actionId !== 'idle').map((r) => r.actionId)).size;
  let maxRepeat = 0;
  let run = 0;
  let prev = '';
  for (const r of done) {
    run = r.actionId === prev ? run + 1 : 1;
    prev = r.actionId;
    maxRepeat = Math.max(maxRepeat, run);
  }
  const worst = NEEDS.reduce((a, b) => (stats.longestPastLine[b] > stats.longestPastLine[a] ? b : a));
  const origins: Record<string, number> = {};
  for (const r of records) origins[r.origin] = (origins[r.origin] ?? 0) + 1;

  const checks: Check[] = [
    { name: 'Slept', value: hm(stats.sleepMin), target: '≥ 6h', ok: stats.sleepMin >= 360 },
    { name: 'Meals', value: String(meals), target: '≥ 3', ok: meals >= 3 },
    { name: 'Time starving', value: `${stats.starvingMin} min`, target: '≤ 60 min', ok: stats.starvingMin <= 60 },
    { name: 'Time exhausted', value: `${stats.exhaustedMin} min`, target: '≤ 60 min', ok: stats.exhaustedMin <= 60 },
    { name: 'Places visited', value: String(places), target: '≥ 4', ok: places >= 4 },
    { name: 'Different activities', value: String(distinct), target: '≥ 10', ok: distinct >= 10 },
    { name: 'Same thing twice in a row', value: String(maxRepeat), target: '≤ 2', ok: maxRepeat <= 2 },
    {
      name: 'Longest neglected need',
      value: `${NEED_NAMES[worst]}, ${hm(stats.longestPastLine[worst])}`,
      target: '≤ 8h',
      ok: stats.longestPastLine[worst] <= 480,
    },
  ];
  const first = (day - 1) * DAY + 360;
  return {
    day, title: `Day ${day} · ${weekday(first)}`, records, stats, meals, places, distinct, maxRepeat,
    worstNeed: { need: worst, minutes: stats.longestPastLine[worst] }, origins, checks,
  };
}

function diaryLines(records: Completed[]): string[] {
  return records
    .filter((r) => r.diary)
    .map((r) => {
      const who = r.origin === 'model' ? 'model' : r.origin;
      const by = r.diaryBy === 'model' ? '' : ' · template diary';
      return `- **${clock(r.start)}** · ${PLACES[r.place].short} — ${r.diary}  \n  <sub>why: “${r.reason}” · ${who}${by}</sub>`;
    });
}

function nightLines(p: NightPage | undefined): string[] {
  if (!p) return [];
  const kept = p.promoted.length ? `kept for good: ${p.promoted.join(' · ')}` : '';
  const dropped = p.dropped.length ? `let go: ${p.dropped.join(' · ')}` : '';
  const sheet = p.sheetLine ? `new on the sheet: “${p.sheetLine}”` : '';
  const notes = [kept, dropped, sheet].filter(Boolean).join(' · ');
  return [
    '',
    '### That night',
    '',
    p.text ? `> ${p.text.replace(/\n+/g, '\n> ')}` : '_(no page written: code did the night alone)_',
    ...(notes ? ['', `<sub>${notes} · by ${p.by === 'model' ? 'Claude' : 'code'}</sub>`] : []),
  ];
}

function hourTable(hours: HourSnap[], day: number): string[] {
  const rows = hours.filter((h) => reportDay(h.t) === day);
  const head = `| time | where | doing | weather | mood | energy | ${NEEDS.map((n) => NEED_NAMES[n]).join(' | ')} |`;
  const sep = `|${' --- |'.repeat(6 + NEEDS.length)}`;
  return [
    head,
    sep,
    ...rows.map(
      (h) =>
        `| ${clock(h.t)} | ${h.place} | ${h.doing} | ${h.weather} | ${moodWord(h.mood)} | ${energyWord(h.energy)} | ${NEEDS.map((n) => Math.round(h.needs[n])).join(' | ')} |`,
    ),
  ];
}

export function writeReport(
  sim: Sim,
  opts: { outDir: string; seed: number; brain: string; runStart: number; runEnd: number; mind: MindStats },
): { path: string; reports: DayReport[] } {
  const reports = completeDays(sim, opts.runStart, opts.runEnd).map((d) => dayReport(sim, d));
  const m = opts.mind;
  const lines: string[] = [
    `# Khina · seed ${opts.seed}`,
    '',
    `Brain: ${opts.brain} · Model calls: ${m.calls} (${m.failures} failed) · Cost: $${m.costUsd.toFixed(4)}`,
    '',
    `Finds on the shelf: ${sim.s.finds.map((f) => f.name).join(', ') || 'none'}  `,
    `Things made: ${sim.s.made.map((x) => x.what).join(', ') || 'none'}`,
    '',
    `Learned (on the character sheet): ${sim.s.learned.map((l) => l.text).join(' ') || 'nothing yet'}  `,
    `Beliefs from evidence: ${sim.s.beliefs.map((b) => `${b.text} (${b.days} of ${b.of} days)`).join(' ') || 'none yet'}  `,
    `Kept for good: ${sim.s.memories.filter((x) => x.tier === 'long').map((x) => x.text).join(' · ') || 'nothing yet'}`,
  ];
  for (const r of reports) {
    const passed = r.checks.filter((c) => c.ok).length;
    lines.push(
      '',
      `## ${r.title}`,
      '',
      `${passed}/${r.checks.length} checks pass · ${r.records.length} things done · picked by ${Object.entries(r.origins).map(([k, v]) => `${k} ${v}`).join(', ')} · mood ${moodWord(r.stats.moodMin)} to ${moodWord(r.stats.moodMax)}`,
      '',
      '### Diary',
      '',
      ...diaryLines(r.records),
      ...nightLines(sim.s.pages.find((p) => p.day === r.day)),
      '',
      '### Checks',
      '',
      '| check | result | target | ok |',
      '| --- | --- | --- | --- |',
      ...r.checks.map((c) => `| ${c.name} | ${c.value} | ${c.target} | ${c.ok ? '✅' : '❌'} |`),
      '',
      '<details><summary>Hour by hour</summary>',
      '',
      ...hourTable(sim.hours, r.day),
      '',
      '</details>',
    );
  }
  const path = join(opts.outDir, 'day.md');
  writeFileSync(path, `${lines.join('\n')}\n`);
  return { path, reports };
}
