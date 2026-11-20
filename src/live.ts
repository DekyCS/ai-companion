// npm run live -- [--seed 1] [--speed 1] [--model] [--port 5174] [--max-spend 0.50]
//                  [--clock real] [--persist data/khina-state.json]
// Runs Khina's life as it happens and shows it in the browser at http://127.0.0.1:5174
// --speed is game minutes per real second: 1 = a day in 24 minutes, 60 = an hour a second,
// 0.0167 = real time. The brain is code only unless --model is given (Claude costs money,
// about $0.023 a game day, under the usual daily cap).
// --clock real paces Khina's clock by the real one: --rate 1 (default) is real time on the
// local wall clock (set TZ), so night is night; --rate 24 lives a Khina day every real hour.
// Khina still sleeps at Khina's night either way. --persist saves Khina's life every few minutes and on shutdown, and picks it up on
// start, catching up on the time missed. Hosting (Railway) sets PORT; then it listens on all
// interfaces. See Dockerfile.
// Khina's asks to the Keeper are in the snapshot for anyone to read; POST /asks/<id> answers one,
// only with the header x-keeper-key equal to KHINA_KEEPER_KEY (at least 24 characters; src/asks.ts).
// POST /asks/check says whether a key is good, so the page can tell before the Keeper types a note.
// Visitors' notes (src/notes.ts): POST /notes {name?, text, website?} leaves one (rate-limited by
// address and overall); GET /notes/mine?ids=a,b says how a browser's own notes are doing. Unread notes
// are private: GET /notes/inbox, POST /notes/inbox/clear?upto=<ms>, POST /notes/<id>/hide and
// POST /notes/<id>/show need the Keeper's key, like answering asks.

import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { budget } from './config.ts';
import { fromHedgehogDays, migrateSave } from './migrate.ts';
import { makeMind } from './minds.ts';
import { Rng } from './rng.ts';
import { Sim } from './sim.ts';
import { PieceStore } from './pieces.ts';
import { TOY_CSP } from './mind/making.ts';
import { makeOutlets, sendEverywhere } from './outlets.ts';
import { newState, type Ask, type Completed, type PieceRef, type Post, type Reading, type Reply, type State } from './state.ts';
import { ASK, answerRequest, asksForSite, checkRequest, keeperGate, newGuard, serverKey } from './asks.ts';
import { clearRequest, clientIp, hideRequest, inboxRequest, mineRequest, newNoteGate, NOTE, notesSnapshot, replyForSite, sendRequest, showRequest } from './notes.ts';
import { clock, dayOf, isDark, partOfDay, weekday } from './time.ts';
import { actionDef } from './world/actions.ts';
import { PLACES } from './world/places.ts';
import { TRAINS, bakeryOpen } from './world/village.ts';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '1' },
    speed: { type: 'string', default: '1' },
    model: { type: 'boolean', default: false },
    port: { type: 'string', default: '5174' },
    'max-spend': { type: 'string', default: String(budget.runUsd) },
    quiet: { type: 'boolean', default: false },
    clock: { type: 'string', default: 'game' },
    rate: { type: 'string', default: '1' },
    persist: { type: 'string' },
  },
});

const seed = Number(values.seed) || 1;
const realClock = values.clock === 'real';
/** With --clock real: Khina minutes per real minute (1 = real time). */
const rate = Math.min(1440, Math.max(0.1, Number(values.rate) || 1));
const speed = realClock ? rate / 60 : Math.min(600, Math.max(0.001, Number(values.speed) || 1));
const port = Number(process.env.PORT) || Number(values.port) || 5174;
const host = process.env.PORT ? '0.0.0.0' : '127.0.0.1';
const persistPath = values.persist ?? null;
const kind = values.model ? 'model' : 'offline';
if (kind === 'model' && !process.env.ANTHROPIC_API_KEY) {
  console.log('--model needs ANTHROPIC_API_KEY in .env');
  process.exit(1);
}
const stampNow = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const outDir = join('runs', `live-${stampNow}-seed${seed}-${kind}`);
const mind = makeMind(kind, { seed, runDir: outDir, capUsd: Number(values['max-spend']) || budget.runUsd });

