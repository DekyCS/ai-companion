// Khina asks the Keeper: pacing by the real clock, cleaning what the model asks for, the second night
// schema only when she may ask, and the Keeper's answer arriving as a letter she reads.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASK, addAsk, answerRequest, askAllowed, asksForSite, checkRequest, cleanAsk, keeperKeyOk, nearlySame, newGuard, serverKey, tidyNote, trimAsks, type KeyGuard } from '../src/asks.ts';
import { remember } from '../src/mind/memory.ts';
import { offlineMind, type Mind } from '../src/mind/decide.ts';
import { nightly, reflectPrompt, reflectSchema, REFLECT_ASK_SCHEMA, REFLECT_SCHEMA, type ReflectInput, type ReflectOutput } from '../src/mind/sleep.ts';
import { Rng } from '../src/rng.ts';
import { Sim } from '../src/sim.ts';
import { newState, type Activity, type Ask, type State } from '../src/state.ts';
import { actionDef } from '../src/world/actions.ts';
import { senderName } from '../src/world/village.ts';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 18, 21, 0);
/** Not a real key: just long enough (ASK.keyMin) to turn answering on. */
const KEY = 'test-keeper-key-0123456789abcdef';

function ask(over: Partial<Ask> = {}): Ask {
  return { id: `a${Math.random().toString(16).slice(2, 8)}`, t: 100, at: NOW - 48 * HOUR, text: 'Could the stream have a few stepping stones?', why: 'My paws get wet.', status: 'open', ...over };
}

/** A night mind that writes a plain page and asks for what it is given; it keeps what it was shown. */
function nightMind(reply: Partial<ReflectOutput> = {}): Mind & { seen: ReflectInput[] } {
  const seen: ReflectInput[] = [];
  return {
    ...offlineMind,
    kind: 'model',
    unavailable: () => null,
    seen,
    reflect: async (_s, input) => {
      seen.push(input);
      return { page: 'Slept well.', keep: [], drop: [], sheetLine: '', evidence: '', ...reply };
    },
  };
}

/** POST /asks/<id>, as the live server passes it on: by default with the right key on both sides. */
const answer = (s: State, id: string, body: unknown, o: { key?: string; envKey?: string; now?: number; guard?: KeyGuard; ip?: string } = {}) =>
  answerRequest(s, {
    id,
    key: 'key' in o ? o.key : KEY,
    envKey: 'envKey' in o ? o.envKey : KEY,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    now: o.now ?? NOW,
    guard: o.guard ?? newGuard(),
    ip: o.ip ?? '203.0.113.1',
  });

// ---------- pacing ----------

test('pacing: she may ask with fewer than 3 open and none in the last 12 real hours', () => {
  const s = newState(1);
  assert.equal(askAllowed(s, NOW), true, 'a new Khina may ask');
  s.asks = [ask(), ask({ text: 'Could I have a bigger window?' })];
  assert.equal(askAllowed(s, NOW), true, 'two open, both two days old');
  s.asks.push(ask({ text: 'Could the halt have a little roof?' }));
  assert.equal(askAllowed(s, NOW), false, '3 open blocks');
  s.asks[0]!.status = 'done';
  assert.equal(askAllowed(s, NOW), true, 'back to 2 open');
  s.asks.push(ask({ at: NOW - 11 * HOUR, status: 'no' }));
  assert.equal(askAllowed(s, NOW), false, 'an ask 11 real hours ago blocks, even answered');
  assert.equal(askAllowed(s, NOW + 2 * HOUR), true, 'the clock is the one passed in: 13 hours later she may');
});

