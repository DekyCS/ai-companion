// Keeping Khina going when things break: Claude rests and comes back instead of switching off for good,
// failures say why, the spend ledger and the save are written whole or not at all, the save has an
// hourly backup, and a save that can't be read never quietly becomes a new life.
// No API call anywhere: Claude is a stand-in client, and the live server runs on code alone.

import type Anthropic from '@anthropic-ai/sdk';
import { APIConnectionError, AuthenticationError, BadRequestError, InternalServerError, RateLimitError } from '@anthropic-ai/sdk';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { backoffMs, ClaudeMind, SpendLedger, type MessagesApi } from '../src/mind/claude.ts';
import { Rng } from '../src/rng.ts';
import { BACKUP_EVERY_MS, backupDue, backupPath, loadSave, parseSave, writeFileAtomic, writeSave, type Saved } from '../src/save.ts';
import { newState } from '../src/state.ts';

const MIN = 60_000;
const NOW = new Date(2026, 10, 20, 12, 0).getTime();
const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Not a real key: shaped like one, to check it never reaches a log line. */
const FAKE_KEY = 'sk-ant-api03-NOTAREALKEY0123456789-abcdef';

function tmp(name: string): string {
  return mkdtempSync(join(tmpdir(), `khina-${name}-`));
}

// ---------- Claude, with a stand-in client ----------

type Reply = 'ok' | 'refusal' | Error;

/** A stand-in for the API: answers from the list, in order ('ok' after it runs out), and counts the calls. */
function standIn(replies: Reply[]): MessagesApi & { asked: number } {
  const api = {
    asked: 0,
    messages: {
      create: async () => {
        api.asked += 1;
        const r = replies.shift() ?? 'ok';
        if (r instanceof Error) throw r;
        return {
          stop_reason: r === 'ok' ? 'end_turn' : 'refusal',
          usage: { input_tokens: 100, output_tokens: 20 },
          content: [{ type: 'text', text: JSON.stringify({ candidates: [] }) }],
        } as unknown as Anthropic.Messages.Message;
      },
    },
  };
  return api;
}

