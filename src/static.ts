// The page's files (src/live.ts decides which paths may be served): read once, compressed once, kept
// in memory, with an ETag and cache headers that let a returning visitor skip the big downloads.
//
// Compression: brotli when the browser takes it (all browsers do over https), else gzip, for text and
// models (.glb: gltfpack's meshopt output still shrinks by about half again). Each file is read,
// stripped of types (.ts), hashed and compressed once per version on disk (size + mtime), then served
// from memory; the heavy ones are compressed in the background when the server starts (warm).
//
// ETag: a hash of the bytes served (weak, as the same bytes go out compressed or not), so a redeploy
// that leaves a file as it was keeps its ETag. If-None-Match with it gets a 304 and no body.
//
// Cache-Control, by whether the URL changes when the content does:
// - index.html and the page's own code (web/*.ts, src/world/*.ts): `no-cache`, i.e. max-age=0 and
//   revalidate. The browser keeps a copy but asks each time, so a deploy shows on the next load and an
//   unchanged file costs a 304 round trip, not its bytes. Their URLs never change, so nothing longer is safe.
// - three.js: index.html's import map is rewritten from /vendor/three/ to /vendor/three@<installed
//   version>/, so the URL changes when three is upgraded: `public, max-age=31536000, immutable`.
// - Models and terrain (art/export): index.html carries each file's hash (<meta name="khina-art">) and
//   web/main.ts asks for /art/export/<file>?v=<hash>, so a deploy that changes a model changes its URL:
//   immutable too, and a returning visitor downloads no model at all. Without the current hash (a tab
//   opened before the deploy, a typed URL) they get `no-cache` like the page.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.ts', '.css', '.glb', '.json', '.svg']);
const IMMUTABLE = 'public, max-age=31536000, immutable';
const ART = join('art', 'export');
/** Files bigger than this are read again for each request instead of kept in memory. */
const KEEP_MAX = 16e6;
/** Everything kept in memory together, before the oldest files are dropped. */
const CACHE_MAX = 96e6;

type Encoding = 'br' | 'gzip';
interface Entry {
  /** Size and mtime on disk (and, for index.html, the art hashes it carries). */
  stamp: string;
  body: Buffer;
  type: string;
  etag: string;
  /** Short content hash, the ?v= a model is asked for with. */
  v: string;
  packed: Partial<Record<Encoding, Promise<Buffer | null>>>;
}

export interface StaticFiles {
  /** Answers a GET or HEAD for `file` (an absolute path that is allowed to be served). */
  send(req: IncomingMessage, res: ServerResponse, file: string): Promise<void>;
  /** Reads and brotli-compresses the page, its code, three.js and the models ahead of the first visitor. */
  warm(): Promise<void>;
}

