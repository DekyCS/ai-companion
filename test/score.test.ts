import assert from 'node:assert/strict';
import { test } from 'node:test';
import { options, shortlist, tier } from '../src/mind/score.ts';
import { Rng } from '../src/rng.ts';
import { newState } from '../src/state.ts';
import { actionDef } from '../src/world/actions.ts';

const at = (day: number, hour: number, minute = 0) => (day - 1) * 1440 + hour * 60 + minute;

test('a starving bunny is only offered food', () => {
  const s = newState(1);
  s.t = at(1, 10);
  s.needs.fullness = 5;
  assert.equal(tier(s), 'starving');
  const opts = options(s, new Rng(1));
  assert.ok(opts.length > 0);
  for (const o of opts) assert.ok((o.def.effects.fullness ?? 0) >= 10, `${o.def.id} should feed`);
});

test('the mask lifts when starving: survival beats boredom', () => {
  const s = newState(1);
  s.t = at(1, 23);
  s.needs.fullness = 5;
  s.recent = ['snack', 'forage', 'pea'];
  const ids = options(s, new Rng(1)).map((o) => o.def.id);
  assert.ok(ids.includes('snack'));
});

test('recently done actions are masked', () => {
  const s = newState(1);
  s.t = at(1, 10);
  s.recent = ['whittle', 'draw', 'tinker'];
  const ids = options(s, new Rng(1)).map((o) => o.def.id);
  for (const id of s.recent) assert.ok(!ids.includes(id), `${id} should be masked`);
});

test('an exhausted bunny at night goes to bed', () => {
  const s = newState(1);
  s.t = at(1, 22);
  s.needs.rest = 8;
  assert.equal(tier(s), 'exhausted');
  const opts = options(s, new Rng(1));
  assert.equal(opts[0]?.def.id, 'sleep');
});

test('a tired bunny at bedtime ranks bed first, but bed is not offered at noon', () => {
  const s = newState(1);
  s.t = at(1, 22);
  s.needs.rest = 30;
  assert.equal(options(s, new Rng(1))[0]?.def.id, 'sleep');
  s.t = at(1, 12);
  s.needs.rest = 60;
  assert.ok(!options(s, new Rng(1)).some((o) => o.def.id === 'sleep'));
});

test('impossible actions are left off the menu', () => {
  const s = newState(1);
  s.t = at(7, 12); // Sunday: the bakery is shut
  const ids = options(s, new Rng(1)).map((o) => o.def.id);
  assert.ok(!ids.includes('crusts'));
  assert.ok(!ids.includes('warm'));
  assert.ok(actionDef('crusts').blocked?.({ s, rng: new Rng(1), at: s.t }));
});

test('the shortlist is capped and drops options far weaker than the best', () => {
  const s = newState(1);
  s.t = at(1, 11);
  const opts = options(s, new Rng(1));
  const list = shortlist(opts);
  assert.ok(list.length <= 8);
  assert.ok(list.every((o) => o.score >= (list[0]?.score ?? 0) * 0.12));
});