// ---------- Khina's life, new or picked up from the last save ----------
interface Saved {
  version: 1;
  seed: number;
  /** Real time (ms) at game minute 0, when the clock follows the wall clock. */
  epochMs: number | null;
  /** Khina minutes per real minute when epochMs was set. */
  rate?: number;
  s: State;
  rngState: number;
  log: Completed[];
}
let saved: Saved | null = null;
if (persistPath && existsSync(persistPath)) {
  try {
    saved = JSON.parse(readFileSync(persistPath, 'utf8')) as Saved;
    if (saved.version !== 1) saved = null;
  } catch (err) {
    console.log(`Could not read ${persistPath}, starting a new life: ${(err as Error).message}`);
  }
}
/** Minutes since this week's Monday 00:00, local time (game minute 0 is a Monday midnight). */
function minutesIntoWeek(d: Date): number {
  return ((d.getDay() + 6) % 7) * 1440 + d.getHours() * 60 + d.getMinutes();
}
const s = saved?.s ?? newState(seed);
// Khina became a bunny on 2026-11-18; a save from her hedgehog days is brought over once, state and
// diary log together. The file as it was is kept next to it, untouched, in case it is ever wanted back.
if (saved && persistPath && migrateSave(saved)) {
  const kept = `${persistPath}.hedgehog.json`;
  if (!existsSync(kept)) copyFileSync(persistPath, kept);
  console.log(`Brought ${persistPath} over from Khina's hedgehog days: she is a bunny now (the old save is kept in ${kept}).`);
}
if (!saved && realClock) {
  s.t = minutesIntoWeek(new Date());
  s.lastNotable = s.t;
}
const rng = new Rng(seed);
if (saved) rng.state = saved.rngState;
// Khina minute t happens at real time epochMs + t / rate minutes. A save made at another rate
// is re-anchored at the current minute (no catching up across a change of pace).
const anchorNow = () => Date.now() - (s.t * 60_000) / rate;
let epochMs: number | null = null;
if (realClock) epochMs = saved?.epochMs != null && (saved.rate ?? 1) === rate ? saved.epochMs : anchorNow();

// Real pieces Khina makes live next to the save (on the server's volume), or in the run folder.
// Khina's posts go to these accounts too, if their keys are set; otherwise they stay on the site.
const outlets = values.model ? makeOutlets() : [];
const store = new PieceStore(persistPath ? join(dirname(persistPath), 'pieces') : join(outDir, 'pieces'));

