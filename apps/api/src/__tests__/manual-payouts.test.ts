import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEFAULT_TENANT_ID, TABLES } from '@openpartner/db';
import { db } from '../db.js';
import { createApp } from '../app.js';

const ADMIN_KEY = 'op_manual_payout_test_admin_0123456789012345';
process.env.ADMIN_API_KEY = ADMIN_KEY;
process.env.OPENPARTNER_MODE = 'selfhost';
process.env.OPENPARTNER_TENANCY = 'single';
const skip = !process.env.DATABASE_URL || process.env.INTEGRATION === 'skip';
const app = createApp({ enableLogger: false });
const post = (path: string, body = {}) => request(app).post(path).set('Authorization', `Bearer ${ADMIN_KEY}`).send(body);
const get = (path: string) => request(app).get(path).set('Authorization', `Bearer ${ADMIN_KEY}`);

beforeEach(async () => {
  if (skip) return;
  for (const table of [TABLES.CommissionAdjustment, TABLES.Commission, TABLES.Attribution, TABLES.Event, TABLES.Identity, TABLES.Click, TABLES.Link, TABLES.Program, TABLES.Payout, TABLES.ApiKey, TABLES.Partner, TABLES.Config]) await db(table).del();
  await db(TABLES.Tenant).where({ id: DEFAULT_TENANT_ID }).update({ payoutThresholdCents: 0 });
});
afterAll(async () => { await db.destroy(); });

async function fixture(suffix: string, holdbackDays = 0) {
  const partner = await post('/partners', { email: `${suffix}@example.test`, name: suffix, sendInvite: false });
  expect(partner.status).toBe(201);
  expect(partner.body.activatedAt).not.toBeNull();
  const program = await post('/programs', { name: suffix, commissionRule: { type: 'percent', value: 20, recurring: true }, holdbackDays, destinationUrl: 'http://localhost:5673/login' });
  const link = await post(`/partners/${partner.body.id}/links`, { linkKey: `manual-${suffix}`, programId: program.body.id });
  expect(link.status).toBe(201);
  const externalEventId = `manual-${suffix}-payment`;
  expect((await post('/payments/simulate', { partnerId: partner.body.id, linkKey: link.body.linkKey, userId: `user-${suffix}`, amount: 1000, externalEventId, currency: 'RUB' })).status).toBe(201);
  const commission = await db(TABLES.Commission).where({ partnerId: partner.body.id }).first();
  return { partnerId: partner.body.id as string, commissionId: commission!.id as string, externalEventId };
}

