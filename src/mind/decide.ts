// The decision loop. Code builds the menu and makes the final random pick;
// the model, when it is on, only proposes a few candidates with reasons.

import { habit, mind, NEEDS, taste } from '../config.ts';
import type { Rng } from '../rng.ts';
import type { Completed, Note, Origin, PieceRef, Reading, State } from '../state.ts';
import { nudgeFor, visitorWho, type NotesAnswer } from '../notes.ts';
import type { PieceDraft, PieceRequest } from './making.ts';
import { actionDef, BEYOND_IDS, OWN_FALLBACK, OWN_KINDS, type OwnKind } from '../world/actions.ts';
import { PLACE_IDS, type PlaceId } from '../world/places.ts';
import { favourites, habits, practiceOf, ROUTINE } from './habit.ts';
import { options, shortlist, tier, type Option } from './score.ts';
import type { ReflectInput, ReflectOutput } from './sleep.ts';

export interface Candidate {
  action: string;
  reason: string;
  weight: number;
  detail: string;
  /** Only for "own": where Khina wants to do it, and what kind of thing it is. */
  place?: string;
  kind?: string;
  /** Added by code (its own favourite), not proposed by the model. */
  fromCode?: boolean;
  /** Proposed as an idea of her own, and turned into "make" by code (routeOwnIdeas). */
  ownIdea?: boolean;
}

export type Proposal = { ok: true; candidates: Candidate[] } | { ok: false; why: string };

export const SENSES = ['none', 'none', 'sound', 'touch', 'sight', 'smell'] as const;
export type Sense = (typeof SENSES)[number];

export interface MindStats {
  calls: number;
  failures: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Calls and dollars per job (decide, diary, sleep, make, web) since the process started. */
  byJob?: Record<string, { calls: number; usd: number }>;
}

/** Whatever proposes candidates and writes diary lines: the Claude API, or nothing. */
export interface Mind {
  kind: 'model' | 'offline';
  /** Why the model cannot be asked right now, or null if it can. */
  unavailable(): string | null;
  propose(s: State, list: Option[], rng: Rng): Promise<Proposal>;
  /** `sense` is which kind of sensory detail the line may use; code rotates it so lines stay varied. */
  narrate(s: State, rec: Completed, recentLines: string[], sense: Sense): Promise<string | null>;
  /** Night jobs while Khina sleeps. Optional: without it, code does the night alone. */
  reflect?(s: State, input: ReflectInput): Promise<ReflectOutput | null>;
  /** Real work (live server): can it be done right now, within today's budget? */
  canWork?(): boolean;
  /** Makes a real piece; returns it checked, or why not. */
  makePiece?(s: State, req: PieceRequest): Promise<PieceDraft | string>;
  /** Looks something up on the web; returns what was found, or why not. */
  browse?(s: State, question: string, onMind: string): Promise<Reading | string>;
  /** Can Khina post right now (model up, today's few posts not used yet)? */
  canPost?(): boolean;
  /** Today's real spend against the caps (live server's /spend). */
  budgetToday?(): {
    spent: number;
    cap: number;
    extras: number;
    extrasAllowedNow: number;
    extrasCap: number;
    posts: number;
    notes?: number;
    notesAllowedNow?: number;
    notesCap?: number;
    noteReads?: number;
  };
  /** Writes a short public post; returns it checked, or why not. */
  writePost?(s: State, about: string, recentLines: string[], latest: PieceRef | undefined, hoursAgo: number | null): Promise<{ text: string; sharePiece: boolean } | string>;
  /** Can she read visitors' notes right now (model up, today's notes budget and sittings not used up)? */
  canReadNotes?(): boolean;
  /**
   * Reads a few visitors' notes: her diary line, at most 2 answers and one idea, as the model wrote
   * them (code checks every word before anything is kept: src/notes.ts checkNotes), or why not.
   */
  readNotes?(s: State, notes: Note[], recentLines: string[], waiting: number): Promise<NotesAnswer | string>;
  stats(): MindStats;
}

export const offlineMind: Mind = {
  kind: 'offline',
  unavailable: () => 'offline',
  propose: async () => ({ ok: false, why: 'offline' }),
  narrate: async () => null,
  stats: () => ({ calls: 0, failures: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }),
};

