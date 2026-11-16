// npm run live -- [--seed 1] [--speed 1] [--model] [--port 5174] [--max-spend 0.50]
//                  [--clock real] [--persist data/khina-state.json]
// Runs Khina's life as it happens and shows it in the browser at http://127.0.0.1:5174
// --speed is game minutes per real second: 1 = a day in 24 minutes, 60 = an hour a second,
// 0.0167 = real time. The brain is code only unless --model is given (Claude costs money,
// about $0.023 a game day, under the usual daily cap).
// --clock real runs at real time with Khina's clock on the local wall clock (set TZ), so night
// is night. --persist saves Khina's life every few minutes and on shutdown, and picks it up on
// start, catching up on the time missed. Hosting (Railway) sets PORT; then it listens on all
// interfaces. See Dockerfile.

import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { budget } from './config.ts';
import { makeMind } from './minds.ts';
import { Rng } from './rng.ts';
import { Sim } from './sim.ts';
import { newState, type Completed, type State } from './state.ts';
import { clock, dayOf, isDark, partOfDay, weekday } from './time.ts';
import { actionDef } from './world/actions.ts';
import { PLACES } from './world/places.ts';
import { bakeryOpen } from './world/village.ts';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '1' },
    speed: { type: 'string', default: '1' },
    model: { type: 'boolean', default: false },
    port: { type: 'string', default: '5174' },
    'max-spend': { type: 'string', default: String(budget.runUsd) },
    quiet: { type: 'boolean', default: false },
    clock: { type: 'string', default: 'game' },
    persist: { type: 'string' },
  },
});

const seed = Number(values.seed) || 1;
const realClock = values.clock === 'real';
const speed = realClock ? 1 / 60 : Math.min(600, Math.max(0.001, Number(values.speed) || 1));
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
if (!saved && realClock) {
  s.t = minutesIntoWeek(new Date());
  s.lastNotable = s.t;
}
const rng = new Rng(seed);
if (saved) rng.state = saved.rngState;
let epochMs = saved?.epochMs ?? (realClock ? Date.now() - s.t * 60_000 : null);
if (realClock && epochMs === null) epochMs = Date.now() - s.t * 60_000;

const clients = new Set<ServerResponse>();
const sim = new Sim(s, {
  mind,
  rng,
  outDir,
  speedMs: 1000 / speed,
  onLine: values.quiet ? undefined : (line) => console.log(line),
  onEvent: (e) => {
    if (e.type === 'tick') return;
    broadcast('snap', { snap: snapshot(), event: brief(e) });
  },
});
if (saved) sim.log.push(...saved.log);

function save(): void {
  if (!persistPath) return;
  const data: Saved = { version: 1, seed, epochMs, s: { ...s, rngState: rng.state }, rngState: rng.state, log: sim.log.slice(-80) };
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
          }
        : null,
    letters: s.world.letters.length,
    diary: sim.log
      .filter((r) => r.diary)
      .slice(-8)
      .map((r) => ({ t: r.end, clock: clock(r.end), text: r.diary, place: PLACES[r.place].short })),
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

const server = createServer(async (req, res) => {
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

server.listen(port, host, () => {
  const pace = realClock ? 'real time, on the wall clock' : `${speed} game minute${speed === 1 ? '' : 's'} per second`;
  console.log(`Khina · seed ${seed} · brain: ${mind.kind === 'model' ? 'Claude' : 'code only'} · ${pace}${saved ? ' · picked up from the last save' : ''}`);
  console.log(`Open http://${host === '0.0.0.0' ? 'localhost' : host}:${port}  (events: ${outDir}/events.jsonl)\n`);
});

if (realClock && epochMs !== null) {
  // Catch up on time missed while the server was down (at most two days; after a longer gap,
  // whole days are skipped so the time of day still matches), then keep pace with the clock.
  const behind = (Date.now() - epochMs) / 60_000 - s.t;
  if (behind > 2 * 1440) epochMs += Math.floor((behind - 2 * 1440) / 1440) * 1440 * 60_000;
  let n = 0;
  for (;;) {
    const due = (Date.now() - epochMs) / 60_000;
    if (s.t <= due) {
      await sim.tick();
      // Let the web server breathe while catching up.
      if (++n % 50 === 0) await new Promise((r) => setImmediate(r));
    } else {
      await new Promise((r) => setTimeout(r, Math.min(60_000, (s.t - due) * 60_000 + 5)));
    }
  }
} else {
  await sim.run(Number.POSITIVE_INFINITY);
}
