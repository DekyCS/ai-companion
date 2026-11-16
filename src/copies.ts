// npm run copies -- [--copies 5] [--days 40] [--personalities 1,2,3] [--compare] [--model] [--night code|model]
// Starts several identical copies of Khina (same personality, world and needs; only chance differs)
// and measures whether they grow into different individuals.
// --compare also runs every copy with learned tastes switched off, as the control.
// --habits compares Claude without and with habit words in its menu (needs --model).
// --vs <switch> compares any switch from Features off vs on, e.g. --vs codeFavourite.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ALL_ON, budget, type Features } from './config.ts';
import { defaultWindow, individuality, profile, type Individuality } from './individuality.ts';
import { measure, type LongMetrics } from './metrics.ts';
import { makeMind } from './minds.ts';
import { writeReport } from './report.ts';
import { Rng } from './rng.ts';
import { Sim } from './sim.ts';
import { newState } from './state.ts';
import { DAY } from './time.ts';

const { values } = parseArgs({
  options: {
    copies: { type: 'string', default: '5' },
    days: { type: 'string', default: '40' },
    personalities: { type: 'string', default: '1,2,3' },
    compare: { type: 'boolean', default: false },
    habits: { type: 'boolean', default: false },
    vs: { type: 'string' },
    model: { type: 'boolean', default: false },
    sticky: { type: 'boolean', default: false },
    night: { type: 'string', default: 'model' },
    'max-spend': { type: 'string', default: String(budget.runUsd) },
    out: { type: 'string' },
  },
});

const n = Math.max(2, Number(values.copies) || 5);
const days = Math.max(8, Number(values.days) || 40);
const personalities = String(values.personalities).split(',').map(Number).filter(Number.isFinite);
const kind = values.model ? 'model' : values.sticky ? 'sticky' : 'offline';
const stampNow = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const outDir = values.out ?? join('runs', `copies-${stampNow}-${n}x${days}d`);
mkdirSync(outDir, { recursive: true });
const w = defaultWindow(days);

// --vs <switch> runs every copy with that switch off, then on (everything else as normal).
const vs = (values.vs ?? (values.habits ? 'habitWords' : values.compare ? 'tastes' : '')) as keyof Features | '';
if (vs && !(vs in ALL_ON)) {
  console.log(`Unknown switch "${vs}". Choose one of: ${Object.keys(ALL_ON).join(', ')}`);
  process.exit(1);
}
const conditions: { name: string; features: Features }[] = vs
  ? [
      { name: `${vs} off`, features: { ...ALL_ON, [vs]: false } },
      { name: `${vs} on`, features: { ...ALL_ON, [vs]: true } },
    ]
  : [{ name: 'as normal', features: ALL_ON }];
// --max-spend is for the whole command, split across every copy of every condition and personality.
const capPerRun = (Number(values['max-spend']) || budget.runUsd) / (n * conditions.length * personalities.length);

