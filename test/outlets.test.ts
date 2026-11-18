import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanPost } from '../src/mind/making.ts';
import { blueskyRecord, makeOutlets, oauthSignature, sendEverywhere } from '../src/outlets.ts';
import type { Post } from '../src/state.ts';

test('posts lose links, mentions and hashtags, and selling is turned down', () => {
  assert.equal(
    cleanPost('Rain on the oak all day! See https://x.test and @someone #hedgehog life'),
    'Rain on the oak all day. See and hedgehog life',
  );
  assert.equal(cleanPost('Buy my crypto token now, it is a good one'), null);
  assert.equal(cleanPost('too short'), null);
  assert.ok((cleanPost('word '.repeat(80)) ?? '').length <= 260);
});

test('no keys, no accounts: posts stay on the site', () => {
  assert.deepEqual(makeOutlets({}), []);
  assert.deepEqual(makeOutlets({ BSKY_HANDLE: 'khina.bsky.social' }), []);
  assert.deepEqual(makeOutlets({ BSKY_HANDLE: 'h', BSKY_APP_PASSWORD: 'p', X_API_KEY: 'a', X_API_SECRET: 'b', X_ACCESS_TOKEN: 'c', X_ACCESS_SECRET: 'd' }).map((o) => o.name), ['bluesky', 'x']);
});

test('a shared piece is linked on Bluesky with a facet over the right bytes', () => {
  const post: Post = { t: 1, text: 'Drew the mill — wobbly.', about: 'x', piece: { id: 'abc-12345', title: 'Mill', form: 'picture' } };
  const r = blueskyRecord(post, 'https://khina.example/', new Date(0)) as { text: string; facets: { index: { byteStart: number; byteEnd: number } }[] };
  const link = 'https://khina.example/#piece=abc-12345';
  assert.equal(r.text, `Drew the mill — wobbly.\n${link}`);
  const bytes = Buffer.from(r.text, 'utf8');
  assert.equal(bytes.subarray(r.facets[0]!.index.byteStart, r.facets[0]!.index.byteEnd).toString('utf8'), link);
  assert.equal((blueskyRecord({ ...post, piece: undefined }, 'https://k', new Date(0)) as { facets?: unknown }).facets, undefined);
});

test('sending to Bluesky logs in with the app password and creates one post', async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fake = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const json = url.endsWith('createSession') ? { did: 'did:plc:khina', accessJwt: 'jwt' } : { uri: 'at://did:plc:khina/app.bsky.feed.post/3kxyz' };
    return new Response(JSON.stringify(json), { status: 200 });
  }) as unknown as typeof fetch;
  const outlets = makeOutlets({ BSKY_HANDLE: 'khina.bsky.social', BSKY_APP_PASSWORD: 'app-pw' }, fake);
  const sent = await sendEverywhere(outlets, { t: 1, text: 'Fog at the stream.', about: 'fog' });
  assert.deepEqual(sent, { bluesky: 'https://bsky.app/profile/did:plc:khina/post/3kxyz' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]!.body, { identifier: 'khina.bsky.social', password: 'app-pw' });
  assert.equal((calls[1]!.body.record as { text: string }).text, 'Fog at the stream.');
});

test('a failed send is noted, not thrown', async () => {
  const fake = (async () => new Response(JSON.stringify({ message: 'Invalid identifier or password' }), { status: 401 })) as unknown as typeof fetch;
  const sent = await sendEverywhere(makeOutlets({ BSKY_HANDLE: 'h', BSKY_APP_PASSWORD: 'p' }, fake), { t: 1, text: 'x y z w', about: '' });
  assert.match(sent.bluesky ?? '', /^error: Bluesky 401: Invalid identifier/);
});

test('the X signature matches the worked example in X\'s OAuth 1.0a docs', () => {
  const sig = oauthSignature(
    'POST',
    'https://api.twitter.com/1.1/statuses/update.json',
    {
      include_entities: 'true',
      status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
      oauth_consumer_key: 'xvz1evFS4wEEPTGEFPHBog',
      oauth_nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: '1318622958',
      oauth_token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      oauth_version: '1.0',
    },
    'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
  );
  assert.equal(sig, 'hCtSmYh+iHYCEqBWrE7C7hYmtUk=');
});
