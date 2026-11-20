// Everything Khina can do in the village. Code decides what each action does to
// each need and what actually happens; the model only proposes and narrates.

import type { Effects } from '../config.ts';
import type { Rng } from '../rng.ts';
import { FOOD_IDS, pantryTotal, unreadNotes, type Activity, type AskAnswer, type FoodId, type NotesRead, type PieceForm, type State } from '../state.ts';
import { clock, hourOf, isDark, isNight, nextMorning } from '../time.ts';
import type { PlaceId } from './places.ts';
import { bakeryOpen, isWet, names, nextTrain, presentAt, senderName, verb, VILLAGERS, type Letter, type VillagerId } from './village.ts';

export interface Ctx {
  s: State;
  rng: Rng;
  /** When the action would start: now, plus any walking time. */
  at: number;
}

export interface Outcome {
  /** What actually happened, in plain words, no subject: "found a blue button". */
  text: string;
  /** Need changes on top of the action's normal effects, applied on completion. */
  extra?: Effects;
  thought?: { key: string; text: string; value: number; hours: number };
  pantry?: Partial<Record<FoodId, number>>;
  find?: string;
  made?: string;
}

export type Topic =
  | 'rest' | 'food' | 'home' | 'making' | 'social' | 'nature' | 'water' | 'exploring' | 'trains' | 'post' | 'visitors';

export interface ActionDef {
  id: string;
  /** 'here' means wherever Khina already is. */
  place: PlaceId | 'here';
  /** Shown in the menu: "forage for clover and berries". */
  label: string;
  /** Shown on the status line: "foraging in the woods". */
  doing: string;
  /** Used in summaries of recent activity: "foraging". */
  gist: string;
  topic: Topic;
  effort: 'rest' | 'easy' | 'hard';
  minutes: [number, number];
  /** What the action does to each need in total, spread over its length. */
  effects: Effects;
  /** Need changes the outcome usually brings, used only for scoring. */
  expect?: (c: Ctx) => Effects;
  /** Replaces effects + expect for scoring. */
  estimate?: (c: Ctx) => Effects;
  /** For open-ended actions: what it does per game hour while it runs. */
  perHour?: Effects;
  /** If set, the model may fill in a few words of free content ("what to whittle"). */
  detailAsk?: string;
  /** Free content used when code decides alone. */
  details?: string[];
  /** Returns why the action is impossible, or null if it is possible. */
  blocked?: (c: Ctx) => string | null;
  /** Extra facts shown next to the option: who is there, when the next train is. */
  note?: (c: Ctx) => string;
  duration?: (c: Ctx) => number;
  /** For open-ended actions: is it finished? Checked every minute. */
  done?: (s: State, act: Activity) => boolean;
  begin?: (c: Ctx, act: Activity) => void;
  scoreMult?: (c: Ctx) => number;
  outcome?: (c: Ctx, act: Activity) => Outcome;
  /** False for actions too small to be worth a diary line. */
  diary?: boolean;
  /**
   * Real work done while the action runs (live server with the model on): 'piece' makes a real
   * drawing, poem, song or game; 'web' looks something up online; 'notes' reads a few visitors' notes
   * (src/notes.ts). The outcome reads act.result.
   */
  work?: 'piece' | 'web' | 'post' | 'notes';
}

/** How the Keeper's answer to one of her asks feels once she reads it: glad at a yes, patient at "not
 * now", a little let down at a no, and over it soon. The thought names the ask, so two answers stay two
 * memories (memories with the same words are merged). */
const KEEPER_ANSWER: Record<AskAnswer, { say: string; thought: (what?: string) => string; value: number; hours: number; extra: Effects }> = {
  done: { say: 'done', thought: (w) => (w ? `The Keeper did what I asked: "${w}"` : 'The Keeper did what I asked for'), value: 5, hours: 12, extra: { novelty: 10, company: 12 } },
  notnow: { say: 'not now', thought: (w) => `The Keeper said not now to ${w ? `"${w}"` : 'what I asked'}. I can wait`, value: 1, hours: 6, extra: { novelty: 6, company: 8 } },
  no: { say: 'no, sorry', thought: (w) => `The Keeper said no to ${w ? `"${w}"` : 'what I asked'}. Fair enough`, value: -2, hours: 3, extra: { company: 6 } },
};

