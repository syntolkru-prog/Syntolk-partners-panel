import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ulid } from 'ulid';
import { DEFAULT_TENANT_ID as tenantId, trackingSourceParams } from '@openpartner/db';
import { createApp } from '../../app.js';
import { db, appDb } from '../../db.js';
import { calculateCoachForecast } from '../forecast-adapter.js';
import { assertIsolatedCoachDatabase } from '../test-guard.js';

assertIsolatedCoachDatabase(process.env.DATABASE_URL!, process.env.COACH_WORKING_DB);
if (process.env.INTEGRATION !== 'run') throw new Error('Use scripts/coach-test.mts with the isolated database.');
process.env.OPENPARTNER_TENANCY = 'single';
process.env.OPENPARTNER_MODE = 'selfhost';
const app = createApp({ enableLogger: false });
const admin = () => ({ Authorization: `Bearer ${process.env.ADMIN_API_KEY}` });
const post = (path: string, body = {}) => request(app).post(path).set(admin()).send(body);
const ago = (days: number) => new Date(Date.now() - days * 86400000);
const scenarioA = `parity-a-${ulid()}`, scenarioB = `parity-b-${ulid()}`;
let until: string, firstProgram: string, secondProgram: string;
let a: Awaited<ReturnType<typeof partner>>, b: Awaited<ReturnType<typeof partner>>;
let sourceA: any, sourceB: any;

afterAll(async () => { await Promise.all([db.destroy(), appDb.destroy()]); });

async function program(model: 'linear' | 'last_click') {
  const r = await post('/programs', { name: `Parity ${ulid()}`, destinationUrl: 'https://example.test', attributionModel: model,
    commissionRule: { type: 'percent', value: 20, recurring: true } });
  expect(r.status, r.text).toBe(201);
  return r.body.id as string;
}

async function partner() {
  const r = await post('/partners', { name: `Parity ${ulid()}`, email: `${ulid()}@example.test`, sendInvite: false });
  expect(r.status, r.text).toBe(201);
  const credential = await post(`/partners/${r.body.id}/api-keys`, { label: 'isolated analytics parity' });
  expect(credential.status, credential.text).toBe(201);
  return { id: r.body.id as string, key: credential.body.plaintext as string };
}

async function link(partnerId: string, programId: string) {
  const r = await post(`/partners/${partnerId}/links`, { programId, linkKey: `parity-${ulid()}` });
  expect(r.status, r.text).toBe(201);
  return r.body;
}

async function source(partnerId: string, programId: string, scenarioId: string, platformId: string) {
  const model = await calculateCoachForecast({});
  const settings = { ...model.settings, frequency: { post: 0, short: 2, long: 0, article: 0, circle: 0 } };
  await db('CoachForecastSnapshot').insert({ id: ulid(), tenantId, partnerId, programId, status: 'confirmed',
    data: JSON.stringify({ scenarioId, scenarioName: scenarioId === scenarioA ? 'Parity A' : 'Parity B', settings }) });
  const l = await link(partnerId, programId);
  const r = await post(`/partners/${partnerId}/links/${l.id}/sources`, { scenarioId, platformId, formatId: 'short' });
  expect(r.status, r.text).toBe(200);
  return { ...r.body.source, link: l };
}

async function click(src: any, ts: Date, fraudFlag?: string) {
  const id = ulid(), params = trackingSourceParams(src);
  const r = await post('/clicks', { id, linkKey: src.link.linkKey, landingUrl: 'https://example.test', ts: ts.toISOString(),
    utmCampaign: params.utm_campaign, utmSource: params.utm_source, utmMedium: params.utm_medium, utmContent: params.utm_content, fraudFlag });
  expect(r.status, r.text).toBe(201);
  return id;
}

async function identify(cref: string, userId: string) {
  const r = await post('/attribution/identify', { cref, userId });
  expect(r.status, r.text).toBe(200);
}

async function signup(userId: string, ts = new Date()) {
  const r = await post('/attribution/events', { userId, type: 'signup', externalEventId: ulid(), ts: ts.toISOString() });
  expect(r.status, r.text).toBe(200);
}

async function pay(userId: string, value: number, ts = new Date()) {
  const externalEventId = ulid();
  const r = await post('/payments/events', { userId, value, currency: 'RUB', externalEventId, ts: ts.toISOString() });
  expect(r.status, r.text).toBe(201);
  return externalEventId;
}

