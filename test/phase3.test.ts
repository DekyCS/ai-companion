import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_ON, taste, type Features } from '../src/config.ts';
import { defaultWindow, individuality, jsd, profile } from '../src/individuality.ts';
import { decide, offlineMind, type Mind } from '../src/mind/decide.ts';
import { habitNote, ownHabits, penaltyFactor, practiceMult, recordFeeling } from '../src/mind/habit.ts';
import { decidePrompt } from '../src/mind/prompts.ts';
import { options, shortlist } from '../src/mind/score.ts';
import { Rng } from '../src/rng.ts';
import { Sim } from '../src/sim.ts';
import { newState } from '../src/state.ts';
import { actionDef } from '../src/world/actions.ts';

const at = (day: number, hour: number) => (day - 1) * 1440 + hour * 60;

test('distance between activity mixes: 0 when the same, 1 when nothing is shared', () => {
  assert.equal(jsd([1, 2, 3], [2, 4, 6]), 0);
  assert.equal(jsd([1, 0], [0, 1]), 1);
});

test('practice grows once per day and its pull is capped', () => {
  const s = newState(1);
  const fish = actionDef('fish');
  s.t = at(1, 10);
  for (let i = 0; i < 5; i++) recordFeeling(s, fish, 'stream', 0);
  assert.equal(s.tastes['a:fish']?.practice, 1, 'five times in one afternoon is one day of practice');
  for (let d = 2; d <= 10; d++) {
    s.t = at(d, 10);
    recordFeeling(s, fish, 'stream', 0);
  }
  assert.equal(practiceMult(s, fish), taste.practiceMax);
  assert.equal(practiceMult(newState(1), fish), 1);
});

test('the fixed-penalty experiment cuts anything done in the last day, then lets go', () => {
  const s = newState(1, { ...ALL_ON, habituation: false, fixedPenalty: true });
  s.t = at(2, 10);
  s.history.push({ actionId: 'fish', kind: 'done', start: s.t - 60, end: s.t - 30 } as (typeof s.history)[number]);
  assert.equal(penaltyFactor(s, actionDef('fish')), 1 / 7);
  assert.equal(penaltyFactor(s, actionDef('draw')), 1);
  s.t += 24 * 60;
  assert.equal(penaltyFactor(s, actionDef('fish')), 1);
  assert.equal(penaltyFactor(newState(1), actionDef('fish')), 1, 'off unless the experiment asks for it');
});

test('the numbers experiment shows needs as numbers; normally Claude sees only words', () => {
  for (const numbers of [false, true]) {
    const s = newState(3, { ...ALL_ON, numbers });
    s.t = at(1, 15);
    s.needs.fullness = 30;
    const prompt = decidePrompt(s, shortlist(options(s, new Rng(1))), new Rng(1));
    assert.equal(/full belly 30/.test(prompt), numbers);
    assert.equal(/\d+\/100/.test(prompt), numbers);
  }
});

test("Claude's menu marks this copy's own habits and what it hardly ever does", () => {
  const s = newState(1);
  for (let d = 1; d <= 6; d++) {
    s.t = at(d, 10);
    recordFeeling(s, actionDef('fish'), 'stream', 0);
  }
  const own = ownHabits(s);
  assert.ok(own.has('fish'));
  assert.equal(habitNote(s, actionDef('fish'), own), "one of Khina's habits");
  assert.equal(habitNote(s, actionDef('paddle'), own), 'Khina hardly ever does this');
  assert.equal(habitNote(s, actionDef('sleep'), own), '', 'routine needs no note');
  s.t = at(2, 10);
  assert.equal(habitNote(s, actionDef('paddle'), own), '', 'too early to call anything rare');
  const off = { ...s, features: { ...s.features, habitWords: false } };
  assert.equal(habitNote(off, actionDef('fish'), own), '', 'switched off, Claude sees no habit words');
});

test("code's own favourite joins the candidates when the model leaves it out, only when switched on", async () => {
  for (const codeFavourite of [false, true]) {
    const s = newState(2, { ...ALL_ON, codeFavourite });
    s.t = at(1, 11);
    const list = shortlist(options(s, new Rng(1)));
    const top = list[0]!.def.id;
    const others = list.filter((o) => o.def.id !== top).slice(0, 3);
    const mind: Mind = {
      ...offlineMind,
      kind: 'model',
      unavailable: () => null,
      propose: async () => ({ ok: true, candidates: others.map((o) => ({ action: o.def.id, reason: 'Hm.', weight: 6, detail: '' })) }),
    };
    s.needs = { fullness: 80, rest: 80, calm: 80, company: 80, novelty: 60, making: 60 };
    const d = await decide(s, new Rng(3), mind, 1);
    const added = d.candidates.find((c) => c.fromCode);
    if (!codeFavourite) assert.equal(added, undefined);
    else if (d.why === '') assert.equal(added?.weight, 6, `code's favourite ${d.menu[0]?.id} gets Claude's typical weight`);
  }
});

test('identical copies become different individuals with tastes and practice, not without', async () => {
  const run = async (features: Features) => {
    let blocks = 0;
    let ratio = 0;
    for (const p of [1, 2]) {
      const sims = [];
      for (let c = 0; c < 5; c++) {
        const sim = new Sim(newState(p, features), { mind: offlineMind, rng: new Rng(p * 1000 + c + 1), outDir: null });
        await sim.run(40 * 1440 + 450);
        sims.push(sim);
      }
      const r = individuality(sims.map(profile), defaultWindow(40));
      blocks += r.identifiedBlocks / 2;
      ratio += r.between / r.within / 2;
    }
    return { blocks, ratio };
  };
  const off = await run({ ...ALL_ON, tastes: false });
  const on = await run(ALL_ON);
  assert.ok(off.ratio < 1, `without tastes, copies differ less than they drift: ${off.ratio.toFixed(2)}`);
  assert.ok(on.ratio > 1.5, `with tastes, copies differ more than they drift: ${on.ratio.toFixed(2)}`);
  assert.ok(on.blocks >= 0.45, `3-day blocks matched to the right copy: ${on.blocks.toFixed(2)} (chance 0.20)`);
});
