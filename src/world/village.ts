// Everything in the village that Khina cannot control: weather, who is around,
// the trains, and the post.

import type { Rng } from '../rng.ts';
import { DAY, hourOf, isSunday, isWeekend, minuteOfDay } from '../time.ts';
import type { PlaceId } from './places.ts';

export type Weather = 'clear' | 'cloudy' | 'drizzle' | 'rain' | 'fog';

export const WEATHER_WORDS: Record<Weather, string> = {
  clear: 'clear',
  cloudy: 'grey',
  drizzle: 'drizzly',
  rain: 'rainy',
  fog: 'foggy',
};

export function isWet(w: Weather): boolean {
  return w === 'drizzle' || w === 'rain';
}

const NEXT_WEATHER: Record<Weather, [Weather, number][]> = {
  clear: [['clear', 0.72], ['cloudy', 0.23], ['fog', 0.05]],
  cloudy: [['cloudy', 0.5], ['clear', 0.25], ['drizzle', 0.2], ['rain', 0.05]],
  drizzle: [['drizzle', 0.45], ['cloudy', 0.32], ['rain', 0.18], ['clear', 0.05]],
  rain: [['rain', 0.5], ['drizzle', 0.35], ['cloudy', 0.15]],
  fog: [['fog', 0.5], ['cloudy', 0.3], ['clear', 0.2]],
};

export function nextWeather(w: Weather, t: number, rng: Rng): Weather {
  const next = rng.weighted(NEXT_WEATHER[w], ([, p]) => p)[0];
  const h = hourOf(t);
  if (next === 'fog' && (h < 4 || h > 10)) return 'cloudy';
  return next;
}

export type VillagerId = 'bramwell' | 'wren' | 'tansy' | 'kids' | 'voles' | 'traveller';

export const VILLAGERS: Record<VillagerId, { name: string; who: string }> = {
  bramwell: { name: 'Bramwell', who: 'Bramwell, the badger who runs the bakery' },
  wren: { name: 'Old Wren', who: 'Old Wren, the tortoise who keeps the vegetable patch' },
  tansy: { name: 'Tansy', who: 'Tansy, the postmouse' },
  kids: { name: 'Pip and Nettle', who: 'Pip and Nettle, two squirrel kids' },
  voles: { name: 'the voles', who: 'the vole family from the mill' },
  traveller: { name: 'the traveller', who: 'a traveller off the train, with a huge rucksack' },
};

const PLURAL = new Set<VillagerId>(['kids', 'voles']);

/** "is" or "are", "was" or "were", for a group of villagers. */
export function verb(ids: readonly VillagerId[], present: boolean): string {
  const many = ids.length > 1 || ids.some((id) => PLURAL.has(id));
  return present ? (many ? 'are' : 'is') : many ? 'were' : 'was';
}