const clients = new Set<ServerResponse>();
const sim = new Sim(s, {
  mind,
  rng,
  outDir,
  speedMs: 1000 / speed,
  pieces: store,
  asks: true,
  onLine: values.quiet ? undefined : (line) => console.log(line),
  onEvent: (e) => {
    if (e.type === 'tick') return;
    if (e.type === 'ask') broadcast('ask', { ask: askWithClock(e.ask as Ask) });
    if (e.type === 'reply') broadcast('reply', { reply: replyForSite(e.reply as Reply) });
    if (e.type === 'post') {
      const post = e.post as Post;
      broadcast('post', { post: withClock(post) });
      if (outlets.length)
        void sendEverywhere(outlets, post).then((sent) => {
          post.sent = sent;
          console.log(`          ✉ sent: ${Object.entries(sent).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
          broadcast('snap', { snap: snapshot(), event: { type: 'sent' } });
        });
    }
    if (e.type === 'piece') broadcast('piece', { piece: withClock(e.piece as PieceRef) });
    if (e.type === 'reading') broadcast('reading', { reading: withClock(e.reading as Reading) });
    broadcast('snap', { snap: snapshot(), event: brief(e) });
  },
});

function withClock<T extends { t: number }>(x: T): T & { clock: string } {
  return { ...x, clock: `${weekday(x.t).slice(0, 3)} ${clock(x.t)}` };
}
function askWithClock(a: Ask) {
  return { ...withClock(a), day: dayOf(a.t) };
}
if (saved) sim.log.push(...saved.log);

function save(): void {
  if (!persistPath) return;
  const data: Saved = { version: 1, seed, epochMs, rate, s: { ...s, rngState: rng.state }, rngState: rng.state, log: sim.log.slice(-80) };
  mkdirSync(dirname(persistPath), { recursive: true });
  const tmp = `${persistPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, persistPath);
}
if (persistPath) {
  setInterval(save, 5 * 60_000).unref();
  for (const sig of ['SIGTERM', 'SIGINT'] as const)
    process.on(sig, () => {
      save();
      process.exit(0);
    });
}

/** Everything the page needs to draw Khina right now. */
function snapshot() {
  const a = s.activity;
  const def = a ? actionDef(a.actionId) : null;
  return {
    t: s.t,
    speed,
    brain: mind.kind === 'model' ? 'Claude' : 'code only',
    clock: clock(s.t),
    day: dayOf(s.t),
    weekday: weekday(s.t),
    part: partOfDay(s.t),
    dark: isDark(s.t),
    weather: s.world.weather,
    bakeryOpen: bakeryOpen(s.t),
    mood: Math.round(s.mood),
    energy: Math.round(s.energy),
    needs: Object.fromEntries(Object.entries(s.needs).map(([k, v]) => [k, Math.round(v)])),
    place: s.place,
    activity:
      a && def
        ? {
            kind: a.kind,
            actionId: a.actionId,
            place: a.place,
            startedAt: a.startedAt,
            endsAt: a.endsAt,
            label: def.label,
            doing: def.doing,
            detail: a.detail,
            reason: a.reason,
            origin: a.origin,
            // A visitor's idea she took up: the name they gave, for a small chip on the site.
            ...(a.nudgedBy !== undefined ? { nudgedBy: a.nudgedBy } : {}),
          }
        : null,
    letters: s.world.letters.length,
    // Who is where this hour, so the page can show the villagers.
    present: s.world.present,
    // The timetable (minutes of the day the train stops at the halt), so the page can run the train.
    trains: TRAINS,
    diary: sim.log
      .filter((r) => r.diary)
      .slice(-40)
      .map((r) => ({ t: r.end, clock: clock(r.end), day: dayOf(r.end), text: r.diary, place: PLACES[r.place].short, actionId: r.actionId })),
    // Pieces, lookups and posts from her hedgehog days stay in the save, but visitors see only the
    // bunny's (as with the diary and the night pages, which the migration already cleaned).
    pieces: (s.pieces ?? []).filter((p) => !fromHedgehogDays(s, p.t, p.title)).slice(-12).map(withClock),
    readings: (s.readings ?? []).filter((r) => !fromHedgehogDays(s, r.t, `${r.question} ${r.learned}`)).slice(-8).map(withClock),
    posts: (s.posts ?? []).filter((p) => !fromHedgehogDays(s, p.t, `${p.text} ${p.about}`)).slice(-10).map(withClock),
    postsTo: outlets.map((o) => o.name),
    // Nights she wrote nothing (code alone, or a page turned away) leave no blank page on the site.
    pages: s.pages.filter((p) => p.text.trim()).slice(-5).map((p) => ({ day: p.day, text: p.text })),
    // What she asked the Keeper for, newest first: anyone may read them, only the Keeper can answer.
    asks: asksForSite(s).map(askWithClock),
    // Visitors' notes: how many wait (a number only, never their words) and her latest answers.
    ...notesSnapshot(s),
    moodArc: sim.hours.slice(-48).map((h) => ({ t: h.t, mood: h.mood })),
  };
}

function brief(e: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of ['type', 'at', 't', 'text', 'from', 'sheetLine', 'diary', 'actionId']) if (e[k] !== undefined) out[k] = e[k];
  return out;
}

function broadcast(type: string, data: unknown) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

// The page also needs the clock between events, to move Khina smoothly along a walk.
setInterval(() => broadcast('clock', { t: s.t }), 1000).unref();

// ---------- files ----------
const ROOT = process.cwd();
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
  '.png': 'image/png',
};
/** Only these folders are served, and only on this machine (127.0.0.1). */
const ALLOWED = ['web', join('art', 'export'), join('node_modules', 'three'), join('src', 'world', 'layout.ts'), join('src', 'world', 'places.ts')];

function resolvePath(url: string): string | null {
  let path = decodeURIComponent(url.split('?')[0] ?? '/');
  if (path === '/') path = '/web/index.html';
  if (path.startsWith('/vendor/three/')) path = `/node_modules/three/${path.slice('/vendor/three/'.length)}`;
  const rel = normalize(path).replace(/^[/\\]+/, '');
  if (rel.split(sep).includes('..')) return null;
  return ALLOWED.some((a) => rel === a || rel.startsWith(a + sep)) ? join(ROOT, rel) : null;
}

// ---------- the Keeper answers an ask ----------
/** The request body; 'big' as soon as it passes `max` bytes (the rest is not read), 'error' if it broke off. */
function readBody(req: IncomingMessage, max: number): Promise<string | 'big' | 'error'> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= max) parts.push(c);
      else {
        req.removeAllListeners('data');
        req.pause();
        resolve('big');
      }
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', () => resolve('error'));
  });
}