test('pacing: the night call only offers an ask when allowed, by the injected clock', async () => {
  const s = newState(1);
  const m = nightMind({ ask: { text: 'Could the stream have a few stepping stones by the dam?', why: 'I keep getting my paws wet.' } });
  const first = await nightly(s, 1, [], m, { asks: true, now: NOW });
  assert.equal(first.ask?.text, 'Could the stream have a few stepping stones by the dam?');
  assert.equal(s.asks?.length, 1);
  assert.equal(s.asks?.[0]?.at, NOW);
  assert.equal(s.asks?.[0]?.status, 'open');
  assert.ok(!('ask' in (s.pages.at(-1) ?? {})), 'the ask is not stored in the night page');

  const m2 = nightMind({ ask: { text: 'Could I have a shelf for my pictures in the shed?', why: 'They curl up in the damp.' } });
  const second = await nightly(s, 2, [], m2, { asks: true, now: NOW + 6 * HOUR });
  assert.equal(m2.seen[0]?.asks, undefined, 'six hours later: not offered');
  assert.equal(second.ask, undefined, 'and an ask the model sends anyway is not taken');
  assert.equal(s.asks?.length, 1);

  const third = await nightly(s, 3, [], m2, { asks: true, now: NOW + 13 * HOUR });
  assert.ok(m2.seen[1]?.asks, 'thirteen hours later: offered again');
  assert.equal(third.ask?.text, 'Could I have a shelf for my pictures in the shed?');
});

test('on the live server, a night ask is an event for the page and a line in the console', async () => {
  const s = newState(2);
  const events: Record<string, unknown>[] = [];
  const lines: string[] = [];
  const m = nightMind({ ask: { text: 'Could the halt have a little roof for rainy mornings?', why: 'I wait for the train in the rain a lot.' } });
  const sim = new Sim(s, { mind: m, rng: new Rng(2), outDir: null, asks: true, onEvent: (e) => events.push(e), onLine: (l) => lines.push(l) });
  await sim.run(s.t + 1440);
  const e = events.find((x) => x.type === 'ask');
  assert.ok(e, 'an ask event');
  assert.equal((e.ask as Ask).text, 'Could the halt have a little roof for rainy mornings?');
  assert.ok(lines.some((l) => l.includes('✋ asked the Keeper: Could the halt have a little roof')));
  assert.ok(!events.some((x) => x.type === 'night' && 'ask' in x), 'the night event stays as it was');

  // Without the live switch (experiments), the same night never asks.
  const quiet = newState(2);
  const m2 = nightMind({ ask: { text: 'Could the halt have a little roof?', why: '' } });
  await new Sim(quiet, { mind: m2, rng: new Rng(2), outDir: null }).run(quiet.t + 1440);
  assert.equal(quiet.asks, undefined);
  assert.ok(m2.seen.length > 0 && m2.seen.every((x) => x.asks === undefined));
});

// ---------- the second schema ----------

test('the ask schema and prompt section only on a night she may ask', async () => {
  const allowed = nightMind();
  await nightly(newState(1), 1, [], allowed, { asks: true, now: NOW });
  const yes = allowed.seen[0]!;
  assert.ok(yes.asks);
  assert.equal(reflectSchema(yes), REFLECT_ASK_SCHEMA);
  assert.ok('ask' in REFLECT_ASK_SCHEMA.properties && (REFLECT_ASK_SCHEMA.required as readonly string[]).includes('ask'));
  assert.match(reflectPrompt(newState(1), yes), /the Keeper looks after the village/);

  const full = newState(1);
  full.asks = [ask(), ask({ text: 'Could I have a bigger window?' }), ask({ text: 'Could the halt have a little roof?' })];
  const blocked = nightMind();
  await nightly(full, 1, [], blocked, { asks: true, now: NOW });
  const no = blocked.seen[0]!;
  assert.equal(no.asks, undefined);
  assert.equal(reflectSchema(no), REFLECT_SCHEMA);
  assert.ok(!('ask' in REFLECT_SCHEMA.properties));
  assert.doesNotMatch(reflectPrompt(full, no), /Keeper/);

  // Experiments never pass `asks`, so their night is exactly as before.
  const off = nightMind();
  await nightly(newState(1), 1, [], off, { now: NOW });
  assert.equal(off.seen[0]?.asks, undefined);
  const { asks: _a, ...plain } = yes;
  assert.equal(reflectPrompt(newState(1), off.seen[0]!), reflectPrompt(newState(1), plain));
});

