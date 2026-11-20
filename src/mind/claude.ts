// Talks to the Claude API. Every call is logged, priced and checked against the spend caps.
// When anything goes wrong the caller falls back to code, so Khina never stops living.

import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { budget, cacheReadFactor, cacheWriteFactor, effort, models, postsPerDay, prices, spendLedgerPath, webSearchUsd } from '../config.ts';
import type { Rng } from '../rng.ts';
import { NOTE, NOTES_SCHEMA, notesPrompt, notesSystem, redactNotes, type NotesAnswer } from '../notes.ts';
import { writeFileAtomic } from '../save.ts';
import type { Completed, Note, PieceRef, Reading, State } from '../state.ts';
import { stamp } from '../time.ts';
import type { Candidate, Mind, MindStats, Proposal, Sense } from './decide.ts';
import { checkPiece, checkReading, cleanPost, makePrompt, makeSystem, MAKE_SCHEMA, postPrompt, postSystem, POST_SCHEMA, webPrompt, webSystem, WEB_SCHEMA, type PieceDraft, type PieceRequest } from './making.ts';
import { decidePrompt, DECIDE_SCHEMA, decideSystem, diaryPrompt, DIARY_SCHEMA, diarySystem, HEDGEHOG_SELF, reflectSystem } from './prompts.ts';
import { reflectPrompt, reflectSchema, type ReflectInput, type ReflectOutput } from './sleep.ts';
import type { Option } from './score.ts';

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export function costOf(model: string, u: Usage): number {
  const p = prices[model];
  if (!p) return 0;
  const cw = u.cache_creation_input_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0;
  const searches = (u.server_tool_use?.web_search_requests ?? 0) * webSearchUsd;
  return (u.input_tokens * p.input + cw * p.input * cacheWriteFactor + cr * p.input * cacheReadFactor + u.output_tokens * p.output) / 1e6 + searches;
}

