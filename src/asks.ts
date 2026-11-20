// Khina asks: things she wants that only a human can do (make an account, add a place or a tool to
// the village). At night the model may ask for one; code paces it by the real clock (fewer than 3 open,
// none in the last 12 real hours) and cleans it. The Keeper, the human who looks after the village,
// answers on the site, and the answer comes back to her in the world, as a letter in her letterbox.
// Asks are public; only whoever holds KHINA_KEEPER_KEY can answer them.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { POST_NEVER } from './mind/making.ts';
import { HEDGEHOG_SELF } from './mind/prompts.ts';
import { ASK_ANSWERS, type Ask, type AskAnswer, type State } from './state.ts';

export const ASK = {
  /** Open asks at one time: the Keeper reads them once a day, so a few is plenty. */
  maxOpen: 3,
  /** Real time between asks. At 24× the night page comes about 24 times a real day; this keeps asks to 2. */
  everyMs: 12 * 3_600_000,
  /** Asks kept in the save (the oldest answered ones go first). */
  keep: 30,
  /** Asks shown on the site (open ones always are). */
  show: 20,
  /** Answered asks read back to her at night, so she does not ask again. */
  remind: 5,
  textMax: 200,
  whyMax: 160,
  noteMax: 300,
  /** Largest answer the server reads, in bytes. */
  bodyMax: 2048,
  /** Shortest KHINA_KEEPER_KEY that turns answering on: a short one could be guessed. */
  keyMin: 24,
  /** Wrong keys from one address in `wrongWindowMs` before that address is shut out for `lockMs`. */
  wrongMax: 20,
  /** Wrong keys from everyone together before the door shuts for everyone, the Keeper included: high,
   * so one troll can't keep the Keeper out (a key of 24+ random characters can't be guessed online). */
  wrongMaxAll: 200,
  wrongWindowMs: 10 * 60_000,
  lockMs: 10 * 60_000,
  /** Addresses remembered at once; past it, the ones with nothing recent are forgotten. */
  guardIps: 2000,
};

export const openAsks = (s: State): Ask[] => (s.asks ?? []).filter((a) => a.status === 'open');

/** May she ask the Keeper for something tonight? `now` is the real clock (epoch ms), passed in for tests. */
export function askAllowed(s: State, now: number): boolean {
  const asks = s.asks ?? [];
  return openAsks(s).length < ASK.maxOpen && !asks.some((a) => now - a.at < ASK.everyMs);
}

/** What she is shown at night: what is still open, and the last few answers with the Keeper's words. */
export function askContext(s: State): { open: Ask[]; answered: Ask[] } {
  const answered = (s.asks ?? []).filter((a) => a.status !== 'open').sort((a, b) => (a.answeredAt ?? 0) - (b.answeredAt ?? 0));
  return { open: openAsks(s), answered: answered.slice(-ASK.remind) };
}

// ---------- cleaning what the model asks for ----------

const CONTROL = /[\u0000-\u001f\u007f]/g;
/** Whole email addresses, taken out before links so no "name@" is left behind. */
const EMAIL = /\S+@\S+/g;
const LINK = /https?:\/\/\S+|www\.\S+/gi;
/** Never money, nor anything bought: the Keeper is not a wallet. (POST_NEVER covers selling and crypto;
 * "bank" is left out, a stream has banks, and "invest" stops short of "investigate".) */
const MONEY = /\b(money|cash|pay|paid|paying|payment|dollars?|euros?|loan|invest(?:s|ed|ing|ment|ments|or|ors)?|stripe|paypal|venmo)\b/i;

/** At most `max` characters, never cutting an emoji or any other two-part character in half. */
const cut = (t: string, max: number) => Array.from(t).slice(0, max).join('');

