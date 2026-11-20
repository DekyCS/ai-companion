// When two questions (or two subjects) are about the same thing. Its own module, so the village's
// actions can use it without importing the prompts (src/mind/making.ts imports src/world/actions.ts).

import { asking } from '../config.ts';
import type { Reading } from '../state.ts';

// Over 48 live days 12 of her 24 lookups were "why do trains skip stops" in other words, and only exact
// repeats were caught. Questions are compared by their content words instead.

/**
 * Words that say nothing about the topic: question words, little words, how much. Not "still", "out",
 * "over", "under", "up", "down" or "one": "why do herons stand so still" and "... on one leg" are two
 * questions, and without those words they shrank to the same one.
 */
const STOP_WORDS = new Set(
  'a an the do does did doing done why how what which when where who whom whose is are was were be been being am to of in on at for with from by and or but if their there they them it its this that these those my me you your our we us he she his her so such some any very really much many more most can could would should will may might just even ever also about into onto than then too not no as all each every ones get got make makes'.split(' '),
);

/**
 * Different words for one thing in her questions: a halt is a stop, a warren is a burrow, and on the line a
 * village is a stop ("why do trains skip tiny villages" was the first of her train-skipping questions).
 */
const SAME_THING: Record<string, string> = {
  station: 'stop', halt: 'stop', platform: 'stop', village: 'stop',
  warren: 'burrow', tunnel: 'burrow', den: 'burrow', underground: 'burrow',
  bunny: 'rabbit', hare: 'rabbit', railway: 'train', railroad: 'train',
};

/** "skipping" and "skipped" are "skip"; "stations" is "station", then "stop". */
function stem(word: string): string {
  const undouble = (x: string) => (/([b-df-hj-np-tv-z])\1$/.test(x) && !/(ll|ss|zz)$/.test(x) ? x.slice(0, -1) : x);
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ss|sh|ch|x|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  else if (w.length > 5 && w.endsWith('ing')) w = undouble(w.slice(0, -3));
  else if (w.length > 5 && w.endsWith('ed')) w = undouble(w.slice(0, -2));
  return SAME_THING[w] ?? w;
}

/** The words of a question (or a subject) that say what it is about. */
export function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().replace(/['’]s\b/g, '').match(/[a-z]+/g) ?? [];
  return new Set(words.filter((w) => w.length > 2 && !STOP_WORDS.has(w)).map(stem));
}

/** How two questions' content words meet: how many they share, how many in all, and whether one's are all in the other. */
function wordsMeet(a: string, b: string): { overlap: number; shared: number; within: boolean } {
  const x = contentWords(a);
  const y = contentWords(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  const either = new Set([...x, ...y]).size;
  return { overlap: either ? shared / either : 0, shared, within: shared > 0 && shared === Math.min(x.size, y.size) };
}

/** Share of content words two questions have in common (0 to 1). */
export function questionOverlap(a: string, b: string): number {
  return wordsMeet(a, b).overlap;
}

/**
 * The same question, in other words: `asking.sameAt` of their content words in common (src/config.ts),
 * and either 3 or more of them, or 2 with nothing new on one side ("why do trains skip stops" / "... skip
 * some stations"). Two shared words with something new on each side is a new question on the same subject
 * ("why do frogs croak at night" / "... in the rain"; "how do rabbits see in the dark" / "how do owls ..."):
 * on overlap alone, 11 of 24 such pairs counted as the same, and her new question was swapped for an old one.
 */
export function sameQuestion(a: string, b: string): boolean {
  const m = wordsMeet(a, b);
  return m.overlap >= asking.sameAt && (m.shared >= 3 || (m.shared >= 2 && m.within));
}

/** The reading she already has for this question (the closest one), if any. */
export function knownReading(readings: Reading[], question: string): Reading | undefined {
  let best: Reading | undefined;
  let bestAt = 0;
  for (const r of readings) {
    if (!sameQuestion(r.question, question)) continue;
    const at = questionOverlap(r.question, question);
    if (at >= bestAt) [best, bestAt] = [r, at];
  }
  return best;
}