interface Result {
  cond: string;
  personality: number;
  r: Individuality;
  /** Repetition and wellbeing, averaged over the copies. */
  life: LongMetrics;
  cost: number;
}
const results: Result[] = [];
const t0 = Date.now();
// Every copy of every condition runs side by side: a Claude run takes as long as one copy.
await Promise.all(
  conditions.flatMap((cond) =>
    personalities.map(async (p) => {
      const sims = await Promise.all(
        [...Array(n).keys()].map(async (c) => {
          const runDir = join(outDir, `${cond.name.replace(/\s+/g, '-')}-p${p}-copy${c + 1}`);
          const mind = makeMind(kind, { seed: p, runDir, capUsd: capPerRun, night: values.night === 'code' ? 'code' : 'model' });
          const s = newState(p, cond.features);
          const start = s.t;
          const end = days * DAY + 450;
          // Same personality seed for every copy; each copy gets its own stream of chance.
          const sim = new Sim(s, { mind, rng: new Rng(p * 1000 + c + 1), outDir: kind === 'model' ? runDir : null });
          await sim.run(end);
          if (kind === 'model') writeReport(sim, { outDir: runDir, seed: p, brain: 'Claude', runStart: start, runEnd: end, mind: mind.stats() });
          return { sim, m: measure(sim, start, end), cost: mind.stats().costUsd };
        }),
      );
      const life = {} as Record<string, number>;
      for (const k of Object.keys(sims[0]!.m)) life[k] = sims.reduce((a, x) => a + (x.m as unknown as Record<string, number>)[k]!, 0) / sims.length;
      results.push({
        cond: cond.name,
        personality: p,
        r: individuality(sims.map((x) => profile(x.sim)), w),
        life: life as unknown as LongMetrics,
        cost: sims.reduce((a, x) => a + x.cost, 0),
      });
      console.log(`${cond.name} · personality ${p}: ${n} copies done at ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }),
  ),
);
results.sort((a, b) => conditions.findIndex((c) => c.name === a.cond) - conditions.findIndex((c) => c.name === b.cond) || a.personality - b.personality);

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const mean = (cond: string, f: (x: Result) => number | null) => {
  const xs = results.filter((x) => x.cond === cond).map(f).filter((x): x is number => x !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
const fmt = (x: number | null, as: (x: number) => string) => (x === null ? '—' : as(x));
const names = conditions.map((c) => c.name);
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const ROWS: [string, (x: Result) => number | null, (x: number) => string][] = [
  ['Later days matched to the right copy (chance ' + pct(1 / n) + ')', (x) => x.r.identified, pct],
  ['Same, matching 3-day blocks', (x) => x.r.identifiedBlocks, pct],
  ['Difference between copies (JSD, bits)', (x) => x.r.between, (v) => v.toFixed(3)],
  ['Difference from own earlier self (JSD, bits)', (x) => x.r.within, (v) => v.toFixed(3)],
  ['Between ÷ within (above 1 = copies differ more than they drift)', (x) => x.r.between / (x.r.within || 1), (v) => v.toFixed(2)],
  ['Taste agreement between copies (1 = same tastes)', (x) => x.r.tasteAgreement, (v) => v.toFixed(2)],
  ['Top-3 actions share (repetition)', (x) => x.life.top3Action, pct1],
  ['Top-3 categories share (paper baseline 57.1%)', (x) => x.life.top3Category, pct1],
  ['Same routine as yesterday', (x) => x.life.dayOverlap, pct1],
  ['Days passing every plausibility check', (x) => x.life.plausible, pct1],
  ['Mood, average (0–100)', (x) => x.life.moodMean, (v) => v.toFixed(1)],
];

const lines = [
  `# ${n} copies × ${days} days · personalities ${personalities.join(', ')} · ${kind === 'model' ? 'Claude on' : kind === 'sticky' ? 'stuck stand-in model' : 'code only'}`,
  '',
  `Learned from days ${w.trainFrom}–${w.trainTo}, tested on days ${w.testFrom}–${w.testTo}.`,
  '',
  `| measure | ${names.join(' | ')} |`,
  `| --- | ${names.map(() => '---').join(' | ')} |`,
  ...ROWS.map(([label, f, as]) => `| ${label} | ${names.map((c) => fmt(mean(c, f), as)).join(' | ')} |`),
];
for (const x of results.filter((y) => y.cond === names[names.length - 1])) {
  lines.push('', `## ${x.cond} · personality ${x.personality}`, '');
  x.r.favourites.forEach((f, i) => lines.push(`- copy ${i + 1}: most chosen ${f.join(", ")} · learned: ${x.r.learned[i]!.join(" ") || "nothing"}`));
}
const cost = results.reduce((a, x) => a + x.cost, 0);
if (cost > 0) lines.push('', `Model cost: $${cost.toFixed(4)}`);
const path = join(outDir, 'summary.md');
writeFileSync(path, `${lines.join('\n')}\n`);
console.log(`\n${lines.slice(0, 6 + ROWS.length).join('\n')}\n\nSummary: ${path}`);
