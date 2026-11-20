// The fixes from the health check of 48 live days (2026-11-20): every action gets offered, needs dip
// again, one question can't take over her days, her own ideas don't fail for no reason, her art and her
// diary vary, and her posts keep to what happened. Code only, with stand-in minds; no API calls.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ALL_ON, taste } from '../src/config.ts';
import { decide, offlineMind, ownCopy, tryNewOption, type Candidate, type Mind, type Proposal } from '../src/mind/decide.ts';
import { practiceMult, recordFeeling } from '../src/mind/habit.ts';
import { closeSubject, formFor, leastRecentForm, makePrompt, pieceRequest, postPrompt, postSystem } from '../src/mind/making.ts';
import { decidePrompt, diaryPrompt, diarySystem, onMind, templateDiary, TRY_NEW_NOTE } from '../src/mind/prompts.ts';
import { addThought } from '../src/body.ts';
import { options, shortlist, type Option } from '../src/mind/score.ts';
import { canAlready, lastOpenings, reflectPrompt } from '../src/mind/sleep.ts';
import { PieceStore } from '../src/pieces.ts';
import { completeDays, dayReport } from '../src/report.ts';
import { Rng } from '../src/rng.ts';
import { Sim } from '../src/sim.ts';
import { newState, type Completed, type PieceRef, type Reading, type State } from '../src/state.ts';
import { actionDef, drawMedium, lastQuestions, MEDIA, mediumNamed, withoutMedium, type Ctx } from '../src/world/actions.ts';

const at = (day: number, hour: number) => (day - 1) * 1440 + hour * 60;
const ctx = (s: State): Ctx => ({ s, rng: new Rng(1), at: s.t });

/** A stand-in for Claude that answers with whatever the test says, and remembers what it was offered. */
function standIn(answer: (list: Option[]) => Candidate[]): Mind & { offered: Option[][] } {
  const offered: Option[][] = [];
  return {
    ...offlineMind,
    kind: 'model',
    unavailable: () => null,
    offered,
    async propose(_s, list): Promise<Proposal> {
      offered.push(list);
      return { ok: true, candidates: answer(list) };
    },
  };
}

const cand = (action: string, detail = '', extra: Partial<Candidate> = {}): Candidate => ({ action, reason: 'Hm.', weight: 7, detail, ...extra });

/** Day 10, needs middling, and a long habit of a few pastimes. */
function practisedState(): State {
  const s = newState(2);
  for (let d = 1; d <= 9; d++) {
    s.t = at(d, 10);
    for (const id of ['draw', 'crusts', 'fish', 'poke', 'moss', 'chat', 'bench', 'warm', 'tidy']) recordFeeling(s, actionDef(id), actionDef(id).place === 'here' ? 'burrow' : (actionDef(id).place as never), 1);
  }
  s.t = at(10, 10) + 30;
  s.needs = { fullness: 75, rest: 80, calm: 70, company: 70, novelty: 60, making: 60 };
  return s;
}

// ---------- 1. Every action gets offered ----------

test('practice pulls at most 3×, so a pastime never done is not 8× behind', () => {
  const s = practisedState();
  assert.equal(taste.practiceMax, 3);
  assert.equal(practiceMult(s, actionDef('draw')), 3);
  assert.equal(practiceMult(s, actionDef('whittle')), 1);
});

test('one slot on the menu goes to what she has practised least, said as something to try again', async () => {
  const s = practisedState();
  const m = standIn((list) => list.slice(0, 3).map((o) => cand(o.def.id)));
  await decide(s, new Rng(4), m, 1);
  const list = m.offered[0]!;
  const fresh = list.filter((o) => o.tryNew);
  assert.equal(fresh.length, 1, 'exactly one slot');
  const id = fresh[0]!.def.id;
  assert.ok(!['draw', 'crusts', 'fish', 'poke', 'moss', 'chat', 'bench', 'warm', 'tidy'].includes(id), `${id} is one she never does`);
  assert.ok(!shortlist(options(s, new Rng(4))).some((o) => o.def.id === id), 'and the shortlist alone would not have offered it');
  const prompt = decidePrompt(s, list, new Rng(1));
  assert.ok(prompt.split('\n').some((l) => l.startsWith(`- ${id}:`) && l.includes(TRY_NEW_NOTE)), prompt);
  assert.doesNotMatch(prompt, /hardly ever/);
});

