// Where Khina's posts go besides the site: a Bluesky account and/or an X account, each switched on
// only when its keys are set (Railway variables). Post only: no replies, likes, follows or messages,
// so Khina never reaches out to anyone. Someone has to make the account by hand; a bot can't sign up.
//
//   Bluesky: BSKY_HANDLE, BSKY_APP_PASSWORD (Settings → App passwords), optional BSKY_SERVICE
//   X:       X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET (developer portal, read+write app)
//   Links:   KHINA_PUBLIC_URL, to link a shared piece on Bluesky (X charges extra for links, so none there)

import { createHmac, randomBytes } from 'node:crypto';
import type { Post } from './state.ts';

export interface Outlet {
  name: string;
  /** Sends one post; returns where it can be seen (a URL). Throws on failure. */
  send(post: Post): Promise<string>;
}

type Env = Record<string, string | undefined>;

export function makeOutlets(env: Env = process.env, fetcher: typeof fetch = fetch): Outlet[] {
  const out: Outlet[] = [];
  if (env.BSKY_HANDLE && env.BSKY_APP_PASSWORD) out.push(bluesky(env, fetcher));
  if (env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET) out.push(xOutlet(env, fetcher));
  return out;
}

/** Sends a post everywhere it is set up to go; never throws. */
export async function sendEverywhere(outlets: Outlet[], post: Post): Promise<Record<string, string>> {
  const sent: Record<string, string> = {};
  for (const o of outlets) {
    try {
      sent[o.name] = await o.send(post);
    } catch (err) {
      sent[o.name] = `error: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`;
    }
  }
  return sent;
}

// ---------- Bluesky (AT Protocol, free) ----------

/** The post text plus, for a shared piece, a link to it, with the facet Bluesky needs to make it clickable. */
export function blueskyRecord(post: Post, publicUrl: string | undefined, now = new Date()): Record<string, unknown> {
  const link = post.piece && publicUrl ? `${publicUrl.replace(/\/+$/, '')}/#piece=${post.piece.id}` : '';
  let text = post.text;
  const room = 300 - (link ? link.length + 1 : 0);
  if ([...text].length > room) text = `${[...text].slice(0, room - 3).join('').replace(/\s+\S*$/, '')}...`;
  const record: Record<string, unknown> = { $type: 'app.bsky.feed.post', text, createdAt: now.toISOString(), langs: ['en'] };
  if (link) {
    const byteStart = Buffer.byteLength(`${text}\n`, 'utf8');
    record.text = `${text}\n${link}`;
    record.facets = [{ index: { byteStart, byteEnd: byteStart + Buffer.byteLength(link, 'utf8') }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: link }] }];
  }
  return record;
}

function bluesky(env: Env, fetcher: typeof fetch): Outlet {
  const service = (env.BSKY_SERVICE || 'https://bsky.social').replace(/\/+$/, '');
  const json = async (res: Response) => {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Bluesky ${res.status}: ${String(body.message ?? body.error ?? '')}`);
    return body;
  };
  return {
    name: 'bluesky',
    async send(post) {
      const session = await json(
        await fetcher(`${service}/xrpc/com.atproto.server.createSession`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ identifier: env.BSKY_HANDLE, password: env.BSKY_APP_PASSWORD }),
        }),
      );
      const did = String(session.did);
      const made = await json(
        await fetcher(`${service}/xrpc/com.atproto.repo.createRecord`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${String(session.accessJwt)}` },
          body: JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', record: blueskyRecord(post, env.KHINA_PUBLIC_URL) }),
        }),
      );
      const rkey = String(made.uri ?? '').split('/').pop();
      return `https://bsky.app/profile/${did}/post/${rkey}`;
    },
  };
}

// ---------- X (API v2, OAuth 1.0a user context; X bills about $0.015 a post) ----------

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The OAuth 1.0a HMAC-SHA1 signature over the method, URL and parameters (a JSON body is not signed). */
export function oauthSignature(method: string, url: string, params: Record<string, string>, consumerSecret: string, tokenSecret: string): string {
  const paramString = Object.keys(params)
    .map((k) => [enc(k), enc(params[k]!)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const base = `${method.toUpperCase()}&${enc(url)}&${enc(paramString)}`;
  return createHmac('sha1', `${enc(consumerSecret)}&${enc(tokenSecret)}`).update(base).digest('base64');
}

function xOutlet(env: Env, fetcher: typeof fetch): Outlet {
  const url = 'https://api.x.com/2/tweets';
  return {
    name: 'x',
    async send(post) {
      const oauth: Record<string, string> = {
        oauth_consumer_key: env.X_API_KEY!,
        oauth_nonce: randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: String(Math.floor(Date.now() / 1000)),
        oauth_token: env.X_ACCESS_TOKEN!,
        oauth_version: '1.0',
      };
      oauth.oauth_signature = oauthSignature('POST', url, oauth, env.X_API_SECRET!, env.X_ACCESS_SECRET!);
      const header = `OAuth ${Object.keys(oauth)
        .sort()
        .map((k) => `${enc(k)}="${enc(oauth[k]!)}"`)
        .join(', ')}`;
      const res = await fetcher(url, {
        method: 'POST',
        headers: { authorization: header, 'content-type': 'application/json' },
        body: JSON.stringify({ text: post.text.slice(0, 280) }),
      });
      const body = (await res.json().catch(() => ({}))) as { data?: { id?: string }; detail?: string; title?: string };
      if (!res.ok || !body.data?.id) throw new Error(`X ${res.status}: ${body.detail ?? body.title ?? ''}`);
      return `https://x.com/i/web/status/${body.data.id}`;
    },
  };
}