export interface Decision {
  id: number;
  t: number;
  actionId: string;
  detail: string;
  reason: string;
  origin: Origin;
  /** Where to do it, when the action itself does not say (Khina's own ideas). */
  place?: PlaceId;
  /** Why code decided alone, when it did. */
  why: string;
  menu: { id: string; score: number }[];
  candidates: (Candidate & { valid: boolean })[];
  probabilities: { id: string; p: number }[];
  /** This choice left out current favourites on purpose. */
  explore?: boolean;
}

const REASONS: Record<string, string[]> = {
  fullness: ['Belly is grumbling.', 'Need something to eat.', 'Thinking about food again.'],
  rest: ['Eyes are heavy.', 'Need to stop for a bit.', 'Paws are tired.'],
  calm: ['Need somewhere quiet.', 'Want to settle down.', 'Could do with some peace.'],
  company: ['Want to see a face.', 'Too quiet on my own.', 'Might see someone.'],
  novelty: ['Need something new to look at.', 'Same old everything.', 'Want to see what is out there.'],
  making: ['Paws want to make something.', 'Feel like making something.', 'Paws are itching.'],
};

/** What kind of thing it is decides the reason first; the need it helps most is the backup. */
const TOPIC_NEED: Partial<Record<string, string>> = {
  food: 'fullness',
  making: 'making',
  social: 'company',
  visitors: 'company',
  exploring: 'novelty',
  trains: 'novelty',
  home: 'calm',
};

function templateReason(o: Option, s: State, rng: Rng): string {
  if (o.def.id === 'sleep') return rng.pick(['Bedtime.', 'Cannot keep my eyes open.', 'Ears are drooping. Bed.']);
  // A visitor's note gave her the idea: she says so ("A visitor, Mo, suggested it.").
  const nudge = nudgeFor(s, o.def.id);
  if (nudge && !tier(s)) return `${visitorWho(nudge.who ?? 'a visitor')} suggested it.`;
  if (o.def.id === 'letterbox') return rng.pick(['Might be post.', 'Better check the letterbox.']);
  const t = tier(s);
  if (t === 'starving') return 'So hungry it hurts.';
  if (t === 'exhausted') return 'Cannot go on.';
  const need = TOPIC_NEED[o.def.topic] ?? o.helps[0];
  return need ? rng.pick(REASONS[need] ?? ['Why not.']) : 'Why not.';
}

function pickDetail(o: Option, rng: Rng, proposed?: string): string {
  if (!o.def.detailAsk) return '';
  let clean = (proposed ?? '').replace(/\s+/g, ' ').trim();
  // Cut long details at a word boundary, never mid-word.
  if (clean.length > 70) clean = clean.slice(0, 70).replace(/[\s,;:]+\S*$/, '');
  return clean || rng.pick(o.def.details ?? ['something']);
}

function normalize(items: { id: string; w: number }[]): { id: string; p: number }[] {
  const total = items.reduce((a, b) => a + b.w, 0) || 1;
  return items.map((x) => ({ id: x.id, p: Math.round((x.w / total) * 1000) / 1000 }));
}