test('the slot is never a door, a routine, or anything in a must-do state', () => {
  const s = practisedState();
  const all = options(s, new Rng(1));
  const slot = tryNewOption(s, all, shortlist(all));
  assert.ok(slot && !['own', 'browse', 'post', 'notes', 'idle', 'sleep', 'nap', 'snack'].includes(slot.def.id));
  s.needs.fullness = 5;
  assert.equal(tryNewOption(s, options(s, new Rng(1)), []), null, 'starving: food only');
});

test('when Claude picks the slot it can win: it is weighed like anything else', async () => {
  const s = practisedState();
  let slotId = '';
  const m = standIn((list) => {
    slotId = list.find((o) => o.tryNew)!.def.id;
    return [cand(list[0]!.def.id), cand(slotId)];
  });
  let won = 0;
  const rng = new Rng(9);
  for (let i = 0; i < 200; i++) if ((await decide(s, rng, m, i)).actionId === slotId) won += 1;
  assert.ok(won > 20, `the slot won ${won} of 200`);
});

test('calm and making dip during her days now, every day still passes its checks, and she never goes to bed hungry (4 seeds × 20 days)', async () => {
  let awake = 0;
  let calmLow = 0;
  let makingLow = 0;
  let pressing = 0;
  let decisions = 0;
  const hungryToBed: string[] = [];
  const failed: string[] = [];
  for (const seed of [1, 2, 3, 4]) {
    const s = newState(seed);
    const sim = new Sim(s, { mind: offlineMind, rng: new Rng(seed), outDir: null });
    const push = sim.decisions.push.bind(sim.decisions);
    sim.decisions.push = (...d) => {
      decisions += d.length;
      if (Object.values(s.needs).some((v) => v < 55)) pressing += d.length;
      // Off to bed for the night with a belly under 45: with making at 6 a point an hour, code alone did this.
      const evening = s.t % 1440 >= 17 * 60 || s.t % 1440 < 4 * 60;
      if (d.some((x) => x.actionId === 'sleep') && evening && s.needs.fullness < 45) hungryToBed.push(`seed ${seed} at ${s.t}: ${s.needs.fullness.toFixed(0)}`);
      return push(...d);
    };
    const end = 20 * 1440 + 450;
    await sim.run(end);
    for (const h of sim.hours.filter((x) => x.doing !== 'asleep in bed' && x.t > 1440)) {
      awake += 1;
      if (h.needs.calm < 80) calmLow += 1;
      if (h.needs.making < 80) makingLow += 1;
    }
    for (const day of completeDays(sim, 0, end)) {
      for (const c of dayReport(sim, day).checks) if (!c.ok) failed.push(`seed ${seed} day ${day}: ${c.name} ${c.value}`);
    }
  }
  // Same run before 2026-11-20: calm under 80 in 0.2% of waking hours, making 0.3%, a need below 55 at
  // 5.0% of decisions. Now (calm 5, making 4.5 an hour) 1.8%, 2.9% and 9.4%: dips, not misery.
  assert.ok(calmLow / awake > 0.01, `calm under 80 in ${((100 * calmLow) / awake).toFixed(1)}% of waking hours`);
  assert.ok(makingLow / awake > 0.015, `making under 80 in ${((100 * makingLow) / awake).toFixed(1)}% of waking hours`);
  assert.ok(pressing / decisions > 0.075, `a need below 55 at ${((100 * pressing) / decisions).toFixed(1)}% of decisions`);
  assert.deepEqual(failed, []);
  assert.deepEqual(hungryToBed, [], 'never off to bed for the night under 45 fullness');
});

test('a pressing need gets a vote when the model leaves it out', async () => {
  // Code's own favourite switched off, so only the body's vote can add a candidate.
  const s = newState(3, { ...ALL_ON, codeFavourite: false });
  s.t = at(2, 10) + 20;
  s.needs = { fullness: 80, rest: 80, calm: 80, company: 20, novelty: 70, making: 70 };
  const m = standIn((list) => list.filter((o) => !o.helps.includes('company')).slice(0, 2).map((o) => cand(o.def.id)));
  const d = await decide(s, new Rng(2), m, 1);
  assert.equal(d.why, '', 'the model answered');
  const vote = d.candidates.find((c) => c.fromCode);
  assert.ok(vote, 'code added one');
  assert.ok((actionDef(vote.action).effects.company ?? 0) > 0, `${vote.action} is for company`);
  assert.equal(vote.weight, 7, "at the model's top weight");
  s.needs.company = 70;
  const calm = await decide(s, new Rng(2), m, 2);
  assert.ok(!calm.candidates.some((c) => c.fromCode), 'nothing pressing, no vote');
});