/** The first encoding the browser accepts, brotli before gzip. */
export function pickEncoding(header: string | string[] | undefined): Encoding | null {
  const accepts = new Map<string, number>();
  for (const part of String(header ?? '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    accepts.set(name, q ? Number(q.slice(2)) || 0 : 1);
  }
  for (const enc of ['br', 'gzip'] as const) if ((accepts.get(enc) ?? accepts.get('*') ?? 0) > 0) return enc;
  return null;
}

/** Whether an If-None-Match header names this ETag (weak comparison). */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const bare = (t: string) => t.trim().replace(/^W\//, '');
  return String(header)
    .split(',')
    .some((t) => t.trim() === '*' || bare(t) === bare(etag));
}

export function createStaticFiles(root: string): StaticFiles {
  const cache = new Map<string, { stamp: string; size: number; ready: Promise<Entry> }>();
  let kept = 0;
  let threeVersion: string | null = null;
  try {
    threeVersion = (JSON.parse(readFileSync(join(root, 'node_modules', 'three', 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    threeVersion = null;
  }
  const indexHtml = join(root, 'web', 'index.html');

  function keep(file: string, stamp: string, size: number, ready: Promise<Entry>) {
    const old = cache.get(file);
    if (old) {
      kept -= old.size;
      cache.delete(file);
    }
    cache.set(file, { stamp, size, ready });
    kept += size;
    // Past the limit (only something walking all of node_modules/three would get there), drop the
    // files asked for longest ago.
    for (const [f, c] of cache) {
      if (kept <= CACHE_MAX) break;
      if (f === file) continue;
      cache.delete(f);
      kept -= c.size;
    }
    ready.catch(() => {
      if (cache.get(file)?.ready !== ready) return;
      cache.delete(file);
      kept -= size;
    });
  }

  function entryOf(file: string, stamp: string, body: Buffer): Entry {
    const hash = createHash('sha256').update(body).digest('hex');
    return { stamp, body, type: TYPES[extname(file)] ?? 'application/octet-stream', etag: `W/"${hash.slice(0, 24)}"`, v: hash.slice(0, 12), packed: {} };
  }

  /** Each model's and the terrain's short hash, for index.html. */
  async function artVersions(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    let names: string[] = [];
    try {
      names = (await readdir(join(root, ART))).filter((n) => /\.(glb|json)$/.test(n)).sort();
    } catch {
      return out;
    }
    for (const n of names) {
      try {
        out[n] = (await load(join(root, ART, n))).v;
      } catch {
        // gone between readdir and read: leave it out
      }
    }
    return out;
  }

  async function load(file: string): Promise<Entry> {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    const isIndex = file === indexHtml;
    const art = isIndex ? await artVersions() : null;
    const stamp = `${st.size}:${st.mtimeMs}${art ? `|${JSON.stringify(art)}` : ''}`;
    const known = cache.get(file);
    if (known && known.stamp === stamp) {
      // To the back of the queue: the files asked for longest ago are the first to go.
      cache.delete(file);
      cache.set(file, known);
      return known.ready;
    }
    const ready = (async () => {
      let body: Buffer = await readFile(file);
      if (extname(file) === '.ts') {
        // The browser cannot read TypeScript; Node strips the types on the way out.
        body = Buffer.from(stripTypeScriptTypes(body.toString('utf8'), { mode: 'strip' }));
      }
      if (isIndex) {
        let html = body.toString('utf8');
        if (threeVersion) html = html.replaceAll('/vendor/three/', `/vendor/three@${threeVersion}/`);
        html = html.replace('</head>', `  <meta name="khina-art" content='${JSON.stringify(art)}' />\n  </head>`);
        body = Buffer.from(html);
      }
      return entryOf(file, stamp, body);
    })();
    if (st.size <= KEEP_MAX) keep(file, stamp, st.size, ready);
    return ready;
  }

  /** The body in this encoding, made once; null when it would not be smaller. */
  function packed(e: Entry, enc: Encoding): Promise<Buffer | null> {
    e.packed[enc] ??= (async () => {
      const out =
        enc === 'br'
          ? await brotli(e.body, {
              params: {
                // 11 is the smallest, but takes seconds on the village (2 MB); 9 is within 5% of it there.
                [constants.BROTLI_PARAM_QUALITY]: e.body.length < 1e6 ? 11 : 9,
                [constants.BROTLI_PARAM_SIZE_HINT]: e.body.length,
              },
            })
          : await gzipped(e.body, { level: 9 });
      return out.length < e.body.length * 0.95 ? out : null;
    })();
    return e.packed[enc];
  }

  function cacheControl(file: string, req: IncomingMessage, e: Entry): string {
    const rel = relative(root, file);
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (threeVersion && rel.startsWith(join('node_modules', 'three') + sep) && url.pathname.startsWith(`/vendor/three@${threeVersion}/`)) return IMMUTABLE;
    if (rel.startsWith(ART + sep) && url.searchParams.get('v') === e.v) return IMMUTABLE;
    return 'no-cache';
  }

  return {
    async send(req, res, file) {
      let e: Entry;
      try {
        e = await load(file);
      } catch {
        res.writeHead(404).end('Not found');
        return;
      }
      const ext = extname(file);
      const headers: Record<string, string> = { 'content-type': e.type, 'cache-control': cacheControl(file, req, e), etag: e.etag };
      if (COMPRESSIBLE.has(ext)) headers.vary = 'Accept-Encoding';
      if (etagMatches(req.headers['if-none-match'], e.etag)) {
        res.writeHead(304, headers).end();
        return;
      }
      let body = e.body;
      const enc = COMPRESSIBLE.has(ext) && body.length > 1024 ? pickEncoding(req.headers['accept-encoding']) : null;
      if (enc) {
        const p = await packed(e, enc);
        if (p) {
          body = p;
          headers['content-encoding'] = enc;
        }
      }
      headers['content-length'] = String(body.length);
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    },

    async warm() {
      const files = [indexHtml];
      for (const dir of ['web', ART]) {
        try {
          for (const n of await readdir(join(root, dir))) if (/\.(ts|glb|json)$/.test(n) && n !== 'tsconfig.json') files.push(join(root, dir, n));
        } catch {
          // no such folder here
        }
      }
      for (const n of ['three.module.min.js', 'three.core.min.js']) files.push(join(root, 'node_modules', 'three', 'build', n));
      await Promise.all(
        files.map(async (f) => {
          try {
            const e = await load(f);
            if (COMPRESSIBLE.has(extname(f))) await packed(e, 'br');
          } catch {
            // missing: it 404s when asked for
          }
        }),
      );
    },
  };
}