/** Her ask, short enough for a thought: cut at a word, without the closing question mark. */
function askShort(text: string, max = 60): string {
  const t = text.replace(/[\s.?!]+$/, '');
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/** Reading a letter from the Keeper (src/asks.ts writes it when the Keeper answers on the site). */
function keeperLetter(letter: Letter): Outcome {
  const status = letter.ask?.status ?? 'done';
  const a = KEEPER_ANSWER[status];
  const asked = letter.ask?.text;
  const note = letter.ask?.note;
  // In her words, like the villagers' notes (the note quoted), and never ending on a full stop, so a
  // "going stale" ending reads on cleanly. A letter from before the ask rode along keeps its own text.
  const text = asked
    ? `found a letter from the Keeper in the letterbox, about what Khina asked for ("${askShort(asked, 200)}"): ${a.say}${note ? `. The Keeper wrote: "${note}"` : ''}`
    : `found a letter from the Keeper in the letterbox. It said: "${letter.text}"`;
  return {
    text,
    extra: a.extra,
    thought: { key: `keeper-${status}`, text: a.thought(asked ? askShort(asked) : undefined), value: a.value, hours: a.hours },
  };
}

const FOOD: Record<FoodId, { one: string; fullness: number }> = {
  berries: { one: 'a few dried blackberries', fullness: 14 },
  clover: { one: 'a bunch of dried clover', fullness: 18 },
  crusts: { one: 'a stale crust', fullness: 22 },
  peas: { one: 'a pea pod', fullness: 12 },
};

const FOOD_WORDS: Record<FoodId, [string, string]> = {
  berries: ['blackberry', 'blackberries'],
  clover: ['bunch of clover', 'bunches of clover'],
  crusts: ['crust', 'crusts'],
  peas: ['pea pod', 'pea pods'],
};

function pluralFood(f: FoodId, n: number): string {
  return `${n} ${FOOD_WORDS[f][n === 1 ? 0 : 1]}`;
}

function takeRandom<T>(rng: Rng, list: T[]): T | undefined {
  if (list.length === 0) return undefined;
  const i = Math.floor(rng.next() * list.length);
  return list.splice(i, 1)[0];
}

const isNightStart = (t: number) => isNight(t) || hourOf(t) >= 20;

/** Who was at the place when the action started (people come and go on the hour). */
const whoWas = (act: Activity): VillagerId[] => act.who ?? [];

export const ACTIONS: ActionDef[] = [
  // The burrow
  {
    id: 'sleep',
    place: 'burrow',
    label: 'go to bed',
    doing: 'asleep in bed',
    gist: 'slept',
    topic: 'rest',
    effort: 'rest',
    minutes: [0, 0],
    effects: {},
    perHour: { rest: 12, calm: 1.5 },
    blocked: ({ s, at }) => (isNightStart(at) || s.needs.rest < 25 ? null : 'it was far too early for bed'),
    estimate: ({ s }) => ({ rest: 100 - s.needs.rest, calm: 4 }),
    scoreMult: ({ at }) => (isNight(at) ? 3 : 1),
    begin: ({ rng }, act) => {
      // Going down after 18:00 counts as the night's sleep, so an evening collapse does not
      // end in a bunny wide awake at midnight.
      const h = hourOf(act.startedAt);
      if (h >= 18 || h < 6) act.wakeAfter = nextMorning(act.startedAt) + rng.int(0, 75);
    },
    done: (s, act) => {
      if (s.needs.fullness < 6) return true;
      if (act.wakeAfter !== undefined) {
        return (s.t >= act.wakeAfter && s.needs.rest >= 85) || s.t >= act.wakeAfter + 180;
      }
      return s.needs.rest >= 75;
    },
    outcome: ({ s }, act) => {
      const hungry = s.needs.fullness < 6;
      const rain = isWet(s.world.weather) ? ', to the sound of rain on the oak roots' : '';
      return {
        text: `slept from ${clock(act.startedAt)} to ${clock(s.t)}${rain}${hungry ? ', and woke up because of hunger' : ''}`,
        thought: hungry ? { key: 'woke-hungry', text: 'Woke up with an empty belly', value: -3, hours: 3 } : undefined,
      };
    },
  },
  {
    id: 'nap',
    place: 'burrow',
    label: 'nap in the armchair',
    doing: 'napping in the armchair',
    gist: 'a nap',
    topic: 'rest',
    effort: 'rest',
    minutes: [30, 60],
    effects: { rest: 15, calm: 4 },
    blocked: ({ s, at }) =>
      isNight(at) ? 'it was bedtime, not nap time' : s.needs.rest >= 60 ? 'Khina was not tired enough to nap' : null,
    outcome: ({ rng }) => ({
      text: rng.pick([
        'flopped over on one side in the armchair and napped',
        'napped in the armchair with one ear hanging off the side',
        'dozed in the armchair, never quite asleep',
      ]),
    }),
  },
  {
    id: 'snack',
    place: 'burrow',
    label: 'nibble something from the pantry',
    doing: 'nibbling something from the pantry',
    gist: 'a snack',
    topic: 'food',
    effort: 'rest',
    minutes: [8, 15],
    effects: { fullness: 16 },
    blocked: ({ s }) => (pantryTotal(s) === 0 ? 'the pantry was empty' : null),
    note: ({ s }) => {
      const n = pantryTotal(s);
      return n <= 2 ? `only ${n} thing${n === 1 ? '' : 's'} left in the pantry` : '';
    },
    outcome: ({ s, rng }) => {
      const kinds = FOOD_IDS.filter((f) => (s.pantry[f] ?? 0) > 0);
      const food = rng.weighted(kinds, (f) => s.pantry[f]);
      const emptyAfter = pantryTotal(s) === 1;
      return {
        text: `ate ${FOOD[food].one} from the pantry${emptyAfter ? '; the pantry is empty now' : ''}`,
        pantry: { [food]: -1 },
        extra: { fullness: FOOD[food].fullness - 16 },
        thought: emptyAfter ? { key: 'pantry-empty', text: 'The pantry is empty', value: -2, hours: 8 } : undefined,
      };
    },
  },
  {
    id: 'tidy',
    place: 'burrow',
    label: 'tidy the burrow',
    doing: 'tidying the burrow',
    gist: 'tidying up',
    topic: 'home',
    effort: 'easy',
    minutes: [20, 35],
    effects: { calm: 10, making: 6, rest: -3 },
    outcome: ({ s, rng }) => ({
      text: rng.pick([
        'swept the old leaves out of the burrow',
        'aired the bedding and pushed the armchair back where it belongs',
        'found a lost acorn under the bed and put it on the shelf',
        ...(s.finds.length >= 2 ? ['rearranged the shelf of finds'] : []),
      ]),
    }),
  },
  {
    id: 'rain',
    place: 'burrow',
    label: 'tuck in by the door and listen to the rain',
    doing: 'listening to the rain',
    gist: 'listening to the rain',
    topic: 'rest',
    effort: 'rest',
    minutes: [20, 40],
    effects: { calm: 16, rest: 6 },
    blocked: ({ s }) => (isWet(s.world.weather) ? null : 'it had stopped raining'),
    outcome: () => ({ text: 'sat tucked into a loaf by the door of the burrow, ears down, and listened to the rain on the oak roots' }),
  },
  {
    id: 'letterbox',
    place: 'burrow',
    label: 'check the letterbox',
    doing: 'checking the letterbox',
    gist: 'checking the post',
    topic: 'post',
    effort: 'easy',
    minutes: [2, 4],
    effects: { novelty: 1 },
    expect: ({ s }) => (s.world.flagSeen && s.world.letters.length > 0 ? { novelty: 10, company: 10 } : {}),
    note: ({ s }) => (s.world.flagSeen && s.world.letters.length > 0 ? 'the little flag on it is up' : ''),
    outcome: ({ s }) => {
      const letter = s.world.letters.shift();
      if (s.world.letters.length === 0) s.world.flagSeen = false;
      if (!letter) {
        return {
          text: 'the letterbox was empty',
          thought: { key: 'letterbox-empty', text: 'The letterbox was empty again', value: -1, hours: 2 },
        };
      }
      if (letter.from === 'keeper') return keeperLetter(letter);
      const from = senderName(letter.from);
      return {
        text: `found a note from ${from} in the letterbox. It said: "${letter.text}"`,
        extra: { novelty: 10, company: 10 },
        thought: { key: 'letter', text: `Got a note from ${from}`, value: 4, hours: 8 },
      };
    },
  },

  // The shed
  {
    id: 'whittle',
    place: 'shed',
    label: 'whittle something at the workbench',
    doing: 'whittling at the workbench',
    gist: 'whittling',
    topic: 'making',
    effort: 'easy',
    minutes: [40, 75],
    effects: { making: 30, novelty: 5, rest: -5 },
    detailAsk: 'what to whittle',
    details: ['a little spoon', 'a peg with a face on it', 'a tiny boat', 'an owl the size of an acorn', 'a whistle', 'a bead'],
    outcome: ({ rng }, act) =>
      rng.chance(0.75)
        ? {
            text: `whittled ${act.detail}`,
            made: `${act.detail} (whittled)`,
            thought: { key: 'made', text: `Whittled ${act.detail}`, value: 4, hours: 10 },
          }
        : {
            text: `started whittling ${act.detail} but the wood split halfway`,
            extra: { making: -14 },
            thought: { key: 'split', text: `The wood split while whittling ${act.detail}`, value: -3, hours: 4 },
          },
  },
  {
    id: 'draw',
    place: 'shed',
    label: 'draw with charcoal on a strip of bark',
    doing: 'drawing with charcoal',
    gist: 'drawing',
    topic: 'making',
    effort: 'easy',
    minutes: [30, 55],
    effects: { making: 24, calm: 4 },
    detailAsk: 'what to draw',
    details: ['the old oak', 'Bramwell asleep behind the counter', 'the train', 'a very tall dandelion', 'rain on the stream'],
    work: 'piece',
    outcome: ({ rng }, act) => {
      const r = act.result;
      if (r?.kind === 'piece')
        return {
          text: `drew "${r.piece.title}" in charcoal on bark (${act.detail})`,
          made: `a charcoal drawing, "${r.piece.title}"`,
          thought: { key: 'made', text: `Drew "${r.piece.title}"`, value: 4, hours: 10 },
        };
      if (r)
        return {
          text: `started drawing ${act.detail}, smudged it with a paw and gave up`,
          extra: { making: -10 },
          thought: { key: 'smudged', text: 'Smudged a drawing', value: -2, hours: 3 },
        };
      return rng.chance(0.85)
        ? {
            text: `drew ${act.detail} in charcoal on bark`,
            made: `a charcoal drawing of ${act.detail.replace(/^(an? )?(quick )?(charcoal )?(sketch|drawing|picture) of /i, '')}`,
            thought: { key: 'made', text: `Drew ${act.detail}`, value: 3, hours: 8 },
          }
        : {
            text: `started drawing ${act.detail}, smudged it with a paw and gave up`,
            extra: { making: -10 },
            thought: { key: 'smudged', text: 'Smudged a drawing', value: -2, hours: 3 },
          };
    },
  },
  {
    id: 'sort',
    place: 'shed',
    label: 'sort the finds on the shelf',
    doing: 'sorting the finds',
    gist: 'sorting finds',
    topic: 'home',
    effort: 'rest',
    minutes: [15, 30],
    effects: { calm: 12, making: 5 },
    blocked: ({ s }) => (s.finds.length < 2 ? 'there was not enough on the shelf to sort' : null),
    outcome: ({ s, rng }) => {
      const some = rng.shuffle(s.finds.map((f) => f.name)).slice(0, 3);
      return { text: `sorted the finds on the shelf, putting ${some.join(', then ')} in a row` };
    },
  },
  {
    id: 'tinker',
    place: 'shed',
    label: 'tinker with a broken thing',
    doing: 'tinkering',
    gist: 'tinkering',
    topic: 'making',
    effort: 'easy',
    minutes: [30, 60],
    effects: { making: 18, novelty: 8, calm: -2 },
    blocked: ({ s }) => (s.world.projects.every((p) => p.done) ? 'there was nothing left to fix' : null),
    note: ({ s }) => {
      const p = s.world.projects.find((x) => !x.done);
      return p ? `working on ${p.name}` : '';
    },
    outcome: ({ s, rng }) => {
      const p = s.world.projects.find((x) => !x.done);
      if (!p) return { text: 'found nothing left to fix' };
      p.progress += 1;
      if (p.progress >= p.needed && (rng.chance(0.6) || p.progress >= p.needed + 2)) {
        p.done = true;
        return {
          text: `got ${p.name} working at last`,
          extra: { making: 10 },
          made: `${p.name}, fixed`,
          thought: { key: 'fixed', text: `Fixed ${p.name}`, value: 7, hours: 24 },
        };
      }
      return {
        text: rng.pick([
          `tinkered with ${p.name}; it still does not work`,
          `took ${p.name} apart and put it back together, slightly better`,
          `got ${p.name} to make one hopeful noise, then nothing`,
        ]),
      };
    },
  },

  // The bakery
  {
    id: 'crusts',
    place: 'bakery',
    label: "ask Bramwell for yesterday's crusts",
    doing: "eating yesterday's crusts at the bakery",
    gist: 'crusts from Bramwell',
    topic: 'food',
    effort: 'easy',
    minutes: [8, 15],
    effects: { fullness: 24, company: 10 },
    blocked: ({ at }) => (bakeryOpen(at) ? null : 'the bakery was shut'),
    expect: ({ s, at }) => (s.world.bakeSpecialUntil > at ? { novelty: 8, calm: 4 } : {}),
    note: ({ s, at }) => (s.world.bakeSpecialUntil > at ? 'Bramwell has seed cake today' : ''),
    outcome: ({ s, rng }) => {
      if (s.world.bakeSpecialUntil > s.t) {
        s.world.bakeSpecialUntil = -1;
        return {
          text: 'Bramwell handed over two crusts and a corner of fresh seed cake, still warm',
          extra: { novelty: 8, calm: 4 },
          thought: { key: 'seedcake-ate', text: 'Got a corner of warm seed cake', value: 4, hours: 8 },
        };
      }
      const r = rng.next();
      if (r < 0.2) {
        return {
          text: 'Bramwell was busy and only nodded at the crust basket, so Khina ate two crusts alone by the door',
          extra: { company: -7 },
          thought: { key: 'bramwell-busy', text: 'Bramwell was too busy to talk', value: -2, hours: 3 },
        };
      }
      if (r < 0.5) {
        return {
          text: 'Bramwell handed over two crusts, plus an extra one for Khina to take home for the pantry',
          pantry: { crusts: 1 },
          thought: { key: 'bramwell-kind', text: 'Bramwell slipped me an extra crust', value: 3, hours: 6 },
        };
      }
      return { text: `Bramwell handed over two crusts and grumbled about the ${s.world.weather === 'clear' ? 'heat of the ovens' : 'weather'}` };
    },
  },
  {
    id: 'warm',
    place: 'bakery',
    label: 'hang about in the warm bakery',
    doing: 'hanging about in the warm bakery',
    gist: 'loitering at the bakery',
    topic: 'social',
    effort: 'rest',
    minutes: [15, 30],
    effects: { company: 10, calm: 6, fullness: 3 },
    blocked: ({ at }) => (bakeryOpen(at) ? null : 'the bakery was shut'),
    note: ({ s }) => {
      const others = presentAt(s.world, 'bakery').filter((v) => v !== 'bramwell');
      return others.length ? `${names(others)} ${verb(others, true)} in there` : '';
    },
    outcome: ({ rng }, act) => {
      const others = whoWas(act).filter((v) => v !== 'bramwell');
      const biscuit = rng.chance(0.3);
      return {
        text:
          'stood by the warm oven while Bramwell worked' +
          (others.length ? `; ${names(others)} came in` : '') +
          (biscuit ? '; got given a broken biscuit' : ''),
        extra: { company: others.length ? 5 : 0, fullness: biscuit ? 6 : 0 },
      };
    },
  },

  // The square
  {
    id: 'bench',
    place: 'square',
    label: 'sit on the bench and watch the village go by',
    doing: 'people-watching from the bench',
    gist: 'people-watching',
    topic: 'social',
    effort: 'rest',
    minutes: [20, 40],
    effects: { company: 7, calm: 5, novelty: 5 },
    outcome: (_c, act) => {
      const p = whoWas(act);
      return p.length
        ? { text: `sat on the bench in the square; ${names(p)} ${verb(p, false)} about` }
        : { text: 'sat on the bench in the square; nobody much came by', extra: { company: -5 } };
    },
  },
  {
    id: 'chat',
    place: 'square',
    label: 'chat with whoever is around',
    doing: 'chatting in the square',
    gist: 'a chat',
    topic: 'social',
    effort: 'easy',
    minutes: [10, 25],
    effects: { company: 22 },
    detailAsk: 'what to talk about',
    details: ['the weather', 'the trains', 'what Bramwell is baking', 'a funny-shaped cloud', 'the frog under the bridge'],
    blocked: ({ s }) => (presentAt(s.world, 'square').length ? null : 'nobody was around'),
    note: ({ s }) => {
      const p = presentAt(s.world, 'square');
      return p.length ? `${names(p)} ${verb(p, true)} there` : '';
    },
    outcome: ({ s, rng }, act) => {
      const pool = whoWas(act);
      if (pool.length === 0) {
        return { text: 'looked for someone to talk to, but everyone had gone', extra: { company: -15 } };
      }
      const who: VillagerId = rng.pick(pool);
      const name = VILLAGERS[who].name;
      if (s.needs.calm < 30 && rng.chance(0.4)) {
        return {
          text: `tried to talk with ${name} about ${act.detail} but felt twitchy and cut it short`,
          extra: { company: -12, calm: -4 },
          thought: { key: 'awkward', text: `Cut a chat with ${name} short`, value: -3, hours: 4 },
        };
      }
      if (who === 'traveller') {
        return {
          text: `talked with the traveller about ${act.detail}; they were waiting for the next train to the city`,
          extra: { novelty: 12 },
          thought: { key: 'traveller', text: 'Talked to a traveller going to the city', value: 4, hours: 12 },
        };
      }
      return {
        text: `talked with ${name} about ${act.detail}`,
        thought: { key: `chat-${who}`, text: `Had a chat with ${name}`, value: 3, hours: 6 },
      };
    },
  },

  // The vegetable patch
  {
    id: 'weed',
    place: 'patch',
    label: 'weed the vegetable patch',
    doing: 'weeding the vegetable patch',
    gist: 'weeding',
    topic: 'nature',
    effort: 'hard',
    minutes: [30, 50],
    effects: { making: 10, calm: 10, rest: -6, fullness: -3 },
    expect: ({ s }) => (presentAt(s.world, 'patch').includes('wren') ? { company: 8 } : {}),
    blocked: ({ at }) => (isDark(at) ? 'it was too dark to tell weeds from peas' : null),
    note: ({ s }) => (presentAt(s.world, 'patch').includes('wren') ? 'Old Wren is working there' : ''),
    outcome: ({ rng }, act) => {
      if (!whoWas(act).includes('wren')) return { text: 'weeded a row of carrots alone' };
      const peas = rng.chance(0.25);
      return {
        text: `weeded a row of carrots alongside Old Wren, who hummed the whole time${peas ? '; Old Wren sent Khina home with two pea pods' : ''}`,
        extra: { company: 8 },
        pantry: peas ? { peas: 2 } : undefined,
      };
    },
  },
  {
    id: 'pea',
    place: 'patch',
    label: 'pinch a pea pod off the vine',
    doing: 'pinching a pea pod',
    gist: 'pinching a pea pod',
    topic: 'food',
    effort: 'easy',
    minutes: [5, 10],
    effects: { fullness: 12 },
    outcome: ({ rng }, act) => {
      if (!whoWas(act).includes('wren')) return { text: 'pinched a pea pod off the vine; nobody saw' };
      return rng.chance(0.5)
        ? { text: 'pinched a pea pod; Old Wren saw and laughed', extra: { company: 5 } }
        : {
            text: 'pinched a pea pod; Old Wren saw and tutted',
            extra: { calm: -5 },
            thought: { key: 'tutted', text: 'Old Wren tutted at me', value: -2, hours: 3 },
          };
    },
  },

  // The stream
  {
    id: 'paddle',
    place: 'stream',
    label: 'paddle in the shallows',
    doing: 'paddling in the shallows',
    gist: 'paddling',
    topic: 'water',
    effort: 'easy',
    minutes: [15, 30],
    effects: { calm: 12, novelty: 6, rest: -2 },
    blocked: ({ s }) => (s.world.weather === 'rain' ? 'the stream was running too fast after the rain' : null),
    outcome: ({ rng }) => ({
      text: rng.pick([
        'paddled in the shallows; the water was cold',
        'paddled in the shallows and chased a water boatman',
        'dabbed a paw in the shallows until it went numb',
      ]),
    }),
  },
  {
    id: 'fish',
    place: 'stream',
    label: 'watch the fish',
    doing: 'watching the fish',
    gist: 'fish-watching',
    topic: 'water',
    effort: 'rest',
    minutes: [15, 35],
    effects: { calm: 14, rest: 3 },
    blocked: ({ at }) => (isDark(at) ? 'it was too dark to see the fish' : null),
    outcome: ({ s, rng }) =>
      s.world.heron
        ? {
            text: 'was watching the fish when a heron landed close by; Khina thumped a back foot once, then froze flat in the grass until it left',
            extra: { calm: -18 },
            thought: { key: 'heron', text: 'A heron landed right next to me', value: -5, hours: 6 },
          }
        : {
            text: rng.pick([
              'watched a silver fish that kept coming back to the same stone',
              'watched the minnows dart about in the shallows',
              'lay on the bank and watched a fat trout not move at all',
            ]),
          },
  },
  {
    id: 'dam',
    place: 'stream',
    label: 'build a little pebble dam',
    doing: 'building a pebble dam',
    gist: 'a pebble dam',
    topic: 'making',
    effort: 'hard',
    minutes: [30, 50],
    effects: { making: 18, novelty: 7, rest: -6 },
    outcome: ({ rng }) =>
      rng.chance(0.7)
        ? {
            text: 'built a pebble dam across a side trickle of the stream, and it held',
            made: 'a pebble dam on the stream',
            thought: { key: 'dam', text: 'Built a dam that held', value: 3, hours: 6 },
          }
        : {
            text: 'built a pebble dam, and the stream knocked it over',
            extra: { making: -8 },
            thought: { key: 'dam', text: 'The stream knocked my dam down', value: -2, hours: 3 },
          },
  },

  // The woods
  {
    id: 'forage',
    place: 'woods',
    label: 'forage for clover and berries',
    doing: 'foraging in the woods',
    gist: 'foraging',
    topic: 'food',
    effort: 'easy',
    minutes: [30, 55],
    effects: { fullness: 10, novelty: 4, rest: -7 },
    outcome: ({ s, rng }) => {
      const owls = isDark(s.t);
      const owlText = owls ? '; every owl hoot made Khina freeze, ears flat' : '';
      const owlCalm = owls ? -6 : 0;
      if (rng.chance(0.15)) {
        return {
          text: `foraged in the woods and found nothing but wet leaves${owlText}`,
          extra: { calm: owlCalm },
          thought: { key: 'forage-none', text: 'Came back from foraging with nothing', value: -2, hours: 3 },
        };
      }
      const berries = rng.int(0, 3);
      const clover = rng.int(1, 2);
      const brought = [
        ...(berries ? [pluralFood('berries', berries)] : []),
        pluralFood('clover', clover),
      ].join(' and ');
      return {
        text: `foraged in the woods, nibbled some on the spot and brought home ${brought}${owlText}`,
        pantry: { berries, clover },
        extra: { calm: owlCalm },
      };
    },
  },
  {
    id: 'birds',
    place: 'woods',
    label: 'sit still and listen to the birds',
    doing: 'listening to the birds',
    gist: 'birdsong',
    topic: 'nature',
    effort: 'rest',
    minutes: [15, 30],
    effects: { calm: 14, novelty: 4 },
    blocked: ({ at }) => (isDark(at) ? 'the birds had gone quiet for the night' : null),
    outcome: ({ rng }) => ({
      text: rng.pick([
        'sat still under a fern and listened to a blackbird',
        'listened to two wrens arguing in a bramble',
        'counted eleven different bird calls, then lost count',
      ]),
    }),
  },
  {
    id: 'explore',
    place: 'woods',
    label: 'follow a path Khina has not tried',
    doing: 'trying a new path through the woods',
    gist: 'a new path',
    topic: 'exploring',
    effort: 'hard',
    minutes: [30, 60],
    effects: { novelty: 26, calm: -4, rest: -10, fullness: -3 },
    blocked: ({ at }) => (isDark(at) ? 'it was too dark for new paths, and owls were about' : null),
    note: ({ s, at }) => (s.world.woodsNewsUntil > at ? 'a big tree came down here; there may be new paths' : ''),
    expect: ({ s, at }) => (s.world.woodsNewsUntil > at ? { novelty: 10 } : {}),
    outcome: ({ s, rng }) => {
      const r = rng.next();
      if (r < 0.25) {
        return {
          text: 'took a new path, got turned around and took ages to find the way back',
          extra: { calm: -10, rest: -5 },
          thought: { key: 'lost', text: 'Got lost in the woods', value: -4, hours: 5 },
        };
      }
      if (r < 0.6) {
        const find = takeRandom(rng, s.world.findsLeft);
        if (find) {
          return {
            text: `took a new path and found ${find}`,
            find,
            thought: { key: 'find', text: `Found ${find}`, value: 5, hours: 12 },
          };
        }
      }
      const sight = takeRandom(rng, s.world.sightsLeft);
      if (sight) {
        return {
          text: `took a new path and came out at ${sight}`,
          thought: { key: 'sight', text: `Came across ${sight}`, value: 4, hours: 12 },
        };
      }
      return {
        text: 'looked for a new path, but every one led somewhere already known',
        extra: { novelty: -14 },
        thought: { key: 'no-new-paths', text: 'Every path in the woods is an old one now', value: -2, hours: 12 },
      };
    },
  },

  // The clearing
  {
    id: 'poke',
    place: 'clearing',
    label: 'poke around in the moss for odd things',
    doing: 'poking around in the moss',
    gist: 'poking about',
    topic: 'exploring',
    effort: 'easy',
    minutes: [20, 40],
    effects: { novelty: 14 },
    outcome: ({ s, rng }) => {
      const r = rng.next();
      if (r < 0.35) {
        const find = takeRandom(rng, s.world.findsLeft);
        if (find) {
          return {
            text: `poked about in the moss and found ${find}`,
            find,
            thought: { key: 'find', text: `Found ${find}`, value: 4, hours: 12 },
          };
        }
      }
      if (r < 0.6) return { text: 'poked about in the moss and found a patch of clover, and took a bunch home for the pantry', pantry: { clover: 1 } };
      if (r < 0.68) return { text: 'poked about in the moss and found some dandelion leaves, and took them home to dry with the clover', pantry: { clover: 1 } };
      if (r < 0.75) return { text: 'poked about in the moss and found a wild strawberry, and took it home to dry with the blackberries', pantry: { berries: 1 } };
      return { text: 'poked about in the moss and found nothing but more moss' };
    },
  },
  {
    id: 'moss',
    place: 'clearing',
    label: 'lie in the moss and watch the clouds',
    doing: 'lying in the moss',
    gist: 'cloud-watching',
    topic: 'nature',
    effort: 'rest',
    minutes: [20, 40],
    effects: { calm: 16, rest: 8 },
    blocked: ({ s, at }) =>
      isWet(s.world.weather) ? 'the moss was soaking wet' : isDark(at) ? 'there were no clouds to see in the dark' : null,
    outcome: ({ rng }) => ({
      text: `lay in the moss watching the clouds; one looked like ${rng.pick(['a teapot', 'a sleeping badger', 'a train', 'a boot', 'nothing at all'])}`,
    }),
  },

  // The halt
  {
    id: 'train',
    place: 'halt',
    label: 'wait for the train and watch it go by',
    doing: 'waiting for the train',
    gist: 'the train going by',
    topic: 'trains',
    effort: 'rest',
    minutes: [0, 0],
    effects: { calm: 2 },
    expect: () => ({ novelty: 24, company: 3 }),
    duration: ({ at }) => nextTrain(at) - at + 3,
    blocked: ({ at }) => (nextTrain(at) - at <= 30 ? null : 'there was no train due for ages'),
    note: ({ at }) => `next train at ${clock(nextTrain(at))}`,
    outcome: ({ s, rng }, act) => {
      const when = clock(nextTrain(act.startedAt));
      const base = `watched the ${when} train rattle through the halt towards the city`;
      if (rng.chance(0.12)) {
        s.world.travellerUntil = s.t + 150;
        const sq = (s.world.present.square ??= []);
        if (!sq.includes('traveller')) sq.push('traveller');
        return {
          text: `${base}; a traveller with a huge rucksack got off and wandered towards the square`,
          extra: { novelty: 28, company: 3 },
          thought: { key: 'stranger', text: 'A stranger got off the train', value: 3, hours: 5 },
        };
      }
      if (rng.chance(0.3)) {
        return {
          text: `${base}; someone waved from a window`,
          extra: { novelty: 24, company: 8 },
          thought: { key: 'train-wave', text: 'Someone waved at me from the train', value: 4, hours: 8 },
        };
      }
      return {
        text: base,
        extra: { novelty: 24, company: 3 },
        thought: { key: 'train', text: 'Watched the train go off to the city', value: 2, hours: 4 },
      };
    },
  },
  {
    id: 'timetable',
    place: 'halt',
    label: 'read the timetable and imagine the city',
    doing: 'reading the timetable',
    gist: 'the timetable',
    topic: 'trains',
    effort: 'rest',
    minutes: [10, 20],
    effects: { novelty: 9, making: 3 },
    outcome: ({ rng }) => ({
      text: rng.pick([
        'read the timetable at the halt again: four trains a day to the city',
        'traced the line on the little map at the halt, all the way to the city at the end',
        'read the timetable and counted the stops to the city: seven',
      ]),
    }),
  },

  // Anywhere, beyond the fixed village life. Only on the menu when the sim allows it (s.world.can),
  // so experiments run exactly as before.
  {
    id: 'make',
    place: 'here',
    label: 'make something of my own: a picture, a poem, a short story, a song or a little game',
    doing: 'making something',
    gist: 'making something of my own',
    topic: 'making',
    effort: 'easy',
    minutes: [40, 80],
    effects: { making: 30, novelty: 8, rest: -4 },
    detailAsk: 'what to make and in what form, e.g. "a song about the heron"',
    details: ['a poem about the oak', 'a picture of the stream', 'a song for rainy days', 'a story about a lost button'],
    blocked: ({ s }) => (s.world.can?.make ? null : 'there was nothing to make it with'),
    work: 'piece',
    outcome: ({ rng }, act) => {
      const r = act.result;
      if (r?.kind === 'piece')
        return {
          text: `${FORM_DID[r.piece.form]}, "${r.piece.title}" (${act.detail})`,
          made: `${FORM_A[r.piece.form]}, "${r.piece.title}"`,
          thought: { key: 'made', text: `Made "${r.piece.title}"`, value: 5, hours: 12 },
        };
      if (r)
        return {
          text: `tried to make ${act.detail}, but it would not come out right`,
          extra: { making: -8 },
          thought: { key: 'spoiled', text: 'Something I tried to make would not come right', value: -2, hours: 3 },
        };
      return rng.chance(0.8)
        ? { text: `made ${act.detail}`, made: act.detail, thought: { key: 'made', text: `Made ${act.detail}`, value: 3, hours: 8 } }
        : { text: `tried to make ${act.detail}, but gave up halfway`, extra: { making: -6 } };
    },
  },
  {
    id: 'browse',
    place: 'nethut',
    label: 'look something up on the internet',
    doing: 'looking something up on the old computer',
    gist: 'looking things up on the internet',
    topic: 'exploring',
    effort: 'easy',
    minutes: [25, 50],
    effects: { novelty: 32, calm: 2, rest: -3 },
    detailAsk: 'what to look up: a question Khina wonders about',
    details: ['why do rabbits thump their back feet', 'why do herons stand so still'],
    blocked: ({ s }) => (s.world.can?.net ? null : 'the old computer would not switch on'),
    work: 'web',
    outcome: (_c, act) => {
      const r = act.result;
      if (r?.kind === 'web' && r.again)
        return {
          text: `went to look up "${r.reading.question}" again, then remembered the answer from last time: ${r.reading.learned.replace(/^[A-Z]/, (c) => c.toLowerCase())}`,
          extra: { novelty: -20 },
          thought: { key: 'asked-again', text: `I already knew about "${r.reading.question}"; I should ask the computer something new`, value: -1, hours: 24 },
        };
      if (r?.kind === 'web')
        return {
          text: `looked up "${r.reading.question}" on the internet and found out that ${r.reading.learned.replace(/^[A-Z]/, (c) => c.toLowerCase())}`,
          thought: { key: 'learned', text: `Found out on the internet: ${r.reading.learned}`, value: 3, hours: 24 },
        };
      return {
        text: 'sat at the old computer, but the internet only showed a spinning circle',
        extra: { calm: -4 },
        thought: { key: 'net', text: 'The internet would not load', value: -2, hours: 3 },
      };
    },
  },
  {
    id: 'post',
    place: 'nethut',
    label: 'write a short post for the internet, about my day or something I made',
    doing: 'typing a post on the old computer',
    gist: 'posting on the internet',
    topic: 'social',
    effort: 'easy',
    minutes: [15, 30],
    effects: { company: 12, making: 6, novelty: 6, rest: -2 },
    detailAsk: 'what the post is about, e.g. "the heron song I made"',
    details: ['the rain on the oak today', 'the picture I drew of the stream'],
    blocked: ({ s }) => (s.world.can?.post ? null : 'the old computer said "try again tomorrow"'),
    work: 'post',
    outcome: (_c, act) => {
      const r = act.result;
      if (r?.kind === 'post')
        return {
          text: `typed a short post for the internet on the old computer: "${r.post.text}"`,
          thought: { key: 'posted', text: `Posted on the internet about ${act.detail}`, value: 2, hours: 12 },
        };
      return {
        text: 'sat at the old computer to write a post, but could not find the words',
        extra: { making: -3 },
        thought: { key: 'no-post', text: 'Could not think what to post', value: -1, hours: 3 },
      };
    },
  },
  {
    id: 'notes',
    place: 'nethut',
    label: 'read the notes visitors left',
    doing: 'reading visitor notes',
    gist: 'reading notes from visitors',
    // Its own topic: chatting with Bramwell every day must not make strangers' notes feel old.
    topic: 'visitors',
    effort: 'rest',
    minutes: [15, 35],
    effects: { company: 18, novelty: 10, calm: -2 },
    // More waiting is more new; too many is a bit much, like a real inbox.
    expect: ({ s }) => notesExtra(unreadNotes(s).length),
    blocked: ({ s }) => (!s.world.can?.notes ? 'the old computer would not switch on' : unreadNotes(s).length ? null : 'there were no new notes'),
    note: ({ s }) => {
      const n = unreadNotes(s).length;
      return `${n} note${n === 1 ? '' : 's'} waiting`;
    },
    scoreMult: ({ s }) => notesPull(s),
    work: 'notes',
    outcome: (_c, act) => {
      const r = act.result;
      if (r?.kind === 'notes') return notesOutcome(r.read);
      return {
        text: 'sat at the old computer to read the notes visitors left, but the screen froze before Khina got far',
        extra: { company: -12, novelty: -6 },
        thought: { key: 'notes-froze', text: 'The notes would not open on the old computer', value: -2, hours: 3 },
      };
    },
  },
  {
    id: 'own',
    place: 'here',
    label: 'something else entirely, an idea of my own',
    doing: 'doing something of my own',
    gist: 'an idea of my own',
    topic: 'exploring',
    effort: 'easy',
    minutes: [25, 60],
    effects: { novelty: 14, making: 6, calm: 6 },
    detailAsk: 'what exactly, under 8 words; also give place and kind',
    blocked: ({ s }) => (s.world.can?.own ? null : 'nothing else came to mind'),
    outcome: (c, act) => ownOutcome(c, act),
  },

  // Anywhere
  {
    id: 'idle',
    place: 'here',
    label: 'sit for a bit',
    doing: 'sitting for a bit',
    gist: 'sitting',
    topic: 'rest',
    effort: 'rest',
    minutes: [5, 12],
    effects: { rest: 3, calm: 2 },
    diary: false,
    outcome: () => ({ text: 'sat for a bit' }),
  },
];

const FORM_DID: Record<PieceForm, string> = {
  picture: 'drew a picture',
  poem: 'wrote a poem',
  story: 'wrote a very short story',
  song: 'made up a song',
  toy: 'made a little game',
};
const FORM_A: Record<PieceForm, string> = {
  picture: 'a picture',
  poem: 'a poem',
  story: 'a short story',
  song: 'a song',
  toy: 'a little game',
};

/**
 * Khina's own ideas. The model says what, where and which kind; the kind decides what it does to
 * each need, so the body still weighs it, and each kind goes stale and becomes a taste on its own
 * ("own.nature" and "own.making" are different things to get used to).
 */
export const OWN_KINDS = ['making', 'social', 'nature', 'exploring', 'rest', 'home'] as const;
export type OwnKind = (typeof OWN_KINDS)[number];

const OWN_EFFECTS: Record<OwnKind, { effects: ActionDef['effects']; effort: ActionDef['effort']; gist: string }> = {
  making: { effects: { making: 24, novelty: 6, rest: -4 }, effort: 'easy', gist: 'building or fixing something of my own' },
  social: { effects: { company: 22, calm: 2, rest: -3 }, effort: 'easy', gist: 'my own idea with the neighbours' },
  nature: { effects: { calm: 18, novelty: 6, rest: -3 }, effort: 'easy', gist: 'my own idea outdoors' },
  exploring: { effects: { novelty: 26, rest: -6 }, effort: 'hard', gist: 'finding out something of my own' },
  rest: { effects: { rest: 14, calm: 10 }, effort: 'rest', gist: 'a quiet idea of my own' },
  home: { effects: { calm: 16, making: 4 }, effort: 'easy', gist: 'pottering about my own way' },
};

/** When code picks "own" by itself it has no idea of its own; these stand in. */
export const OWN_FALLBACK: { detail: string; kind: OwnKind }[] = [
  { detail: 'count the stones along the path', kind: 'nature' },
  { detail: 'stack pebbles into a careful tower', kind: 'making' },
  { detail: 'listen to the wind in the oak', kind: 'rest' },
  { detail: 'rearrange the finds by colour', kind: 'home' },
];

/** More unread notes than this is a bit much: she can't read them all, like a real inbox. */
export const NOTES_A_LOT = 40;

/** What a pile of waiting notes adds to a sitting: something new, and a little overwhelm when it is huge. */
function notesExtra(waiting: number): Effects {
  const out: Effects = { novelty: Math.min(8, Math.floor(waiting / 5)) };
  if (waiting > NOTES_A_LOT) out.calm = -6;
  return out;
}

/**
 * The gentle pull of notes waiting at the internet hut: it grows with how many there are and how long
 * the oldest has waited (about 1.5× for a new one, 4× after five Khina hours), so she gets to them
 * within a few hours. A multiplier on the body's own score, never a must.
 */
function notesPull(s: State): number {
  const unread = unreadNotes(s);
  const oldest = unread[0];
  if (!oldest) return 1;
  const hours = Math.max(0, (s.t - oldest.t) / 60);
  return 1 + Math.min(0.5, unread.length / 40) + Math.min(3, hours * 0.6);
}

const both = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? ''));