test("the body's vote is never a post, a piece, a lookup or an idea of her own: those cost, and nobody chose them", async () => {
  const votes = new Set<string>();
  for (let seed = 1; seed <= 20; seed++) {
    const s = newState(seed, { ...ALL_ON, codeFavourite: false });
    s.t = at(2, 10) + 20;
    s.world.can = { make: true, own: true, net: true, post: true, notes: false };
    for (const low of ['company', 'novelty', 'making'] as const) {
      s.needs = { fullness: 80, rest: 80, calm: 80, company: 80, novelty: 80, making: 80, [low]: 30 };
      // The model's candidates help none of the low needs.
      const m = standIn((list) => list.filter((o) => !o.helps.includes(low) && !['own', 'browse', 'post', 'make', 'notes'].includes(o.def.id)).slice(0, 2).map((o) => cand(o.def.id)));
      const d = await decide(s, new Rng(seed), m, seed);
      const vote = d.candidates.find((c) => c.fromCode);
      if (vote) votes.add(`${low}->${vote.action}`);
    }
  }
  assert.ok(votes.size > 0, 'the body did vote');
  for (const v of votes) assert.doesNotMatch(v, /->(post|own|make|browse|notes)$/, v);
  assert.ok([...votes].some((v) => v.startsWith('company->')), 'lonely, it votes for something free and sociable');
});

test('the slot for something not done in a long while is only for the model: code alone never gets it', async () => {
  const s = practisedState();
  let plain = 0;
  for (let i = 0; i < 30; i++) {
    const d = await decide(s, new Rng(i), offlineMind, i);
    if (d.explore) continue; // a menu without her favourites, on purpose
    plain += 1;
    const top = shortlist(options(s, new Rng(i))).map((o) => o.def.id);
    assert.deepEqual(d.menu.map((o) => o.id), top, "code's menu is its shortlist, nothing added");
  }
  assert.ok(plain > 15);
  // Nor does it turn a menu of two (bedtime, mostly) into a model call: code still picks those.
  const m = standIn((list) => list.slice(0, 3).map((o) => cand(o.def.id)));
  const sim = new Sim(newState(4), { mind: m, rng: new Rng(4), outDir: null });
  await sim.run(at(7, 0));
  const two = sim.decisions.filter((d) => d.why === 'only one or two options');
  assert.ok(two.length > 0, 'short menus still happen');
  assert.ok(two.every((d) => d.menu.length <= 2 && d.origin === 'autopilot'));
  assert.ok(m.offered.every((list) => list.filter((o) => !o.tryNew).length >= 3), 'the model is asked only about menus of 3 or more');
});

test("a paid piece is never the slot's 'half minded to try it again'", () => {
  const s = practisedState();
  s.world.can = { make: true, own: true, net: true, post: true, notes: false };
  const all = options(s, new Rng(1));
  assert.ok(all.some((o) => o.def.id === 'make'), 'make is possible, and never practised');
  const slot = tryNewOption(s, all, []);
  assert.ok(slot && !['make', 'browse', 'post', 'own', 'notes'].includes(slot.def.id), String(slot?.def.id));
});

// ---------- 2. One question can't take over ----------

test('the decide prompt shows only what she made or looked up in the last day', () => {
  const s = newState(1);
  s.t = at(5, 10);
  s.pieces = [{ id: 'a', form: 'poem', title: 'Old Train Poem', t: at(3, 10), about: 'trains' }, { id: 'b', form: 'song', title: 'Fresh Rain Song', t: at(5, 8), about: 'rain' }];
  s.readings = [{ t: at(2, 9), question: 'Why do trains skip stops?', learned: 'Express trains skip small stops.', sources: [] }, { t: at(5, 7), question: 'Why do frogs croak?', learned: 'Frogs croak to find each other.', sources: [] }];
  const p = decidePrompt(s, shortlist(options(s, new Rng(1))), new Rng(1));
  assert.match(p, /Fresh Rain Song/);
  assert.doesNotMatch(p, /Old Train Poem/);
  assert.match(p, /Frogs croak/);
  assert.doesNotMatch(p, /Express trains/);
});

