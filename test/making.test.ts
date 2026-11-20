import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extrasAllowance } from '../src/mind/claude.ts';
import { ownChoice } from '../src/mind/decide.ts';
import { checkPiece, checkReading, cleanHtml, cleanNotes, cleanSvg, formFor, knownReading, pieceRequest, sameQuestion } from '../src/mind/making.ts';
import { diaryPrompt, STALE_NOTE } from '../src/mind/prompts.ts';
import { Rng } from '../src/rng.ts';
import { newState, type Reading } from '../src/state.ts';

const shapes = '<rect x="0" y="0" width="400" height="300" fill="#a87"/><circle cx="50" cy="50" r="20"/><path d="M0 0L10 10"/>';

test('pictures: scripts, handlers and outside links are removed', () => {
  const svg = cleanSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" onload="alert(1)"><script>alert(2)</script>${shapes}<image href="https://x.test/a.png"/><a href="https://x.test"><rect/></a><rect style="fill:url(https://x.test/f)"/><foreignObject><div>hi</div></foreignObject></svg>`,
  );
  assert.ok(svg);
  assert.doesNotMatch(svg, /script|onload|https:\/\/x\.test|foreignObject|<image|<a\b/i);
  assert.match(svg, /<circle/);
});

test('pictures: not an SVG, or nothing drawn, is turned down', () => {
  assert.equal(cleanSvg('<div>no</div>'), null);
  assert.equal(cleanSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), null);
  assert.equal(cleanSvg(`<!DOCTYPE svg [<!ENTITY x "y">]><svg>${shapes}</svg>`), null);
  assert.match(cleanSvg(`<svg>${shapes}</svg>`) ?? '', /xmlns=.*viewBox|viewBox=.*xmlns/);
});

test('songs: only real pitches and sane lengths', () => {
  assert.equal(cleanNotes([{ p: 'E4', d: 1 }]), null);
  const n = cleanNotes([...Array(9)].map((_, i) => ({ p: ['C4', 'D#4', 'Bb3', 'rest', 'X9', 'G7', 'A5', 'E4', 'C6'][i], d: i === 0 ? 99 : 0.5 })));
  assert.ok(n);
  assert.deepEqual(n.map((x) => x.p), ['C4', 'D#4', 'Bb3', 'rest', 'A5', 'E4', 'C6']);
  assert.equal(n[0]?.d, 1);
});

test('little games: no frames or forms, and a no-network policy is added', () => {
  assert.equal(cleanHtml('<iframe src="https://x.test"></iframe>' + 'x'.repeat(100)), null);
  const html = cleanHtml(`<html><head><title>t</title></head><body><canvas></canvas><script>let a=1;</script>${' '.repeat(80)}</body></html>`);
  assert.ok(html);
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'/);
});

test('the form follows Khina\'s words, else code picks one', () => {
  const rng = new Rng(1);
  assert.equal(formFor('a song about the heron', rng), 'song');
  assert.equal(formFor('a little game with acorns', rng), 'toy');
  assert.equal(formFor('a picture of fog', rng), 'picture');
  assert.ok(['picture', 'poem', 'story', 'song', 'toy'].includes(formFor('the old mill', rng)));
});

test('a piece missing its content is turned down', () => {
  const s = newState(1);
  const req = pieceRequest(s, 'poem', 'a poem', '', new Rng(2), '');
  assert.equal(typeof checkPiece({ title: 'x', text: 'too short' }, req), 'string');
  const ok = checkPiece({ title: '"Rain"', text: 'one two three four five six seven eight nine ten eleven twelve thirteen' }, req);
  assert.equal(typeof ok, 'object');
  assert.equal((ok as { title: string }).title, 'Rain');
});