/** Code decides alone: weighted random among the top few by score. */
function autopilot(s: State, list: Option[], rng: Rng, why: string, origin: Origin, id: number): Decision {
  const top = list.slice(0, mind.autopilotTopN);
  const pick = rng.weighted(top, (o) => o.score);
  const fallback = pick.def.id === 'own' ? rng.pick(OWN_FALLBACK) : null;
  return {
    id,
    t: s.t,
    actionId: fallback ? `own.${fallback.kind}` : pick.def.id,
    detail: fallback ? fallback.detail : pickDetail(pick, rng),
    reason: templateReason(pick, s, rng),
    origin,
    why,
    menu: list.map((o) => ({ id: o.def.id, score: round(o.score) })),
    candidates: [],
    probabilities: normalize(top.map((o) => ({ id: o.def.id, w: o.score }))),
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

const ALWAYS_OFFERED = new Set(['own', 'browse', 'post', 'notes']);

/** When code should not bother asking the model. */
export function autopilotReason(s: State, list: Option[], m: Mind): string | null {
  const off = m.unavailable();
  if (off) return off;
  const t = tier(s);
  if (t) return `must-do: ${t}`;
  if (list.length <= 2) return 'only one or two options';
  const [a, b] = list;
  if (a && b && a.score >= mind.obviousRatio * b.score) return `obvious: ${a.def.id}`;
  return null;
}

export async function decide(s: State, rng: Rng, m: Mind, id: number): Promise<Decision> {
  const all = options(s, rng);
  if (all.length === 0) {
    const idle = actionDef('idle');
    return {
      id, t: s.t, actionId: idle.id, detail: '', reason: 'Nothing to do.', origin: 'autopilot',
      why: 'no options at all', menu: [], candidates: [], probabilities: [{ id: idle.id, p: 1 }],
    };
  }
  let list = shortlist(all);
  // A share of free choices leaves out current favourites, so tastes cannot lock in for good.
  let explore = false;
  if (s.features.tastes && !tier(s) && rng.chance(taste.exploreShare)) {
    const fav = new Set([...favourites(s), ...(taste.exploreHabits && s.features.habituation ? habits(s) : [])]);
    const rest = shortlist(all.filter((o) => !fav.has(o.def.id)));
    if (fav.size > 0 && rest.length >= 2) {
      list = rest;
      explore = true;
    }
  }
  // Khina's own ideas and the internet are doors to anything, not one more pastime: when they are
  // possible they are always on the menu, and the body's score still weighs the final pick. So is
  // what a visitor's note gave her the idea for, while that idea lasts: a pull she can see, not an order.
  for (const o of all) if ((ALWAYS_OFFERED.has(o.def.id) || nudgeFor(s, o.def.id)) && !list.includes(o)) list = [...list, o];
  const d = await choose(s, rng, m, id, list, all);
  if (explore) d.explore = true;
  return d;
}

/**
 * Doors to anything, what costs money or reaches outside (a real piece, a lookup, a post), and the body's
 * routine: never the slot for something not done in a long while ("make" was offered as "half minded to
 * try it again" whenever it was her least-practised action, and it is a paid piece).
 */
const NOT_A_PASTIME = new Set([...ALWAYS_OFFERED, ...BEYOND_IDS, 'idle', ...ROUTINE]);

/**
 * The possible action she has practised least, when it is not on the menu already; of equals, the one
 * that suits the moment best. With needs mostly full, practice picks the shortlist, and an action never
 * done never gains practice: in 48 live days six of her 31 actions were never once on her menu.
 */
export function tryNewOption(s: State, all: Option[], list: Option[]): Option | null {
  if (!taste.tryNewSlot || !s.features.tastes || tier(s)) return null;
  const listed = new Set(list.map((o) => o.def.id));
  let best: Option | null = null;
  // `all` is best first, so the first of equals is the one code likes most right now.
  for (const o of all) {
    if (listed.has(o.def.id) || NOT_A_PASTIME.has(o.def.id)) continue;
    if (!best || practiceOf(s, o.def.id) < practiceOf(s, best.def.id)) best = o;
  }
  return best ? { ...best, tryNew: true } : null;
}

/**
 * An idea "of her own" that is really one of her actions. Drawing, painting or writing is "make": the
 * body weighs it as making and the Gallery gets the real piece. The computer (typing, posting, looking
 * things up) is dropped: browse and post are the costed, capped way to it. Both used to run as an own
 * idea with a blind 15% chance of failing, and those made-up failures went into her diary and her asks.
 */
const OWN_AS_MAKE = /\b(draw|drawing|drawings|sketch\w*|charcoal|chalk|paint\w*|poem|poems|verse|song|songs|story|stories)\b/i;
/** Hearing, telling, singing or humming a song or a story is not making one... */
const NOT_MAKING = /\b(listen\w*|hear\w*|tell\w*|told|sing\w*|sang|hum|hums|humm\w*|read\w*|recit\w*)\b/i;
/** ...unless she makes it up as well ("write a song to sing to the voles"). */
const MAKING_VERB = /\b(make|makes|making|made|write|writes|writing|wrote|compos\w*|draw|draws|drawing|sketch\w*|scribbl\w*|doodl\w*)\b/i;
/** Drawing water and painting the letterbox red are not pictures. */
const NOT_A_PICTURE = /\bdraw(?:s|ing)?\s+(?:up\s+)?(?:some\s+)?(?:water|a bucket|breath|near\w*|close\w*|back|the curtains?)\b|\bpaint\w*\s+(?:the |a |an |her |my )?(?:\w+\s+){0,2}(?:red|blue|green|yellow|white|black|pink|purple|orange|brown)\b/i;
/**
 * "look it up" and "look up herons" are the computer; "look up at the clouds" and "look up the hill" are
 * not. "posting a letter" is the letterbox's business, not the computer's.
 */
const OWN_AS_COMPUTER = /\b(computer|internet|online|website|typ(?:ing|ed)|type (?:up|out|a|on)|posting(?!\s+(?:a |the |her |my )?(?:letter|note|card|parcel|package)s?\b)|(?:a|short) post (?:for|on|about)|look(?:s|ed|ing)? (?:\w+ )?up\b(?!\s+(?:at|into|to|towards?|through|from|in|(?:the |a )?(?:hill|sky|tree|oak|lane|path|slope|bank|stream|track|road|trunk|branch\w*|clouds?|stars?|moon|chimney|stairs?|steps)\b)))/i;

export function ownCopy(c: Candidate): 'make' | 'drop' | null {
  const what = ownDetail(c);
  if (OWN_AS_COMPUTER.test(what)) return 'drop';
  if (!OWN_AS_MAKE.test(what) || NOT_A_PICTURE.test(what)) return null;
  return NOT_MAKING.test(what) && !MAKING_VERB.test(what) ? null : 'make';
}

/** What an own idea is: its detail or, without one, what its reason says ("I want to sniff the evening air"). */
function ownDetail(c: Candidate): string {
  const fromReason = (c.reason ?? '').replace(/^(I('d| would)? (want|like|need) to|Could|Might|Time to|Let me)\s+/i, '').replace(/[.;].*$/, '');
  let detail = (c.detail || fromReason).replace(/\s+/g, ' ').trim();
  if (detail.length > 70) detail = detail.slice(0, 70).replace(/[\s,;:]+\S*$/, '');
  return detail;
}

/**
 * Code's best option for her worst pressing need that none of the candidates helps; else null. It joins
 * the candidates at the model's top weight, and the pick stays a weighted draw. Against the stuck stand-in
 * (8 seeds × 40 days, calm and making decaying faster) it took days passing every check from 81% to 97%
 * (98% before the faster decay); at the line (35) instead of pressing (55), at a middling weight, or only
 * for the single worst need, it helped far less.
 */
export function bodysVote(s: State, all: Option[], valid: Candidate[], byId: Map<string, Option>): Option | null {
  const helped = (n: string) => valid.some((c) => byId.get(c.action)?.helps.includes(n as never));
  const worst = NEEDS.filter((n) => s.needs[n] < habit.pressingBelow && !helped(n)).sort((a, b) => s.needs[a] - s.needs[b])[0];
  if (!worst) return null;
  // Never a door or anything that costs or reaches outside: a post nobody chose would go out about a stock
  // detail ("the picture I drew of the stream"), with details the records don't have, and spend a post.
  return all.find((o) => o.helps[0] === worst && !COSTED.has(o.def.id) && !valid.some((c) => c.action === o.def.id)) ?? null;
}

/** Doors to anything, and what costs money or reaches outside: only ever chosen by the model, never added by code. */
const COSTED = new Set([...ALWAYS_OFFERED, ...BEYOND_IDS]);

/** Turns own ideas that copy a real action into that action, or drops them (ownCopy). */
function routeOwnIdeas(marked: (Candidate & { valid: boolean })[], byId: Map<string, Option>, all: Option[]): void {
  const make = all.find((o) => o.def.id === 'make');
  for (const c of marked) {
    if (!c.valid || c.action !== 'own') continue;
    const copy = ownCopy(c);
    if (copy === 'drop') c.valid = false;
    if (copy !== 'make') continue;
    // "make" is possible (budget left, not just done) and not proposed already: the idea becomes it.
    if (!make || marked.some((x) => x.valid && x.action === 'make')) {
      c.valid = false;
      continue;
    }
    byId.set('make', make);
    Object.assign(c, { action: 'make', detail: ownDetail(c), ownIdea: true });
  }
}

async function choose(s: State, rng: Rng, m: Mind, id: number, offered: Option[], all: Option[] = offered): Promise<Decision> {
  const why = autopilotReason(s, offered, m);
  if (why) return autopilot(s, offered, rng, why, 'autopilot', id);
  // One slot for something she has not done in a long while, only when the model is asked: added before,
  // it reached code's own top few when the menu was short (at bedtime), and made a 2-option menu a call.
  const fresh = tryNewOption(s, all, offered);
  const list = fresh ? [...offered, fresh] : offered;

  const proposal = await m.propose(s, list, rng);
  if (!proposal.ok) return autopilot(s, list, rng, `model failed: ${proposal.why}`, 'fallback', id);

  const byId = new Map(list.map((o) => [o.def.id, o]));
  const seen = new Set<string>();
  const marked = proposal.candidates.map((c) => {
    const valid = byId.has(c.action) && !seen.has(c.action);
    seen.add(c.action);
    return { ...c, valid };
  });
  routeOwnIdeas(marked, byId, all);
  const valid = marked.filter((c) => c.valid);
  if (valid.length === 0) {
    const d = autopilot(s, list, rng, 'model picked nothing on the menu', 'fallback', id);
    d.candidates = marked;
    return d;
  }

  // This copy's own favourite (it carries its practice and tastes) always gets a vote, at Claude's
  // typical weight, so Claude's shared favourites cannot wash out each copy's history.
  const top = list[0];
  if (s.features.codeFavourite && top && !valid.some((c) => c.action === top.def.id)) {
    const ws = valid.map((c) => c.weight).sort((a, b) => a - b);
    const extra = { action: top.def.id, reason: templateReason(top, s, rng), weight: ws[Math.floor(ws.length / 2)] ?? 5, detail: '', valid: true, fromCode: true };
    marked.push(extra);
    valid.push(extra);
  }

  // A pressing need always gets a vote: code owns the body, and a model stuck on its favourites must
  // not leave her lonely all day (with calm and making dipping again, it did: src/config.ts decayAwake).
  const need = bodysVote(s, all, valid, byId);
  if (need) {
    const extra = { action: need.def.id, reason: templateReason(need, s, rng), weight: Math.max(...valid.map((c) => c.weight)), detail: '', valid: true, fromCode: true };
    byId.set(need.def.id, need);
    marked.push(extra);
    valid.push(extra);
  }

  // The model's weights are flattened (they are not calibrated) and multiplied by code's score,
  // so the model shapes the choice but cannot overrule the body.
  const combined = valid.map((c) => {
    const o = byId.get(c.action) as Option;
    const w = Math.min(10, Math.max(1, Math.round(c.weight) || 1));
    return { c, o, w: Math.pow(w, mind.modelWeightExponent) * o.score };
  });
  const bestW = Math.max(...combined.map((x) => x.w));
  const kept = combined.filter((x) => x.w >= bestW * mind.candidatePruneRatio);
  const pick = rng.weighted(kept, (x) => x.w);

  const own = pick.o.def.id === 'own' ? ownChoice(pick.c, s.place, rng) : null;
  // An own idea turned into "make" still happens where she meant to do it ("sketch the stream").
  const where = own?.place ?? (pick.c.ownIdea ? ownPlace(pick.c, s.place) : undefined);
  return {
    id,
    t: s.t,
    actionId: own ? own.actionId : pick.o.def.id,
    detail: own ? own.detail : pickDetail(pick.o, rng, pick.c.detail),
    place: where,
    reason: pick.c.reason.replace(/\s+/g, ' ').trim().slice(0, 120) || templateReason(pick.o, s, rng),
    origin: 'model',
    why: '',
    menu: list.map((o) => ({ id: o.def.id, score: round(o.score) })),
    candidates: marked,
    probabilities: normalize(kept.map((x) => ({ id: x.o.def.id, w: x.w }))),
  };
}

/** Turns the model's own idea into something the sim can run: a kind (for its effects) and a place. */
export function ownChoice(c: Candidate, here: PlaceId, rng: Rng): { actionId: string; detail: string; place: PlaceId } {
  const kind = (OWN_KINDS as readonly string[]).includes(c.kind ?? '') ? (c.kind as OwnKind) : null;
  // Without a "what", the reason usually says it ("I want to sniff the evening air").
  const detail = ownDetail(c);
  if (!detail || !kind) {
    const f = rng.pick(OWN_FALLBACK);
    return { actionId: `own.${f.kind}`, detail: f.detail, place: here };
  }
  return { actionId: `own.${kind}`, detail, place: ownPlace(c, here) };
}

/** Where an own idea happens: the place she named, if it is a real one. The internet hut's computer is
 * reached through "browse", which is costed and capped. */
function ownPlace(c: Candidate, here: PlaceId): PlaceId {
  return (PLACE_IDS as string[]).includes(c.place ?? '') && c.place !== 'nethut' ? (c.place as PlaceId) : here;
}
