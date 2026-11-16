// npm run day -- [--days 1] [--seed 1] [--offline] [--speed 0] [--max-spend 0.50] [--out dir] [--quiet]

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { budget } from './config.ts';
import { ClaudeMind } from './mind/claude.ts';
import { offlineMind, type Mind } from './mind/decide.ts';
import { writeReport } from './report.ts';
import { Rng } from './rng.ts';
import { Sim } from './sim.ts';
import { newState } from './state.ts';
import { DAY } from './time.ts';

const { values } = parseArgs({
  options: {
    days: { type: 'string', default: '1' },
    seed: { type: 'string', default: '1' },
    offline: { type: 'boolean', default: false },
    speed: { type: 'string', default: '0' },
    'max-spend': { type: 'string', default: String(budget.runUsd) },
    out: { type: 'string' },
    quiet: { type: 'boolean', default: false },
  },
});

const days = Math.max(1, Number(values.days) || 1);
const seed = Number(values.seed) || 1;
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const online = !values.offline && hasKey;

const now = new Date();
const stampNow = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
const outDir = values.out ?? join('runs', `${stampNow}-seed${seed}-${online ? 'model' : 'offline'}`);

if (!values.offline && !hasKey) {
  console.log('No ANTHROPIC_API_KEY found, so Khina runs on code alone. Put your key in .env to switch the model on.\n');
}

const mind: Mind = online
  ? new ClaudeMind({ outDir, runCapUsd: Number(values['max-spend']) || budget.runUsd })
  : offlineMind;
const brain = online ? 'Claude (Haiku 5.5 for decisions and diary)' : 'offline (code only)';

const s = newState(seed);
const runStart = s.t;
const runEnd = days * DAY + 450;
const sim = new Sim(s, {
  mind,
  rng: new Rng(seed),
  outDir,
  speedMs: Number(values.speed) || 0,
  onLine: values.quiet ? undefined : (l) => console.log(l),
});

console.log(`Khina · seed ${seed} · ${days} day${days > 1 ? 's' : ''} · brain: ${brain}\n`);
await sim.run(runEnd);

const { path, reports } = writeReport(sim, { outDir, seed, brain, runStart, runEnd, mind: mind.stats() });
const st = mind.stats();
console.log('');
for (const r of reports) {
  const failed = r.checks.filter((c) => !c.ok);
  console.log(
    `${r.title}: ${r.checks.length - failed.length}/${r.checks.length} checks pass${failed.length ? ` (failed: ${failed.map((c) => `${c.name} ${c.value}`).join('; ')})` : ''}`,
  );
}
if (online) console.log(`Model calls: ${st.calls} (${st.failures} failed) · cost $${st.costUsd.toFixed(4)}`);
const offReason = mind.unavailable();
if (online && offReason) console.log(`Model was switched off during the run: ${offReason}`);
console.log(`Report: ${path}`);