test('readings keep only web links', () => {
  const r = checkReading({ question: 'q', learned: 'Herons wait without moving so fish do not notice them.', sources: [{ title: 'a', url: 'javascript:alert(1)' }, { title: 'b', url: 'https://example.org/heron' }] }, 'q', 5);
  assert.equal(typeof r, 'object');
  assert.deepEqual((r as { sources: unknown[] }).sources, [{ title: 'b', url: 'https://example.org/heron' }]);
});

test('own ideas get a kind and a real place, or a stand-in', () => {
  const rng = new Rng(3);
  const a = ownChoice({ action: 'own', reason: '', weight: 5, detail: 'build a tiny raft for a ladybird', place: 'stream', kind: 'making' }, 'burrow', rng);
  assert.deepEqual(a, { actionId: 'own.making', detail: 'build a tiny raft for a ladybird', place: 'stream' });
  const b = ownChoice({ action: 'own', reason: '', weight: 5, detail: 'x', place: 'mars', kind: 'nature' }, 'burrow', rng);
  assert.equal(b.place, 'burrow');
  const c = ownChoice({ action: 'own', reason: '', weight: 5, detail: '', place: '', kind: '' }, 'shed', rng);
  assert.match(c.actionId, /^own\./);
});

test('the extras budget is let out through the day, not spent by 2 a.m.', () => {
  const at = (h: number) => new Date(2026, 10, 17, h, 0);
  assert.ok(extrasAllowance(0.3, at(0)) > 0.015 && extrasAllowance(0.3, at(0)) < 0.025);
  assert.ok(Math.abs(extrasAllowance(0.3, at(12)) - 0.16875) < 1e-9);
  assert.equal(extrasAllowance(0.3, at(23)), 0.3);
});

test('the same question asked twice is recognised', () => {
  assert.ok(sameQuestion('Why do rabbits thump their back feet?', 'why do rabbits thump their back feet'));
  assert.ok(sameQuestion('Why do trains skip some stops?', 'why do trains skip stations'), 'a station is a stop');
  assert.ok(sameQuestion('How do rabbits dig their warrens?', 'how do bunnies dig burrows'), 'a warren is a burrow');
  assert.ok(!sameQuestion('Why do herons stand still?', 'Why do herons fly?'));
  assert.ok(!sameQuestion('?', '!'));
});

/**
 * Her 24 real lookups over 48 live days, in order: what she asked (the decision's words) and the question
 * the search stored, or null where the old exact check already said "asked again". A heron question was
 * stored before the logs begin.
 */
const LIVE_LOOKUPS: [string, string | null][] = [
  ['how do rabbits dig such deep burrows', 'How do rabbits dig such deep burrows?'],
  ['how do rabbits dig warrens', 'How do rabbits dig their warrens?'],
  ['how rabbits dig warren tunnels with paws', 'How do rabbits dig warren tunnels?'],
  ['why do minnows gather in shallows', 'Why do minnows gather in the shallows?'],
  ['how do rabbits keep burrows dry in rain', 'How do rabbits keep their burrows dry in the rain?'],
  ['how do burrows keep rain water out', 'How do burrows keep rain water out?'],
  ['how does the post train reach villages', 'How does the post train reach villages?'],
  ['how do rabbits stay dry underground', 'How do rabbits stay dry underground?'],
  ['why do trains skip tiny villages', 'Why do trains skip tiny villages?'],
  ['why do rabbits thump back feet', 'Why do rabbits thump their back feet?'],
  ['why do trains skip some stops', 'Why do trains skip some stops?'],
  ['why do rabbits thump their back feet', null],
  ['why do trains skip stops', 'Why do trains skip stops?'],
  ['why do trains skip stops', null],
  ['why do herons stand so still', null],
  ['why do trains skip stops', null],
  ['why do herons stand so still', null],
  ['why do trains skip some stops', null],
  ['how trains decide which stations to skip', 'How do trains decide which stations to skip?'],
  ['why do trains skip some stops', null],
  ['why do herons stand so still', null],
  ['why do trains skip some stations', 'Why do trains skip some stations?'],
  ['why do express trains skip small stations', 'Why do express trains skip small stations?'],
  ['why do express trains skip small stations', null],
];

