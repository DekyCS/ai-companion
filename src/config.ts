// Every tunable number in Khina's body and mind lives here.
// These are starting values to tune in the simulator, not findings.

export const NEEDS = ['fullness', 'rest', 'calm', 'company', 'novelty', 'making'] as const;
export type NeedId = (typeof NEEDS)[number];
export type Needs = Record<NeedId, number>;
export type Effects = Partial<Record<NeedId, number>>;

/** How each need is named when talking about it. 100 means fully satisfied. */
export const NEED_NAMES: Record<NeedId, string> = {
  fullness: 'hunger',
  rest: 'rest',
  calm: 'calm',
  company: 'company',
  novelty: 'something new',
  making: 'the urge to make',
};

export const body = {
  /** Below this a need is "past the line" and starts dragging mood down. */
  line: 35,
  /** Below this a need is critical. */
  critical: 12,
  /**
   * Points lost per game hour while awake. Calm and making were 1.5 and 3.5 until 2026-11-20: over 48 live
   * days calm sat at 80 or more all of her waking time and making 98% of it, so no need was pressing in 94%
   * of decisions and practice alone decided what she did. Making at 6 was too much: a model stuck on its
   * favourites left her miserable on some seeds (stuck stand-in, seeds 7-16 × 50 days: days passing every
   * check 86% before, 73% at 5 / 6, 93% at 5 / 4.5), and code alone sent her to bed hungry.
   */
  decayAwake: { fullness: 5, rest: 4, calm: 5, company: 4, novelty: 4.5, making: 4.5 } as Needs,
  /** Points lost per game hour while asleep. */
  decayAsleep: { fullness: 2, rest: 0, calm: 0, company: 1, novelty: 0.5, making: 0.5 } as Needs,
  /** Staying up at night tires Khina faster. */
  nightRestFactor: 1.6,
  /** Mood chases its target at a capped rate (points per game hour). */
  moodUpPerHour: 12,
  moodDownPerHour: 8,
  energyPerHour: 25,
  /** A need past the line weighs -(base + perHour * hours past the line), capped. */
  needThought: { base: 4, perHour: 2, cap: 18, criticalExtra: 6 },
};

export const mind = {
  /** How many of the most recent actions are blocked from the menu. */
  maskLength: 3,
  /** Most options shown to the model, and the weakest one kept (as a share of the best). */
  shortlistMax: 8,
  shortlistMinRatio: 0.12,
  /** Autopilot picks at random among this many top options, weighted by score. */
  autopilotTopN: 3,
  /** If the best option scores this many times the second, code picks without asking the model. */
  obviousRatio: 4,
  /** The model's 1-10 weights are flattened with this exponent, because they are not calibrated. */
  modelWeightExponent: 0.5,
  /** Candidates scoring under this share of the best combined weight are dropped. */
  candidatePruneRatio: 0.2,
  /**
   * Costs (a walk that tires, a job that makes hungry) count for this share when choosing.
   * At full weight, effortless options like sitting on a bench crowd out everything else.
   */
  costWeight: 0.5,
  /** Must-do states: only actions that fix the need are allowed. */
  tiers: { exhaustedBelow: 12, starvingBelow: 10 },
  /**
   * A visitor's note gave her the idea (live server only, src/notes.ts): that action's score is
   * multiplied by this while the thought lasts, and it stays on her menu (src/mind/decide.ts). A pull,
   * not an order: the body still weighs it. (1.8 moved too little: a nudged bench went from 1% of next
   * choices to 7%; at 2.5 it is about 15%.)
   */
  nudgeMult: 2.5,
};

/** Switchable systems, so each can be measured one change at a time (see `npm run long -- --exp`). */
export interface Features {
  habituation: boolean;
  tastes: boolean;
  memory: boolean;
  drama: boolean;
  /** Experiment only: a fixed 7× penalty on anything done in the last day, instead of going stale. */
  fixedPenalty: boolean;
  /** Experiment only: show Claude needs, mood and energy as numbers instead of words. */
  numbers: boolean;
  /**
   * Tell Claude which options are this copy's own habits and which it hardly ever does.
   * Without it, Claude brought the same favourites to every copy and copies stayed alike.
   */
  habitWords: boolean;
  /**
   * Code's own favourite option is always among the candidates, even when Claude leaves it out,
   * so this copy's practice and tastes always get a vote. Claude's shared favourites otherwise wash them out.
   */
  codeFavourite: boolean;
}
export const ALL_ON: Features = {
  habituation: true, tastes: true, memory: true, drama: true, fixedPenalty: false, numbers: false, habitWords: true, codeFavourite: false,
};
export const ALL_OFF: Features = {
  habituation: false, tastes: false, memory: false, drama: false, fixedPenalty: false, numbers: false, habitWords: false, codeFavourite: false,
};