export function names(ids: readonly VillagerId[]): string {
  const n = ids.map((id) => VILLAGERS[id].name);
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

export function bakeryOpen(t: number): boolean {
  const h = hourOf(t);
  return !isSunday(t) && h >= 7 && h < 17;
}

/** Trains pass through the halt at these minutes of the day, heading for the city. */
export const TRAINS = [8 * 60 + 10, 11 * 60 + 40, 15 * 60 + 20, 18 * 60 + 45];

/** Game time of the next train at or after t. */
export function nextTrain(t: number): number {
  const m = minuteOfDay(t);
  const start = t - m;
  for (const tm of TRAINS) if (tm >= m) return start + tm;
  return start + DAY + (TRAINS[0] as number);
}

export interface Letter {
  from: VillagerId;
  text: string;
  t: number;
}

const LETTERS: { from: VillagerId; text: string }[] = [
  { from: 'bramwell', text: 'Seed cake on Thursday. I will put a corner aside if you come early.' },
  { from: 'wren', text: 'The peas are coming on. Bring small paws, the rows are tight.' },
  { from: 'kids', text: 'WE FOUND A FROG AS BIG AS A TEACUP. it went under the bridge. come and look' },
  { from: 'tansy', text: 'A parcel came for nobody. It is sitting at the halt if you want a look.' },
  { from: 'wren', text: 'Saw your light on late. Sleep is cheaper than worry, little one.' },
  { from: 'bramwell', text: 'Burnt a whole tray of buns. The crows are delighted. Come and help me laugh about it.' },
  { from: 'voles', text: 'The mill wheel squeaks again. If you know anything about squeaks, we would be grateful.' },
  { from: 'tansy', text: 'Your letterbox flag sticks. I gave it a push. You are welcome.' },
  { from: 'kids', text: 'we are building a den in the woods and you can be in it if you bring snacks' },
  { from: 'wren', text: 'A hedgehog was here before you, years back. Kept a garden of stones. You remind me of her.' },
];

export function newLetter(t: number, rng: Rng): Letter {
  const l = rng.pick(LETTERS);
  return { ...l, t };
}

export const FINDS = [
  'a blue button',
  'a bottle cap with a fox on it',
  'an empty snail shell, striped',
  'a key with no lock',
  'a marble with a crack in it',
  'a grey and white feather',
  'a tiny brass bell',
  'a scrap of red ribbon',
  'a smooth green stone',
  'a thimble',
  'a bent spoon',
  'a ticket stub with a city name half rubbed off',
  'a glass bead, amber',
  'a wooden die with one face missing its dots',
];

export const SIGHTS = [
  'a ring of grey mushrooms',
  'a fallen tree hollow enough to sit inside',
  'the back of the bakery from up on the bank',
  'an empty badger sett',
  'a little waterfall upstream',
  'an old signpost with the letters worn off',
  'a field of tall grass on the far side of the wood',
  'a bench nobody uses, covered in ivy',
  'a gap in a fence just hedgehog-sized',
  'the railway line from up on the embankment',
  'a stone wall full of snail shells',
  'a pond with one duck on it',
];

export const PROJECTS = [
  { name: 'the old lantern', needed: 4 },
  { name: 'a broken music box', needed: 5 },
  { name: 'a squeaky wheelbarrow', needed: 3 },
];

export interface WorldState {
  weather: Weather;
  present: Partial<Record<PlaceId, VillagerId[]>>;
  heron: boolean;
  letters: Letter[];
  /** Khina has seen the letterbox flag up since the newest letter arrived. */
  flagSeen: boolean;
  travellerUntil: number;
  findsLeft: string[];
  sightsLeft: string[];
  projects: { name: string; needed: number; progress: number; done: boolean }[];
  /** Everything ever generated, so nothing is found twice. */
  used: string[];
  /** Until when news of a fallen tree makes the woods worth exploring. */
  woodsNewsUntil: number;
  /** Until when Bramwell has seed cake. */
  bakeSpecialUntil: number;
}

const FIND_COLOURS = ['red', 'blue', 'green', 'white', 'yellow', 'black', 'chipped', 'tiny', 'odd-shaped'];
const FIND_THINGS = ['button', 'bead', 'marble', 'buckle', 'bottle stopper', 'hairpin', 'thimble', 'toy wheel'];
const FIND_NATURE_ADJ = ['speckled', 'striped', 'white', 'grey', 'tiny', 'odd-shaped', 'pale'];
const FIND_NATURE = ['feather', 'pebble', 'snail shell', 'acorn cap', 'beetle wing', 'seed pod'];
const SIGHT_ADJ = ['a mossy', 'a hollow', 'a split', 'a tilted', 'an ivy-covered', 'a half-sunk', 'a crooked', 'a white-barked'];
const SIGHT_THING = ['stump', 'boulder', 'log', 'old gate', 'cart wheel', 'root bridge', 'stone step', 'tumbled wall'];
const SIGHT_WHERE = [
  'under the ferns', 'past the brambles', 'beside a dry ditch', 'at the top of a slope',
  'behind a holly bush', 'where the path forks', 'in a hollow full of leaves', 'near an old fence',
];

const article = (word: string) => (/^[aeiou]/.test(word) ? 'an' : 'a');

/** A find nobody has found before. */
export function generateFind(w: WorldState, rng: Rng): string {
  for (let i = 0; i < 40; i++) {
    const natural = rng.chance(0.4);
    const adj = rng.pick(natural ? FIND_NATURE_ADJ : FIND_COLOURS);
    const thing = rng.pick(natural ? FIND_NATURE : FIND_THINGS);
    const text = `${article(adj)} ${adj} ${thing}`;
    if (!w.used.includes(text)) {
      w.used.push(text);
      return text;
    }
  }
  return 'a small grey stone';
}

/** A place in the woods nobody has seen before. */
export function generateSight(w: WorldState, rng: Rng): string {
  for (let i = 0; i < 40; i++) {
    const text = `${rng.pick(SIGHT_ADJ)} ${rng.pick(SIGHT_THING)} ${rng.pick(SIGHT_WHERE)}`;
    if (!w.used.includes(text)) {
      w.used.push(text);
      return text;
    }
  }
  return 'a quiet patch of ferns';
}

export function newWorld(): WorldState {
  return {
    weather: 'clear',
    present: {},
    heron: false,
    letters: [],
    flagSeen: false,
    travellerUntil: -1,
    findsLeft: [...FINDS],
    sightsLeft: [...SIGHTS],
    projects: PROJECTS.map((p) => ({ ...p, progress: 0, done: false })),
    used: [...FINDS, ...SIGHTS],
    woodsNewsUntil: -1,
    bakeSpecialUntil: -1,
  };
}

/** Who is where this hour. Called on the hour. */
export function updatePresence(w: WorldState, t: number, rng: Rng): void {
  const h = hourOf(t);
  const wet = isWet(w.weather);
  const present: Partial<Record<PlaceId, VillagerId[]>> = {};
  const add = (p: PlaceId, v: VillagerId) => (present[p] ??= []).push(v);

  if (bakeryOpen(t)) {
    add('bakery', 'bramwell');
    if (rng.chance(0.35)) add('bakery', rng.pick(['tansy', 'voles', 'wren'] as const));
  }
  const wrenAtPatch = h >= 8 && h < 16 && rng.chance(wet ? 0.3 : 0.75);
  if (wrenAtPatch) add('patch', 'wren');
  if (h >= 8 && h < 20) {
    if (rng.chance(0.3)) add('square', 'tansy');
    if ((h >= 15 || isWeekend(t)) && rng.chance(wet ? 0.2 : 0.6)) add('square', 'kids');
    if (!wrenAtPatch && h >= 12 && rng.chance(0.25)) add('square', 'wren');
    if (rng.chance(0.25)) add('square', 'voles');
  }
  if (t < w.travellerUntil) add('square', 'traveller');
  // Dedupe in case the bakery customer is also out and about.
  for (const p of Object.keys(present) as PlaceId[]) present[p] = [...new Set(present[p])];
  w.present = present;
  w.heron = h >= 6 && h < 20 && rng.chance(0.15);
}

export function presentAt(w: WorldState, p: PlaceId): VillagerId[] {
  return w.present[p] ?? [];
}
