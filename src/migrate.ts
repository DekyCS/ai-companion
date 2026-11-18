// Khina was a hedgehog until 2026-11-18, when she became a bunny. A save from before (the live
// server had 54 Khina days of hedgehog life) is brought over once, right after it is loaded:
// her tastes, habits, friends, pieces, readings, posts, letters and diary stay; dried beetles
// become dried clover; and what she was holding in mind that only makes sense for a hedgehog
// (spines, quills, curling into a ball, beetles, snails) is let go, from the state and from the
// saved diary log alike.

import { beliefText } from './mind/habit.ts';
import { fromHedgehogDays, HEDGEHOG_ONLY } from './mind/prompts.ts';
import { labelFor } from './mind/sleep.ts';
import { FOOD_IDS, type Completed, type State } from './state.ts';
import { actionDef } from './world/actions.ts';

export { fromHedgehogDays, HEDGEHOG_ONLY };

/** The old heron outcome, and the model's lines about it: a hedgehog curling up, where a bunny now
 * thumps a back foot and freezes ("Khina curled up tight until it left"). */
const HERON_CURL = /\bheron\b.{0,80}\bcurl(?:s|ed|ing)? up\b|\bcurl(?:s|ed|ing)? up\b.{0,80}\bheron\b/i;

export const hedgehogOnly = (text: string | undefined) => !!text && (HEDGEHOG_ONLY.test(text) || HERON_CURL.test(text));

/** Village things that changed with her: finds, sights and Old Wren's letter, old words to new. */
const RENAMED: Record<string, string> = {
  'an empty snail shell, striped': 'a hazelnut shell with a neat hole in it',
  'a gap in a fence just hedgehog-sized': 'a gap in a fence just bunny-sized',
  'a stone wall full of snail shells': 'a stone wall with wild strawberries along the bottom',
  'A hedgehog was here before you, years back. Kept a garden of stones. You remind me of her.':
    'A rabbit lived in your burrow before you, years back. Kept a garden of stones. You remind me of her.',
};

function bunnyWords(text: string): string {
  return RENAMED[text] ?? text.replace(/\bsnail shells?\b/g, (m) => m.replace('snail', 'hazelnut')).replace(/\bbeetle wings?\b/g, (m) => (m.endsWith('s') ? 'eggshells' : 'eggshell'));
}

/** Any key about beetles is now about clover; an existing clover key wins. */
function renameKeys<T>(rec: Record<string, T> | undefined): void {
  if (!rec) return;
  for (const k of Object.keys(rec)) {
    if (!/beetle/i.test(k)) continue;
    const to = k.replace(/beetles?/gi, 'clover');
    if (!(to in rec)) rec[to] = rec[k] as T;
    delete rec[k];
  }
}

/** Menu words for a record, from the actions as they are now ("forage for clover and berries"). */
export function relabel(r: Completed): Completed {
  try {
    const def = actionDef(r.actionId);
    r.label = def.label;
    r.gist = def.gist;
  } catch {
    // An action that no longer exists keeps its old words.
  }
  return r;
}

/** A record (in her history or the saved diary log) that only a hedgehog could have lived. */
export const hedgehogRecord = (r: Completed) => hedgehogOnly(r.outcome) || hedgehogOnly(r.diary) || hedgehogOnly(r.detail) || hedgehogOnly(r.reason);

function safeLabel(key: string): string | null {
  try {
    return labelFor(key);
  } catch {
    return null;
  }
}

/**
 * Makes a hedgehog-era Khina a bunny. Runs once per save (it marks the state), and running the
 * rules again changes nothing. Returns whether anything was done. A new state is already a bunny.
 */
