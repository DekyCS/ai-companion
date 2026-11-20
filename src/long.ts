// npm run long -- [--exp compare|penalty|parts|favourite|claude] [--days 40] [--seeds 1,2,3]
//                 [--model | --sticky] [--night model|code] [--max-spend 0.50]
// Fast-forwards Khina for many days and measures how repetitive the life is,
// changing one thing at a time between conditions. --compare is short for --exp compare.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ALL_OFF, ALL_ON, budget, NEEDS, type Features } from './config.ts';
import { measure, PASTIMES, type LongMetrics } from './metrics.ts';
import { makeMind, type MindKind } from './minds.ts';
import { writeReport } from './report.ts';
import { Rng } from './rng.ts';
import { Sim } from './sim.ts';
import { newState } from './state.ts';
import { DAY } from './time.ts';

interface Condition {
  name: string;
  features: Features;
  /** Which mind runs this condition; unset = whatever the flags say. */
  mind?: MindKind;
}

const EXPERIMENTS: Record<string, { about: string; conditions: Condition[] }> = {
  on: { about: 'everything on', conditions: [{ name: 'phase 2 on', features: ALL_ON }] },
  compare: {
    about: 'phase 2 off vs on',
    conditions: [
      { name: 'phase 2 off', features: ALL_OFF },
      { name: 'phase 2 on', features: ALL_ON },
    ],
  },
  penalty: {
    about: 'no repeat penalty vs a fixed 7× penalty vs going stale (everything else on)',
    conditions: [
      { name: 'no penalty', features: { ...ALL_ON, habituation: false } },
      { name: 'fixed 7x penalty', features: { ...ALL_ON, habituation: false, fixedPenalty: true } },
      { name: 'going stale', features: ALL_ON },
    ],
  },
  parts: {
    about: 'everything on, then each phase 2 part switched off alone',
    conditions: [
      { name: 'all on', features: ALL_ON },
      { name: 'no going stale', features: { ...ALL_ON, habituation: false } },
      { name: 'no tastes or practice', features: { ...ALL_ON, tastes: false } },
      { name: 'no memory', features: { ...ALL_ON, memory: false } },
      { name: 'no village events', features: { ...ALL_ON, drama: false } },
    ],
  },
  favourite: {
    about: "the model's candidates alone vs code's own favourite always among them",
    conditions: [
      { name: 'model candidates only', features: ALL_ON },
      { name: "plus code's favourite", features: { ...ALL_ON, codeFavourite: true } },
    ],
  },
  // Two experiments in one run: code picks vs Claude picks (first two), words vs numbers (last two).
  claude: {
    about: 'code picks alone vs Claude proposing, with feelings shown as words vs as numbers',
    conditions: [
      { name: 'code picks', features: ALL_ON, mind: 'offline' },
      { name: 'Claude, feelings in words', features: ALL_ON, mind: 'model' },
      { name: 'Claude, feelings in numbers', features: { ...ALL_ON, numbers: true }, mind: 'model' },
    ],
  },
};

const { values } = parseArgs({
  options: {
    exp: { type: 'string' },
    days: { type: 'string', default: '40' },
    seeds: { type: 'string', default: '1,2,3' },
    compare: { type: 'boolean', default: false },
    model: { type: 'boolean', default: false },
    sticky: { type: 'boolean', default: false },
    night: { type: 'string', default: 'model' },
    'max-spend': { type: 'string', default: String(budget.runUsd) },
    out: { type: 'string' },
  },
});

const expName = values.exp ?? (values.compare ? 'compare' : 'on');
const exp = EXPERIMENTS[expName];
if (!exp) {
  console.log(`Unknown experiment "${expName}". Choose one of: ${Object.keys(EXPERIMENTS).join(', ')}`);
  process.exit(1);
}
const days = Math.max(6, Number(values.days) || 40);
const seeds = String(values.seeds).split(',').map(Number).filter(Number.isFinite);
const flagMind: MindKind = values.model ? 'model' : values.sticky ? 'sticky' : 'offline';
const kindOf = (c: Condition): MindKind => c.mind ?? flagMind;
const modelRuns = exp.conditions.filter((c) => kindOf(c) === 'model').length * seeds.length;
if (modelRuns > 0 && !process.env.ANTHROPIC_API_KEY) {
  console.log('This experiment needs Claude, and no ANTHROPIC_API_KEY was found.');
  process.exit(1);
}
const night = values.night === 'code' ? 'code' : 'model';
const capPerRun = (Number(values['max-spend']) || budget.runUsd) / Math.max(1, modelRuns);
const stampNow = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const outDir = values.out ?? join('runs', `long-${stampNow}-${expName}-${days}d`);
mkdirSync(outDir, { recursive: true });

