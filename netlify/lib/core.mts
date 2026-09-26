/* 30 HARD account API: sign up, sign in, sign out, profile, and per-user app state.
   Storage is injected so the same logic runs on Netlify Blobs and in local development. */
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHmac } from 'node:crypto';

export interface KV {
  get(key: string, opts: { type: 'json' }): Promise<any | null>;
  setJSON(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
export interface Stores { users: KV; state: KV; attempts: KV; }

const COOKIE = 'th_session';
const SESSION_DAYS = 30;
const MAX_STATE_BYTES = 256 * 1024;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ─────────────── Crypto helpers ─────────────── */

function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))));
}
const b64u = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
function sign(payload: object, secret: string): string {
  const body = b64u(JSON.stringify(payload));
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token: string, secret: string): any | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return typeof data.exp === 'number' && data.exp > Date.now() ? data : null;
  } catch { return null; }
}

/* ─────────────── HTTP helpers ─────────────── */

function json(status: number, data: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}
const fail = (status: number, error: string) => json(status, { error });

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
function sessionCookie(token: string, secure: boolean, maxAge: number): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
async function body(req: Request): Promise<any> {
  if (!(req.headers.get('content-type') || '').includes('application/json')) return null;
  try { return await req.json(); } catch { return null; }
}
const userKey = (email: string) => `user:${email}`;
const idKey = (id: string) => `id:${id}`;
const publicUser = (u: any) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt });

/* ─────────────── Handler ─────────────── */

export function createApi(stores: Stores, secret: string | undefined) {
  async function currentUser(req: Request): Promise<any | null> {
    const token = readCookie(req, COOKIE);
    if (!token || !secret) return null;
    const session = verify(token, secret);
    if (!session) return null;
    const email = await stores.users.get(idKey(session.uid), { type: 'json' });
    if (!email) return null;
    const user = await stores.users.get(userKey(email), { type: 'json' });
    return user && user.sv === session.sv ? user : null;
  }

  function startSession(user: any, secure: boolean): string {
    const token = sign({ uid: user.id, sv: user.sv, exp: Date.now() + SESSION_DAYS * 86400000 }, secret!);
    return sessionCookie(token, secure, SESSION_DAYS * 86400);
  }

  return async function handle(req: Request): Promise<Response> {
    if (!secret) return fail(500, 'Server is missing SESSION_SECRET.');
    const url = new URL(req.url);
    const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
    const secure = url.protocol === 'https:';
    const method = req.method;

    if (route === 'signup' && method === 'POST') {
      const b = await body(req);
      const name = String(b?.name || '').trim().slice(0, 60);
      const email = String(b?.email || '').trim().toLowerCase();
      const password = String(b?.password || '');
      if (!name) return fail(400, 'Please enter your name.');
      if (!EMAIL_RE.test(email) || email.length > 254) return fail(400, 'Please enter a valid email address.');
      if (password.length < 8) return fail(400, 'Use at least 8 characters for your password.');
      if (password.length > 200) return fail(400, 'That password is too long.');
      if (await stores.users.get(userKey(email), { type: 'json' })) return fail(409, 'An account with that email already exists. Try signing in.');

      const salt = randomBytes(16);
      const hash = await hashPassword(password, salt);
      const user = { id: randomUUID(), email, name, salt: b64u(salt), hash: b64u(hash), sv: 1, createdAt: new Date().toISOString() };
      await stores.users.setJSON(userKey(email), user);
      await stores.users.setJSON(idKey(user.id), email);
      return json(201, { user: publicUser(user), state: null }, { 'Set-Cookie': startSession(user, secure) });
    }

    if (route === 'login' && method === 'POST') {
      const b = await body(req);
      const email = String(b?.email || '').trim().toLowerCase();
      const password = String(b?.password || '');
      const bad = () => fail(401, 'That email and password do not match.');
      if (!email || !password) return bad();

      const lock = await stores.attempts.get(email, { type: 'json' });
      if (lock && lock.until > Date.now()) return fail(429, 'Too many attempts. Please wait 15 minutes and try again.');

      const user = await stores.users.get(userKey(email), { type: 'json' });
      const hash = await hashPassword(password, user ? Buffer.from(user.salt, 'base64url') : randomBytes(16));
      const ok = !!user && timingSafeEqual(hash, Buffer.from(user.hash, 'base64url'));
      if (!ok) {
        const expired = lock && lock.until && lock.until <= Date.now();
        const fails = (expired ? 0 : lock?.fails || 0) + 1;
        await stores.attempts.setJSON(email, { fails, until: fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
        return bad();
      }
      if (lock) await stores.attempts.delete(email);
      const state = await stores.state.get(user.id, { type: 'json' });
      return json(200, { user: publicUser(user), state }, { 'Set-Cookie': startSession(user, secure) });
    }

    if (route === 'logout' && method === 'POST') {
      return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('', secure, 0) });
    }

    const user = await currentUser(req);
    if (!user) return fail(401, 'Please sign in.');

    if (route === 'me' && method === 'GET') {
      const state = await stores.state.get(user.id, { type: 'json' });
      return json(200, { user: publicUser(user), state });
    }

    if (route === 'me' && method === 'PATCH') {
      const b = await body(req);
      const name = String(b?.name || '').trim().slice(0, 60);
      if (!name) return fail(400, 'Please enter your name.');
      user.name = name;
      await stores.users.setJSON(userKey(user.email), user);
      return json(200, { user: publicUser(user) });
    }

    if (route === 'state' && method === 'PUT') {
      const text = await req.text();
      if (text.length > MAX_STATE_BYTES) return fail(413, 'Saved data is too large.');
      let state: unknown;
      try { state = JSON.parse(text); } catch { return fail(400, 'Invalid data.'); }
      if (!state || typeof state !== 'object' || Array.isArray(state)) return fail(400, 'Invalid data.');
      await stores.state.setJSON(user.id, state);
      return json(200, { ok: true });
    }

    if (route === 'logout-all' && method === 'POST') {
      user.sv = (user.sv || 1) + 1;
      await stores.users.setJSON(userKey(user.email), user);
      return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('', secure, 0) });
    }

    return fail(404, 'Not found.');
  };
}

/* In-memory store for local development and tests. */
export function memoryStores(): Stores {
  const make = (): KV => {
    const m = new Map<string, string>();
    return {
      async get(k) { const v = m.get(k); return v === undefined ? null : JSON.parse(v); },
      async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
      async delete(k) { m.delete(k); },
    };
  };
  return { users: make(), state: make(), attempts: make() };
}