/** A sitting with the notes, in code's words: how many, who she wrote back to, never what they said. */
function notesOutcome(read: NotesRead): Outcome {
  const n = read.ids.length;
  const names = read.replies.map((r) => r.name);
  const many = read.waiting > NOTES_A_LOT;
  const idea = read.nudge ? `; ${read.nudge.name} suggested ${actionDef(read.nudge.actionId).gist}` : '';
  return {
    text:
      `read ${n} note${n === 1 ? '' : 's'} that visitors from far away had left on the old computer` +
      (names.length ? `, and wrote back to ${both(names)}` : '') +
      (many ? `; ${read.waiting} were waiting, far too many to read in one go` : '') +
      idea,
    extra: notesExtra(read.waiting),
    // No names in her thoughts: they go into the prompts for what she makes and looks up.
    thought: many
      ? { key: 'notes-many', text: "So many notes. I can't read them all", value: -1, hours: 3 }
      : names.length
        ? { key: 'notes', text: `Wrote back to ${names.length === 1 ? 'a visitor' : 'visitors'} on the internet`, value: 3, hours: 8 }
        : { key: 'notes', text: 'Read notes from visitors far away', value: 2, hours: 6 },
  };
}

function ownOutcome({ s, rng }: Ctx, act: Activity) {
  const kind = act.actionId.split('.')[1] as OwnKind | undefined;
  if (kind === 'social' && presentAt(s.world, act.place).length === 0)
    return { text: `went to ${act.detail}, but nobody was about`, extra: { company: -6 }, thought: { key: 'alone', text: 'Nobody was about', value: -2, hours: 3 } };
  return rng.chance(0.85)
    ? { text: `did something of Khina's own: ${act.detail}`, thought: { key: 'own', text: `Did my own thing: ${act.detail}`, value: 3, hours: 8 } }
    : { text: `tried something of Khina's own (${act.detail}), and it did not work out`, extra: { calm: -4 }, thought: { key: 'own', text: `My idea did not work out: ${act.detail}`, value: -2, hours: 3 } };
}

