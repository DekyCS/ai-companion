// Everything the model reads. Feelings go in as words, never numbers.
// The model sees no scores, and the options are shuffled so list position means nothing.

import { energyWord, moodWord, needThoughts, pressingWords } from '../body.ts';
import type { Rng } from '../rng.ts';
import type { Completed, State } from '../state.ts';
import { ago, clock, partOfDay, weekday } from '../time.ts';
import { actionDef, ACTION_IDS, OWN_KINDS } from '../world/actions.ts';
import { PLACE_IDS, PLACES } from '../world/places.ts';
import { isWet, names, presentAt, verb, WEATHER_WORDS } from '../world/village.ts';
import { habit, NEEDS, type NeedId } from '../config.ts';
import type { Sense } from './decide.ts';
import { habitNote, ownHabits } from './habit.ts';
import { recall } from './memory.ts';
import type { Option } from './score.ts';
import { labelFor } from './sleep.ts';

/** Locked lines: temperament and voice. No hobbies; those have to be earned. */
const CHARACTER_BASE = `Who Khina is:
- A small hedgehog who lives alone in a burrow under an old oak, at the edge of a forest village.
- Shy. Watches a place for a while before going in. Better with one face than with a crowd.
- Curious, but in careful steps: looks first, sniffs second, touches last.
- Notices smells before anything else.
- Startles at loud noises. Herons, owls, deep water and being stared at are the worst things in the world.
- Stubborn about small things: the right stone, the right spot, the right way round.
- Grumpy when hungry or tired, and does not pretend otherwise.
- Hums when content. Counts things under the breath when nervous.
- Keeps things found on walks. Rarely gives anything away.
- Dry. Says plain, short things. Never gushes.`;

const VILLAGE = `The village: Bramwell the badger (he) runs the bakery. Old Wren, an old tortoise (she), keeps the vegetable patch. Tansy the postmouse (she) brings the post. Pip and Nettle are two squirrel kids. A vole family lives by the mill. A little train halt has trains to the city at the end of the line.`;

/** The sheet as it stands: locked lines, plus lines earned over time (added at night, backed by code's counts). */
export function characterSheet(s?: State): string {
  const learned = s?.learned ?? [];
  const extra = learned.length ? `\n\nLearned about itself over time:\n${learned.map((l) => `- ${l.text}`).join('\n')}` : '';
  const hut = s?.world.can?.net ? ' Down the lane there is an internet hut, where an old computer on the porch can look up anything Khina wonders about.' : '';
  return `${CHARACTER_BASE}${extra}\n\n${VILLAGE}${hut}`;
}

export const CHARACTER = characterSheet();

export const decideSystem = (s?: State) => `You are the inner voice of Khina, a small hedgehog. Nobody is talking to you. There is no user, no task and nobody to help. Khina is just living a day.

Each time Khina finishes something, you are told how Khina feels and what Khina could do next. Pick the 3 to 5 options Khina would most plausibly do now.

How to choose:
- Feelings come first. A hungry, tired or grumpy hedgehog makes hungry, tired, grumpy choices. Do not default to the most wholesome or productive option.
- Khina is not a helper and has no goals beyond today. Khina does things because of how they feel, not to be useful or to improve.
- Fit the moment: the weather, the hour, who is around, what Khina has just been doing.
- Make the picks genuinely different from each other, not five versions of one idea.
${s?.world.can?.own ? `- Khina is free to do anything a small hedgehog could do in this village, not only what is listed. If Khina would rather do something not on the list, pick "own" and say what. Ideas of Khina's own are welcome, as long as they fit this village and a hedgehog's paws. To look something up, use "browse" (when it is listed), never "own".
` : ''}${s?.features.habitWords ? "- Khina has a few habits. Options marked as one of Khina's habits are things this particular hedgehog keeps coming back to; lean toward them when nothing pressing says otherwise. Options Khina hardly ever does are less likely, though not impossible.\n" : ''}
For each pick:
- action: its id from the list.
- reason: what goes through Khina's head right now. First person, under 15 words, plain words. Not a description of the option.
- weight: 1 to 10, how much Khina wants it right now.
- detail: only for options marked [say what]. Under 8 concrete words, specific to today (what to whittle, what to talk about). Otherwise an empty string.
- For "own", detail is required: what Khina will actually do, under 8 words ("float a leaf boat down the stream").
- place and kind: only for "own". place is where Khina would do it (one of: ${PLACE_IDS.filter((p) => p !== 'nethut').join(', ')}). kind is what sort of thing it is (one of: ${OWN_KINDS.join(', ')}). For every other option, empty strings.

${characterSheet(s)}`;