interface Row {
  cond: string;
  seed: number;
  m: LongMetrics;
  cost: number;
  /** Share of choices where Claude was asked. */
  asked: number;
  /** Of those, share where the pick was also code's own favourite. */
  agreed: number;
}
const rows: Row[] = [];
for (const cond of exp.conditions) {
  const t0 = Date.now();
  const kind = kindOf(cond);
  // Seeds run side by side: a Claude run takes as long as one seed, not all of them.
  const done = await Promise.all(
    seeds.map(async (seed) => {
      const runDir = join(outDir, `${cond.name.replace(/\s+/g, '-')}-seed${seed}`);
      const mind = makeMind(kind, { seed, runDir, capUsd: capPerRun, night });
      const s = newState(seed, cond.features);
      const start = s.t;
      const end = days * DAY + 450;
      const sim = new Sim(s, { mind, rng: new Rng(seed), outDir: kind === 'model' ? runDir : null });
      await sim.run(end);
      if (kind === 'model') writeReport(sim, { outDir: runDir, seed, brain: 'Claude', runStart: start, runEnd: end, mind: mind.stats() });
      writeFileSync(
        join(outDir, `${cond.name.replace(/\s+/g, '-')}-seed${seed}-mind.json`),
        JSON.stringify({ beliefs: s.beliefs, learned: s.learned, memories: s.memories, tastes: s.tastes, pages: s.pages }, null, 2),
      );
      const asked = sim.decisions.filter((d) => d.origin === 'model');
      return {
        cond: cond.name,
        seed,
        m: measure(sim, start, end),
        cost: mind.stats().costUsd,
        asked: sim.decisions.length ? asked.length / sim.decisions.length : 0,
        agreed: asked.length ? asked.filter((d) => d.actionId === d.menu[0]?.id).length / asked.length : 0,
      };
    }),
  );
  rows.push(...done);
  console.log(`${cond.name}: ${seeds.length} seeds in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
type Col = [string, (r: Row) => number, (x: number) => string, string];
const COLS: Col[] = [
  ['Paper metric: category seen before (rolling 5-day)', (r) => r.m.paperRepetition, pct, '95.2–97.6%'],
  ['Top-3 categories share', (r) => r.m.top3Category, pct, '57.1%'],
  ['Top-5 categories share', (r) => r.m.top5Category, pct, '75.4%'],
  ['Top-3 actions share', (r) => r.m.top3Action, pct, ''],
  ['Same routine as yesterday (action pairs repeated)', (r) => r.m.dayOverlap, pct, ''],
  ['Exact repeats (same action and same content)', (r) => r.m.exactRepeat, pct, ''],
  ['Variety (bits per 5-day window)', (r) => r.m.entropy, (x) => x.toFixed(2), ''],
  ['New things per week (finds, new paths, made)', (r) => r.m.newPerWeek, (x) => x.toFixed(1), ''],
  ['Days passing every plausibility check', (r) => r.m.plausible, pct, ''],
  ['Mood, average (0–100)', (r) => r.m.moodMean, (x) => x.toFixed(1), ''],
  ['Hours grumpy or worse', (r) => r.m.lowMood, pct, ''],
  ['Things done per day', (r) => r.m.eventsPerDay, (x) => x.toFixed(1), '5 in the paper'],
];
if (modelRuns > 0) {
  COLS.push(['Choices where Claude was asked', (r) => r.asked, pct, '']);
  COLS.push(["Of those, Claude's pick was code's favourite too", (r) => r.agreed, pct, '']);
}

const mean = (cond: string, f: (r: Row) => number) => {
  const xs = rows.filter((r) => r.cond === cond).map(f);
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
};
const names = exp.conditions.map((c) => c.name);
const minds = [...new Set(exp.conditions.map(kindOf))].map((k) => (k === 'model' ? `Claude${night === 'code' ? ' (nights by code)' : ''}` : k === 'sticky' ? 'stuck stand-in model' : 'code only'));
const lines = [
  `# ${exp.about} · ${days} days · seeds ${seeds.join(', ')} · ${minds.join(' and ')}`,
  '',
  `| measure | ${names.join(' | ')} | paper baseline |`,
  `| --- | ${names.map(() => '---').join(' | ')} | --- |`,
  ...COLS.map(([label, f, as, base]) => `| ${label} | ${names.map((c) => as(mean(c, f))).join(' | ')} | ${base} |`),
  '',
  'Per seed:',
  '',
  `| condition | seed | ${COLS.map(([n]) => n.split(' (')[0]).join(' | ')} |`,
  `| --- | --- | ${COLS.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.cond} | ${r.seed} | ${COLS.map(([, f, as]) => as(f(r))).join(' | ')} |`),
];

/** What she did, all seeds together, and what she never chose (over 48 live days, 9 pastimes never were). */
function actionLines(): string[] {
  const out = ['What she did, all seeds together:', ''];
  for (const c of names) {
    const counts: Record<string, number> = {};
    for (const r of rows.filter((x) => x.cond === c)) for (const [id, n] of Object.entries(r.m.actions)) counts[id] = (counts[id] ?? 0) + n;
    const done = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ${n}`);
    const never = PASTIMES.filter((id) => !counts[id]);
    out.push(`- ${c}: ${done.join(', ')}`, `  never chosen: ${never.length ? never.join(', ') : 'none'} (of ${PASTIMES.length} pastimes)`);
  }
  return out;
}

/** Needs over her waking hours, averaged over seeds: do they dip, and how far. */
function needLines(): string[] {
  const cell = (c: string, n: string) => {
    const f = (k: 'p10' | 'median' | 'below55') => mean(c, (r) => r.m.needs[n]?.[k] ?? 0);
    return `${f('p10').toFixed(0)} / ${f('median').toFixed(0)} / ${pct(f('below55'))}`;
  };
  return [
    'Needs while awake (10th percentile / median / waking hours below 55):',
    '',
    `| need | ${names.join(' | ')} |`,
    `| --- | ${names.map(() => '---').join(' | ')} |`,
    ...NEEDS.map((n) => `| ${n} | ${names.map((c) => cell(c, n)).join(' | ')} |`),
  ];
}

const extra = [...actionLines(), '', ...needLines()];
lines.push('', ...extra);
const cost = rows.reduce((a, r) => a + r.cost, 0);
if (cost > 0) lines.push('', `Model cost: $${cost.toFixed(4)}`);
const path = join(outDir, 'summary.md');
writeFileSync(path, `${lines.join('\n')}\n`);
console.log(`\n${lines.slice(0, 4 + COLS.length).join('\n')}\n\n${extra.join('\n')}${cost > 0 ? `\n\nModel cost: $${cost.toFixed(4)}` : ''}\n\nSummary: ${path}`);
