import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_OFF, ALL_ON, beliefs as beliefCfg, memoryCfg } from '../src/config.ts';
import { computeBeliefs, decay, recordFeeling, recordUse, staleEffects, staleFactor, tasteMult } from '../src/mind/habit.ts';
import { recall, remember } from '../src/mind/memory.ts';
import { measure } from '../src/metrics.ts';
import { offlineMind } from '../src/mind/decide.ts';
import { labelFor, nightly } from '../src/mind/sleep.ts';
import { stickyMind } from '../src/mind/sticky.ts';
import { Rng } from '../src/rng.ts';
import { Sim } from '../src/sim.ts';
import { newState } from '../src/state.ts';
import { actionDef } from '../src/world/actions.ts';
import { maybeDrama } from '../src/world/drama.ts';

const at = (day: number, hour: number) => (day - 1) * 1440 + hour * 60;

test('an overdone action goes stale and recovers over a few days', () => {
  const s = newState(1);
  const chat = actionDef('chat');
  assert.equal(staleFactor(s, chat), 1);
  for (let i = 0; i < 3; i++) recordUse(s, chat, 'square');
  const tired = staleFactor(s, chat);
  assert.ok(tired < 0.3, `three chats in a row should bite: ${tired}`);
  decay(s, 1440);
  assert.ok(staleFactor(s, chat) > tired * 1.5, 'clearly better after a day');
  decay(s, 3 * 1440);
  assert.ok(staleFactor(s, chat) > 0.75, 'mostly fresh again after four days');
});

test('going stale makes things feel less new, but never fills a need less', () => {
  const e = staleEffects({ company: 22, novelty: 10, rest: -3 }, 0.25);
  assert.equal(e.company, 22);
  assert.equal(e.novelty, 2.5);
  assert.equal(e.rest, -3);
});

test('routine actions never go stale', () => {
  const s = newState(1);
  for (let i = 0; i < 5; i++) recordUse(s, actionDef('sleep'), 'burrow');
  assert.equal(staleFactor(s, actionDef('sleep')), 1);
});

test('good experiences raise taste; switched off, they do not', () => {
  const on = newState(1);
  const off = newState(1, ALL_OFF);
  for (const s of [on, off]) for (let i = 0; i < 4; i++) recordFeeling(s, actionDef('train'), 'halt', 5);
  assert.ok(tasteMult(on, actionDef('train'), 'halt') > 1.2);
  assert.equal(tasteMult(off, actionDef('train'), 'halt'), 1);
});

test('a belief needs support on several distinct days, not one good day', () => {
  const s = newState(1);
  s.t = at(1, 12);
  for (let i = 0; i < 10; i++) recordFeeling(s, actionDef('fish'), 'stream', -6);
  assert.equal(computeBeliefs(s, labelFor).length, 0, 'ten bad times on one day is not enough');
  for (let d = 2; d <= beliefCfg.minDays; d++) {
    s.t = at(d, 12);
    recordFeeling(s, actionDef('fish'), 'stream', -6);
  }
  const b = computeBeliefs(s, labelFor).find((x) => x.key === 'a:fish');
  assert.equal(b?.polarity, 'dislikes');
  assert.match(b?.text ?? '', /not keen on watching the fish/);
});

test('memory is bounded: one kind of thing cannot fill it, and the weak lose', () => {
  const s = newState(1);
  for (let i = 0; i < 10; i++) remember(s, { text: `Waved at train ${i}`, where: 'at the halt', category: 'train', salience: 4 + i * 0.1 });
  assert.equal(s.memories.filter((m) => m.category === 'train').length, memoryCfg.perCategory);
  assert.equal(remember(s, { text: 'A dull thing', where: 'here', category: 'x', salience: 1 }), 'rejected');
  assert.equal(remember(s, { text: 'Waved at train 9', where: 'at the halt', category: 'train', salience: 5 }), 'recurred');
});

test('a recalled memory rests before it can come back', () => {
  const s = newState(1);
  s.t = at(2, 10);
  remember(s, { text: 'Found a thimble', where: 'in the woods', category: 'find', salience: 6 });
  s.t += 120;
  const rng = new Rng(1);
  assert.equal(recall(s, rng).length, 1);
  assert.equal(recall(s, rng).length, 0, 'shown just now, so it rests');
  s.t += memoryCfg.recallRestMin;
  assert.equal(recall(s, rng).length, 1);
});

test('the village makes something happen after a long quiet spell', () => {
  const s = newState(1);
  s.t = at(2, 11);
  s.lastNotable = s.t - 3;
  assert.equal(maybeDrama(s, new Rng(1)), null);
  s.lastNotable = s.t - 20 * 60;
  assert.ok(maybeDrama(s, new Rng(1)));
  assert.equal(maybeDrama(s, new Rng(2)), null, 'then it waits for its cooldown');
});

test('the night adds a sheet line only from strong, multi-day evidence', async () => {
  const s = newState(1);
  for (let d = 1; d <= beliefCfg.sheetMinDays; d++) {
    s.t = at(d, 12);
    recordFeeling(s, actionDef('train'), 'halt', 5);
  }
  const page = await nightly(s, beliefCfg.sheetMinDays, [], offlineMind);
  assert.equal(page.sheetLine, 'Has come to like waiting for the train.');
  const again = await nightly(s, beliefCfg.sheetMinDays + 1, [], offlineMind);
  assert.equal(again.sheetLine, '', 'at most one line every few nights');
});

test('phase 2 breaks the rut of a stuck model (3 seeds × 20 days)', async () => {
  const avg = async (features: typeof ALL_ON) => {
    let top3 = 0;
    let same = 0;
    let plausible = 0;
    for (const seed of [1, 2, 3]) {
      const s = newState(seed, features);
      const start = s.t;
      const end = 20 * 1440 + 450;
      const sim = new Sim(s, { mind: stickyMind(seed), rng: new Rng(seed), outDir: null });
      await sim.run(end);
      const m = measure(sim, start, end);
      top3 += m.top3Action / 3;
      same += m.dayOverlap / 3;
      plausible += m.plausible / 3;
    }
    return { top3, same, plausible };
  };
  const off = await avg(ALL_OFF);
  const on = await avg(ALL_ON);
  assert.ok(on.top3 < off.top3 - 0.03, `top-3 share ${off.top3.toFixed(3)} → ${on.top3.toFixed(3)}`);
  assert.ok(on.same < off.same, `same routine ${off.same.toFixed(3)} → ${on.same.toFixed(3)}`);
  assert.ok(on.plausible >= 0.9, `plausible days ${on.plausible.toFixed(2)}`);
});