/** The prompt asks for 2 sentences; models overrun, so code enforces it. */
export function keepShort(line: string, maxSentences = 2, maxWords = 45): string {
  const sentences = line.match(/[^.?]+[.?]+["']?|[^.?]+$/g)?.map((x) => x.trim()) ?? [line];
  if (sentences.length <= maxSentences && line.split(' ').length <= maxWords) return line;
  return sentences.slice(0, maxSentences).join(' ');
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** How much of today's extras budget may be spent by `now`: an even share per hour, 1.5 hours ahead. */
export function extrasAllowance(cap: number, now: Date): number {
  const hours = now.getHours() + now.getMinutes() / 60;
  return cap * Math.min(1, (hours + 1.5) / 24);
}

/**
 * May she sit down with visitors' notes now? Today's notes spend and sittings so far, against the
 * notes cap and NOTE.readsPerDay, both let out through the day so they can't all go in the morning.
 */
export function notesOpen(spentUsd: number, reads: number, capUsd: number, now: Date): boolean {
  return spentUsd < extrasAllowance(capUsd, now) && reads < Math.ceil(extrasAllowance(NOTE.readsPerDay, now) - 1e-9);
}

/** Real money spent per real calendar day, shared by every run on this machine. */
/**
 * Shared by every run, including runs going on side by side, so it re-reads the file on every
 * check and every addition. Keeping a copy in memory let parallel runs overwrite each other's
 * spend and slip past the daily cap. Every write is whole or not at all (writeFileAtomic): a crash
 * mid-write used to leave half a file, which reads as empty, so today's spend began again at $0.
 */
export class SpendLedger {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  private load(): Record<string, number> {
    try {
      return existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : {};
    } catch {
      return {};
    }
  }

  spentToday(): number {
    return this.load()[today()] ?? 0;
  }

  /** The part of today's spend that went on one pot: real pieces and the internet, or visitors' notes. */
  potToday(pot: Pot): number {
    return this.load()[`${today()} ${pot}`] ?? 0;
  }

  /** How many of a counted thing (e.g. posts) happened today. */
  countToday(name: string): number {
    return this.load()[`${today()} ${name}`] ?? 0;
  }

  bump(name: string): void {
    const data = this.load();
    const k = `${today()} ${name}`;
    data[k] = (data[k] ?? 0) + 1;
    writeFileAtomic(this.path, JSON.stringify(data, null, 2));
  }

  /** Adds to today's spend, and to one pot inside it ("<date> extras" or "<date> notes"). */
  add(usd: number, pot?: Pot): void {
    const data = this.load();
    const k = today();
    data[k] = (data[k] ?? 0) + usd;
    if (pot) data[`${k} ${pot}`] = (data[`${k} ${pot}`] ?? 0) + usd;
    writeFileAtomic(this.path, JSON.stringify(data, null, 2));
  }
}

/** Budgets inside the daily cap: real pieces and the internet ('extras'), and reading visitors' notes. */
export type Pot = 'extras' | 'notes';

type Trouble = { kind: 'disable' | 'no-money' | 'busy' | 'offline' | 'other'; why: string };

function classify(err: unknown): Trouble {
  if (err instanceof AuthenticationError) return { kind: 'disable', why: 'API key was rejected' };
  if (err instanceof PermissionDeniedError) return { kind: 'disable', why: 'API key is not allowed to use this model' };
  if (err instanceof RateLimitError) {
    return err.errorCode === 'enforced_spend_limit_reached'
      ? { kind: 'no-money', why: 'workspace spend limit reached' }
      : { kind: 'busy', why: 'rate limited' };
  }
  if (err instanceof BadRequestError) {
    return /credit balance|usage limit/i.test(err.message)
      ? { kind: 'no-money', why: 'out of API credits' }
      : { kind: 'other', why: `bad request: ${err.message.slice(0, 160)}` };
  }
  if (err instanceof APIConnectionError) return { kind: 'offline', why: 'no connection to the API' };
  if (err instanceof APIError) {
    if (err.status === 402) return { kind: 'no-money', why: 'payment required' };
    return { kind: 'busy', why: `API error ${err.status ?? ''}`.trim() };
  }
  return { kind: 'other', why: err instanceof Error ? err.message.slice(0, 160) : String(err) };
}

/** Failures in a row before Claude rests; out of money, it rests at once. */
export const FAILS_BEFORE_REST = 5;

/**
 * How long Claude rests after the n-th failure in a row: 5 minutes, then twice as long each time it
 * fails again (10, 20, 40), at most an hour. Until 2026-11-20, 5 failures in a row or an empty purse
 * switched Claude off until the next redeploy, though such trouble is usually over within the hour.
 */
export function backoffMs(n: number): number {
  return Math.min(3_600_000, 300_000 * 2 ** Math.max(0, n - FAILS_BEFORE_REST));
}

/** A failed call as /spend shows it: when (real time), which job, and why. */
export interface FailureNote {
  at: string;
  job: string;
  why: string;
}

/** Anything shaped like an API key is cut out of a reason before it is logged or shown. */
const scrub = (why: string) => why.replace(/sk-ant-[\w-]+/g, 'sk-ant-…');

/** The one API method Khina's mind uses; tests hand in a stand-in, so they never reach the API. */
export interface MessagesApi {
  messages: { create(body: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Messages.Message> };
}

export interface ClaudeMindOptions {
  outDir: string;
  runCapUsd?: number;
  dailyCapUsd?: number;
  extrasCapUsd?: number;
  notesCapUsd?: number;
  ledgerPath?: string;
  /** The API client; by default the real one. */
  client?: MessagesApi;
  /** Where a failed call's one line goes; by default the console (the server log). */
  onLine?: (line: string) => void;
}

export class ClaudeMind implements Mind {
  readonly kind = 'model' as const;
  private client: MessagesApi;
  private onLine: (line: string) => void;
  private ledger: SpendLedger;
  private runCap: number;
  private dailyCap: number;
  private extrasCap: number;
  private notesCap: number;
  private outDir: string;
  private disabled: string | null = null;
  private pausedUntil = 0;
  private pausedWhy = '';
  private consecutiveFailures = 0;
  /** The last 10 failed calls, newest last. */
  private lastFailures: FailureNote[] = [];
  private s: MindStats = { calls: 0, failures: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  constructor(o: ClaudeMindOptions) {
    this.client = o.client ?? new Anthropic({ maxRetries: 2, timeout: 60_000 });
    this.onLine = o.onLine ?? ((line) => console.log(line));
    this.outDir = o.outDir;
    this.runCap = o.runCapUsd ?? budget.runUsd;
    this.dailyCap = o.dailyCapUsd ?? budget.dailyUsd;
    this.extrasCap = o.extrasCapUsd ?? budget.extrasUsd;
    this.notesCap = o.notesCapUsd ?? budget.notesUsd;
    this.ledger = new SpendLedger(o.ledgerPath ?? spendLedgerPath);
    mkdirSync(this.outDir, { recursive: true });
  }

  unavailable(): string | null {
    if (this.disabled) return this.disabled;
    if (this.s.costUsd >= this.runCap) return `run spend cap reached ($${this.runCap.toFixed(2)})`;
    if (this.ledger.spentToday() >= this.dailyCap) return `daily spend cap reached ($${this.dailyCap.toFixed(2)})`;
    if (Date.now() < this.pausedUntil) return `paused: ${this.pausedWhy}`;
    return null;
  }

  stats(): MindStats {
    return { ...this.s, byJob: structuredClone(this.s.byJob ?? {}) };
  }

  /** The last 10 failed calls (real time, job, why), for the live server's /spend. */
  recentFailures(): FailureNote[] {
    return this.lastFailures.map((f) => ({ ...f }));
  }

  /**
   * Real pieces and the internet: only while the model is up and today's extras budget lasts.
   * The budget is let out through the day (plus a little head start), so a fast clock cannot
   * spend it all in the first hours after midnight and leave the rest of the day empty.
   */
  canWork(now = new Date()): boolean {
    return this.unavailable() === null && this.ledger.potToday('extras') < extrasAllowance(this.extrasCap, now);
  }

  /** Makes a real piece. Returns the checked piece, or why it could not be made. */
  async makePiece(s: State, req: PieceRequest): Promise<PieceDraft | string> {
    if (!this.canWork()) return 'no budget for making today';
    const out = await this.call('make', s, makeSystem(s), makePrompt(req), MAKE_SCHEMA, 16000, { pot: 'extras' });
    if (!out.ok) return out.why;
    return checkPiece(out.json, req);
  }

  budgetToday(now = new Date()) {
    const r = (x: number) => +x.toFixed(4);
    return {
      spent: r(this.ledger.spentToday()),
      cap: this.dailyCap,
      extras: r(this.ledger.potToday('extras')),
      extrasAllowedNow: r(extrasAllowance(this.extrasCap, now)),
      extrasCap: this.extrasCap,
      posts: this.ledger.countToday('posts'),
      notes: r(this.ledger.potToday('notes')),
      notesAllowedNow: r(extrasAllowance(this.notesCap, now)),
      notesCap: this.notesCap,
      noteReads: this.ledger.countToday('note-reads'),
    };
  }

  /**
   * Visitors' notes: while the model is up, today's notes budget (let out through the day, like the
   * extras) lasts, and fewer than NOTE.readsPerDay sittings have happened, also let out through the day,
   * so she reads a few times a day rather than all in the morning.
   */
  canReadNotes(now = new Date()): boolean {
    return this.unavailable() === null && notesOpen(this.ledger.potToday('notes'), this.ledger.countToday('note-reads'), this.notesCap, now);
  }

  /**
   * One Haiku call for a sitting with a few notes. Code checks everything it says (src/notes.ts
   * checkNotes). Room for a long answer (code cuts the replies anyway), so a note can't get every sitting
   * cut off.
   */
  async readNotes(s: State, notes: Note[], recentLines: string[], waiting: number): Promise<NotesAnswer | string> {
    if (!this.canReadNotes()) return 'no notes budget today';
    const paid = this.s.calls;
    const out = await this.call('notes', s, notesSystem(s), notesPrompt(notes, recentLines, waiting), NOTES_SCHEMA, 1200, { pot: 'notes' });
    // Every sitting the API answered counts towards the day's sittings, a failed one too: otherwise a
    // note that makes every sitting fail would get as many paid tries as it liked.
    if (this.s.calls > paid) this.ledger.bump('note-reads');
    if (!out.ok) return out.why;
    return typeof out.json === 'object' && out.json !== null ? (out.json as NotesAnswer) : 'the answer was not an object';
  }

  /** A few short public posts a day, while the model is up. */
  canPost(now = new Date()): boolean {
    // Spread through the day like the extras budget: one at midnight, the rest every few hours.
    return this.unavailable() === null && this.ledger.countToday('posts') < Math.ceil(extrasAllowance(postsPerDay, now) - 1e-9);
  }

  /** Writes a short public post. Code checks it (no links, mentions, selling) before anyone sees it. */
  async writePost(s: State, about: string, recentLines: string[], latest: PieceRef | undefined, hoursAgo: number | null): Promise<{ text: string; sharePiece: boolean } | string> {
    if (!this.canPost()) return 'no posts left today';
    const out = await this.call('post', s, postSystem(s), postPrompt(about, recentLines, latest, hoursAgo), POST_SCHEMA, 600);
    if (!out.ok) return out.why;
    const j = (out.json ?? {}) as { text?: unknown; sharePiece?: unknown };
    const text = cleanPost(j.text);
    if (!text) return 'the post did not pass the checks';
    this.ledger.bump('posts');
    return { text, sharePiece: j.sharePiece === true && !!latest };
  }

  /** Looks something up on the web (search only, read-only). */
  async browse(s: State, question: string, onMind: string): Promise<Reading | string> {
    if (!this.canWork()) return 'no budget for the internet today';
    const out = await this.call('web', s, webSystem(s), webPrompt(question, onMind), WEB_SCHEMA, 8000, {
      pot: 'extras',
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 1 }],
    });
    if (!out.ok) return out.why;
    return checkReading(out.json, question, s.t);
  }

  async propose(s: State, list: Option[], rng: Rng): Promise<Proposal> {
    const prompt = decidePrompt(s, list, rng);
    const out = await this.call('decide', s, decideSystem(s), prompt, DECIDE_SCHEMA, 2000);
    if (!out.ok) return out;
    const raw = (out.json as { candidates?: unknown }).candidates;
    if (!Array.isArray(raw)) return { ok: false, why: 'answer had no candidates' };
    const candidates: Candidate[] = raw
      .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
      .map((c) => ({
        action: String(c.action ?? ''),
        reason: String(c.reason ?? ''),
        weight: Number(c.weight ?? 1),
        detail: String(c.detail ?? ''),
        place: String(c.place ?? ''),
        kind: String(c.kind ?? ''),
      }));
    return { ok: true, candidates };
  }

  async narrate(s: State, rec: Completed, recentLines: string[], sense: Sense): Promise<string | null> {
    if (this.unavailable()) return null;
    const out = await this.call('diary', s, diarySystem(s), diaryPrompt(s, rec, recentLines, sense), DIARY_SCHEMA, 800);
    if (!out.ok) return null;
    const line = String((out.json as { line?: unknown }).line ?? '')
      .replace(/\s+/g, ' ')
      .replace(/!/g, '.')
      .replace(/^["']|["']$/g, '')
      .trim();
    // A line that gives her spines again is left to code's own words.
    if (HEDGEHOG_SELF.test(line)) return null;
    return keepShort(line) || null;
  }

  /** Night jobs on the bigger model. Any failure returns null and code does the night alone. */
  async reflect(s: State, input: ReflectInput): Promise<ReflectOutput | null> {
    // The schema with an ask only on a night she may ask the Keeper; otherwise exactly as before.
    const out = await this.call('sleep', s, reflectSystem(s), reflectPrompt(s, input), reflectSchema(input), 6000);
    if (!out.ok) return null;
    const j = out.json as Record<string, unknown>;
    const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    const ask = input.asks && typeof j.ask === 'object' && j.ask !== null ? (j.ask as Record<string, unknown>) : null;
    return {
      page: String(j.page ?? ''),
      keep: strings(j.keep),
      drop: strings(j.drop),
      sheetLine: String(j.sheet_line ?? ''),
      evidence: String(j.evidence ?? ''),
      ...(ask ? { ask: { text: String(ask.text ?? ''), why: String(ask.why ?? '') } } : {}),
    };
  }

  private async call(
    job: 'decide' | 'diary' | 'sleep' | 'make' | 'web' | 'post' | 'notes',
    s: State,
    system: string,
    prompt: string,
    schema: Record<string, unknown>,
    maxTokens: number,
    o: { pot?: Pot; tools?: Anthropic.Messages.ToolUnion[] } = {},
  ): Promise<{ ok: true; json: unknown } | { ok: false; why: string }> {
    const model = models[job];
    const started = Date.now();
    const log: Record<string, unknown> = { at: stamp(s.t), t: s.t, job, model };
    // Visitors' notes are private until answered: the run's prompts.md keeps their ids and lengths only.
    const kept = job === 'notes' ? redactNotes(prompt) : prompt;
    appendFileSync(join(this.outDir, 'prompts.md'), `\n## ${stamp(s.t)} · ${job} · ${model}\n\n\`\`\`\n${kept}\n\`\`\`\n`);
    try {
      const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: prompt }];
      let res: Anthropic.Messages.Message | null = null;
      let cost = 0;
      // A server-tool turn (web search) can pause; send it back so the server carries on.
      for (let turn = 0; turn < 3; turn++) {
        res = await this.client.messages.create({
          model,
          max_tokens: maxTokens,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages,
          ...(o.tools ? { tools: o.tools } : {}),
          output_config: { effort: effort[job], format: { type: 'json_schema', schema } },
        });
        const c = costOf(model, res.usage);
        cost += c;
        this.record(c, res.usage, o.pot, job);
        if (res.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: res.content });
      }
      if (!res) return this.fail(log, 'no answer');
      Object.assign(log, { ms: Date.now() - started, stop: res.stop_reason, usage: res.usage, costUsd: cost });

      if (res.stop_reason === 'refusal') return this.fail(log, 'model refused');
      if (res.stop_reason === 'max_tokens') return this.fail(log, 'answer was cut off');
      if (res.stop_reason === 'pause_turn') return this.fail(log, 'search took too long');
      // With tools, the JSON answer is the text after the last tool result.
      const lastTool = res.content.map((b) => b.type !== 'text').lastIndexOf(true);
      const text = res.content
        .slice(lastTool + 1)
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return this.fail({ ...log, text }, 'answer was not valid JSON');
      }
      this.consecutiveFailures = 0;
      this.write({ ...log, ok: true, output: json });
      return { ok: true, json };
    } catch (err) {
      const t = classify(err);
      // A rejected key, or a model the key may not use, won't mend by waiting: off until the next deploy.
      if (t.kind === 'disable') this.disabled = scrub(t.why);
      if (t.kind === 'busy') this.pause(60_000, t.why);
      if (t.kind === 'offline') this.pause(20_000, t.why);
      return this.fail({ ...log, ms: Date.now() - started, error: { ...t, why: scrub(t.why) } }, t.why, t.kind);
    }
  }

  private record(cost: number, u: Usage, pot: Pot | undefined, job = '?'): void {
    this.s.calls += 1;
    const j = ((this.s.byJob ??= {})[job] ??= { calls: 0, usd: 0 });
    j.calls += 1;
    j.usd += cost;
    this.s.costUsd += cost;
    this.s.inputTokens += u.input_tokens + (u.cache_creation_input_tokens ?? 0);
    this.s.outputTokens += u.output_tokens;
    this.s.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    this.ledger.add(cost, pot);
  }

  /** A pause never shortens one already running: a rate limit's minute can't cut a long rest short. */
  private pause(ms: number, why: string): void {
    const until = Date.now() + ms;
    if (until <= this.pausedUntil) return;
    this.pausedUntil = until;
    this.pausedWhy = why;
  }

  /**
   * Counts a failed call, rests Claude when it keeps failing or the money is gone (backoffMs), and says
   * so in one line of the server log, with the reason only: never a key, never the prompt.
   */
  private fail(log: Record<string, unknown>, reason: string, kind?: Trouble['kind']): { ok: false; why: string } {
    const why = scrub(reason);
    const job = String(log.job ?? '?');
    this.s.failures += 1;
    const n = (this.consecutiveFailures += 1);
    let then = '';
    if (kind === 'disable') then = ' · Claude is off until the next deploy';
    else if (kind === 'no-money' || n >= FAILS_BEFORE_REST) {
      const ms = backoffMs(n);
      this.pause(ms, n >= FAILS_BEFORE_REST ? `${n} failures in a row (last: ${why})` : why);
      then = ` · ${n >= FAILS_BEFORE_REST ? `${n} in a row, ` : ''}Claude rests ${Math.round(ms / 60_000)} min`;
    }
    this.lastFailures = [...this.lastFailures, { at: new Date().toISOString(), job, why }].slice(-10);
    this.onLine(`${' '.repeat(10)}✗ ${job} failed: ${why}${then}`);
    this.write({ ...log, ok: false, why });
    return { ok: false, why };
  }

  private write(entry: Record<string, unknown>): void {
    appendFileSync(join(this.outDir, 'calls.jsonl'), `${JSON.stringify(entry)}\n`);
  }
}