test("the computer's option lists her last 6 questions as already looked up", () => {
  const s = newState(1);
  s.world.can = { make: true, own: true, net: true, post: true, notes: false };
  s.readings = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x, i) => ({ t: i, question: `Why is ${x} so?`, learned: '…', sources: [] }));
  const note = actionDef('browse').note!(ctx(s));
  assert.equal(note, 'already looked up: "Why is g so", "Why is f so", "Why is e so", "Why is d so", "Why is c so", "Why is b so"');
});

test('the already-looked-up list names a question once in any words: the live readings are 3 questions, not 6 trains', () => {
  // The 8 readings on the live save (state.json), oldest first: 5 of the 6 newest are trains skipping stops.
  const live = [
    'How do rabbits stay dry underground?', 'Why do trains skip tiny villages?', 'Why do rabbits thump their back feet?',
    'Why do trains skip some stops?', 'Why do trains skip stops?', 'How do trains decide which stations to skip?',
    'Why do trains skip some stations?', 'Why do express trains skip small stations?',
  ];
  const readings: Reading[] = live.map((question, i) => ({ t: i, question, learned: '…', sources: [] }));
  assert.deepEqual(lastQuestions(readings.slice(2), 6), ['Why do express trains skip small stations', 'Why do rabbits thump their back feet']);
  const s = newState(1);
  s.world.can = { make: true, own: true, net: true, post: true, notes: false };
  s.readings = readings;
  assert.equal(
    actionDef('browse').note!(ctx(s)),
    'already looked up: "Why do express trains skip small stations", "Why do rabbits thump their back feet", "How do rabbits stay dry underground"',
  );
});

test('asking again does not keep the question on her mind; asking it again and again wears it out', () => {
  const s = newState(1);
  s.t = at(4, 10);
  const reading: Reading = { t: at(1, 9), question: 'Why do trains skip stops?', learned: 'Express trains skip small stops.', sources: [] };
  const act = { actionId: 'browse', detail: 'why do trains skip stations', result: { kind: 'web', reading, again: true } } as never;
  const once = actionDef('browse').outcome!(ctx(s), act);
  assert.equal(once.thought?.key, 'asked-again');
  assert.doesNotMatch(once.thought!.text, /train/i, 'the thought does not name it');
  reading.again = [s.t - 600, s.t - 60];
  const worn = actionDef('browse').outcome!(ctx(s), act);
  assert.equal(worn.thought?.key, 'worn-out');
  assert.match(worn.thought!.text, /worn out/);
  // Not named either: thoughts rank by strength, and a named one sat under "On Khina's mind" for 2 days.
  assert.doesNotMatch(worn.thought!.text, /train|stop/i);
  assert.ok(worn.thought!.value < 0 && worn.thought!.hours <= 24);
  // Nor is either one the "on her mind lately" line a piece or a lookup is made with.
  s.thoughts = [];
  addThought(s, worn.thought!);
  addThought(s, { key: 'learned', text: 'Found out frogs croak to find each other', value: 1, hours: 24 });
  assert.match(onMind(s, 1, false)[0] ?? '', /worn out/, 'the strongest thought');
  assert.match(onMind(s, 1, false, ['asked-again', 'worn-out'])[0] ?? '', /frogs/);
  reading.again = [s.t - 5 * 1440, s.t - 60];
  assert.equal(actionDef('browse').outcome!(ctx(s), act).thought?.key, 'asked-again', 'once in the last 3 days is not worn out');
});

