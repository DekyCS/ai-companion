import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addThought, moodTarget, needThoughts, pressingWords, tickBody } from '../src/body.ts';
import { body } from '../src/config.ts';
import { newState } from '../src/state.ts';

test('needs drop while awake and hunger barely moves while asleep', () => {
  const awake = newState(1);
  const asleep = newState(1);
  for (let i = 0; i < 60; i++) {
    tickBody(awake, null, false);
    tickBody(asleep, null, true);
    awake.t += 1;
    asleep.t += 1;
  }
  assert.ok(awake.needs.fullness < 55 - 3, 'an awake hour costs a few points of hunger');
  assert.ok(asleep.needs.fullness > awake.needs.fullness, 'sleep slows hunger');
  assert.equal(asleep.needs.rest, 92, 'rest does not drop while asleep');
});

test('a need past the line becomes a bad thought that grows with time', () => {
  const s = newState(1);
  s.needs.company = body.line - 5;
  s.pastLine.company = 0;
  const early = needThoughts(s).find((t) => t.need === 'company');
  s.pastLine.company = 5 * 60;
  const late = needThoughts(s).find((t) => t.need === 'company');
  assert.ok(early && late);
  assert.ok(late.value < early.value, 'longer neglect hurts more');
  assert.ok(late.value >= -(body.needThought.cap + body.needThought.criticalExtra), 'capped');
});

test('mood chases its target at a capped rate', () => {
  const s = newState(1);
  s.mood = 50;
  addThought(s, { key: 'gift', text: 'Got a present', value: 30, hours: 10 });
  tickBody(s, null, false);
  assert.ok(moodTarget(s) > 70);
  assert.ok(Math.abs(s.mood - 50 - body.moodUpPerHour / 60) < 1e-9, 'one minute moves mood by at most the hourly cap / 60');
});

test('thoughts expire', () => {
  const s = newState(1);
  addThought(s, { key: 'x', text: 'Something', value: -5, hours: 1 });
  for (let i = 0; i < 61; i++) {
    tickBody(s, null, false);
    s.t += 1;
  }
  assert.equal(s.thoughts.length, 0);
});

test('feelings are described in words, worst first', () => {
  const s = newState(1);
  s.needs = { fullness: 8, rest: 50, calm: 90, company: 30, novelty: 70, making: 70 };
  const words = pressingWords(s);
  assert.equal(words[0], 'starving');
  assert.ok(words.includes('missing company'));
  assert.ok(!words.some((w) => /\d/.test(w)), 'no numbers');
});