export const diarySystem = (s?: State) => `You write Khina's diary. Khina is a small hedgehog. You are given the facts of one thing Khina just did; write the diary line for it.

Rules:
- First person, past tense, as Khina. At most 2 sentences and 35 words.
- Stick to the facts given. Do not add places, objects, people or actions that are not in them.
- Use a sensory detail only of the kind the facts ask for, and at most one.
- Let the mood colour the wording without naming it. Never mention energy or how rested Khina feels.
- Do not say how many minutes something took.
- Plain, short words. No exclamation marks, no emojis. Never use the words cozy, cosy, adventure, journey, magical, delightful or whimsical.
- No lessons, no morals, no hopes about tomorrow.
- Start differently from the recent lines you are shown, and do not reuse their phrases. Never write "did less for me than it used to".

${characterSheet(s)}`;

export const reflectSystem = (s?: State) => `You are Khina's mind at night, while Khina sleeps. Khina is a small hedgehog. You get the facts of Khina's day from the village's records, and some notes. Do four small jobs.

1. page: tonight's diary page. First person as Khina, past tense, 3 to 5 sentences, under 90 words. Pick the one or two things that mattered most today and skip the rest. Plain short words, dry. No exclamation marks, no lessons or morals, no hopes about tomorrow. Do not invent anything that is not in the records. Never use the words cozy, cosy, adventure, journey, magical, delightful or whimsical.
2. keep: ids of at most 2 memories worth keeping for good, from the "could be kept" list. Keep what Khina would still think about in a month. An empty list is fine.
3. drop: ids of at most 3 short-term memories not worth keeping. An empty list is fine.
4. sheet_line and evidence: only if one of the counted patterns clearly says something about who Khina is becoming, write one line for Khina's character sheet in third person, under 12 words (for example "Has come to like watching the trains leave."), and put that pattern's id in evidence. Otherwise leave both empty. Most nights should leave them empty.

${characterSheet(s)}`;

/** Static schema: every action id is allowed here; code checks the pick was on the menu. */
export const DECIDE_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ACTION_IDS },
          reason: { type: 'string' },
          weight: { type: 'integer' },
          detail: { type: 'string' },
          place: { type: 'string', enum: ['', ...PLACE_IDS] },
          kind: { type: 'string', enum: ['', ...OWN_KINDS] },
        },
        required: ['action', 'reason', 'weight', 'detail', 'place', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
} as const;

export const DIARY_SCHEMA = {
  type: 'object',
  properties: { line: { type: 'string' } },
  required: ['line'],
  additionalProperties: false,
} as const;

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const cap = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?"]$/.test(cap) ? cap : `${cap}.`;
}

/** What is on Khina's mind, worst or strongest first. */
export function onMind(s: State, max = 4, withNeeds = true): string[] {
  const fromNeeds = needThoughts(s)
    .filter((th) => withNeeds && th.value < 0)
    .map((th) => ({ text: th.text, weight: Math.abs(th.value) + 100, at: th.at }));
  const events = s.thoughts.map((th) => ({ text: `${th.text} (${ago(s.t, th.at)})`, weight: Math.abs(th.value), at: th.at }));
  return [...fromNeeds, ...events]
    .sort((a, b) => b.weight - a.weight || b.at - a.at)
    .slice(0, max)
    .map((x) => sentence(x.text));
}