/** Going stale: each use makes an action give less; it recovers with rest. */
export const habit = {
  /** Familiarity halves in this many game minutes (one pet-day). */
  halfLifeMin: 1440,
  /** One use adds 1 to the action's familiarity and this much to its topic's and place's. */
  topicShare: 0.5,
  placeShare: 0.5,
  /** Topic familiarity counts this much relative to the action's own. */
  topicWeight: 1,
  /**
   * Appeal is scaled by 1 / sqrt(1 + familiarity), and so is how new it feels (novelty).
   * The other needs are filled in full: a fifth chat still helps loneliness. Scaling those too
   * left Khina lonely for 35 hours while chatting 125 times in 40 days.
   */
  staleNeeds: ['novelty'] as NeedId[],
  /**
   * Below this level a need is pressing, and the part of an option's appeal that serves it never goes stale.
   * Above the line (35) on purpose: at 35 Khina skipped supper and went to bed hungry. 55 tested best
   * (8 seeds × 40 days, stuck proposer: days passing all checks 92% → 100%).
   */
  pressingBelow: 55,
  /**
   * Staleness = (1 + familiarity) ^ -exponent. 0.5 is the count-based novelty bonus from RL;
   * 1.0 tested better against a stuck proposer (8 seeds × 40 days: top-3 share 40.6% → 32.0%,
   * same routine as yesterday 19.9% → 12.0%, days passing all checks 73% → 99%).
   */
  exponent: 1,
  /** Experiment: the fixed penalty divides the appeal of anything done within this window by this much. */
  fixedPenalty: 7,
  fixedWindowMin: 24 * 60,
  /** At this familiarity the option is described to the model as "done a lot lately". */
  noteAt: 2.5,
  /** Below this benefit factor Khina notices it did less than it used to. */
  feltBelow: 0.6,
  /** Novelty restored by doing something unfamiliar, scaled by 1 / (1 + familiarity). */
  unfamiliarNovelty: 8,
  /** Reward = unfamiliarNovelty / (1 + familiarity) ^ falloff. Higher keeps it for truly new things. */
  unfamiliarFalloff: 3,
};

/** Tastes learned from how mood actually changed. */
export const taste = {
  /** Moving-average rates per experience. */
  fastRate: 0.3,
  slowRate: 0.06,
  /** Tastes fade toward neutral with these half-lives, in pet-days. */
  fastHalfLifeDays: 3,
  slowHalfLifeDays: 30,
  /** Score multiplier = exp(gain × (fast + slow)), clamped. */
  scoreGain: 0.05,
  minMult: 0.6,
  maxMult: 1.7,
  /** Share of free choices that leave out current favourites. */
  exploreShare: 0.15,
  /** Explore choices also leave out the most-repeated habits of the last day, not only learned likes. */
  exploreHabits: true,
  /** One experience moves taste by at most this many mood points. */
  clampExperience: 8,
  /**
   * Score multiplier from practice = min(practiceMax, (1 + practice) ^ practiceGain): early accidents stick.
   * Without it, 5 identical copies stayed indistinguishable (19% of later days matched to their copy, chance 20%);
   * with 1.5 and a cap of 8, 62% of days and 84% of 3-day blocks were (5 copies × 4 personalities × 40 days),
   * while top-3 share rose only 25.4% → 26.9%. At 2 and above it turns into a rut.
   */
  practiceGain: 1.5,
  /**
   * 8 until 2026-11-20. With needs mostly full, a pull of up to 8× (against 1× for anything never done)
   * decided nearly every live choice, and 6 of 31 actions were never chosen in 48 days: an action never
   * done never gains practice, so it never made the shortlist.
   */
  practiceMax: 3,
  /** Practice grows at most once a day per action, so it tracks days of interest rather than one busy afternoon. */
  practicePerDay: true,
  /**
   * Habit words for Claude: the few most-practised actions (at least `habitAt` days of practice)
   * are "one of Khina's habits"; from day `rareFromDay`, actions under `rareBelow` are "not done in a long
   * while" (until 2026-11-20 "Khina hardly ever does this", which read as a reason not to).
   */
  habitWords: { top: 5, habitAt: 3, rareBelow: 0.5, rareFromDay: 4 },
  /**
   * One slot on every menu Claude sees goes to the possible action she has practised least, when it is not
   * already there: the shortlist alone never offered an action that was never done (src/mind/decide.ts).
   */
  tryNewSlot: true,
  /** Practice halves in this many pet-days without use. */
  practiceHalfLifeDays: 20,
  /**
   * How an action felt = what happened (the outcome's thought) + this share of the relief from needs.
   * At full share, anything that relieves a need gets "liked", which says nothing about the individual.
   */
  reliefShare: 0.15,
};

