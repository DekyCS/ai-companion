// Everything about Khina and the village at one moment. Code owns all of it.

import { ALL_ON, NEEDS, type Features, type NeedId, type Needs } from './config.ts';
import { Rng } from './rng.ts';
import type { PlaceId } from './world/places.ts';
import { newWorld, type VillagerId, type WorldState } from './world/village.ts';

export type FoodId = 'berries' | 'beetles' | 'crusts' | 'peas';
export type Origin = 'model' | 'autopilot' | 'fallback';

export interface Thought {
  key: string;
  /** What it is about, in plain words: "Found a blue button in the moss". */
  text: string;
  /** Pushes mood's target up or down. */
  value: number;
  at: number;
  until: number;
}

export interface Activity {
  kind: 'walk' | 'act';
  actionId: string;
  detail: string;
  reason: string;
  origin: Origin;
  /** Where the action happens (the destination while walking). */
  place: PlaceId;
  startedAt: number;
  /** null while the action runs until a condition is met (sleep). */
  endsAt: number | null;
  /** For fixed-length actions: how long it was planned to take. */
  duration: number;
  /** For sleep: do not wake before this. */
  wakeAfter?: number;
  /** Villagers at the place when the action started. */
  who?: VillagerId[];
  /** How much of its usual benefit the action gives this time (1 = fresh, lower = stale). */
  stale?: number;
  /** Mood pull from needs when the action started, to measure the relief it brought. */
  needBefore?: number;
  moodBefore: number;
  decisionId: number;
  /** What the real work behind the action came to (a piece made, a page read online), when there was any. */
  result?: WorkResult;
}

/** The kinds of real piece Khina can make. */
export type PieceForm = 'picture' | 'poem' | 'story' | 'song' | 'toy';
export const PIECE_FORMS: PieceForm[] = ['picture', 'poem', 'story', 'song', 'toy'];

/** A real piece Khina made, stored outside the state (see src/pieces.ts). */
export interface PieceRef {
  id: string;
  form: PieceForm;
  title: string;
  /** Game minute it was finished. */
  t: number;
  /** What Khina set out to make, in Khina's words. */
  about: string;
}

/** Something Khina looked up at the internet hut, and what came of it. */
export interface Reading {
  t: number;
  question: string;
  /** What Khina took from it, in plain words. */
  learned: string;
  sources: { title: string; url: string }[];
}

export type WorkResult =
  | { kind: 'piece'; piece: PieceRef }
  | { kind: 'web'; reading: Reading; again?: boolean }
  | { kind: 'none'; why: string };

/** One finished (or refused) action, as the village's records saw it. */
export interface Completed {
  kind: 'done' | 'refused';
  actionId: string;
  label: string;
  gist: string;
  place: PlaceId;
  start: number;
  end: number;
  detail: string;
  reason: string;
  origin: Origin;
  /** Code-written description of what actually happened. */
  outcome: string;
  diary: string;
  diaryBy: 'model' | 'template' | 'none';
  moodBefore: number;
  moodAfter: number;
  /** Villagers who were there. */
  who?: VillagerId[];
  /** Benefit factor this time (1 = fresh). */
  stale?: number;
  /** How the action actually felt: change in mood target, in mood points. */
  felt?: number;
}

export interface Taste {
  fast: number;
  slow: number;
  n: number;
  /** Practice: days it was done, fading over weeks. Doing something on many days makes it an acquired taste. */
  practice?: number;
  /** Last day practice was counted, so it grows at most once a day. */
  practiceDay?: number;
}

export interface Memory {
  id: number;
  t: number;
  text: string;
  /** Where it happened, in words: "in the woods". */
  where: string;
  /** One slot group per kind of thing, so one theme cannot fill the memory. */
  category: string;
  salience: number;
  recalls: number;
  lastRecalled: number;
  tier: 'short' | 'long';
  /** Distinct days on which it happened (again). */
  days: number[];
}

export interface Belief {
  /** Evidence key: "a:train" (an action) or "p:stream" (a place). */
  key: string;
  polarity: 'likes' | 'dislikes';
  /** Distinct days that support it, out of days observed in the window. */
  days: number;
  of: number;
  text: string;
}