async function refund(originalExternalEventId: string, amount: number) {
  const r = await post('/payments/refunds', { originalExternalEventId, refundExternalEventId: ulid(), amount, currency: 'RUB' });
  expect(r.status, r.text).toBe(201);
}

async function reports(owner: { id: string; key: string }, extra: Record<string, string | string[]> = {}) {
  const q = new URLSearchParams({ period: '30d', until, currency: 'RUB', includeSeries: 'true', ...Object.fromEntries(Object.entries(extra).filter(([,v]) => typeof v === 'string')) });
  for (const [k, v] of Object.entries(extra)) if (Array.isArray(v)) for (const id of v) q.append(k, id);
  const partnerResponse = await request(app).get(`/partners/${owner.id}/analytics?${q}`).set('Authorization', `Bearer ${owner.key}`);
  const adminResponse = await request(app).get(`/admin/analytics?partnerId=${owner.id}&${q}`).set(admin());
  expect(partnerResponse.status, partnerResponse.text).toBe(200);
  expect(adminResponse.status, adminResponse.text).toBe(200);
  return { partner: partnerResponse.body, admin: adminResponse.body };
}

function expectParity(p: any, adminReport: any) {
  for (const field of ['counts', 'amountsMinor', 'conversions', 'balances', 'currency', 'timezone', 'period', 'metricBasis', 'dataQuality', 'warnings', 'views', 'ctr']) {
    expect(adminReport[field], field).toEqual(p[field]);
  }
  expect(adminReport.series.points).toEqual(p.series.points);
}

beforeAll(async () => {
  firstProgram = await program('linear'); secondProgram = await program('last_click');
  a = await partner(); b = await partner();
  await db('CoachProfile').insert({ id: ulid(), tenantId, partnerId: a.id, status: 'complete', data: JSON.stringify({ timezone: 'America/New_York' }) });
  sourceA = await source(a.id, firstProgram, scenarioA, 'vkclips');
  const otherTouch = await source(b.id, firstProgram, scenarioA, 'vkclips');
  sourceB = await source(a.id, secondProgram, scenarioB, 'ytshorts');
  const user = ulid();
  await identify(await click(sourceA, ago(3)), user);
  await identify(await click(otherTouch, ago(2)), user);
  await signup(user, ago(1));
  const first = await pay(user, 1000, new Date(Date.now() - 3600000));
  await pay(user, 500, new Date(Date.now() - 1800000));
  await refund(first, 250);
  const secondUser = ulid();
  await identify(await click(sourceB, ago(10)), secondUser); await signup(secondUser, ago(9)); await pay(secondUser, 2000, ago(9));
  const fraudUser = ulid();
  await identify(await click(sourceA, new Date(), 'manual'), fraudUser); await signup(fraudUser); await pay(fraudUser, 700);
  until = new Date().toISOString();
});

