import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as rsaSign } from 'node:crypto';
import { createApi, memoryStores } from '../netlify/lib/core.mts';

// No secret passed: the API must generate and persist its own.
const CLIENT = 'test-client.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const api = createApi(memoryStores(), { googleClientId: CLIENT, jwks: async () => ({ keys: [jwk] }) });
function googleToken(claims: Record<string, unknown>, key = privateKey) {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = enc({ iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600,
    email_verified: true, ...claims });
  return `${head}.${body}.${rsaSign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}
const call = (path: string, method = 'GET', data?: unknown, cookie = '') =>
  api(new Request(`https://x.test/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: data === undefined ? undefined : JSON.stringify(data),
  }));
const cookieOf = (r: Response) => (r.headers.get('set-cookie') || '').split(';')[0];

let r = await call('me');
assert.equal(r.status, 401, 'me requires a session');

r = await call('signup', 'POST', { name: 'Ish', email: 'bad', password: 'longenough' });
assert.equal(r.status, 400, 'rejects invalid email');
r = await call('signup', 'POST', { name: 'Ish', email: 'ish@example.com', password: 'short' });
assert.equal(r.status, 400, 'rejects short password');

r = await call('signup', 'POST', { name: 'Ish', email: 'Ish@Example.com', password: 'discipline1' });
assert.equal(r.status, 201);
const c1 = cookieOf(r);
assert.match(r.headers.get('set-cookie')!, /HttpOnly/);
assert.match(r.headers.get('set-cookie')!, /Secure/);

r = await call('signup', 'POST', { name: 'Ish', email: 'ish@example.com', password: 'discipline1' });
assert.equal(r.status, 409, 'duplicate email');

r = await call('state', 'PUT', { start: '2026-10-01', days: { 1: { done: { move: true } } } }, c1);
assert.equal(r.status, 200);
r = await call('me', 'GET', undefined, c1);
const me = await r.json();
assert.equal(me.user.email, 'ish@example.com');
assert.equal(me.state.start, '2026-10-01');
assert.equal(me.user.hash, undefined, 'never leaks hash');

r = await call('login', 'POST', { email: 'ish@example.com', password: 'wrongpass' });
assert.equal(r.status, 401);
r = await call('login', 'POST', { email: 'ISH@example.com', password: 'discipline1' });
assert.equal(r.status, 200);
assert.equal((await r.json()).state.start, '2026-10-01');

// A second user cannot see the first user's data.
r = await call('signup', 'POST', { name: 'Friend', email: 'friend@example.com', password: 'discipline2' });
const c2 = cookieOf(r);
r = await call('me', 'GET', undefined, c2);
assert.equal((await r.json()).state, null);

// Tampered cookie is rejected.
r = await call('me', 'GET', undefined, c1.slice(0, -2) + 'xx');
assert.equal(r.status, 401);

// Lockout after repeated failures.
for (let i = 0; i < 5; i++) await call('login', 'POST', { email: 'friend@example.com', password: 'nope-nope' });
r = await call('login', 'POST', { email: 'friend@example.com', password: 'discipline2' });
assert.equal(r.status, 429);

// Sign out everywhere invalidates old sessions.
r = await call('logout-all', 'POST', {}, c1);
assert.equal(r.status, 200);
r = await call('me', 'GET', undefined, c1);
assert.equal(r.status, 401);

// Google sign-in: config exposes the client id.
r = await call('config');
assert.equal((await r.json()).googleClientId, CLIENT);

// New Google user gets an account and a session.
r = await call('google', 'POST', { credential: googleToken({ sub: 'g-1', email: 'new@gmail.com', given_name: 'Grace' }) });
assert.equal(r.status, 201);
const g1 = cookieOf(r);
assert.equal((await r.json()).user.name, 'Grace');
r = await call('me', 'GET', undefined, g1);
assert.equal(r.status, 200);

// Returning Google user signs back in to the same account.
r = await call('google', 'POST', { credential: googleToken({ sub: 'g-1', email: 'new@gmail.com' }) });
assert.equal(r.status, 200);

// Google-only accounts get a helpful message on password sign-in.
r = await call('login', 'POST', { email: 'new@gmail.com', password: 'whatever1' });
assert.match((await r.json()).error, /Google/);

// Verified Google email links to an existing password account.
r = await call('google', 'POST', { credential: googleToken({ sub: 'g-2', email: 'ish@example.com' }) });
assert.equal(r.status, 200);
assert.equal((await r.json()).state.start, '2026-10-01');

// Rejections: forged signature, wrong audience, expired, unverified email.
const { privateKey: evil } = generateKeyPairSync('rsa', { modulusLength: 2048 });
r = await call('google', 'POST', { credential: googleToken({ sub: 'x', email: 'x@gmail.com' }, evil) });
assert.equal(r.status, 401, 'forged signature');
r = await call('google', 'POST', { credential: googleToken({ sub: 'x', email: 'x@gmail.com', aud: 'other' }) });
assert.equal(r.status, 401, 'wrong audience');
r = await call('google', 'POST', { credential: googleToken({ sub: 'x', email: 'x@gmail.com', exp: 1 }) });
assert.equal(r.status, 401, 'expired');
r = await call('google', 'POST', { credential: googleToken({ sub: 'x', email: 'x@gmail.com', email_verified: false }) });
assert.equal(r.status, 401, 'unverified email');
r = await call('google', 'POST', { credential: 'garbage' });
assert.equal(r.status, 401, 'garbage token');

// Without a Google client id, the endpoint says it is not set up.
const plain = createApi(memoryStores(), {});
r = await plain(new Request('https://x.test/api/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
assert.equal(r.status, 503);

console.log('api tests passed');