/** A short prose summary of the last few hours. Raw logs invite copying; prose does not. */
export function lately(s: State, hours = 8): string {
  const since = s.t - hours * 60;
  const items = s.history.filter((h) => h.end > since && h.actionId !== 'idle');
  if (items.length === 0) return 'Nothing much yet today.';
  const groups: { part: string; bits: string[] }[] = [];
  for (const h of items) {
    const p = partOfDay(h.start);
    const part =
      h.actionId === 'sleep' ? 'overnight' : p === 'early morning' ? 'early this morning' : p === 'night' ? 'late at night' : `this ${p}`;
    const bit =
      h.kind === 'refused'
        ? `went to ${PLACES[h.place].short} for nothing`
        : h.actionId === 'sleep'
          ? `slept until ${clock(h.end)}`
          : `${h.gist}${h.detail ? ` (${h.detail})` : ''}${h.gist.includes(PLACES[h.place].short) ? '' : ` at ${PLACES[h.place].short}`}`;
    const last = groups[groups.length - 1];
    if (last && last.part === part) last.bits.push(bit);
    else groups.push({ part, bits: [bit] });
  }
  return groups.map((g) => sentence(`${g.part[0]!.toUpperCase()}${g.part.slice(1)}: ${g.bits.join(', then ')}`)).join(' ');
}

function optionLine(o: Option, s: State, own: Set<string>): string {
  const where = o.place === s.place ? 'right here' : `${PLACES[o.place].name}, ${o.travel} min walk`;
  const ask = o.def.detailAsk ? ` [say what: ${o.def.detailAsk}]` : '';
  if (o.def.id === 'own') return `- own: ${o.def.label}${ask} (anywhere in the village)`;
  const notes = [o.note, habitNote(s, o.def, own), o.familiarity >= habit.noteAt ? 'done a lot lately' : ''].filter(Boolean);
  return `- ${o.def.id}: ${o.def.label}${ask} (${where}${notes.length ? `; ${notes.join('; ')}` : ''})`;
}

/** A small, rotating sample of what Khina has come to like and dislike, so no single taste fills every prompt. */
export function tastesLine(s: State, rng: Rng): string {
  const likes = rng.shuffle(s.beliefs.filter((b) => b.polarity === 'likes')).slice(0, 2).map((b) => labelFor(b.key));
  const dislikes = rng.shuffle(s.beliefs.filter((b) => b.polarity === 'dislikes')).slice(0, 1).map((b) => labelFor(b.key));
  const parts = [];
  if (likes.length) parts.push(`Khina has come to like ${likes.join(' and ')}.`);
  if (dislikes.length) parts.push(`Not keen on ${dislikes[0]}.`);
  return parts.join(' ');
}

/** Experiment: the same state as numbers. */
const NUMBER_NAMES: Record<NeedId, string> = {
  fullness: 'full belly',
  rest: 'rest',
  calm: 'calm',
  company: 'company',
  novelty: 'something new',
  making: 'making things',
};

function feelingLines(s: State): string[] {
  if (!s.features.numbers) return [`How Khina feels: ${[moodWord(s.mood), energyWord(s.energy), ...pressingWords(s)].join(', ')}.`];
  return [
    `How Khina feels: mood ${Math.round(s.mood)}/100, energy ${Math.round(s.energy)}/100.`,
    `Needs met (100 = fully met, 0 = desperate): ${NEEDS.map((n) => `${NUMBER_NAMES[n]} ${Math.round(s.needs[n])}`).join(', ')}.`,
  ];
}

export function decidePrompt(s: State, list: Option[], rng: Rng): string {
  const own = ownHabits(s);
  const here = presentAt(s.world, s.place);
  const last = s.history[s.history.length - 1];
  const lines = [
    `It is ${weekday(s.t)}, ${clock(s.t)} (${partOfDay(s.t)}). The weather is ${WEATHER_WORDS[s.world.weather]}.`,
    `Khina is at ${PLACES[s.place].name}${here.length ? `. ${names(here)} ${verb(here, true)} here` : ''}.`,
    '',
    ...feelingLines(s),
  ];
  // In the numbers experiment, needs appear only as numbers, not also as felt thoughts.
  const mind = onMind(s, 4, !s.features.numbers);
  if (mind.length) lines.push('On Khina\'s mind:', ...mind.map((m) => `- ${m}`));
  const mems = recall(s, rng);
  if (mems.length) lines.push('Comes to mind:', ...mems.map((m) => `- ${sentence(m.text)} (${m.where}, ${ago(s.t, m.t)})`));
  const tastes = tastesLine(s, rng);
  if (tastes) lines.push(tastes);
  const pieces = (s.pieces ?? []).slice(-3);
  if (pieces.length) lines.push(`Made lately: ${pieces.map((p) => `"${p.title}" (${p.form === 'toy' ? 'a little game' : `a ${p.form}`})`).join(', ')}.`);
  const reads = (s.readings ?? []).slice(-2);
  if (reads.length) lines.push('Found out on the internet lately:', ...reads.map((r) => `- ${sentence(r.learned)}`));
  lines.push('', `Lately: ${lately(s)}`);
  if (last) lines.push(`Just finished: ${sentence(last.outcome)}`);
  lines.push('', 'What Khina could do next:', ...rng.shuffle(list).map((o) => optionLine(o, s, own)));
  lines.push('', `Pick ${Math.min(3, list.length)} to ${Math.min(5, list.length)} of these for Khina.`);
  return lines.join('\n');
}