describe.skipIf(skip)('local manual payout lifecycle', () => {
  it('scopes planning, reserves once, confirms once and isolates partner permissions', async () => {
    const a = await fixture('a');
    const b = await fixture('b');
    expect((await post(`/commissions/${a.commissionId}/approve`)).status).toBe(200);
    expect((await post(`/commissions/${b.commissionId}/approve`)).status).toBe(200);
    const planned = await post('/payouts/run', { partnerId: a.partnerId });
    expect(planned.body.payouts).toHaveLength(1);
    expect(planned.body.payouts[0]).toMatchObject({ partnerId: a.partnerId, amount: 200, status: 'pending' });
    expect((await get(`/partners/${a.partnerId}/dashboard`)).body.balances).toMatchObject({ available: 0, pending: 200, paid: 0 });
    expect((await get(`/partners/${b.partnerId}/dashboard`)).body.balances.available).toBe(200);
    expect((await get('/admin/overview')).body.totals).toMatchObject({ commissionApproved: 200, commissionPending: 200, commissionPaid: 0 });
    expect((await post('/payouts/run', { partnerId: a.partnerId })).body.payouts).toHaveLength(0);
    const payoutId = planned.body.payouts[0].payoutId;
    const key = await post(`/partners/${a.partnerId}/api-keys`, { label: 'test' });
    const history = await request(app).get(`/partners/${a.partnerId}/payouts`).set('Authorization', `Bearer ${key.body.plaintext}`);
    expect(history.body.payouts[0].status).toBe('pending');
    expect((await request(app).post(`/payouts/${payoutId}/confirm`).set('Authorization', `Bearer ${key.body.plaintext}`)).status).toBe(403);
    expect((await request(app).get(`/partners/${b.partnerId}/payouts`).set('Authorization', `Bearer ${key.body.plaintext}`)).status).toBe(403);
    expect((await post(`/payouts/${payoutId}/confirm`)).status).toBe(200);
    expect((await get(`/partners/${a.partnerId}/dashboard`)).body.balances).toMatchObject({ available: 0, pending: 0, paid: 200 });
    expect((await post(`/payouts/${payoutId}/confirm`)).status).toBe(409);
    expect((await post(`/payouts/${payoutId}/cancel`)).status).toBe(409);
    expect((await post('/payouts/run', { partnerId: a.partnerId })).body.payouts).toHaveLength(0);
  });

  it('refund of a reserved payment prevents stale confirmation; cancellation releases it', async () => {
    const a = await fixture('refund');
    await post(`/commissions/${a.commissionId}/approve`);
    const planned = await post('/payouts/run', { partnerId: a.partnerId });
    const payoutId = planned.body.payouts[0].payoutId;
    expect((await post('/payments/refunds', { originalExternalEventId: a.externalEventId, refundExternalEventId: 'refund-1', amount: 500, currency: 'RUB' })).status).toBe(201);
    expect((await post(`/payouts/${payoutId}/confirm`)).body.error).toBe('payout_amount_changed');
    expect((await post(`/payouts/${payoutId}/cancel`)).status).toBe(200);
    expect((await get(`/partners/${a.partnerId}/dashboard`)).body.balances).toMatchObject({ available: 100, pending: 0, paid: 0, total: 100 });
    const fresh = await post('/payouts/run', { partnerId: a.partnerId });
    expect(fresh.body.payouts[0].amount).toBe(100);
    expect((await post(`/payouts/${fresh.body.payouts[0].payoutId}/confirm`)).status).toBe(200);
    expect((await get(`/partners/${a.partnerId}/dashboard`)).body.balances.paid).toBe(100);
  });

  it('enforces the minimum amount and commission holdback', async () => {
    const held = await fixture('held', 30);
    expect((await post(`/commissions/${held.commissionId}/approve`)).body.error).toBe('holdback_active');
    const a = await fixture('threshold');
    await post(`/commissions/${a.commissionId}/approve`);
    await db(TABLES.Tenant).where({ id: DEFAULT_TENANT_ID }).update({ payoutThresholdCents: 20100 });
    const blocked = await post('/payouts/run', { partnerId: a.partnerId });
    expect(blocked.body.payouts).toHaveLength(0);
    expect(blocked.body.skippedBelowThreshold[0].amount).toBe(200);
    await db(TABLES.Tenant).where({ id: DEFAULT_TENANT_ID }).update({ payoutThresholdCents: 20000 });
    expect((await post('/payouts/run', { partnerId: a.partnerId })).body.payouts).toHaveLength(1);
  });

  it('reads and cancels legacy prematurely-paid pending reservations without changing completed payouts', async () => {
    const a = await fixture('legacy');
    await post(`/commissions/${a.commissionId}/approve`);
    const planned = await post('/payouts/run', { partnerId: a.partnerId });
    const payoutId = planned.body.payouts[0].payoutId;
    await db(TABLES.Commission).where({ id: a.commissionId }).update({ status: 'paid', paidAt: new Date() });
    expect((await get(`/partners/${a.partnerId}/dashboard`)).body.balances).toMatchObject({ pending: 200, paid: 0 });
    expect((await post(`/payouts/${payoutId}/cancel`)).status).toBe(200);
    expect((await get(`/partners/${a.partnerId}/dashboard`)).body.balances).toMatchObject({ available: 200, pending: 0, paid: 0 });
    expect((await db(TABLES.Commission).where({ id: a.commissionId }).first())!.paidAt).toBeNull();
  });
});
