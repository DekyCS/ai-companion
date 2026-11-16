// npm run live -- [--seed 1] [--speed 1] [--model] [--port 5174] [--max-spend 0.50]
// Runs Khina's life as it happens and shows it in the browser at http://127.0.0.1:5174
// --speed is game minutes per real second: 1 = a day in 24 minutes, 60 = an hour a second,
// 0.0167 = real time. The brain is code only unless --model is given (Claude costs money,
// about $0.023 a game day, under the usual daily cap).

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, normalize, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { budget } from './config.ts';
import { makeMind } from './minds.ts';
import { Rng } from './rng.ts';
import { Sim } from './sim.ts';
import { newState } from './state.ts';
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
  },
});

const seed = Number(values.seed) || 1;
const speed = Math.min(600, Math.max(0.001, Number(values.speed) || 1));
const port = Number(values.port) || 5174;
const kind = values.model ? 'model' : 'offline';
if (kind === 'model' && !process.env.ANTHROPIC_API_KEY) {
  console.log('--model needs ANTHROPIC_API_KEY in .env');
  process.exit(1);
}
const stampNow = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const outDir = join('runs', `live-${stampNow}-seed${seed}-${kind}`);
const mind = makeMind(kind, { seed, runDir: outDir, capUsd: Number(values['max-spend']) || budget.runUsd });

const s = newState(seed);
const clients = new Set<ServerResponse>();
const sim = new Sim(s, {
  mind,
  rng: new Rng(seed),
  outDir,
  speedMs: 1000 / speed,
  onLine: values.quiet ? undefined : (line) => console.log(line),
  onEvent: (e) => {
    if (e.type === 'tick') return;
    broadcast('snap', { snap: snapshot(), event: brief(e) });
  },
});

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

server.listen(port, '127.0.0.1', () => {
  console.log(`Khina · seed ${seed} · brain: ${mind.kind === 'model' ? 'Claude' : 'code only'} · ${speed} game minute${speed === 1 ? '' : 's'} per second`);
  console.log(`Open http://127.0.0.1:${port}  (events: ${outDir}/events.jsonl)\n`);
});

await sim.run(Number.POSITIVE_INFINITY);