const SENSE_ASK: Record<Sense, string> = {
  none: 'No sensory detail this time.',
  sound: 'If you add a sensory detail, make it a sound. No smells.',
  touch: 'If you add a sensory detail, make it something felt: cold, wet, rough, heavy. No smells.',
  sight: 'If you add a sensory detail, make it something seen: light, colour, shape. No smells.',
  smell: 'If you add a sensory detail, make it a smell.',
};

export function diaryPrompt(s: State, rec: Completed, recentLines: string[], sense: Sense = 'none'): string {
  const def = actionDef(rec.actionId);
  const who = rec.who ?? [];
  const before = moodWord(rec.moodBefore);
  const after = moodWord(rec.moodAfter);
  const lines = [
    // No weekday, and weather only when it is worth noticing: otherwise every line opens "Monday, clear."
    `When: ${clock(rec.start)}${rec.end - rec.start >= 20 ? ` to ${clock(rec.end)}` : ''}.`,
    `Where: ${PLACES[rec.place].name}.`,
  ];
  const w = s.world.weather;
  if (isWet(w) || w === 'fog') lines.push(`Weather: ${WEATHER_WORDS[w]}.`);
  // Only a thwarted plan gets "meant to"; otherwise the model invents a contrast that did not happen.
  if (rec.kind === 'refused') lines.push(`What Khina set out to do: ${def.label}${rec.detail ? ` (${rec.detail})` : ''}.`);
  lines.push(
    `What happened: ${sentence(rec.outcome.replace(STALE_NOTE, ''))}`,
    `Why Khina chose it: ${rec.reason}`,
    `Mood (let it colour the wording, do not name it): ${after}${before !== after ? `, was ${before} before` : ''}.`,
    `Senses: ${SENSE_ASK[sense]}`,
  );
  if (who.length) lines.push(`Also there: ${names(who)}.`);
  // Said every line, "it did less for me than it used to" became Khina's catchphrase: hint at it now and then.
  if (rec.outcome.includes(STALE_NOTE) && Math.floor(rec.start) % 3 === 0) {
    lines.push('Also: Khina has done this a lot lately and it is wearing a little thin. Hint at that in your own fresh words, or leave it out.');
  }
  if (recentLines.length) lines.push('', 'Recent diary lines (start differently from these):', ...recentLines.map((l) => `- ${l}`));
  lines.push('', 'Write the diary line.');
  return lines.join('\n');
}

/** Added to an outcome when an overdone action gave less than it used to (the model reads it). */
export const STALE_NOTE = '; it did less for Khina than it used to';
const STALE_SAY = ['Not as much fun as it used to be.', "I've done that a lot lately.", 'Nice enough, but I could do with something new.', 'Same as last time, really.'];

/** Diary line written by code when the model is off. */
export function templateDiary(rec: Completed): string {
  const stale = rec.outcome.includes(STALE_NOTE);
  const firstPerson = rec.outcome
    .replace(STALE_NOTE, '')
    .replace(/\bKhina (?=[a-z]+ed\b|ate\b|took\b|was\b|got\b|went\b|had\b|stood\b|sat\b)/g, 'I ')
    .replace(/\bKhina\b/g, 'me');
  const line = sentence(firstPerson);
  // Going stale is said now and then, in different words, not tacked onto every line.
  const k = Math.floor(rec.start);
  return stale && k % 3 === 0 ? `${line} ${STALE_SAY[Math.floor(k / 3) % STALE_SAY.length]}` : line;
}