export interface SheetLine {
  key: string;
  text: string;
  /** Last night the line was still supported by evidence. */
  night: number;
  /** Night it was added. */
  added?: number;
}

export interface NightPage {
  day: number;
  text: string;
  by: 'model' | 'none';
  promoted: string[];
  dropped: string[];
  sheetLine: string;
}

export interface Personality {
  /** Multiplies how fast each need drops. */
  decay: Needs;
  /** Multiplies how much each need counts when choosing. */
  weight: Needs;
  /** Where mood settles when nothing is pulling it. */
  moodBase: number;
}

export interface State {
  name: string;
  seed: number;
  t: number;
  place: PlaceId;
  needs: Needs;
  /** Minutes each need has spent below the line, without a break. */
  pastLine: Needs;
  mood: number;
  energy: number;
  thoughts: Thought[];
  activity: Activity | null;
  /** Most recent finished action ids, newest first. */
  recent: string[];
  /** The last few finished actions, newest last. */
  history: Completed[];
  pantry: Record<FoodId, number>;
  finds: { name: string; t: number }[];
  made: { what: string; t: number }[];
  /** Real pieces made (live server only). */
  pieces: PieceRef[];
  /** Things looked up at the internet hut (live server only). */
  readings: Reading[];
  world: WorldState;
  personality: Personality;
  rngState: number;

  // Phase 2
  features: Features;
  /** Going-stale counters: "a:whittle", "t:making", "p:shed". */
  familiarity: Record<string, number>;
  /** Learned likes per action ("a:id") and place ("p:id"). */
  tastes: Record<string, Taste>;
  /** Per key, per day: summed mood change and count. Code's evidence for beliefs. */
  evidence: Record<string, Record<number, { sum: number; n: number }>>;
  memories: Memory[];
  nextMemoryId: number;
  beliefs: Belief[];
  /** Lines added to the character sheet by sleep, with the night they were added. */
  learned: SheetLine[];
  pages: NightPage[];
  /** Last time something notable happened (for the drama manager). */
  lastNotable: number;
  dramaUntil: number;
  lastReflectDay: number;
}

function needsOf(f: (n: NeedId) => number): Needs {
  return Object.fromEntries(NEEDS.map((n) => [n, f(n)])) as Needs;
}

/** Temperament in numbers, drawn once from the seed. */
export function personalityFromSeed(seed: number): Personality {
  const r = new Rng(seed * 7919 + 17);
  return {
    decay: needsOf(() => Math.round(r.range(0.85, 1.15) * 100) / 100),
    weight: needsOf(() => Math.round(r.range(0.85, 1.2) * 100) / 100),
    moodBase: Math.round(r.range(50, 60)),
  };
}

/** A new Khina, waking up at 06:30 on Monday of day 1. */
export function newState(seed: number, features: Features = ALL_ON): State {
  const personality = personalityFromSeed(seed);
  return {
    name: 'Khina',
    seed,
    t: 6 * 60 + 30,
    place: 'burrow',
    needs: { fullness: 55, rest: 92, calm: 70, company: 45, novelty: 50, making: 50 },
    pastLine: needsOf(() => 0),
    mood: personality.moodBase,
    energy: 70,
    thoughts: [],
    activity: null,
    recent: [],
    history: [],
    pantry: { berries: 2, beetles: 3, crusts: 0, peas: 0 },
    finds: [],
    made: [],
    pieces: [],
    readings: [],
    world: newWorld(),
    personality,
    rngState: seed,
    features: { ...features },
    familiarity: {},
    tastes: {},
    evidence: {},
    memories: [],
    nextMemoryId: 1,
    beliefs: [],
    learned: [],
    pages: [],
    lastNotable: 6 * 60 + 30,
    dramaUntil: 0,
    lastReflectDay: 0,
  };
}

export const HISTORY_KEEP = 40;

export function pantryTotal(s: State): number {
  return s.pantry.berries + s.pantry.beetles + s.pantry.crusts + s.pantry.peas;
}