test('live, with a stand-in mind: the same question in new words is remembered, never paid for, and wears out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'khina-ask-'));
  try {
    const s = newState(4);
    s.t = at(2, 9);
    s.readings = [{ t: at(1, 15), question: 'Why do trains skip some stops?', learned: 'Express trains skip small stops.', sources: [] }];
    let searches = 0;
    const m: Mind = {
      ...standIn((list) => (list.some((o) => o.def.id === 'browse') ? [cand('browse', 'why do the trains skip stations')] : list.slice(0, 3).map((o) => cand(o.def.id)))),
      canWork: () => true,
      browse: async () => {
        searches += 1;
        return 'no';
      },
    };
    const sim = new Sim(s, { mind: m, rng: new Rng(4), outDir: null, pieces: new PieceStore(dir) });
    await sim.run(at(3, 21));
    const asks = sim.log.filter((r) => r.actionId === 'browse');
    assert.ok(asks.length >= 3, `${asks.length} trips to the computer`);
    assert.equal(searches, 0, 'never searched again');
    assert.ok((s.readings[0]!.again ?? []).length >= 3);
    assert.ok(asks.some((r) => /remembered the answer/.test(r.outcome)));
    assert.ok(s.thoughts.some((t) => t.key === 'worn-out') || sim.log.some((r) => r.actionId === 'browse' && r.felt !== undefined && r.felt < 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- 3. Her own ideas ----------

test('own ideas that copy a real action become it, or are dropped', () => {
  const own = (detail: string) => ownCopy(cand('own', detail, { kind: 'making', place: 'stream' }));
  assert.equal(own('sketch the stream in charcoal'), 'make');
  assert.equal(own('write a little poem about rain'), 'make');
  assert.equal(own('chalk a picture on the shed door'), 'make');
  assert.equal(own('type a post about the clover'), 'drop');
  assert.equal(own('look up rabbit burrows, then sketch one'), 'drop');
  assert.equal(own('ask the old computer about herons'), 'drop');
  assert.equal(own('look up at the clouds from the bank'), null);
  assert.equal(own("listen to the blackbird's song"), null);
  assert.equal(own('float a leaf boat down the stream'), null);
  // Telling, singing or humming one is not making one, unless she makes it up too.
  assert.equal(own('tell Tansy a story about the train'), null);
  assert.equal(own('hum a song while weeding'), null);
  assert.equal(own('sing a song to the voles'), null);
  assert.equal(own('write a song to sing to the voles'), 'make');
  // Drawing water and painting the letterbox are not pictures; looking up the hill and posting a letter are not the computer.
  assert.equal(own('draw water from the stream'), null);
  assert.equal(own('paint the letterbox red'), null);
  assert.equal(own('look up the hill for the heron'), null);
  assert.equal(own('posting a letter to Tansy'), null);
});

test('a drawing idea of her own is made for real when she can make things, else not faked', async () => {
  const s = newState(2);
  s.t = at(2, 11);
  s.needs = { fullness: 80, rest: 80, calm: 70, company: 70, novelty: 55, making: 50 };
  const m = standIn(() => [cand('own', 'sketch the heron by the stream', { kind: 'making', place: 'stream' })]);
  s.world.can = { make: true, own: true, net: false, post: false, notes: false };
  const d = await decide(s, new Rng(1), m, 1);
  assert.equal(d.origin, 'model');
  assert.ok(d.candidates.some((c) => c.valid && c.action === 'make'), 'the idea became a real piece');
  assert.ok(!d.candidates.some((c) => c.valid && c.action === 'own'));
  // With this seed the draw picks it: it keeps her words and the place she meant.
  assert.equal(d.actionId, 'make');
  assert.equal(d.detail, 'sketch the heron by the stream');
  assert.equal(d.place, 'stream');
  s.world.can = { make: false, own: true, net: false, post: false, notes: false };
  const e = await decide(s, new Rng(1), m, 2);
  assert.notEqual(e.actionId, 'own.making', 'no budget: not an own idea pretending to draw');
  assert.ok(e.candidates.every((c) => !c.valid || c.action !== 'own'));
});

test('her own ideas never fail by a blind roll, only for a reason', () => {
  const s = newState(1);
  s.t = at(2, 14);
  s.world.weather = 'clear';
  const act = (kind: string, place: string, detail: string) => ({ actionId: `own.${kind}`, place, detail }) as never;
  for (let seed = 1; seed <= 200; seed++) {
    const out = actionDef('own.nature').outcome!({ s, rng: new Rng(seed), at: s.t }, act('nature', 'stream', 'float a leaf boat'));
    assert.match(out.text, /^did something of Khina's own/);
  }
  s.world.weather = 'rain';
  assert.match(actionDef('own.nature').outcome!(ctx(s), act('nature', 'stream', 'float a leaf boat')).text, /rain came down too hard/);
  assert.match(actionDef('own.home').outcome!(ctx(s), act('home', 'burrow', 'rearrange the shelf')).text, /^did something/, 'indoors, rain does not matter');
  assert.match(actionDef('own.nature').outcome!(ctx(s), act('nature', 'woods', 'watch rain drip off the oak roots')).text, /^did something/, 'an idea about the rain');
});

test('the dark stops only an idea that needs light, and only one begun in the dark', () => {
  const s = newState(1);
  s.world.weather = 'clear';
  const run = (kind: string, detail: string, startedAt: number, place = 'clearing') => {
    s.t = startedAt + 40;
    return actionDef(`own.${kind}`).outcome!(ctx(s), { actionId: `own.${kind}`, place, detail, startedAt } as never).text;
  };
  assert.match(run('making', 'stack pebbles into a careful tower', at(2, 21)), /too dark to see/);
  assert.match(run('making', 'stack pebbles into a careful tower', at(2, 19) + 40), /^did something/, 'begun in daylight, it is finished');
  assert.match(run('nature', 'sniff the evening air', at(2, 21)), /^did something/, 'nature needs no light');
  assert.match(run('exploring', 'look for owls in the dark', at(2, 22)), /^did something/, 'an idea about the night');
  assert.match(run('making', 'line up stones under the stars', at(2, 22)), /^did something/);
  assert.match(run('making', 'stack pebbles into a careful tower', at(2, 22), 'shed'), /^did something/, 'indoors');
});

test('on a night she may ask the Keeper, she is told what she can already do', () => {
  const s = newState(1);
  s.world.can = { make: true, own: true, net: true, post: true, notes: true };
  const p = reflectPrompt(s, { day: 3, log: '- 10:00 in the shed: drew the oak', keepable: [], droppable: [], patterns: [], asks: { open: [], answered: [] } });
  assert.match(p, /What Khina can already do \(never ask for these\): .*draw at the workbench.*make real pictures, poems.*look anything up/);
  assert.equal(canAlready(newState(1)).includes('look anything up'), false, 'only what she really can');
});

// ---------- 4. Her art ----------

const piece = (form: PieceRef['form'], about = 'x', t = 0, by: PieceRef['by'] = 'make'): PieceRef => ({ id: `${form}${t}`, form, title: about, t, about, by });

test('a form made 3 of her last 5 times gives way to the one she has gone longest without', () => {
  const recent = [piece('poem'), piece('song'), piece('picture'), piece('picture'), piece('story'), piece('picture')];
  assert.equal(formFor('a picture of the oak', new Rng(1), recent), 'toy', 'never made a game');
  assert.equal(formFor('a song about rain', new Rng(1), recent), 'song', 'one song lately is fine');
  assert.equal(leastRecentForm([piece('toy'), piece('poem'), piece('song'), piece('story'), piece('picture')]), 'toy');
  assert.equal(formFor('a picture of the oak', new Rng(1), [piece('picture'), piece('picture')]), 'picture');
});

test("the workbench's daily drawings don't count toward a rut: only what she made with 'make'", () => {
  // Her last pieces live: workbench pictures (untagged, their words name no form) and one song.
  const live = ['the wet oak roots', 'the fox bottle cap, small and round', 'the blue bead on bark', 'wet oak roots from the doorway', 'the grey sky over the oak roots'].map((a, i) => ({ ...piece('picture', a, i), by: undefined }));
  assert.equal(formFor('sketch the heron by the stream', new Rng(1), live), 'picture', 'not turned into a little game');
  const drawn = [1, 2, 3, 4, 5].map((i) => piece('picture', 'the oak', i, 'draw'));
  assert.equal(formFor('a picture of the oak', new Rng(1), [...drawn, piece('picture', 'a picture of x', 6)]), 'picture');
  // Made with "make" (or untagged, but naming a form), they do count.
  const made = ['a charcoal drawing of the square', 'a picture of the mill', 'a drawing of Tansy'].map((a, i) => ({ ...piece('picture', a, i), by: undefined }));
  assert.notEqual(formFor('a picture of the oak', new Rng(1), made), 'picture');
});

test('a subject close to a recent one brings her last subjects in, to pick another', () => {
  const s = newState(1);
  s.pieces = ['the train rushing past the halt', 'a poem about the skipping express', 'rain on the oak bark'].map((a, i) => piece('picture', a, i));
  const close = pieceRequest(s, 'picture', 'a charcoal drawing of the train at the halt', 'charcoal on a strip of bark', new Rng(1), '');
  assert.deepEqual(close.sameSubject, ['the train rushing past the halt', 'a poem about the skipping express', 'rain on the oak bark']);
  assert.match(makePrompt(close), /pick a different subject from these/);
  const other = pieceRequest(s, 'picture', 'a picture of the heron', '', new Rng(1), '');
  assert.equal(other.sameSubject, undefined);
  assert.doesNotMatch(makePrompt(other), /different subject/);
});

test('a one-word subject is close when its word was in a recent one, and a word in 3 of her last 10 is worn', () => {
  // Her subjects are short: "the train" shares only one word with anything, so 2 shared words never caught it.
  assert.ok(closeSubject('the train', ['the express train skipping the halt']));
  assert.ok(closeSubject('a charcoal drawing of the train on bark', ['the express train skipping the halt', 'rain on the oak']));
  assert.ok(closeSubject('a poem about the oak', ['a poem about the oak']));
  assert.ok(!closeSubject('a poem about the heron', ['a poem about the oak', 'the express train skipping the halt']));
  // Three of the last 10 had the oak in them: the oak is worn, even said with new words around it.
  const oaks = ['wet oak roots from the doorway', 'the grey sky over the oak roots', 'the oak in fog', 'Bramwell asleep', 'the mill wheel'];
  assert.ok(closeSubject('moss growing up the big oak at dusk', oaks));
  assert.ok(!closeSubject('moss growing up the mill wall at dusk', oaks.slice(0, 2)), 'the mill in one subject is not worn');
});

test('the workbench uses the medium her words name, else code picks; the records say it once', () => {
  assert.equal(mediumNamed('the voles by the mill, in charcoal'), MEDIA[0]);
  assert.equal(mediumNamed('the heron in chalk on slate'), MEDIA[1]);
  assert.equal(mediumNamed('the oak on birch bark'), MEDIA[2]);
  assert.equal(mediumNamed('the old oak'), null);
  assert.equal(withoutMedium('the voles by the mill, in charcoal'), 'the voles by the mill');
  assert.equal(withoutMedium('a charcoal drawing of the train on bark'), 'the train');
  assert.equal(withoutMedium('the old oak roots in charcoal'), 'the old oak roots');
  assert.equal(withoutMedium('the stones on the slate roof'), 'the stones on the slate roof');
  const s = newState(1);
  const draw = actionDef('draw');
  assert.doesNotMatch(draw.label, /charcoal/, "the menu doesn't put charcoal in her mouth");
  // Named: that medium, whatever code would have picked (minute 3 would be something other than charcoal).
  const named = { detail: 'the old oak roots in charcoal', startedAt: 3 } as never as Parameters<NonNullable<typeof draw.begin>>[1];
  draw.begin!(ctx(s), named);
  assert.equal(named.medium, MEDIA[0]!.name);
  assert.equal(named.detail, 'the old oak roots');
  assert.doesNotMatch(draw.outcome!(ctx(s), named).text, /charcoal.*charcoal/, 'said once');
  // Not named: code's pick, and her words carry no medium of their own.
  const picked = { detail: 'Bramwell asleep behind the counter', startedAt: 3 } as never as Parameters<NonNullable<typeof draw.begin>>[1];
  draw.begin!(ctx(s), picked);
  assert.equal(picked.medium, drawMedium(3).name);
  assert.notEqual(picked.medium, MEDIA[0]!.name);
});

test('about 1 time in 3 the workbench drawing is not charcoal, and the prompt and records say so', () => {
  const media = Array.from({ length: 300 }, (_, i) => drawMedium(1000 + i).name);
  const other = media.filter((m) => m !== MEDIA[0]!.name);
  assert.equal(other.length, 100);
  assert.ok(new Set(other).size >= 4, 'several different ones');
  const s = newState(1);
  const req = pieceRequest(s, 'picture', 'the oak', MEDIA[1]!.name, new Rng(1), '');
  assert.match(makePrompt(req), /Medium: chalk on a piece of slate \(so: pale, dusty chalk/);
  const out = actionDef('draw').outcome!(ctx(s), { detail: 'the oak', medium: MEDIA[1]!.name, result: { kind: 'piece', piece: piece('picture', 'the oak') } } as never);
  assert.match(out.text, /in chalk on slate/);
  assert.match(out.made ?? '', /^a chalk drawing/);
});

// ---------- 5. Diary and night tics ----------

const rec = (o: Partial<Completed>): Completed => ({
  kind: 'done', actionId: 'sleep', label: '', gist: '', place: 'shed', start: at(2, 7) + 4, end: at(2, 8), detail: '', reason: 'Bed.',
  origin: 'model', outcome: 'slept from 21:40 to 06:55', diary: '', diaryBy: 'none', moodBefore: 60, moodAfter: 60, ...o,
});

test('the diary is given the part of the day, not the clock, and short place names', () => {
  const s = newState(1);
  const p = diaryPrompt(s, rec({}), []);
  assert.match(p, /When: early morning\./);
  assert.match(p, /Where: the shed\./);
  assert.match(p, /Slept from late evening to early morning/);
  assert.doesNotMatch(p, /\d\d:\d\d/);
  assert.doesNotMatch(p, /workbench/);
  const train = diaryPrompt(s, rec({ actionId: 'train', place: 'halt', outcome: 'watched the 11:40 train rattle through the halt towards the city' }), []);
  assert.match(train, /11:40 train/, 'a train keeps its time');
  assert.match(diarySystem(s), /Never write clock times/);
});

test('no clock times reach the diary by the back doors: the reason, the recent lines, the lines code writes', () => {
  const s = newState(1);
  const p = diaryPrompt(s, rec({ reason: 'It is 07:04 and I am hungry.' }), ['At 07:04 I ate a crust.', 'Watched the 11:40 train go through.']);
  assert.match(p, /Why Khina chose it: It is early morning and I am hungry\./);
  assert.match(p, /- At early morning I ate a crust\./);
  assert.match(p, /11:40 train/, "a train's line keeps its time");
  assert.equal(templateDiary(rec({})), 'Slept from late evening to early morning.');
  // And the decide prompt (whose reason goes to the diary) names the place shortly.
  s.place = 'shed';
  const d = decidePrompt(s, shortlist(options(s, new Rng(1))), new Rng(1));
  assert.match(d, /Khina is at the shed[.\s]/);
  assert.doesNotMatch(d, /little shed with the workbench/);
});

test('cloud shapes: more of them, and no train', () => {
  const s = newState(1);
  const seen = new Set<string>();
  for (let seed = 1; seed <= 400; seed++) seen.add(actionDef('moss').outcome!({ s, rng: new Rng(seed), at: 0 }, {} as never).text.replace(/^.*looked like /, ''));
  assert.ok(seen.size >= 11, `${seen.size} shapes`);
  assert.ok(![...seen].some((x) => /train/.test(x)));
});

test("tonight's page is told how her last 3 pages began", () => {
  const s = newState(1);
  s.pages = ['I drew the oak again today.', '', 'I drew the fallen tree at the bakery.', 'Old Wren tutted at me twice.'].map((text, i) => ({ day: i + 1, text, by: 'model' as const, promoted: [], dropped: [], sheetLine: '' }));
  assert.deepEqual(lastOpenings(s.pages), ['I drew the oak again today', 'I drew the fallen tree at', 'Old Wren tutted at me twice']);
  const p = reflectPrompt(s, { day: 5, log: '', keepable: [], droppable: [], patterns: [] });
  assert.match(p, /start tonight's page differently from these/);
  assert.match(p, /- "I drew the fallen tree at…"/);
});

// ---------- 6. Posts ----------

test('posts are written from the records, and told to use only those details', () => {
  const p = postPrompt('the oak', ['drew the oak in charcoal on bark', 'watched the minnows dart about in the shallows'], undefined, null);
  assert.match(p, /from the village's records \(the only facts to use\):\n- Khina drew the oak in charcoal on bark/);
  assert.doesNotMatch(p, /diary/);
  assert.match(postSystem(), /Only use details from these facts/);
});

test('live, with a stand-in mind: a post gets the last records, never the diary lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'khina-post-'));
  try {
    const s = newState(5);
    s.t = at(2, 9);
    let facts: string[] | null = null;
    const m: Mind = {
      ...standIn((list) => (list.some((o) => o.def.id === 'post') && s.history.length >= 3 ? [cand('post', 'my morning')] : list.filter((o) => o.def.id !== 'post').slice(0, 3).map((o) => cand(o.def.id)))),
      narrate: async () => 'A DIARY LINE WITH A MADE-UP OWL IN IT.',
      canPost: () => facts === null,
      writePost: async (_s, _about, recent) => {
        facts = recent;
        return { text: 'A quiet morning by the stream.', sharePiece: false };
      },
    };
    const sim = new Sim(s, { mind: m, rng: new Rng(5), outDir: null, pieces: new PieceStore(dir) });
    await sim.run(at(2, 20));
    assert.ok(facts, 'she posted');
    const got = facts as string[];
    assert.ok(got.length >= 3 && got.length <= 5);
    assert.ok(got.every((f) => !/MADE-UP OWL/.test(f)), 'no diary lines');
    const before = sim.log.filter((r) => r.kind === 'done' && r.actionId !== 'post' && r.actionId !== 'idle').map((r) => r.outcome);
    assert.ok(got.every((f) => before.some((o) => o.startsWith(f.slice(0, 20)))), 'each is a record of what happened');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