describe('admin/partner canonical calculation parity', () => {
  const cases: Array<[string, () => Record<string, string | string[]>]> = [
    ['7d', () => ({ period: '7d' })],
    ['30d', () => ({ period: '30d' })],
    ['custom', () => ({ period: 'custom', from: ago(12).toISOString().slice(0,10), to: new Date().toISOString().slice(0,10) })],
    ['program', () => ({ programId: firstProgram })],
    ['platform', () => ({ platformId: 'vkclips' })],
    ['multiple platforms', () => ({ platformIds: ['vkclips', 'ytshorts'] })],
    ['scenario', () => ({ scenarioId: scenarioA })],
    ['multiple scenarios', () => ({ scenarioIds: [scenarioA, scenarioB] })],
    ['format', () => ({ formatId: 'short' })],
    ['source', () => ({ sourceId: sourceA.id })],
    ['currency', () => ({ currency: 'USD' })],
    ['empty rows', () => ({ includeEmpty: 'true' })],
    ['platform series', () => ({ groupBy: 'platform', seriesBy: 'platform' })],
  ];
  it.each(cases)('matches every shared field with the %s filter', async (_name, filters) => {
    const r = await reports(a, filters()); expectParity(r.partner, r.admin);
    expect(r.admin.timezone).toBe('America/New_York');
  });

  it('keeps first/repeat, refunds and fraud exclusion identical for both partner credentials', async () => {
    for (const owner of [a, b]) {
      const r = await reports(owner, { programId: firstProgram }); expectParity(r.partner, r.admin);
      expect(r.partner.counts).toMatchObject({ clicks: 1, identities: 1, registrations: 1, payingCustomers: 1, paymentCount: 2, firstPaymentCount: 1, repeatPaymentCount: 1 });
      expect(r.partner.amountsMinor).toEqual({ observedPayments: 75000, refunds: 12500, netPayments: 62500, netAccrued: 12500 });
    }
  });

  it('counts global users and payments distinctly across two partners while adding weighted money', async () => {
    const q = new URLSearchParams({ period: '30d', until, currency: 'RUB', includeEmpty: 'false' });
    q.append('partnerIds', a.id); q.append('partnerIds', b.id);
    const r = await request(app).get(`/admin/analytics?${q}`).set(admin());
    expect(r.status, r.text).toBe(200);
    expect(r.body.counts).toMatchObject({ clicks: 3, identities: 2, registrations: 2, payingCustomers: 2, paymentCount: 3, firstPaymentCount: 2, repeatPaymentCount: 1 });
    expect(r.body.amountsMinor).toEqual({ observedPayments: 350000, refunds: 25000, netPayments: 325000, netAccrued: 65000 });
    expect(r.body.rows).toHaveLength(2);
    expect(r.body.rows.reduce((n: number, row: any) => n + row.counts.payingCustomers, 0)).toBe(3);
    expect(r.body.rows.reduce((n: number, row: any) => n + row.amountsMinor.netPayments, 0)).toBe(325000);
  });

  it('does not grant partners administrative analytics access', async () => {
    expect((await request(app).get('/admin/analytics').set('Authorization', `Bearer ${a.key}`)).status).toBe(403);
    expect((await request(app).get('/admin/analytics')).status).toBe(401);
  });

  it('cannot widen a partner endpoint with administrative partner selectors', async () => {
    const base = new URLSearchParams({ period: '30d', until, currency: 'RUB' });
    const own = await request(app).get(`/partners/${a.id}/analytics?${base}`).set('Authorization', `Bearer ${a.key}`);
    const forged = await request(app).get(`/partners/${a.id}/analytics?${base}&partnerId=${b.id}&partnerIds=${b.id}`).set('Authorization', `Bearer ${a.key}`);
    expect(own.status, own.text).toBe(200); expect(forged.status, forged.text).toBe(200);
    for (const field of ['counts', 'amountsMinor', 'balances', 'conversions']) expect(forged.body[field]).toEqual(own.body[field]);
  });

  it('smokes real redirect → trusted identity/signup → payments/refund → both reports', async () => {
    const owner = await partner(), programId = await program('last_click'), l = await link(owner.id, programId);
    const probe = createServer(); await new Promise<void>(done => probe.listen(0, '127.0.0.1', done));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done()));
    const child = spawn(process.execPath, [resolve('../router/dist/server.js')], { cwd: resolve('../..'), windowsHide: true, env: { ...process.env, ROUTER_PORT: String(port), DATABASE_URL: process.env.DATABASE_URL! }, stdio: 'ignore' });
    try {
      let ready = false;
      for (let i = 0; i < 50; i++) { try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch {} if (ready) break; await delay(100); }
      expect(ready).toBe(true);
      const redirect = await fetch(`http://127.0.0.1:${port}/r/${l.linkKey}`, { redirect: 'manual' });
      expect(redirect.status).toBe(302);
      const cref = new URL(redirect.headers.get('location')!).searchParams.get('cref')!;
      expect(await db('Click').where({ id: cref, tenantId, partnerId: owner.id }).first()).toBeDefined();
      const userId = ulid(); await identify(cref, userId); await signup(userId);
      const first = await pay(userId, 1000); await pay(userId, 500); await refund(first, 250);
      const r = await reports(owner, { period: 'all', until: new Date().toISOString() }); expectParity(r.partner, r.admin);
      expect(r.partner.counts).toMatchObject({ clicks: 1, identities: 1, registrations: 1, payingCustomers: 1, paymentCount: 2, firstPaymentCount: 1, repeatPaymentCount: 1 });
      expect(r.partner.amountsMinor).toEqual({ observedPayments: 150000, refunds: 25000, netPayments: 125000, netAccrued: 25000 });
      expect(r.partner.balances).toMatchObject({ accrued: 250, available: 0, pending: 0, paid: 0, debt: 0 });
      console.info('ANALYTICS_PARITY_FIXTURE', JSON.stringify({ counts: r.partner.counts, amountsMinor: r.partner.amountsMinor, balances: r.partner.balances }));
    } finally {
      if (child.pid && child.exitCode === null) { const stopped = new Promise<void>(done => child.once('exit', () => done())); child.kill(); await Promise.race([stopped, delay(2000)]); }
    }
  });
});
