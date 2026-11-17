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
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { budget, cacheReadFactor, cacheWriteFactor, effort, models, prices, spendLedgerPath, webSearchUsd } from '../config.ts';
import type { Rng } from '../rng.ts';
import type { Completed, Reading, State } from '../state.ts';
import { stamp } from '../time.ts';
import type { Candidate, Mind, MindStats, Proposal, Sense } from './decide.ts';
import { checkPiece, checkReading, makePrompt, makeSystem, MAKE_SCHEMA, webPrompt, webSystem, WEB_SCHEMA, type PieceDraft, type PieceRequest } from './making.ts';
import { decidePrompt, DECIDE_SCHEMA, decideSystem, diaryPrompt, DIARY_SCHEMA, diarySystem, reflectSystem } from './prompts.ts';
import { reflectPrompt, REFLECT_SCHEMA, type ReflectInput, type ReflectOutput } from './sleep.ts';
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

/** Real money spent per real calendar day, shared by every run on this machine. */
/**
 * Shared by every run, including runs going on side by side, so it re-reads the file on every
 * check and every addition. Keeping a copy in memory let parallel runs overwrite each other's
 * spend and slip past the daily cap.
 */
class SpendLedger {
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

  /** The part of today's spend that went on real pieces and the internet. */
  extrasToday(): number {
    return this.load()[`${today()} extras`] ?? 0;
  }

  add(usd: number, extra = false): void {
    const data = this.load();
    const k = today();
    data[k] = (data[k] ?? 0) + usd;
    if (extra) data[`${k} extras`] = (data[`${k} extras`] ?? 0) + usd;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(data, null, 2));
  }
}

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

export interface ClaudeMindOptions {
  outDir: string;
  runCapUsd?: number;
  dailyCapUsd?: number;
  extrasCapUsd?: number;
  ledgerPath?: string;
}

export class ClaudeMind implements Mind {
  readonly kind = 'model' as const;
  private client = new Anthropic({ maxRetries: 2, timeout: 60_000 });
  private ledger: SpendLedger;
  private runCap: number;
  private dailyCap: number;
  private extrasCap: number;
  private outDir: string;
  private disabled: string | null = null;
  private pausedUntil = 0;
  private pausedWhy = '';
  private consecutiveFailures = 0;
  private s: MindStats = { calls: 0, failures: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  constructor(o: ClaudeMindOptions) {
    this.outDir = o.outDir;
    this.runCap = o.runCapUsd ?? budget.runUsd;
    this.dailyCap = o.dailyCapUsd ?? budget.dailyUsd;
    this.extrasCap = o.extrasCapUsd ?? budget.extrasUsd;
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
    return { ...this.s };
  }

  /**
   * Real pieces and the internet: only while the model is up and today's extras budget lasts.
   * The budget is let out through the day (plus a little head start), so a fast clock cannot
   * spend it all in the first hours after midnight and leave the rest of the day empty.
   */
  canWork(now = new Date()): boolean {
    return this.unavailable() === null && this.ledger.extrasToday() < extrasAllowance(this.extrasCap, now);
  }

  /** Makes a real piece. Returns the checked piece, or why it could not be made. */
  async makePiece(s: State, req: PieceRequest): Promise<PieceDraft | string> {
    if (!this.canWork()) return 'no budget for making today';
    const out = await this.call('make', s, makeSystem(s), makePrompt(req), MAKE_SCHEMA, 16000, { extra: true });
    if (!out.ok) return out.why;
    return checkPiece(out.json, req);
  }

  /** Looks something up on the web (search only, read-only). */
  async browse(s: State, question: string, onMind: string): Promise<Reading | string> {
    if (!this.canWork()) return 'no budget for the internet today';
    const out = await this.call('web', s, webSystem(s), webPrompt(question, onMind), WEB_SCHEMA, 8000, {
      extra: true,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }],
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
    return keepShort(line) || null;
  }

  /** Night jobs on the bigger model. Any failure returns null and code does the night alone. */
  async reflect(s: State, input: ReflectInput): Promise<ReflectOutput | null> {
    const out = await this.call('sleep', s, reflectSystem(s), reflectPrompt(s, input), REFLECT_SCHEMA, 6000);
    if (!out.ok) return null;
    const j = out.json as Record<string, unknown>;
    const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    return {
      page: String(j.page ?? ''),
      keep: strings(j.keep),
      drop: strings(j.drop),
      sheetLine: String(j.sheet_line ?? ''),
      evidence: String(j.evidence ?? ''),
    };
  }

  private async call(
    job: 'decide' | 'diary' | 'sleep' | 'make' | 'web',
    s: State,
    system: string,
    prompt: string,
    schema: Record<string, unknown>,
    maxTokens: number,
    o: { extra?: boolean; tools?: Anthropic.Messages.ToolUnion[] } = {},
  ): Promise<{ ok: true; json: unknown } | { ok: false; why: string }> {
    const model = models[job];
    const started = Date.now();
    const log: Record<string, unknown> = { at: stamp(s.t), t: s.t, job, model };
    appendFileSync(join(this.outDir, 'prompts.md'), `\n## ${stamp(s.t)} · ${job} · ${model}\n\n\`\`\`\n${prompt}\n\`\`\`\n`);
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
        this.record(c, res.usage, o.extra);
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
      if (t.kind === 'disable' || t.kind === 'no-money') this.disabled = t.why;
      if (t.kind === 'busy') this.pause(60_000, t.why);
      if (t.kind === 'offline') this.pause(20_000, t.why);
      return this.fail({ ...log, ms: Date.now() - started, error: t }, t.why);
    }
  }

  private record(cost: number, u: Usage, extra = false): void {
    this.s.calls += 1;
    this.s.costUsd += cost;
    this.s.inputTokens += u.input_tokens + (u.cache_creation_input_tokens ?? 0);
    this.s.outputTokens += u.output_tokens;
    this.s.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    this.ledger.add(cost, extra);
  }

  private pause(ms: number, why: string): void {
    this.pausedUntil = Date.now() + ms;
    this.pausedWhy = why;
  }

  private fail(log: Record<string, unknown>, why: string): { ok: false; why: string } {
    this.s.failures += 1;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 5 && !this.disabled) this.disabled = `${this.consecutiveFailures} failures in a row (last: ${why})`;
    this.write({ ...log, ok: false, why });
    return { ok: false, why };
  }

  private write(entry: Record<string, unknown>): void {
    appendFileSync(join(this.outDir, 'calls.jsonl'), `${JSON.stringify(entry)}\n`);
  }
}