const OWN_DEFS: Record<string, ActionDef> = Object.fromEntries(
  OWN_KINDS.map((k) => {
    const base = ACTIONS.find((a) => a.id === 'own') as ActionDef;
    const o = OWN_EFFECTS[k];
    const def: ActionDef = { ...base, id: `own.${k}`, topic: k, effects: o.effects, effort: o.effort, gist: o.gist, blocked: undefined };
    return [def.id, def];
  }),
);

export const ACTION_BY_ID: Record<string, ActionDef> = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
export const ACTION_IDS = ACTIONS.map((a) => a.id);
/** Actions beyond the fixed village life (live server only; blocked in experiments). */
export const BEYOND_IDS = new Set(['make', 'browse', 'own', 'post', 'notes']);
/**
 * What a visitor's note may nudge her toward (src/notes.ts): her own menu, minus what reaches the outside
 * world or has no shape of its own (posting, her own ideas, reading notes again), what costs money
 * (making a real piece, drawing, looking something up), and bed or idling.
 */
export const NUDGE_IDS = ACTION_IDS.filter((id) => !['post', 'own', 'notes', 'make', 'draw', 'browse', 'sleep', 'idle'].includes(id));

export function actionDef(id: string): ActionDef {
  const def = ACTION_BY_ID[id] ?? OWN_DEFS[id];
  if (!def) throw new Error(`unknown action ${id}`);
  return def;
}
