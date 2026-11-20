import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, get as httpGet, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { createStaticFiles, etagMatches, pickEncoding } from '../src/static.ts';

test('brotli before gzip, and only what the browser takes', () => {
  assert.equal(pickEncoding('gzip, deflate, br, zstd'), 'br');
  assert.equal(pickEncoding('gzip, deflate'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(undefined), null);
});

test('If-None-Match matches weakly, in a list, or with *', () => {
  assert.ok(etagMatches('W/"abc"', 'W/"abc"'));
  assert.ok(etagMatches('"abc"', 'W/"abc"'));
  assert.ok(etagMatches('"x", W/"abc"', 'W/"abc"'));
  assert.ok(etagMatches('*', 'W/"abc"'));
  assert.ok(!etagMatches('W/"abd"', 'W/"abc"'));
  assert.ok(!etagMatches(undefined, 'W/"abc"'));
});

// A tiny checkout: the page, a module, a model and three.js.
let root = '';
let server: Server;
let base = '';
before(async () => {
  root = mkdtempSync(join(tmpdir(), 'khina-static-'));
  mkdirSync(join(root, 'web'));
  mkdirSync(join(root, 'art', 'export'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'three', 'build'), { recursive: true });
  writeFileSync(join(root, 'web', 'index.html'), '<html><head><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.min.js"}}</script></head><body></body></html>');
  writeFileSync(join(root, 'web', 'main.ts'), `const n: number = 1;\n${'export const filler = "the village wakes up";\n'.repeat(200)}`);
  writeFileSync(join(root, 'art', 'export', 'khina.glb'), Buffer.alloc(40_000, 7));
  writeFileSync(join(root, 'node_modules', 'three', 'package.json'), '{"version":"0.181.2"}');
  writeFileSync(join(root, 'node_modules', 'three', 'build', 'three.module.min.js'), 'export const REVISION = "181";\n'.repeat(100));
  const files = createStaticFiles(root);
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    const rel = path === '/' ? 'web/index.html' : path.replace(/^\/vendor\/three(@[\w.-]+)?\//, 'node_modules/three/').replace(/^\//, '');
    void files.send(req, res, join(root, rel));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
after(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

test('index.html points at a versioned three.js and carries each model hash', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  const html = await res.text();
  assert.match(html, /\/vendor\/three@0\.181\.2\/build\/three\.module\.min\.js/);
  const meta = /<meta name="khina-art" content='([^']*)'/.exec(html);
  assert.ok(meta, 'has the art hashes');
  const art = JSON.parse(meta[1]!) as Record<string, string>;
  assert.match(art['khina.glb'] ?? '', /^[0-9a-f]{12}$/);

  // The model under its current hash is kept for good; without it, the browser asks again each time.
  const fresh = await fetch(`${base}/art/export/khina.glb?v=${art['khina.glb']}`);
  assert.equal(fresh.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await fresh.arrayBuffer()).byteLength, 40_000);
  const bare = await fetch(`${base}/art/export/khina.glb`);
  assert.equal(bare.headers.get('cache-control'), 'no-cache');
  await bare.arrayBuffer();
  const three = await fetch(`${base}/vendor/three@0.181.2/build/three.module.min.js`);
  assert.equal(three.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  await three.text();
});

test('compressed once, types stripped, and a 304 for an ETag the browser already has', async () => {
  const get = (enc: string, extra: Record<string, string> = {}) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
    // fetch() always takes gzip and br and undoes them, so ask with node:http to see the raw bytes.
    httpGet(`${base}/web/main.ts`, { headers: { 'accept-encoding': enc, ...extra } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
    }).on('error', reject);
  });
  const br = await get('gzip, br');
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers.vary, 'Accept-Encoding');
  const code = brotliDecompressSync(br.body).toString('utf8');
  assert.match(code, /^const n\s+= 1;/, 'types stripped');
  assert.ok(br.body.length < code.length / 4, 'much smaller');
  const gz = await get('gzip');
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(gunzipSync(gz.body).toString('utf8'), code);
  const plain = await get('identity');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.body.toString('utf8'), code);
  const etag = String(br.headers.etag);
  assert.equal(etag, plain.headers.etag, 'one ETag, whatever the encoding');
  const again = await get('gzip, br', { 'if-none-match': etag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
});

test('a missing file is a 404', async () => {
  const res = await fetch(`${base}/web/nothing.ts`);
  assert.equal(res.status, 404);
  await res.text();
});
