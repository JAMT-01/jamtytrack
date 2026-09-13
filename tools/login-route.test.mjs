import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const bundle = readFileSync(new URL('../dist/worker.js', import.meta.url), 'utf8');
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`);
const origin = 'https://jamtytrack.example';
function fixture({ configured = true, lockedOut = false } = {}) {
  let assetRequests = 0;
  const statement = {
    bind() { return this; },
    async first() { return lockedOut ? { locked_until: new Date(Date.now() + 60000).toISOString() } : null; },
    async run() { return { success: true }; }
  };
  const env = {
    APP_PASSWORD: configured ? 'test-only-passphrase' : undefined,
    DB: { prepare() { return statement; } },
    ASSETS: { async fetch() { assetRequests++; return new Response('authenticated app shell'); } }
  };
  return {
    fetch(path, init) { return worker.fetch(new Request(origin + path, init), env, { waitUntil() {} }); },
    assetRequests() { return assetRequests; }
  };
}

test('opening or refreshing the login URL serves a complete form without protected assets', async () => {
  const app = fixture();
  const response = await app.fetch('/api/auth/login');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  assert.match(html, /<form method="POST" action="\/api\/auth\/login">/);
  assert.match(html, /name="password"/);
  assert.doesNotMatch(html, /<script[^>]*type="module"/);
  assert.equal(app.assetRequests(), 0);
});

test('successful login sets a session, redirects home, and skips the form when already signed in', async () => {
  const app = fixture();
  const response = await app.fetch('/api/auth/login', { method: 'POST', body: new URLSearchParams({ password: 'test-only-passphrase' }) });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^jamtytrack_session=/);
  const home = await app.fetch('/', { headers: { cookie } });
  assert.equal(home.status, 200);
  assert.equal(await home.text(), 'authenticated app shell');
  const login = await app.fetch('/api/auth/login', { headers: { cookie } });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), '/');
});

test('a failed password followed by a reload shows the login form', async () => {
  const app = fixture();
  const rejected = await app.fetch('/api/auth/login', { method: 'POST', body: new URLSearchParams({ password: 'wrong' }) });
  assert.equal(rejected.status, 401);
  assert.match(await rejected.text(), /That passphrase is not right/);
  const refreshed = await app.fetch('/api/auth/login');
  assert.equal(refreshed.status, 200);
  assert.match(await refreshed.text(), /name="password"/);
  assert.equal(app.assetRequests(), 0);
});

test('missing configuration and password rate limits still fail closed', async () => {
  assert.equal((await fixture({ configured: false }).fetch('/api/auth/login')).status, 503);
  const response = await fixture({ lockedOut: true }).fetch('/api/auth/login', { method: 'POST', body: new URLSearchParams({ password: 'test-only-passphrase' }) });
  assert.equal(response.status, 429);
  assert.equal((await fixture().fetch('/assets/app.js')).status, 401);
});