/** A Claude mind on a stand-in client, in a folder of its own, on a mocked clock; its log lines are kept. */
function mindWith(t: TestContext, replies: Reply[]) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const dir = tmp('claude');
  // Belt and braces: even if a real client were made, it would have a made-up key and an address that goes nowhere.
  const env = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };
  process.env.ANTHROPIC_API_KEY = 'not-a-real-key';
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';
  t.after(() => {
    if (env.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = env.key;
    if (env.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = env.base;
    rmSync(dir, { recursive: true, force: true });
  });
  const api = standIn(replies);
  const lines: string[] = [];
  const m = new ClaudeMind({ outDir: dir, ledgerPath: join(dir, 'spend.json'), dailyCapUsd: 1, client: api, onLine: (l) => lines.push(l) });
  const s = newState(1);
  // propose() does not look at unavailable() first (the sim does), so it also stands for a call already on its way.
  const ask = () => m.propose(s, [], new Rng(1));
  return { m, api, lines, ask, dir };
}

const err = (body: Record<string, unknown>) => ({ type: 'error', error: body });
const noCredit = () => new BadRequestError(400, err({ type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' }), undefined, new Headers());
const spendLimit = () => new RateLimitError(429, err({ type: 'rate_limit_error', message: 'Spend limit reached.', details: { error_code: 'enforced_spend_limit_reached' } }), undefined, new Headers());
const badKey = () => new AuthenticationError(401, err({ type: 'authentication_error', message: 'invalid x-api-key' }), undefined, new Headers());
const serverDown = () => new InternalServerError(500, err({ type: 'api_error', message: 'Internal server error' }), undefined, new Headers());

test('rest after failures in a row: 5 minutes, then 10, 20, 40, then an hour at most', () => {
  assert.deepEqual([1, 5, 6, 7, 8, 9, 10, 40].map((n) => backoffMs(n) / MIN), [5, 5, 10, 20, 40, 60, 60, 60]);
});

test('5 failures in a row rest Claude instead of switching it off; it is back after the rest, and a call that works starts the count again', async (t) => {
  const { m, api, lines, ask } = mindWith(t, ['refusal', 'refusal', 'refusal', 'refusal', 'refusal', 'refusal', 'ok', 'refusal']);
  for (let i = 1; i <= 4; i++) {
    assert.deepEqual(await ask(), { ok: false, why: 'model refused' });
    assert.equal(m.unavailable(), null, `${i} failure${i > 1 ? 's' : ''}: no reason to rest yet`);
  }
  await ask();
  assert.equal(m.unavailable(), 'paused: 5 failures in a row (last: model refused)');
  assert.match(lines.at(-1) ?? '', /✗ decide failed: model refused · 5 in a row, Claude rests 5 min$/);
  t.mock.timers.tick(5 * MIN - 1000);
  assert.notEqual(m.unavailable(), null);
  t.mock.timers.tick(1000);
  assert.equal(m.unavailable(), null, 'back after 5 minutes, with no redeploy');

  await ask();
  assert.match(lines.at(-1) ?? '', /6 in a row, Claude rests 10 min$/, 'failing again rests it twice as long');
  t.mock.timers.tick(10 * MIN - 1000);
  assert.notEqual(m.unavailable(), null);
  t.mock.timers.tick(1000);
  assert.equal(m.unavailable(), null);

  assert.deepEqual(await ask(), { ok: true, candidates: [] });
  await ask();
  assert.equal(m.unavailable(), null, 'one failure after a call that worked is not a streak');
  assert.equal(api.asked, 8);
  assert.equal(m.stats().failures, 7);
});

for (const [make, why] of [[noCredit, 'out of API credits'], [spendLimit, 'workspace spend limit reached']] as const) {
  test(`${why}: Claude rests and tries again, instead of staying off until a redeploy`, async (t) => {
    const { m, lines, ask } = mindWith(t, [make(), make()]);
    assert.deepEqual(await ask(), { ok: false, why });
    assert.equal(m.unavailable(), `paused: ${why}`, 'resting at once, without waiting for 5 failures');
    assert.match(lines.at(-1) ?? '', new RegExp(`✗ decide failed: ${why} · Claude rests 5 min$`));
    t.mock.timers.tick(5 * MIN);
    assert.equal(m.unavailable(), null, 'tries again after the rest: credits may have been topped up');
    await ask();
    assert.equal(m.unavailable(), `paused: ${why}`);
    t.mock.timers.tick(5 * MIN);
    assert.deepEqual(await ask(), { ok: true, candidates: [] }, 'credits back: Claude is back');
    assert.equal(m.unavailable(), null);
  });
}

test('a rejected key still switches Claude off for good: waiting would not mend it', async (t) => {
  const { m, lines, ask } = mindWith(t, [badKey()]);
  assert.deepEqual(await ask(), { ok: false, why: 'API key was rejected' });
  t.mock.timers.tick(24 * 60 * MIN);
  assert.equal(m.unavailable(), 'API key was rejected');
  assert.match(lines.at(-1) ?? '', /✗ decide failed: API key was rejected · Claude is off until the next deploy$/);
});

test("a short pause (rate limit, no connection) never cuts a longer rest short", async (t) => {
  const busy = new RateLimitError(429, err({ type: 'rate_limit_error', message: 'Too many requests.' }), undefined, new Headers());
  const { m, ask } = mindWith(t, ['refusal', 'refusal', 'refusal', 'refusal', 'refusal', 'ok', busy, new APIConnectionError({ message: 'Connection error.' }), serverDown()]);
  for (let i = 0; i < 5; i++) await ask();
  // A call that was already on its way works (the count starts again), then a rate limit and a lost connection.
  await ask();
  await ask();
  await ask();
  t.mock.timers.tick(2 * MIN);
  assert.match(m.unavailable() ?? '', /^paused: /, 'still in the 5-minute rest');
  t.mock.timers.tick(3 * MIN);
  assert.equal(m.unavailable(), null);
  await ask();
  assert.equal(m.unavailable(), 'paused: API error 500', 'a server error alone pauses a minute, as before');
  t.mock.timers.tick(MIN);
  assert.equal(m.unavailable(), null);
});

test('each failure is one line in the server log and one of the last 10 on /spend: the reason only, never a key or the prompt', async (t) => {
  const replies: Reply[] = [new Error(`header x-api-key ${FAKE_KEY} was malformed`), noCredit(), badKey()];
  for (let i = 0; i < 9; i++) replies.push('refusal');
  const { m, lines, ask, dir } = mindWith(t, replies);
  const first = await ask();
  assert.equal(first.ok, false);
  assert.ok(!first.ok && !first.why.includes('NOTAREALKEY'), 'the reason handed back to the sim has no key in it either');
  for (let i = 0; i < 11; i++) await ask();
  assert.equal(lines.length, 12, 'one line per failed call');
  const prompt = readFileSync(join(dir, 'prompts.md'), 'utf8');
  const promptLine = prompt.split('\n').find((l) => l.startsWith('It is '));
  assert.ok(promptLine, 'the prompt was written to the run folder as usual');
  for (const l of lines) {
    assert.match(l, /^ {10}✗ decide failed: \S/);
    assert.ok(!l.includes('NOTAREALKEY') && !l.includes(promptLine), l);
  }
  assert.match(lines[0] ?? '', /sk-ant-… was malformed/);
  const recent = m.recentFailures();
  assert.equal(recent.length, 10, 'the last 10 only');
  assert.deepEqual(recent.slice(0, 2).map((f) => f.why), ['API key was rejected', 'model refused'], 'oldest first, the first two gone');
  assert.ok(recent.every((f) => f.job === 'decide' && !Number.isNaN(Date.parse(f.at))));
  assert.ok(!JSON.stringify(recent).includes('NOTAREALKEY'));
  const calls = readFileSync(join(dir, 'calls.jsonl'), 'utf8');
  assert.ok(!calls.includes('NOTAREALKEY'), 'nor in the run folder');
});

// ---------- whole or not at all ----------

test('the spend ledger is written whole or not at all: a write that breaks leaves the old ledger as it was', () => {
  const dir = tmp('ledger');
  try {
    const path = join(dir, 'spend.json');
    const l = new SpendLedger(path);
    l.add(0.25);
    l.bump('posts');
    const before = readFileSync(path, 'utf8');
    assert.deepEqual(readdirSync(dir), ['spend.json'], 'no half-written copy left lying about');
    // Something in the way of the new copy (as a crash mid-write would leave things): the write fails...
    mkdirSync(`${path}.${process.pid}.tmp`);
    assert.throws(() => l.add(0.5));
    // ...and the ledger still has today's spend, where a torn file used to read as $0 spent.
    assert.equal(readFileSync(path, 'utf8'), before);
    assert.equal(l.spentToday(), 0.25);
    assert.equal(l.countToday('posts'), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeFileAtomic replaces the file in one step and leaves nothing behind', () => {
  const dir = tmp('atomic');
  try {
    const path = join(dir, 'deep', 'er', 'f.json');
    writeFileAtomic(path, 'one');
    writeFileAtomic(path, 'two');
    assert.equal(readFileSync(path, 'utf8'), 'two');
    assert.deepEqual(readdirSync(join(dir, 'deep', 'er')), ['f.json']);
    // A write that fails after its copy is made (here the rename: a folder is in the way, as a full disk
    // would fail the write) takes its half-made copy away with it.
    const blocked = join(dir, 'blocked');
    mkdirSync(join(blocked, 'in-the-way'), { recursive: true });
    assert.throws(() => writeFileAtomic(blocked, 'three'));
    assert.deepEqual(readdirSync(dir).sort(), ['blocked', 'deep'], 'no .tmp copy left behind');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- the save ----------

function life(t = 600): Saved {
  const s = newState(1);
  s.t = t;
  return { version: 1, seed: 1, epochMs: null, rate: 1, s, rngState: 12345, log: [] };
}

/** A save cut off mid-way, with a visitor's private note in the part that is still there. */
function torn(): string {
  const x = life() as unknown as { s: Record<string, unknown> };
  x.s.inbox = [{ id: 'n1', text: 'my secret garden gnome is called Mo' }];
  const text = JSON.stringify(x);
  return text.slice(0, Math.floor(text.length * 0.6));
}

test('loading: the save; its backup when the save is torn, empty or missing; nothing at all is a new life', () => {
  const dir = tmp('load');
  try {
    const path = join(dir, 'khina.json');
    assert.deepEqual(loadSave(path), { from: 'none' });

    writeFileSync(path, JSON.stringify(life(700)));
    const a = loadSave(path);
    assert.equal(a.from, 'save');
    assert.equal(a.from === 'save' && a.saved.s.t, 700);

    writeFileSync(backupPath(path), JSON.stringify(life(650)));
    writeFileSync(path, torn());
    const b = loadSave(path);
    assert.equal(b.from, 'backup');
    assert.ok(b.from === 'backup' && b.saved.s.t === 650 && b.path === backupPath(path));
    assert.match(b.from === 'backup' ? (b.trouble ?? '') : '', /not valid JSON \(\d+ bytes; cut off or damaged\)/);
    assert.ok(!JSON.stringify(b.from === 'backup' ? b.trouble : '').includes('gnome'), "the reason never quotes the file: unread notes are private");

    writeFileSync(path, '');
    const c = loadSave(path);
    assert.equal(c.from, 'backup');
    assert.match(c.from === 'backup' ? (c.trouble ?? '') : '', /the file is empty/);

    rmSync(path);
    assert.equal(loadSave(path).from, 'backup', 'the save gone but the backup there');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loading: a save that is there but can not be read, backup and all, is never taken for a new life', () => {
  const dir = tmp('unreadable');
  try {
    const path = join(dir, 'khina.json');
    writeFileSync(path, torn());
    const a = loadSave(path);
    assert.equal(a.from, 'unreadable', 'torn, and no backup');
    assert.match(a.from === 'unreadable' ? a.why : '', /khina\.json: not valid JSON.*khina\.json\.bak: missing/);
    writeFileSync(backupPath(path), '{"version":1,"s":');
    assert.equal(loadSave(path).from, 'unreadable', 'both torn');
    // A save from a newer build: rolling back must not start her over, nor write over it.
    writeFileSync(path, JSON.stringify({ ...life(), version: 2 }));
    rmSync(backupPath(path));
    const v = loadSave(path);
    assert.equal(v.from, 'unreadable');
    assert.match(v.from === 'unreadable' ? v.why : '', /a version 2 save \(this build reads version 1\)/);
    // Not even with an older build's backup that this build could read (a rollback within the hour):
    // starting from it would write over the newer save at the first save.
    writeFileSync(backupPath(path), JSON.stringify(life(650)));
    const w = loadSave(path);
    assert.equal(w.from, 'unreadable');
    assert.match(w.from === 'unreadable' ? w.why : '', /a newer build's save is never replaced from the backup/);
    assert.equal(typeof parseSave('{"version":1,"s":{},"log":{}}'), 'string', 'parts missing');
    assert.equal(typeof parseSave('[1,2]'), 'string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saving copies the save as it stood to .bak about once a real hour, and never copies a broken one over a good backup', () => {
  const dir = tmp('backup');
  try {
    const path = join(dir, 'data', 'khina.json');
    const bak = backupPath(path);
    const t = (p: string) => (JSON.parse(readFileSync(p, 'utf8')) as Saved).s.t;
    // The backup's age is its file time, so this test runs on the real clock.
    const at = Date.now();
    writeSave(path, life(1), at);
    assert.equal(existsSync(bak), false, 'nothing to back up before the first save');
    writeSave(path, life(2), at);
    assert.equal(t(bak), 1, 'the save as it stood went to the backup before the new one replaced it');
    writeSave(path, life(3), at + 5 * MIN);
    assert.equal(t(bak), 1, 'not again within the hour');
    assert.equal(t(path), 3);
    const old = (at - BACKUP_EVERY_MS) / 1000;
    utimesSync(bak, old, old);
    assert.equal(backupDue(path, at), true);
    writeSave(path, life(4), at);
    assert.equal(t(bak), 3, 'an hour on: backed up again');

    // The save torn (say, started from the backup because of it): the backup is kept, the save mended.
    writeFileSync(path, torn());
    utimesSync(bak, old, old);
    writeSave(path, life(5), at);
    assert.equal(t(bak), 3, 'the good backup was not replaced by the torn save');
    assert.equal(t(path), 5);
    assert.deepEqual(readdirSync(join(dir, 'data')).sort(), ['khina.json', 'khina.json.bak']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- the live server, on code alone ----------

/**
 * A port nothing is listening on: the system hands one out, and it is let go again for the server. A
 * random port failed now and then when something already had it, and `--port 0` can't ask the system
 * there (live.ts reads 0 as "the default port").
 */
function freePort(): Promise<string> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(String(port)));
    });
  });
}

/** Runs the live server (code-only brain, game clock) on a save in `dir`; resolves when `until` says so or it exits. */
async function runLive(dir: string, persist: string, until: (out: string) => boolean): Promise<{ code: number | null; out: string; kill: () => Promise<number | null> }> {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.PORT;
  const port = await freePort();
  const child = spawn(process.execPath, [join(ROOT, 'src', 'live.ts'), '--persist', persist, '--port', port, '--quiet'], { cwd: dir, env });
  let out = '';
  // 'close', not 'exit': by then everything it printed has been read.
  const exited = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));
  const kill = async () => {
    child.kill('SIGTERM');
    return exited;
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the live server did not get there in time:\n${out}`));
    }, 30_000);
    const look = (b: Buffer) => {
      out += b.toString();
      if (until(out)) {
        clearTimeout(timer);
        resolve({ code: null, out, kill });
      }
    };
    child.stdout.on('data', look);
    child.stderr.on('data', look);
    void exited.then((code) => {
      clearTimeout(timer);
      resolve({ code, out, kill });
    });
  });
}

test('live: a save that can not be read, backup and all, stops the server (exit 1) and leaves both files as they were', async () => {
  const dir = tmp('live-stop');
  try {
    const data = join(dir, 'data');
    mkdirSync(data);
    const persist = join(data, 'khina.json');
    const broken = torn();
    writeFileSync(persist, broken);
    writeFileSync(backupPath(persist), '');
    const r = await runLive(dir, persist, () => false);
    assert.equal(r.code, 1);
    assert.match(r.out, /Khina's save can't be read: .*not valid JSON.*the file is empty/);
    assert.match(r.out, /Not starting a new life over it/);
    assert.doesNotMatch(r.out, /gnome/);
    assert.equal(readFileSync(persist, 'utf8'), broken);
    assert.equal(readFileSync(backupPath(persist), 'utf8'), '');
    assert.deepEqual(readdirSync(data).sort(), ['khina.json', 'khina.json.bak']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live: a torn save is picked up from the backup, the torn file is kept to look at, and the next save is whole again', async () => {
  const dir = tmp('live-backup');
  try {
    const data = join(dir, 'data');
    mkdirSync(data);
    const persist = join(data, 'khina.json');
    const broken = torn();
    const good = JSON.stringify(life(650));
    writeFileSync(persist, broken);
    writeFileSync(backupPath(persist), good);
    // An old backup, so the save on the way out is due one: it must not copy the torn save over it.
    const old = (Date.now() - 2 * BACKUP_EVERY_MS) / 1000;
    utimesSync(backupPath(persist), old, old);
    const r = await runLive(dir, persist, (out) => out.includes('Open http'));
    assert.equal(r.code, null, r.out);
    assert.match(r.out, /picked up from the backup .*khina\.json\.bak instead, the broken file is kept as .*khina\.json\.unreadable/);
    assert.match(r.out, /picked up from the last save/);
    assert.equal(await r.kill(), 0, 'SIGTERM saves and exits cleanly');
    assert.equal(readFileSync(`${persist}.unreadable`, 'utf8'), broken);
    assert.equal(readFileSync(backupPath(persist), 'utf8'), good, 'the good backup is untouched');
    const now = loadSave(persist);
    assert.equal(now.from, 'save', 'the save is whole again');
    assert.ok(now.from === 'save' && now.saved.s.t >= 650, 'and it carries on her life from the backup, not a new one');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
