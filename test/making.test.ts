import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownChoice } from '../src/mind/decide.ts';
import { checkPiece, checkReading, cleanHtml, cleanNotes, cleanSvg, formFor, pieceRequest } from '../src/mind/making.ts';
import { Rng } from '../src/rng.ts';
import { newState } from '../src/state.ts';

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
  const a = ownChoice({ action: 'own', reason: '', weight: 5, detail: 'build a tiny raft for beetles', place: 'stream', kind: 'making' }, 'burrow', rng);
  assert.deepEqual(a, { actionId: 'own.making', detail: 'build a tiny raft for beetles', place: 'stream' });
  const b = ownChoice({ action: 'own', reason: '', weight: 5, detail: 'x', place: 'mars', kind: 'nature' }, 'burrow', rng);
  assert.equal(b.place, 'burrow');
  const c = ownChoice({ action: 'own', reason: '', weight: 5, detail: '', place: '', kind: '' }, 'shed', rng);
  assert.match(c.actionId, /^own\./);
});