export function toBunny(s: State): boolean {
  // Dried beetles in the pantry of a bunny's save mean the hedgehog build ran on it again (a deploy
  // rolled back, then forward): it is brought over again, which also folds them into clover and lets
  // go of whatever hedgehog things that build wrote meanwhile. The rules are safe to run twice.
  const pantry = (s.pantry ?? {}) as Record<string, number>;
  const beetles = Math.max(0, Number(pantry.beetles) || 0);
  if (s.species === 'bunny' && beetles === 0) return false;

  // The pantry: dried beetles become dried clover. Old saves have a 'beetles' key and no 'clover'.
  // The key stays, at 0, so the hedgehog build can still read this save if a deploy is rolled back
  // (it adds up berries + beetles + crusts + peas); nothing today reads it.
  for (const f of FOOD_IDS) pantry[f] = Math.max(0, Number(pantry[f]) || 0);
  pantry.clover = (pantry.clover ?? 0) + beetles;
  pantry.beetles = 0;
  s.pantry = pantry as State['pantry'];
  // When she became a bunny: what she made, read or posted before then that only a hedgehog could
  // have stays in the save but is not shown or read back as hers (fromHedgehogDays).
  s.bunnySince = s.t;

  // Keys name actions, places and topics, so none is about beetles in practice; any that is becomes clover.
  renameKeys(s.tastes);
  renameKeys(s.evidence);
  renameKeys(s.familiarity);
  for (const m of s.memories ?? []) m.category = m.category.replace(/beetles?/gi, 'clover');

  // Finds on her shelf get their bunny names, like the finds still to come (an empty snail shell is now a hazelnut shell).
  s.finds = (s.finds ?? []).map((f) => ({ ...f, name: bunnyWords(f.name) })).filter((f) => !hedgehogOnly(f.name));

  // What only makes sense for a hedgehog is let go: thoughts, memories, recent history, night pages.
  s.thoughts = (s.thoughts ?? []).filter((th) => !hedgehogOnly(th.text));
  s.memories = (s.memories ?? []).filter((m) => !hedgehogOnly(m.text) && !hedgehogOnly(m.where));
  s.history = (s.history ?? []).filter((r) => !hedgehogRecord(r)).map(relabel);
  s.pages = (s.pages ?? []).filter((p) => !hedgehogOnly(p.text) && !hedgehogOnly(p.sheetLine));

  // Beliefs and earned sheet lines keep their evidence; their words are written again from today's labels.
  for (const b of s.beliefs ?? []) {
    const label = safeLabel(b.key);
    if (label) b.text = beliefText(b.key, b.polarity, () => label);
  }
  s.learned = (s.learned ?? []).flatMap((l) => {
    if (!hedgehogOnly(l.text)) return [l];
    const b = s.beliefs.find((x) => x.key === l.key);
    const label = safeLabel(l.key);
    if (!b || !label) return [];
    return [{ ...l, text: b.polarity === 'likes' ? `Has come to like ${label}.` : `Has gone off ${label}.` }];
  });

  // The village: finds and sights still to come, and letters not yet read, in bunny words.
  const w = s.world;
  w.findsLeft = w.findsLeft.map(bunnyWords);
  w.sightsLeft = w.sightsLeft.map(bunnyWords);
  w.used = [...new Set(w.used.map(bunnyWords))];
  w.letters = w.letters.map((l) => ({ ...l, text: bunnyWords(l.text) }));

  // Something she is in the middle of that only a hedgehog would do is dropped; she decides afresh.
  const a = s.activity;
  if (a && (hedgehogOnly(a.detail) || hedgehogOnly(a.reason))) s.activity = null;

  s.species = 'bunny';
  return true;
}

/** A save as the live server keeps it: the state and the last diary records. */
export interface SavedLife {
  s: State;
  log?: Completed[];
}

/**
 * Brings a whole save over: the state (toBunny) and, in the same one-time step, the saved diary log,
 * which feeds the diary, post and night prompts and the site's diary. Returns whether anything was done.
 */
export function migrateSave(saved: SavedLife): boolean {
  if (!toBunny(saved.s)) return false;
  saved.log = (saved.log ?? []).filter((r) => !hedgehogRecord(r)).map(relabel);
  return true;
}