test('the night prompt lists open asks and the answers, so she does not repeat herself', () => {
  const s = newState(1);
  const input: ReflectInput = {
    day: 2, log: '', keepable: [], droppable: [], patterns: [],
    asks: {
      open: [ask({ text: 'Could I have a bigger window?' })],
      answered: [ask({ text: 'Could I have an account?', status: 'done', note: 'Made you one on Bluesky.' })],
    },
  };
  const p = reflectPrompt(s, input);
  assert.match(p, /"Could I have a bigger window\?"/);
  assert.match(p, /"Could I have an account\?": done \(the Keeper wrote: "Made you one on Bluesky\."\)/);
  assert.match(p, /Most nights she asks for nothing/);
});

test('an empty ask is nothing tonight', async () => {
  const s = newState(1);
  const r = await nightly(s, 1, [], nightMind({ ask: { text: '', why: '' } }), { asks: true, now: NOW });
  assert.equal(r.ask, undefined);
  assert.equal(s.asks, undefined);
});

// ---------- cleaning ----------

test('cleaning: links, mentions, hashtags and emoji go; text and why are capped', () => {
  const c = cleanAsk({ text: '  "Could I have an account at https://bsky.app/x for my #poems, @keeper? 🐰✨"  ', why: 'So strangers can read them! 🌸' }, []);
  assert.ok(c);
  assert.doesNotMatch(c.text, /https|bsky|@|#|🐰|✨/u);
  assert.match(c.text, /poems/);
  assert.equal(c.why, 'So strangers can read them.');
  const long = cleanAsk({ text: `Could the village have ${'a very long row of little lanterns '.repeat(12)}`, why: 'Because '.repeat(40) }, []);
  assert.ok(long);
  assert.ok(long.text.length <= ASK.textMax, `text ${long.text.length}`);
  assert.ok(long.why.length <= ASK.whyMax, `why ${long.why.length}`);
});

test('cleaning: too short, money, selling, a hedgehog body, or a repeat is let go', () => {
  assert.equal(cleanAsk({ text: 'A boat.', why: '' }, []), null, 'under 3 words');
  assert.equal(cleanAsk({ text: '', why: 'nothing tonight' }, []), null);
  assert.equal(cleanAsk({ text: 'Could you buy me a new paintbrush?', why: 'Mine is worn.' }, []), null, 'POST_NEVER: buy');
  assert.equal(cleanAsk({ text: 'Could I have some crypto for the bakery?', why: 'Bramwell wants it.' }, []), null, 'POST_NEVER: crypto');
  assert.equal(cleanAsk({ text: 'Could I have some money for seeds?', why: 'The patch is bare.' }, []), null, 'money');
  assert.equal(cleanAsk({ text: 'Could I have somewhere soft to curl into a ball?', why: 'I am cold.' }, []), null, 'HEDGEHOG_SELF');
  const open = [ask({ text: 'Could I have a little bridge over the stream?' })];
  assert.equal(cleanAsk({ text: 'Could you build a bridge across the stream, please?', why: 'Wet paws.' }, open), null, 'nearly the same as an open ask');
  assert.ok(cleanAsk({ text: 'Could the stream have stepping stones by the dam?', why: 'Wet paws.' }, open), 'a different thing at the same stream is fine');
  assert.ok(cleanAsk({ text: 'Could I have a bench on the stream bank?', why: 'To sit and watch.' }, []), 'a stream bank is not a bank');
});

test('nearly the same: shared words that matter, not shared small words', () => {
  assert.ok(nearlySame('Could I have an account for my posts?', 'Could you make me an account for posts please'));
  assert.ok(!nearlySame('Could I have a bigger window?', 'Could the halt have a little roof?'));
  assert.ok(!nearlySame('Could I have a bench by the stream?', 'Could I have a bench in the square?'), 'one shared word is not enough');
  assert.ok(!nearlySame('Could I have a bigger window?', 'Could I have a bigger lantern?'));
  assert.ok(nearlySame('Could I have a boat?', 'Could I please have a boat?'), 'the same one word is the same ask');
});

test('cleaning: an email goes whole, and "investigate" is not money', () => {
  const c = cleanAsk({ text: 'Could you write to khina@example.com for me about the account?', why: 'ok' }, []);
  assert.equal(c?.text, 'Could you write to for me about the account?');
  assert.ok(cleanAsk({ text: 'Could I have a magnifying glass to investigate the moss?', why: 'I like looking closely.' }, []));
  assert.equal(cleanAsk({ text: 'Could you invest in a bigger mill?', why: 'It squeaks.' }, []), null);
});

test("the Keeper's note: emails and links out, never cut through an emoji", () => {
  const n = tidyNote(`${'a'.repeat(299)}🐰 and more`);
  assert.equal(Array.from(n).length, ASK.noteMax);
  assert.doesNotMatch(n, /[\ud800-\udbff]$/, 'no half an emoji at the end');
  assert.ok(n.endsWith('🐰'));
  assert.equal(tidyNote('Made it: name@example.com, see https://example.com/x ok'), 'Made it: see ok');
});

// ---------- keeping the list small ----------

test('at most 30 asks are kept, the oldest answered go first, open ones stay', () => {
  const asks: Ask[] = [ask({ id: 'old-open' }), ...Array.from({ length: 30 }, (_, i) => ask({ id: `x${i}`, status: 'done' }))];
  trimAsks(asks);
  assert.equal(asks.length, 30);
  assert.equal(asks[0]?.id, 'old-open');
  assert.ok(!asks.some((a) => a.id === 'x0'));

  const s = newState(1);
  s.asks = asks;
  const made = addAsk(s, { text: 'Could I have a bigger window?', why: '' }, NOW);
  assert.equal(s.asks.length, 30);
  assert.equal(s.asks.at(-1), made);
  assert.match(made.id, /^[0-9a-f]{8}$/);
  const site = asksForSite(s);
  assert.equal(site[0], made, 'newest first');
  assert.ok(site.some((a) => a.id === 'old-open'), 'an open ask is always shown');
  assert.ok(site.length <= ASK.show + 3);
});

// ---------- the Keeper answers ----------

test('answering: only the Keeper key works, and nothing changes otherwise', () => {
  const s = newState(1);
  s.asks = [ask({ id: 'k1' })];
  const before = JSON.stringify(s);
  assert.equal(answer(s, 'k1', { status: 'done' }, { key: 'wrong-key' }).status, 403);
  assert.equal(answer(s, 'k1', { status: 'done' }, { key: undefined }).status, 403, 'missing key');
  assert.equal(answer(s, 'k1', { status: 'done' }, { key: '' }).status, 403, 'empty key');
  assert.equal(answer(s, 'k1', { status: 'done' }, { envKey: undefined }).status, 403, 'unset on the server: nobody can answer');
  assert.equal(answer(s, 'k1', { status: 'done' }, { envKey: '' }).status, 403, 'empty on the server');
  assert.equal(answer(s, 'k1', { status: 'done' }, { key: KEY.slice(0, -1) }).status, 403, 'a key one letter short');
  const short = 'hunter2-reused-password';
  assert.equal(answer(s, 'k1', { status: 'done' }, { key: short, envKey: short }).status, 403, 'a server key under 24 characters is as good as unset');
  assert.equal(serverKey(short), null);
  assert.equal(answer(s, 'k1', { status: 'done' }, { envKey: undefined }).body.off, true, 'the page can tell answering is off');
  assert.equal(JSON.stringify(s), before);
  assert.equal(keeperKeyOk(KEY, KEY), true);
});

test('answering: after 20 wrong keys in 10 minutes from one address, that address can\'t answer for 10 minutes, and the count is logged', () => {
  const s = newState(1);
  s.asks = [ask({ id: 'k1' })];
  const g = newGuard();
  const MIN = 60_000;
  // Wrong keys spread out over more than the window never shut it.
  for (let i = 0; i < 40; i++) assert.equal(answer(s, 'k1', { status: 'done' }, { key: `guess-${i}`, now: NOW + i * MIN, guard: g }).status, 403);
  assert.equal(g.byIp.get('203.0.113.1')?.lockedUntil, 0);
  const t0 = NOW + 100 * MIN;
  let last = answer(s, 'k1', { status: 'done' }, { key: 'guess', now: t0, guard: g });
  assert.doesNotMatch(last.log ?? '', /guess/, 'the log counts wrong keys, never says them');
  for (let i = 1; i < ASK.wrongMax; i++) last = answer(s, 'k1', { status: 'done' }, { key: 'guess', now: t0 + i, guard: g });
  assert.equal(last.status, 403, 'the 20th wrong key is still a 403');
  assert.match(last.log ?? '', /shut out for 10 minutes/);
  assert.equal(answer(s, 'k1', { status: 'done' }, { key: 'guess', now: t0 + MIN, guard: g }).status, 429);
  assert.equal(answer(s, 'k1', { status: 'done' }, { now: t0 + MIN, guard: g }).status, 429, 'the right key too, or the lock would tell a right guess');
  assert.equal(s.asks[0]?.status, 'open');
  assert.equal(answer(s, 'k1', { status: 'done' }, { now: t0 + 11 * MIN, guard: g }).status, 200, 'open again after 10 minutes');
});

test('answering: a troll can\'t lock the Keeper out: no key counts for nothing, and one address shuts out only itself', () => {
  const s = newState(1);
  s.asks = [ask({ id: 'k1' })];
  const g = newGuard();
  // Requests with no key at all are not guesses.
  for (let i = 0; i < 100; i++) {
    const r = answer(s, 'k1', { status: 'done' }, { key: undefined, now: NOW + i, guard: g, ip: '198.51.100.9' });
    assert.equal(r.status, 403);
    assert.equal(r.log, undefined, 'and leave no line in the log');
  }
  assert.equal(g.wrong.length, 0);
  // Twenty wrong keys from one address shut out that address, not the Keeper's.
  for (let i = 0; i < ASK.wrongMax; i++) answer(s, 'k1', { status: 'done' }, { key: 'guess', now: NOW + 200 + i, guard: g, ip: '198.51.100.9' });
  assert.equal(answer(s, 'k1', { status: 'done' }, { key: 'guess', now: NOW + 300, guard: g, ip: '198.51.100.9' }).status, 429);
  assert.equal(answer(s, 'k1', { status: 'notnow' }, { now: NOW + 300, guard: g, ip: '203.0.113.50' }).status, 200, 'the Keeper, elsewhere, still gets in');
  // Only very many wrong keys from everyone together shut the door for all.
  const g2 = newGuard();
  for (let i = 0; i < ASK.wrongMaxAll; i++) answer(s, 'k1', { status: 'done' }, { key: 'guess', now: NOW + i, guard: g2, ip: `198.51.${i >> 8}.${i & 255}` });
  assert.equal(answer(s, 'k1', { status: 'done' }, { now: NOW + 1000, guard: g2, ip: '203.0.113.50' }).status, 429);
});

test('checking a key: 204 good, 403 wrong, 503 answering off', () => {
  const g = newGuard();
  assert.equal(checkRequest(g, KEY, KEY, NOW).status, 204);
  assert.equal(checkRequest(g, 'nope', KEY, NOW).status, 403);
  assert.equal(checkRequest(g, KEY, undefined, NOW).status, 503);
  assert.equal(checkRequest(g, KEY, 'too-short', NOW).status, 503);
  assert.equal(checkRequest(g, undefined, KEY, NOW).status, 403);
  assert.equal(g.wrong.length, 1, 'a wrong key counts towards the lock; no key, or answering off, does not');
});

test('answering: bad body 400, too long 413, unknown 404, twice 409', () => {
  const s = newState(1);
  s.asks = [ask({ id: 'k1' })];
  const before = JSON.stringify(s);
  assert.equal(answer(s, 'k1', 'not json').status, 400);
  assert.equal(answer(s, 'k1', [1, 2]).status, 400);
  assert.equal(answer(s, 'k1', { status: 'maybe' }).status, 400);
  assert.equal(answer(s, 'k1', { status: 'open' }).status, 400, 'open is not an answer');
  assert.equal(answer(s, 'k1', { status: 'done', note: 42 }).status, 400);
  assert.equal(answer(s, 'k1', { status: 'done', note: 'x'.repeat(3000) }).status, 413);
  assert.equal(answer(s, 'nope', { status: 'done' }).status, 404);
  assert.equal(JSON.stringify(s), before, 'nothing changed');
  assert.equal(answer(s, 'k1', { status: 'done' }).status, 200);
  const letters = s.world.letters.length;
  assert.equal(answer(s, 'k1', { status: 'no' }).status, 409);
  assert.equal(s.asks[0]?.status, 'done');
  assert.equal(s.world.letters.length, letters, 'no second letter');
});

test('answering: the answer is kept and a letter from the Keeper goes in her letterbox', () => {
  const s = newState(1);
  s.asks = [ask({ id: 'k1', text: 'Could the stream have a few stepping stones.' })];
  // Two village letters already waiting: the Keeper's still gets in.
  s.world.letters.push({ from: 'wren', text: 'Peas.', t: 1 }, { from: 'tansy', text: 'Post.', t: 2 });
  s.world.flagSeen = true;
  const r = answer(s, 'k1', { status: 'done', note: `  Put three flat ones in this morning.\n${' '.repeat(5)}Mind the moss. ${'x'.repeat(400)}` });
  assert.equal(r.status, 200);
  const a = s.asks[0]!;
  assert.equal(a.status, 'done');
  assert.equal(a.answeredAt, NOW);
  assert.ok(a.note && a.note.length <= ASK.noteMax);
  assert.match(a.note, /^Put three flat ones in this morning\. Mind the moss\./);
  assert.equal(s.world.letters.length, 3);
  const l = s.world.letters[2]!;
  assert.equal(l.from, 'keeper');
  assert.deepEqual(l.ask, { id: 'k1', status: 'done', text: 'Could the stream have a few stepping stones.', note: a.note });
  assert.match(l.text, /^About "Could the stream have a few stepping stones": done\. Put three flat ones/);
  assert.equal(s.world.flagSeen, false, 'the flag goes up again');
  assert.equal(senderName('keeper'), 'the Keeper');

  s.asks.push(ask({ id: 'k2', text: 'Could I have a boat?' }), ask({ id: 'k3', text: 'Could I have a kite?' }));
  answer(s, 'k2', { status: 'notnow' });
  answer(s, 'k3', { status: 'no', note: 'Too windy up there.' });
  assert.equal(s.world.letters[3]?.text, 'About "Could I have a boat?": not now.');
  assert.equal(s.world.letters[4]?.text, 'About "Could I have a kite?": no, sorry. Too windy up there.');
});

test('reading the Keeper letter: glad at done, patient at not now, a little let down at no', () => {
  const read = (status: 'done' | 'notnow' | 'no') => {
    const s = newState(1);
    s.asks = [ask({ id: 'k1' })];
    answer(s, 'k1', { status, note: 'Note.' });
    s.world.flagSeen = true;
    const out = actionDef('letterbox').outcome!({ s, rng: new Rng(1), at: s.t }, {} as Activity);
    assert.match(out.text, /letter from the Keeper/);
    assert.match(out.text, /about what Khina asked for \("Could the stream have a few stepping stones"\): /);
    assert.match(out.text, /The Keeper wrote: "Note\."$/, 'the note is quoted, like a villager note');
    assert.equal(s.world.letters.length, 0, 'read and taken out');
    return out.thought!;
  };
  const done = read('done');
  const notnow = read('notnow');
  const no = read('no');
  assert.ok(done.value >= 4, `done is glad: ${done.value}`);
  assert.ok(notnow.value > 0 && notnow.value < done.value, `not now is patient: ${notnow.value}`);
  assert.ok(no.value < 0 && no.value > -4, `no is a small let-down: ${no.value}`);
  assert.ok(no.hours < done.hours, 'and over soon');
  assert.match(done.key, /^keeper-/);
  assert.match(done.text, /"Could the stream have a few stepping stones"/, 'the thought says what she asked for');
});

test('reading the Keeper letter: no note, no full stop at the end, and two answers make two memories', () => {
  const s = newState(1);
  s.asks = [ask({ id: 'k1', text: 'Could I have a shelf for my pictures in the shed?' }), ask({ id: 'k2', text: 'Could the halt have a little roof?' })];
  answer(s, 'k1', { status: 'no' });
  answer(s, 'k2', { status: 'done' });
  const outs = [0, 1].map(() => actionDef('letterbox').outcome!({ s, rng: new Rng(1), at: s.t }, {} as Activity));
  assert.equal(outs[0]!.text, 'found a letter from the Keeper in the letterbox, about what Khina asked for ("Could I have a shelf for my pictures in the shed"): no, sorry');
  for (const o of outs) remember(s, { text: o.thought!.text, where: 'at home', category: o.thought!.key.split('-')[0]!, salience: 5 });
  const kept = s.memories.filter((m) => m.category === 'keeper').map((m) => m.text);
  assert.equal(kept.length, 2, `two memories: ${kept.join(' | ')}`);
  assert.ok(kept.some((t) => t.includes('shelf')) && kept.some((t) => t.includes('roof')));
  // A letter from before the ask rode along on it still reads.
  s.world.letters.push({ from: 'keeper', text: 'About "x": done.', t: 0, ask: { id: 'old', status: 'done' } });
  const old = actionDef('letterbox').outcome!({ s, rng: new Rng(1), at: s.t }, {} as Activity);
  assert.equal(old.thought?.text, 'The Keeper did what I asked for');
});

test('village post still comes while Keeper letters wait', () => {
  const s = newState(3);
  s.features.drama = false;
  s.world.letters.push({ from: 'keeper', text: 'About "x": done.', t: 0, ask: { id: 'k', status: 'done' } }, { from: 'keeper', text: 'About "y": no, sorry.', t: 0, ask: { id: 'j', status: 'no' } });
  const sim = new Sim(s, { mind: offlineMind, rng: new Rng(3), outDir: null });
  // Many mid-morning hours with nobody reading the post: the village fills up to its own 2 letters.
  for (let i = 0; i < 300; i++) {
    s.t = 10 * 60;
    (sim as unknown as { hourly(): void }).hourly();
  }
  assert.equal(s.world.letters.filter((l) => l.from === 'keeper').length, 2);
  assert.equal(s.world.letters.filter((l) => l.from !== 'keeper').length, 2, 'two village letters, as without the Keeper');
});

// ---------- old saves ----------

test('an old save without asks loads and works', async () => {
  const old = JSON.parse(JSON.stringify(newState(1))) as State;
  delete old.asks;
  assert.equal(old.asks, undefined);
  assert.equal(askAllowed(old, NOW), true);
  assert.deepEqual(asksForSite(old), []);
  assert.equal(answer(old, 'whatever', { status: 'done' }).status, 404);
  const sim = new Sim(old, { mind: offlineMind, rng: new Rng(1), outDir: null, asks: true });
  await sim.run(old.t + 1440);
  assert.equal(old.asks, undefined, 'code alone never asks');
  const r = await nightly(old, 2, [], nightMind({ ask: { text: 'Could I have a bigger window in the burrow?', why: 'It is dark by four.' } }), { asks: true, now: NOW });
  assert.equal(r.ask?.text, 'Could I have a bigger window in the burrow?');
  assert.equal(asksForSite(old).length, 1);
});