test('replayed on her 24 real lookups, the repeat check skips 9 of the 15 paid ones and nothing new', () => {
  const readings: Reading[] = [{ t: 0, question: 'Why do herons stand so still?', learned: 'They wait for fish.', sources: [] }];
  const fresh: string[] = [];
  let paidSkipped = 0;
  let againCaught = 0;
  for (const [asked, stored] of LIVE_LOOKUPS) {
    if (knownReading(readings, asked)) {
      if (stored) paidSkipped += 1;
      else againCaught += 1;
      continue;
    }
    fresh.push(asked);
    readings.push({ t: 0, question: stored ?? asked, learned: '…', sources: [] });
  }
  assert.equal(againCaught, 9, 'every repeat the exact check caught is still caught');
  assert.equal(paidSkipped, 9, 'and 9 of the 15 paid lookups would not have been paid for');
  // What is still looked up: the first question on each thing she wondered about, never a repeat in new words.
  assert.deepEqual(fresh, [
    'how do rabbits dig such deep burrows',
    'why do minnows gather in shallows',
    'how do rabbits keep burrows dry in rain',
    'how does the post train reach villages',
    'why do trains skip tiny villages',
    'why do rabbits thump back feet',
  ]);
});

/**
 * Different questions on the same subject, which must each be looked up. On overlap alone (0.4) 14 of these
 * counted as one she had asked, so she "remembered" an answer to another question and lost a new one.
 */
const DIFFERENT: [string, string][] = [
  ['Why do herons stand so still?', 'why do herons stand on one leg'],
  ['How do rabbits see in the dark?', 'how do owls see in the dark'],
  ['Why do frogs croak at night?', 'why do frogs croak in the rain'],
  ['Why do frogs croak at night?', 'why do owls hoot at night'],
  ['Why do trains skip some stops?', 'why do trains whistle at stops'],
  ['Why do trains skip some stops?', 'how do trains stop so fast'],
  ['What is a heron?', 'what do herons eat'],
  ['what are clouds', 'why are clouds white'],
  ['what are minnows', 'what do minnows eat'],
  ['How do rabbits dig such deep burrows?', 'how deep do moles dig'],
  ['How do rabbits dig such deep burrows?', 'how many rabbits live in one burrow'],
  ['Why do rabbits thump their back feet?', 'how do rabbits clean their feet'],
  ['Why do leaves change colour in autumn?', 'why do leaves fall in autumn'],
  ['How do rabbits keep their burrows dry in the rain?', 'how do badgers keep their setts dry'],
  ['Why do trains go over bridges?', 'why do trains go under bridges'],
];

test('a new question on the same subject is still looked up', () => {
  for (const [old, asked] of DIFFERENT) {
    assert.ok(!sameQuestion(old, asked), `"${asked}" is not "${old}"`);
    assert.equal(knownReading([{ t: 0, question: old, learned: '…', sources: [] }], asked), undefined);
  }
  // The same question in other words still is the same.
  assert.ok(sameQuestion('How do rabbits dig warren tunnels?', 'how do rabbits dig'));
  assert.ok(sameQuestion('Why do express trains skip small stations?', 'why do trains skip tiny villages'));
});

test('the diary is not told "it did less for Khina than it used to" every time', () => {
  const s = newState(1);
  const rec = { actionId: 'tidy', place: 'burrow', start: 601, end: 640, outcome: `tidied the burrow${STALE_NOTE}`, reason: 'messy', moodBefore: 60, moodAfter: 60 } as unknown as Parameters<typeof diaryPrompt>[1];
  assert.doesNotMatch(diaryPrompt(s, rec, []), /did less for Khina/);
  assert.match(diaryPrompt(s, { ...rec, start: 600 }, []), /wearing a little thin/);
});
