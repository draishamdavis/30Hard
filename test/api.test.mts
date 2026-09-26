import assert from 'node:assert/strict';
import { createApi, memoryStores } from '../netlify/lib/core.mts';

const api = createApi(memoryStores(), 'test-secret');
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

console.log('api tests passed');
