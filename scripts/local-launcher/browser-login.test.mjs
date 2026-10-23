import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { issueBrowserTickets, redeemBrowserTicket, localBrowserLogin, localOrigins } from './browser-login.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'syntolk-browser-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await issueBrowserTickets(root);
  const path = join(root, '.local-demo/browser-login/admin.ticket.json');
  const ticket = JSON.parse(await readFile(path, 'utf8'));
  return { root, path, ticket };
}
const fakeCredentials = async () => ({ admin: { token: 'fake-admin' }, partner: { token: 'fake-partner' } });

test('a valid file authorizes only its assigned role and is consumed once', async t => {
  const f = await fixture(t);
  assert.equal(await redeemBrowserTicket(f.root, f.ticket, localOrigins.partner, fakeCredentials), null);
  const result = await redeemBrowserTicket(f.root, f.ticket, localOrigins.admin, fakeCredentials);
  assert.deepEqual(result, { credential: 'fake-admin', role: 'admin' });
  assert.equal(await redeemBrowserTicket(f.root, f.ticket, localOrigins.admin, fakeCredentials), null);
});

test('wrong, expired and malicious tickets never reach credentials', async t => {
  const f = await fixture(t); let loaded = 0;
  const load = async () => { loaded++; return fakeCredentials(); };
  for (const ticket of [{ ...f.ticket, token: '0'.repeat(64) }, { ...f.ticket, role: '../../other' }, { ...f.ticket, token: 'ю'.repeat(64) }]) {
    assert.equal(await redeemBrowserTicket(f.root, ticket, localOrigins.admin, load), null);
  }
  await writeFile(f.path, JSON.stringify({ ...f.ticket, expiresAt: new Date(0).toISOString() }));
  assert.equal(await redeemBrowserTicket(f.root, f.ticket, localOrigins.admin, load), null);
  assert.equal(loaded, 0);
});

test('concurrent requests cannot redeem a file twice', async t => {
  const f = await fixture(t);
  const results = await Promise.all([redeemBrowserTicket(f.root, f.ticket, localOrigins.admin, fakeCredentials), redeemBrowserTicket(f.root, f.ticket, localOrigins.admin, fakeCredentials)]);
  assert.equal(results.filter(Boolean).length, 1);
});

test('dev route rejects cross-origin, non-loopback, GET and missing browser headers', async t => {
  const f = await fixture(t); let handler;
  localBrowserLogin(f.root).configureServer({ middlewares: { use: middleware => { handler = middleware; } } });
  const valid = { method: 'POST', url: '/__syntolk_local_login', headers: { host: 'localhost:5673', origin: localOrigins.admin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' } };
  for (const req of [{ ...valid, method: 'GET' }, { ...valid, headers: { ...valid.headers, origin: 'https://other.test' } }, { ...valid, headers: { ...valid.headers, 'sec-fetch-site': 'cross-site' } }, { ...valid, headers: { ...valid.headers, host: '127.0.0.1:5673' } }, { ...valid, socket: { remoteAddress: '192.168.1.5' } }]) {
    let status, body;
    await handler(req, { writeHead: code => { status = code; }, end: text => { body = JSON.parse(text); } }, () => assert.fail('auth route must not fall through'));
    assert.equal(status, 403);
    assert.ok(!('credential' in body));
  }
});
