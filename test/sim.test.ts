// Phase 1 is done when Khina lives a plausible day with the model switched off.
// This runs several seeds for several days on code alone and checks every day.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { offlineMind } from '../src/mind/decide.ts';
import { completeDays, dayReport } from '../src/report.ts';
import { Rng } from '../src/rng.ts';
import { Sim } from '../src/sim.ts';
import { newState } from '../src/state.ts';
import { DAY } from '../src/time.ts';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const DAYS = 3;

async function run(seed: number) {
  const s = newState(seed);
  const start = s.t;
  const end = DAYS * DAY + 450;
  const sim = new Sim(s, { mind: offlineMind, rng: new Rng(seed), outDir: null });
  await sim.run(end);
  return { sim, reports: completeDays(sim, start, end).map((d) => dayReport(sim, d)) };
}

test('the same seed replays the same day', async () => {
  const a = await run(5);
  const b = await run(5);
  assert.deepEqual(
    a.sim.log.map((r) => `${r.start}:${r.actionId}`),
    b.sim.log.map((r) => `${r.start}:${r.actionId}`),
  );
});

test(`offline days are plausible (${SEEDS.length} seeds × ${DAYS} days)`, async () => {
  const failures: string[] = [];
  for (const seed of SEEDS) {
    const { reports } = await run(seed);
    assert.equal(reports.length, DAYS, `seed ${seed} should cover ${DAYS} full days`);
    for (const r of reports) {
      for (const c of r.checks) if (!c.ok) failures.push(`seed ${seed} ${r.title}: ${c.name} = ${c.value} (want ${c.target})`);
    }
  }
  assert.deepEqual(failures, []);
});

test('different seeds live different days', async () => {
  const days = await Promise.all([1, 2, 3].map(async (seed) => (await run(seed)).sim.log.slice(0, 12).map((r) => r.actionId).join(',')));
  assert.equal(new Set(days).size, 3);
});