const sendJson = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));

/**
 * A request whose body is never wanted: with none on the way it is simply let go; with one (of any
 * size) the connection is closed once the answer is sent, rather than reading it all to throw away.
 */
function dropBody(req: IncomingMessage, res: ServerResponse): void {
  const coming = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (!coming) {
    req.resume();
    return;
  }
  res.setHeader('connection', 'close');
  res.on('finish', () => req.destroy());
}

/**
 * Who a request came from, for the per-address limits: behind the host's proxy (PORT is set, as on
 * Railway) the address the edge passes on, on this machine the connection's own (src/notes.ts clientIp).
 */
const trustProxy = !!process.env.PORT;
const ipOf = (req: IncomingMessage) => clientIp({ realIp: req.headers['x-real-ip'], forwarded: req.headers['x-forwarded-for'] }, req.socket.remoteAddress, trustProxy);

/** Wrong keys lately, for every request together (src/asks.ts keeperGate). */
const keyGuard = newGuard();
const keeperLog = (line: string | undefined) => line && console.log(`${' '.repeat(10)}${line}`);

/**
 * POST /asks/<id> {status, note?} with the Keeper's key. The answer goes into her letterbox as a letter.
 * POST /asks/check only tries the key.
 */
async function handleAnswer(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' }).end('POST only');
    return;
  }
  const header = req.headers['x-keeper-key'];
  const key = typeof header === 'string' ? header : undefined;
  const envKey = process.env.KHINA_KEEPER_KEY;
  const ip = ipOf(req);
  if (id === 'check') {
    dropBody(req, res);
    const c = checkRequest(keyGuard, key, envKey, Date.now(), ip);
    keeperLog(c.log);
    if (c.status === 204) res.writeHead(204, { 'cache-control': 'no-store' }).end();
    else sendJson(res, c.status, c.body);
    return;
  }
  // Strangers get nothing read and nothing changed.
  const denied = keeperGate(keyGuard, key, envKey, Date.now(), ip);
  if (denied) {
    dropBody(req, res);
    keeperLog(denied.log);
    sendJson(res, denied.status, denied.body);
    return;
  }
  const body = await readBody(req, ASK.bodyMax);
  if (body === 'big' || body === 'error') {
    // Stop here: the rest of an oversized body is never read, and the connection is closed after the answer.
    res.on('finish', () => req.destroy());
    res.writeHead(body === 'big' ? 413 : 400, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' });
    res.end(JSON.stringify({ error: body === 'big' ? 'Too long.' : 'Could not read that.' }));
    return;
  }
  const r = answerRequest(s, { id, key, envKey, body, now: Date.now(), guard: keyGuard, ip });
  if (r.status === 200) {
    const ask = r.body.ask as Ask;
    console.log(`${' '.repeat(10)}✉ the Keeper answered "${ask.text}": ${ask.status}${ask.note ? ` (${ask.note})` : ''}`);
    save();
    broadcast('snap', { snap: snapshot(), event: { type: 'answered', id: ask.id } });
  }
  sendJson(res, r.status, r.status === 200 ? { ok: true, ask: askWithClock(r.body.ask as Ask) } : r.body);
}

// ---------- visitors' notes ----------
/** Who left notes lately, for the rate limits (src/notes.ts). In memory: a restart forgives everyone. */
const noteGate = newNoteGate();

/** Only these methods on these addresses; anything else is a 405 before any body is read. */
function onlyMethod(req: IncomingMessage, res: ServerResponse, method: 'GET' | 'POST'): boolean {
  if (req.method === method) return true;
  dropBody(req, res);
  res.writeHead(405, { allow: method }).end(`${method} only`);
  return false;
}

