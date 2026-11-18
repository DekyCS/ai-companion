// The decision loop. Code builds the menu and makes the final random pick;
// the model, when it is on, only proposes a few candidates with reasons.

import { mind, taste } from '../config.ts';
import type { Rng } from '../rng.ts';
import type { Completed, Origin, Reading, State } from '../state.ts';
import type { PieceDraft, PieceRequest } from './making.ts';
import { actionDef, OWN_FALLBACK, OWN_KINDS, type OwnKind } from '../world/actions.ts';
import { PLACE_IDS, type PlaceId } from '../world/places.ts';
import { favourites, habits } from './habit.ts';
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
  making: ['Paws want to make something.', 'Feel like making something.', 'Hands are itching.'],
};

/** What kind of thing it is decides the reason first; the need it helps most is the backup. */
const TOPIC_NEED: Partial<Record<string, string>> = {
  food: 'fullness',
  making: 'making',
  social: 'company',
  exploring: 'novelty',
  trains: 'novelty',
  home: 'calm',
};

function templateReason(o: Option, s: State, rng: Rng): string {
  if (o.def.id === 'sleep') return rng.pick(['Bedtime.', 'Cannot keep my eyes open.', 'Time to curl up.']);
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

const ALWAYS_OFFERED = new Set(['own', 'browse']);

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
  // possible they are always on the menu, and the body's score still weighs the final pick.
  for (const o of all) if (ALWAYS_OFFERED.has(o.def.id) && !list.includes(o)) list = [...list, o];
  const d = await choose(s, rng, m, id, list);
  if (explore) d.explore = true;
  return d;
}

async function choose(s: State, rng: Rng, m: Mind, id: number, list: Option[]): Promise<Decision> {
  const why = autopilotReason(s, list, m);
  if (why) return autopilot(s, list, rng, why, 'autopilot', id);

  const proposal = await m.propose(s, list, rng);
  if (!proposal.ok) return autopilot(s, list, rng, `model failed: ${proposal.why}`, 'fallback', id);

  const byId = new Map(list.map((o) => [o.def.id, o]));
  const seen = new Set<string>();
  const marked = proposal.candidates.map((c) => {
    const valid = byId.has(c.action) && !seen.has(c.action);
    seen.add(c.action);
    return { ...c, valid };
  });
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
  return {
    id,
    t: s.t,
    actionId: own ? own.actionId : pick.o.def.id,
    detail: own ? own.detail : pickDetail(pick.o, rng, pick.c.detail),
    place: own?.place,
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
  const fromReason = (c.reason ?? '').replace(/^(I('d| would)? (want|like|need) to|Could|Might|Time to|Let me)\s+/i, '').replace(/[.;].*$/, '');
  let detail = (c.detail || fromReason).replace(/\s+/g, ' ').trim();
  if (detail.length > 70) detail = detail.slice(0, 70).replace(/[\s,;:]+\S*$/, '');
  if (!detail || !kind) {
    const f = rng.pick(OWN_FALLBACK);
    return { actionId: `own.${f.kind}`, detail: f.detail, place: here };
  }
  // The internet hut's computer is reached through "browse", which is costed and capped.
  const place = (PLACE_IDS as string[]).includes(c.place ?? '') && c.place !== 'nethut' ? (c.place as PlaceId) : here;
  return { actionId: `own.${kind}`, detail, place };
}
