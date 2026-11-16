import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, offlineMind, type Candidate, type Mind, type Proposal } from '../src/mind/decide.ts';
import { decidePrompt, templateDiary } from '../src/mind/prompts.ts';
import { options, shortlist, type Option } from '../src/mind/score.ts';
import { Rng } from '../src/rng.ts';
import { newState, type State } from '../src/state.ts';

/** A stand-in for Claude that answers with whatever the test says. */
function fakeMind(answer: (list: Option[]) => Proposal): Mind & { calls: number } {
  return {
    kind: 'model',
    calls: 0,
    unavailable: () => null,
    async propose(_s, list) {
      this.calls += 1;
      return answer(list);
    },
    narrate: async () => null,
    stats: () => offlineMind.stats(),
  };
}

/** Late morning, everything middling: no obvious winner, so the model gets asked. */
function openState(): State {
  const s = newState(3);
  s.t = 10 * 60 + 30;
  s.needs = { fullness: 60, rest: 70, calm: 55, company: 45, novelty: 45, making: 45 };
  return s;
}

const cand = (action: string, weight: number): Candidate => ({ action, weight, reason: 'Because.', detail: '' });

test('model picks that are not on the menu are dropped', async () => {
  const s = openState();
  const real = shortlist(options(s, new Rng(1)))[0]!.def.id;
  const m = fakeMind(() => ({ ok: true, candidates: [cand('fly_to_the_moon', 10), cand(real, 3)] }));
  const d = await decide(s, new Rng(1), m, 1);
  assert.equal(m.calls, 1);
  assert.equal(d.origin, 'model');
  assert.equal(d.actionId, real);
  assert.equal(d.candidates.find((c) => c.action === 'fly_to_the_moon')?.valid, false);
});

test('when the model fails, code decides and says so', async () => {
  const s = openState();
  const m = fakeMind(() => ({ ok: false, why: 'rate limited' }));
  const d = await decide(s, new Rng(1), m, 1);
  assert.equal(d.origin, 'fallback');
  assert.match(d.why, /rate limited/);
});

test('when every model pick is off the menu, code decides', async () => {
  const s = openState();
  const m = fakeMind(() => ({ ok: true, candidates: [cand('nope', 5)] }));
  const d = await decide(s, new Rng(1), m, 1);
  assert.equal(d.origin, 'fallback');
});

test('in a must-do state the model is not asked', async () => {
  const s = openState();
  s.needs.fullness = 4;
  const m = fakeMind(() => ({ ok: true, candidates: [] }));
  const d = await decide(s, new Rng(1), m, 1);
  assert.equal(m.calls, 0);
  assert.equal(d.origin, 'autopilot');
});

test('code samples among the model picks instead of always taking the favourite', async () => {
  const s = openState();
  const list = shortlist(options(s, new Rng(1)));
  const [a, b] = [list[0]!.def.id, list[1]!.def.id];
  const m = fakeMind(() => ({ ok: true, candidates: [cand(a, 9), cand(b, 9)] }));
  const counts: Record<string, number> = {};
  const rng = new Rng(42);
  for (let i = 0; i < 400; i++) {
    const d = await decide(s, rng, m, i);
    counts[d.actionId] = (counts[d.actionId] ?? 0) + 1;
  }
  assert.ok((counts[a] ?? 0) > 40 && (counts[b] ?? 0) > 40, `both picks happen: ${JSON.stringify(counts)}`);
});

test('the prompt shows feelings in words and never shows scores', () => {
  const s = openState();
  const list = shortlist(options(s, new Rng(1)));
  const p = decidePrompt(s, list, new Rng(1));
  assert.match(p, /How Khina feels:/);
  for (const o of list) {
    assert.ok(p.includes(`- ${o.def.id}:`));
    assert.ok(!p.includes(o.score.toFixed(2)));
  }
});

test('template diary lines are first person', () => {
  const line = templateDiary({
    kind: 'done', actionId: 'fish', label: '', gist: '', place: 'stream', start: 0, end: 10, detail: '', reason: '',
    origin: 'autopilot', diary: '', diaryBy: 'none', moodBefore: 50, moodAfter: 40,
    outcome: 'was watching the fish when a heron landed close by; Khina curled up tight until it left',
  });
  assert.equal(line, 'Was watching the fish when a heron landed close by; I curled up tight until it left.');
});