/** A belief needs support on this many distinct days; a character-sheet line needs more. */
export const beliefs = {
  minDays: 4,
  sheetMinDays: 8,
  /** At most one new sheet line per this many nights. */
  sheetEveryNights: 3,
  /** Mean mood change on a day must pass this to count as support. */
  dayThreshold: 1,
  /** Share of observed days that must agree. */
  agreement: 0.7,
  /** Only the last this many days count as evidence. */
  windowDays: 30,
  maxLearnedLines: 5,
};

/** Bounded memory, Dwarf Fortress style: few slots, the strongest win. */
export const memoryCfg = {
  shortSlots: 24,
  longSlots: 24,
  perCategory: 4,
  shortHalfLifeDays: 3,
  longHalfLifeDays: 60,
  /** Recall adds to a memory's worth, but only this many times, so one memory cannot dominate. */
  recallCap: 3,
  /** Outcome thoughts at least this strong become memories (an ordinary chat is 3, a find 5). */
  minSalience: 4,
  /** A memory recalled into a prompt is not shown again for this many game minutes. */
  recallRestMin: 12 * 60,
  forgetBelow: 0.8,
  promotePerNight: 2,
};

/** The internet hut: when a question counts as one she already looked up, and when a topic is worn out. */
export const asking = {
  /**
   * Share of content words two questions must have in common (stop-words out, plurals and -ing off, a
   * few same-thing words: a halt is a stop), as well as 3 shared words or 2 with nothing new on one side
   * (sameQuestion in src/mind/questions.ts). Exact repeats only, until 2026-11-20: 12 of 24 live lookups
   * were "why do trains skip stops" again. Replayed on those 24 (test/making.test.ts), this catches 8 of
   * the 15 that were paid for and every repeat the old check caught, and none of 28 different questions
   * on the same subjects. On overlap alone, 0.4 took 14 of the 28 for repeats and 0.5 still took 5.
   */
  sameAt: 0.4,
  /** Asked again this many times within this long, a question is worn out: it gives a thought that pushes away. */
  wornTimes: 2,
  wornWithinMin: 3 * 1440,
  /** Her last this many questions are listed by the hut's computer on her menu, as already looked up. */
  listed: 6,
  /** What she made or looked up is in her decide prompt for this long only (it was there for days). */
  showForMin: 1440,
};

/** If nothing notable has happened for a while, the village makes something happen. */
export const dramaCfg = {
  quietHours: 14,
  cooldownHours: 20,
};

/** Which Claude model does which job. Phase 1 only uses decide and diary. */
export const models = {
  decide: 'claude-haiku-5-5',
  diary: 'claude-haiku-5-5',
  make: 'claude-sonnet-5-5',
  web: 'claude-sonnet-5-5',
  post: 'claude-haiku-5-5',
  // Reading a batch of visitors' notes: one small call, a diary line, at most 2 answers and one idea.
  notes: 'claude-haiku-5-5',
  // The night page. At a fast clock (24 pages a real day) the live server sets KHINA_NIGHT_MODEL to Sonnet.
  sleep: (process.env.KHINA_NIGHT_MODEL ?? 'claude-opus-5-5') as 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5',
} as const;

export const effort = { decide: 'low', diary: 'low', make: 'medium', web: 'low', post: 'low', notes: 'low', sleep: 'medium' } as const;

/** Most posts Khina may write per real day (each is one small Haiku call; sending is free on Bluesky, about $0.015 on X). */
export const postsPerDay = Number(process.env.KHINA_POSTS_PER_DAY ?? 3) || 3;

/** US dollars per web search (server-side search tool). Check the current price. */
export const webSearchUsd = 0.01;

/** US dollars per million tokens. Check current prices before trusting cost figures. */
export const prices: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};
export const cacheReadFactor = 0.1;
export const cacheWriteFactor = 1.25;

export const budget = {
  /** Most Khina may spend on the API per real calendar day, across all runs. */
  dailyUsd: Number(process.env.KHINA_DAILY_CAP_USD ?? 1) || 1,
  /** Default most a single simulator run may spend. */
  runUsd: 0.5,
  /**
   * Of the daily cap, the most that real pieces and the internet may take per real day. When it is
   * used up, Khina's making turns back into words only and the internet hut's computer stays off.
   */
  extrasUsd: Number(process.env.KHINA_EXTRAS_CAP_USD ?? 0.3) || 0.3,
  /**
   * Of the daily cap, the most that reading visitors' notes may take per real day (one small Haiku
   * call a sitting), let out through the day like the extras. Reads are also capped by count (src/notes.ts).
   */
  notesUsd: Number(process.env.KHINA_NOTES_CAP_USD ?? 0.25) || 0.25,
};

/** Where the real-money spend ledger lives (shared by all runs). */
export const spendLedgerPath = 'data/spend.json';