function tidy(raw: unknown, max: number): string {
  let t = String(raw ?? '')
    .replace(CONTROL, ' ')
    .replace(EMAIL, '')
    .replace(LINK, '')
    .replace(/\b[a-z0-9-]+\.(com|net|org|io|app|xyz|ai|co|social)\b\S*/gi, '')
    .replace(/(^|\s)@[\w.-]+/g, '$1')
    .replace(/#(\w+)/g, '$1')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/!/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“]+|["”]+$/g, '')
    .trim();
  if (t.length > max) t = `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  return t;
}

/** Small words that say nothing about what is asked for. */
const STOP = new Set(
  'the and but for with from you your can could would will please some more little new that this there have like want need get make put give let one something thing over across into under near beside next our its may might just also'.split(' '),
);

function keyWords(t: string): Set<string> {
  return new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/s$/, '')),
  );
}

/**
 * Nearly the same ask in other words: the same words that matter, or at least two of them shared and
 * most of them. One shared word is not enough ("a bench by the stream" is not "a bench in the square").
 */
export function nearlySame(a: string, b: string): boolean {
  const A = keyWords(a);
  const B = keyWords(b);
  if (!A.size || !B.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  if (both === A.size && both === B.size) return true;
  return both >= 2 && (both / Math.max(A.size, B.size) >= 0.5 || both / Math.min(A.size, B.size) >= 0.7);
}

/**
 * The model's ask, made safe to show on the site, or null to let it go (silently): too short, about
 * money or selling, giving her a hedgehog's body again, or one she has already asked and is waiting on.
 */
export function cleanAsk(raw: { text?: unknown; why?: unknown } | null | undefined, open: Ask[]): { text: string; why: string } | null {
  if (!raw) return null;
  const text = tidy(raw.text, ASK.textMax);
  const why = tidy(raw.why, ASK.whyMax);
  if (text.split(' ').filter(Boolean).length < 3) return null;
  const both = `${text} ${why}`;
  if (POST_NEVER.test(both) || MONEY.test(both) || HEDGEHOG_SELF.test(both)) return null;
  if (open.some((a) => nearlySame(a.text, text))) return null;
  return { text, why };
}

/** Keeps the save small: at most ASK.keep asks, dropping the oldest answered ones first. */
export function trimAsks(asks: Ask[]): void {
  while (asks.length > ASK.keep) {
    const i = asks.findIndex((a) => a.status !== 'open');
    asks.splice(i >= 0 ? i : 0, 1);
  }
}

export function addAsk(s: State, a: { text: string; why: string }, now: number): Ask {
  const asks = (s.asks ??= []);
  let id = randomBytes(4).toString('hex');
  while (asks.some((x) => x.id === id)) id = randomBytes(4).toString('hex');
  const ask: Ask = { id, t: s.t, at: now, text: a.text, why: a.why, status: 'open' };
  asks.push(ask);
  trimAsks(asks);
  return ask;
}

/** For the site: every open ask, then the latest answered, newest first. */
export function asksForSite(s: State): Ask[] {
  const all = s.asks ?? [];
  return all.filter((a, i) => a.status === 'open' || i >= all.length - ASK.show).reverse();
}

// ---------- the Keeper answers ----------

/**
 * The server's key, or null when answering is off: unset, or shorter than ASK.keyMin, so a short or
 * reused password can't be guessed into it.
 */
export function serverKey(env: string | undefined): string | null {
  const k = env?.trim();
  return k && k.length >= ASK.keyMin ? k : null;
}

/** Is this the Keeper's key? Unset (or too short) on the server means nobody can answer. */
export function keeperKeyOk(given: string | undefined, expected: string | undefined): boolean {
  const want = serverKey(expected);
  if (!want || !given) return false;
  // Hashed first, so both buffers are the same length and the comparison takes as long whatever was sent.
  const a = createHash('sha256').update(given.trim()).digest();
  const b = createHash('sha256').update(want).digest();
  return timingSafeEqual(a, b);
}

/** Wrong keys lately, per address and for everyone, so guessing the key online gets nowhere. */
export interface KeyGuard {
  /** When each recent wrong key came, from anyone (epoch ms). */
  wrong: number[];
  /** Nobody can answer until then, the Keeper included: otherwise a lock would still tell a right guess. */
  lockedUntil: number;
  /** The same, per address (src/notes.ts clientIp). */
  byIp: Map<string, { wrong: number[]; lockedUntil: number }>;
}
export const newGuard = (): KeyGuard => ({ wrong: [], lockedUntil: 0, byIp: new Map() });

/** Addresses with no recent wrong key and no lock are forgotten once there are many. */
function tidyGuard(g: KeyGuard, now: number): void {
  if (g.byIp.size <= ASK.guardIps) return;
  for (const [ip, e] of g.byIp) if (now >= e.lockedUntil && !e.wrong.some((t) => now - t < ASK.wrongWindowMs)) g.byIp.delete(ip);
}

export interface AnswerResult {
  status: number;
  body: Record<string, unknown>;
  /** A line for the server console (a count of wrong keys, never the keys). */
  log?: string;
}

/**
 * The door before anything is read: null lets the Keeper in. Answering off on the server is 403 with
 * `off`, so the page can say so. No key at all is a plain 403 and counts for nothing (it is no guess).
 * After ASK.wrongMax wrong keys in ASK.wrongWindowMs from one address, that address gets 429 for
 * ASK.lockMs; after ASK.wrongMaxAll from everyone together, everyone does. `ip` null or missing is
 * one shared "unknown" address.
 */
export function keeperGate(g: KeyGuard, key: string | undefined, envKey: string | undefined, now: number, ip?: string | null): AnswerResult | null {
  if (!serverKey(envKey)) return { status: 403, body: { error: 'Answering is off on this server.', off: true } };
  if (!key?.trim()) return { status: 403, body: { error: 'Only the Keeper can answer.' } };
  const where = ip ?? 'unknown';
  const mine = g.byIp.get(where);
  if (now < g.lockedUntil || (mine && now < mine.lockedUntil)) return { status: 429, body: { error: 'Too many wrong keys. Try again later.' } };
  if (keeperKeyOk(key, envKey)) return null;
  tidyGuard(g, now);
  const e = mine ?? { wrong: [], lockedUntil: 0 };
  g.byIp.set(where, e);
  e.wrong = e.wrong.filter((t) => now - t < ASK.wrongWindowMs);
  e.wrong.push(now);
  g.wrong = g.wrong.filter((t) => now - t < ASK.wrongWindowMs);
  g.wrong.push(now);
  const minutes = ASK.wrongWindowMs / 60_000;
  let log = `✗ a wrong keeper key (${e.wrong.length} from that address, ${g.wrong.length} in all, in the last ${minutes} minutes)`;
  if (g.wrong.length >= ASK.wrongMaxAll) {
    g.lockedUntil = now + ASK.lockMs;
    g.wrong = [];
    log += `: answering is shut for everyone for ${ASK.lockMs / 60_000} minutes`;
  } else if (e.wrong.length >= ASK.wrongMax) {
    e.lockedUntil = now + ASK.lockMs;
    e.wrong = [];
    log += `: that address is shut out for ${ASK.lockMs / 60_000} minutes`;
  }
  return { status: 403, body: { error: 'Only the Keeper can answer.' }, log };
}

/** POST /asks/check: is this key good? 204 yes, 403 no, 503 answering is off, 429 shut for a while. */
export function checkRequest(g: KeyGuard, key: string | undefined, envKey: string | undefined, now: number, ip?: string | null): AnswerResult {
  const denied = keeperGate(g, key, envKey, now, ip);
  if (!denied) return { status: 204, body: {} };
  return denied.body.off ? { status: 503, body: denied.body } : denied;
}

const ANSWER_WORDS: Record<AskAnswer, string> = { done: 'done.', notnow: 'not now.', no: 'no, sorry.' };

/** The Keeper's letter, written by code: 'About "<her ask>": done. <the Keeper's note>'. */
export function keeperLetterText(ask: Ask): string {
  const what = ask.text.replace(/[\s.]+$/, '');
  const answer = ask.status === 'open' ? '' : ANSWER_WORDS[ask.status];
  return `About "${what}": ${answer}${ask.note ? ` ${ask.note}` : ''}`;
}

/**
 * The Keeper's note is public (the site, her diary, her night pages), so email addresses and links are
 * taken out in case one slips in, and it is cut by characters, never through the middle of an emoji.
 */
export function tidyNote(raw: unknown): string {
  const t = String(raw ?? '').replace(CONTROL, ' ').replace(EMAIL, '').replace(LINK, '').replace(/\s+/g, ' ').trim();
  return cut(t, ASK.noteMax).trim();
}

/** Records the answer and puts the Keeper's letter in her letterbox (keeper letters always get in). */
export function answerAsk(s: State, ask: Ask, status: AskAnswer, note: unknown, now: number): void {
  ask.status = status;
  ask.answeredAt = now;
  const n = tidyNote(note);
  if (n) ask.note = n;
  // What she asked and the note ride along, so reading it becomes a memory of this answer, not any answer.
  const about = { id: ask.id, status, text: ask.text, ...(ask.note ? { note: ask.note } : {}) };
  s.world.letters.push({ from: 'keeper', text: keeperLetterText(ask), t: s.t, ask: about });
  s.world.flagSeen = false;
}

/**
 * POST /asks/<id> with {status: 'done'|'notnow'|'no', note?}, header x-keeper-key. Pure, so tests
 * need no server: the live server reads the body (at most ASK.bodyMax) and sends back what this says.
 * Nothing changes unless the answer is 200. `guard` is the server's count of wrong keys (always
 * passed: without it there would be no limit on guessing).
 */
export function answerRequest(
  s: State,
  r: { id: string; key: string | undefined; envKey: string | undefined; body: string; now: number; guard: KeyGuard; ip?: string | null },
): AnswerResult {
  const denied = keeperGate(r.guard, r.key, r.envKey, r.now, r.ip);
  if (denied) return denied;
  if (Buffer.byteLength(r.body) > ASK.bodyMax) return { status: 413, body: { error: 'Too long.' } };
  let j: unknown;
  try {
    j = JSON.parse(r.body);
  } catch {
    return { status: 400, body: { error: 'Send JSON: {"status": "done" | "notnow" | "no", "note": "..."}' } };
  }
  if (typeof j !== 'object' || j === null || Array.isArray(j)) return { status: 400, body: { error: 'Send a JSON object.' } };
  const { status, note } = j as { status?: unknown; note?: unknown };
  if (!ASK_ANSWERS.includes(status as AskAnswer)) return { status: 400, body: { error: 'status must be done, notnow or no.' } };
  if (note !== undefined && note !== null && typeof note !== 'string') return { status: 400, body: { error: 'note must be text.' } };
  const ask = (s.asks ?? []).find((a) => a.id === r.id);
  if (!ask) return { status: 404, body: { error: 'No such ask.' } };
  if (ask.status !== 'open') return { status: 409, body: { error: 'Already answered.', ask } };
  answerAsk(s, ask, status as AskAnswer, note, r.now);
  return { status: 200, body: { ok: true, ask } };
}