/**
 * POST /notes leaves a note; GET /notes/mine?ids= says how a browser's own notes are doing; the Keeper
 * reads the unread ones at GET /notes/inbox, throws away what was shown with POST /notes/inbox/clear,
 * takes one away (or an answer off the site) with POST /notes/<id>/hide, and puts an answer back with
 * POST /notes/<id>/show. The server log gets counts, never words, names or addresses.
 */
async function handleNotes(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams): Promise<void> {
  const header = req.headers['x-keeper-key'];
  const key = typeof header === 'string' ? header : undefined;
  const envKey = process.env.KHINA_KEEPER_KEY;
  const ip = ipOf(req);
  const keeper = () => ({ key, envKey, now: Date.now(), guard: keyGuard, ip });
  const changed = (event: Record<string, unknown>) => {
    save();
    broadcast('snap', { snap: snapshot(), event });
  };
  if (path === '/notes') {
    if (!onlyMethod(req, res, 'POST')) return;
    const body = await readBody(req, NOTE.bodyMax);
    if (body === 'big' || body === 'error') {
      res.on('finish', () => req.destroy());
      res.writeHead(body === 'big' ? 413 : 400, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' });
      res.end(JSON.stringify({ error: body === 'big' ? 'That note is too long.' : 'Could not read that.' }));
      return;
    }
    const r = sendRequest(s, { body, contentType: req.headers['content-type'], ip, now: Date.now(), gate: noteGate });
    keeperLog(r.log);
    if (r.status === 200 && s.inbox?.some((n) => n.id === r.body.id)) changed({ type: 'note' });
    sendJson(res, r.status, r.body);
    return;
  }
  if (path === '/notes/mine') {
    if (!onlyMethod(req, res, 'GET')) return;
    const r = mineRequest(s, query.get('ids'), noteGate);
    sendJson(res, r.status, r.body);
    return;
  }
  if (path === '/notes/inbox') {
    if (!onlyMethod(req, res, 'GET')) return;
    const r = inboxRequest(s, keeper());
    keeperLog(r.log);
    sendJson(res, r.status, r.body);
    return;
  }
  if (path === '/notes/inbox/clear') {
    if (!onlyMethod(req, res, 'POST')) return;
    dropBody(req, res);
    const r = clearRequest(s, { ...keeper(), upto: query.get('upto') });
    keeperLog(r.log);
    if (r.status === 200 && r.body.cleared) changed({ type: 'hidden' });
    sendJson(res, r.status, r.body);
    return;
  }
  const one = /^\/notes\/([^/]+)\/(hide|show)$/.exec(path);
  if (one) {
    if (!onlyMethod(req, res, 'POST')) return;
    dropBody(req, res);
    const r = (one[2] === 'hide' ? hideRequest : showRequest)(s, { ...keeper(), id: one[1] ?? '' });
    keeperLog(r.log);
    if (r.status === 200) changed({ type: one[2] === 'hide' ? 'hidden' : 'shown' });
    sendJson(res, r.status, r.body);
    return;
  }
  sendJson(res, 404, { error: 'Not found.' });
}

const startedAt = Date.now();
// Timeouts are checked every 5 s (Node's default is 30 s, which let a dribbling body hang on for ~45 s).
const server = createServer({ connectionsCheckingInterval: 5_000 }, async (req, res) => {
  const url = req.url ?? '/';
  if (url === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: snap\ndata: ${JSON.stringify({ snap: snapshot(), event: { type: 'hello' } })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url === '/state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(snapshot()));
    return;
  }
  if (url === '/spend') {
    // What Claude has cost since this process started, per job: how the daily cap is being used.
    const st = mind.stats();
    const hours = (Date.now() - startedAt) / 3_600_000;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify({ hours: +hours.toFixed(2), khinaDays: +((hours * rate) / 24).toFixed(2), usd: +st.costUsd.toFixed(4), calls: st.calls, failures: st.failures, byJob: st.byJob ?? {}, today: mind.budgetToday?.() ?? null }));
    return;
  }
  if (url.startsWith('/asks/')) {
    await handleAnswer(req, res, url.slice('/asks/'.length).split('?')[0] ?? '');
    return;
  }
  if (url === '/notes' || url.startsWith('/notes/') || url.startsWith('/notes?')) {
    try {
      const u = new URL(url, 'http://khina.local');
      await handleNotes(req, res, u.pathname, u.searchParams);
    } catch {
      // A strange address or body never takes the village down.
      if (!res.headersSent) sendJson(res, 400, { error: 'Could not read that.' });
    }
    return;
  }
  if (url === '/pieces') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify({ pieces: store.list().filter((p) => !fromHedgehogDays(s, p.t, p.title)).reverse().map(withClock) }));
    return;
  }
  if (url.startsWith('/pieces/')) {
    const f = store.file(url.slice('/pieces/'.length).split('?')[0] ?? '');
    if (!f) {
      res.writeHead(404).end('Not found');
      return;
    }
    const safe = { 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=86400' };
    if (f.type === 'json') {
      const body = withClock(JSON.parse(await readFile(f.path, 'utf8')) as PieceRef);
      res.writeHead(200, { ...safe, 'content-type': 'application/json' }).end(JSON.stringify(body));
    } else if (f.type === 'svg') {
      res.writeHead(200, { ...safe, 'content-type': 'image/svg+xml', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
      createReadStream(f.path).pipe(res);
    } else {
      // Little games run in an opaque, sandboxed origin with no network, even when opened directly.
      res.writeHead(200, { ...safe, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `${TOY_CSP}; sandbox allow-scripts` });
      createReadStream(f.path).pipe(res);
    }
    return;
  }
  const file = resolvePath(url);
  if (!file) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    const ext = extname(file);
    const headers = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' };
    if (ext === '.ts') {
      // The browser cannot read TypeScript; Node strips the types on the way out.
      const code = stripTypeScriptTypes(await readFile(file, 'utf8'), { mode: 'strip' });
      res.writeHead(200, headers).end(code);
      return;
    }
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

// POST /notes is the first door that reads a body from anyone: a body that dribbles in is cut off
// (Node would wait 5 minutes). The event stream is untouched: its request is whole as soon as it lands.
server.requestTimeout = 20_000;
server.headersTimeout = 15_000;

server.listen(port, host, () => {
  const pace = realClock ? (rate === 1 ? 'real time, on the wall clock' : `${rate}× real time (a Khina day every ${+(24 / rate).toFixed(2)} h)`) : `${speed} game minute${speed === 1 ? '' : 's'} per second`;
  if (outlets.length) console.log(`Posts also go to: ${outlets.map((o) => o.name).join(', ')}`);
  const keeperEnv = process.env.KHINA_KEEPER_KEY?.trim();
  console.log(
    serverKey(keeperEnv)
      ? "The Keeper can answer Khina's asks on the site (open it with #keeper)."
      : keeperEnv
        ? `KHINA_KEEPER_KEY is too short: answering is off (use at least ${ASK.keyMin} random characters).`
        : "KHINA_KEEPER_KEY is not set: Khina's asks can be read but not answered.",
  );
  console.log(`Khina · seed ${seed} · brain: ${mind.kind === 'model' ? 'Claude' : 'code only'} · ${pace}${saved ? ' · picked up from the last save' : ''}`);
  console.log(`Open http://${host === '0.0.0.0' ? 'localhost' : host}:${port}  (events: ${outDir}/events.jsonl)\n`);
});

if (realClock && epochMs !== null) {
  // Catch up on time missed while the server was down (at most two days; after a longer gap,
  // whole days are skipped so the time of day still matches), then keep pace with the clock.
  const behind = ((Date.now() - epochMs) * rate) / 60_000 - s.t;
  if (behind > 2 * 1440) epochMs += (Math.floor((behind - 2 * 1440) / 1440) * 1440 * 60_000) / rate;
  let n = 0;
  for (;;) {
    const due = ((Date.now() - epochMs) * rate) / 60_000;
    if (s.t <= due) {
      await sim.tick();
      // Let the web server breathe while catching up.
      if (++n % 50 === 0) await new Promise((r) => setImmediate(r));
    } else {
      await new Promise((r) => setTimeout(r, Math.min(60_000, ((s.t - due) * 60_000) / rate + 5)));
    }
  }
} else {
  await sim.run(Number.POSITIVE_INFINITY);
}
