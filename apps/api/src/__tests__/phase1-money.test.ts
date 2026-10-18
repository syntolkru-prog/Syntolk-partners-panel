import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ulid } from 'ulid';
import { DEFAULT_TENANT_ID as tenantId, TABLES, type CommissionRow, type EventRow } from '@openpartner/db';
import { db, appDb } from '../db.js';
import { createApp } from '../app.js';
import { attributeEvent } from '../attribution.js';
import { ingestPaymentEvent } from '../payment-events.js';
import { adjustmentTotalsByCommission, commissionGroupKey, manualPayableAmounts, manualPayoutBalances, netCommissionAmount } from '../commission-net.js';
import { assertIsolatedCoachDatabase } from '../coach/test-guard.js';

// This suite must fail closed, never silently skip or clear a working DB.
assertIsolatedCoachDatabase(process.env.DATABASE_URL!, process.env.COACH_WORKING_DB);
const ADMIN = 'phase1-money-test-admin';
const SECRET = 'phase1-cloudpayments-test-secret';
process.env.ADMIN_API_KEY = ADMIN;
process.env.CLOUDPAYMENTS_WEBHOOK_SECRET = SECRET;
const app = createApp({ enableLogger: false });
const post = (path: string, body = {}) => request(app).post(path).set('Authorization', `Bearer ${ADMIN}`).send(body);

beforeEach(async () => {
  for (const table of [TABLES.CommissionAdjustment, TABLES.Commission, TABLES.Attribution, TABLES.Event, TABLES.Identity, TABLES.Click, TABLES.Link, TABLES.Coupon, TABLES.Program, TABLES.Payout, TABLES.ApiKey, TABLES.Partner, TABLES.Config]) await db(table).del();
  await db(TABLES.Tenant).where({ id: tenantId }).update({ payoutThresholdCents: 0 });
});
afterAll(async () => { await Promise.all([db.destroy(), appDb.destroy()]); });

async function fixture() {
  const partner = await post('/partners', { email: `${ulid()}@example.test`, name: 'Money regression', sendInvite: false });
  expect(partner.status).toBe(201);
  const program = await post('/programs', { name: 'Money regression', commissionRule: { type: 'percent', value: 20, recurring: true }, destinationUrl: 'https://example.test' });
  expect(program.status).toBe(201);
  const link = await post(`/partners/${partner.body.id}/links`, { programId: program.body.id, linkKey: `money-${ulid()}` });
  expect(link.status).toBe(201);
  const click = async () => {
    const id = ulid();
    await db(TABLES.Click).insert({ id, tenantId, linkId: link.body.id, partnerId: partner.body.id, programId: program.body.id, landingUrl: 'https://example.test', ts: new Date() });
    return id;
  };
  const userId = ulid();
  const identify = (cref: string) => post('/attribution/identify', { cref, userId });
  const pay = (externalEventId: string, value = 1000, type = 'invoice_paid', currency = 'RUB') => post('/payments/events', { userId, type, value, currency, externalEventId });
  const refund = (originalExternalEventId: string, refundExternalEventId: string, amount: number, currency = 'RUB') => post('/payments/refunds', { originalExternalEventId, refundExternalEventId, amount, currency });
  const commissions = () => db<CommissionRow>(TABLES.Commission).where({ partnerId: partner.body.id });
  const approve = async () => { for (const c of await commissions().where({ status: 'accrued' })) expect((await post(`/commissions/${c.id}/approve`)).status).toBe(200); };
  const plan = () => post('/payouts/run', { partnerId: partner.body.id });
  const confirm = async (id: string) => { expect((await post(`/payouts/${id}/confirm`)).status).toBe(200); };
  const net = async () => {
    const rows = await commissions();
    const adjustments = await adjustmentTotalsByCommission(db, rows.map((c) => c.id));
    return rows.reduce((sum, c) => sum + (c.status === 'reversed' ? 0 : netCommissionAmount(c, adjustments, c.id)), 0);
  };
  return { partnerId: partner.body.id as string, programId: program.body.id as string, userId, click, identify, pay, refund, commissions, approve, plan, confirm, net };
}

describe('Phase 1 money invariants (real isolated PostgreSQL)', () => {
  it('A/B/G: click → trusted identify → payment earns once; later click and retries cannot append allocations', async () => {
    const f = await fixture();
    expect((await f.identify(await f.click())).status).toBe(200);
    const payment = await f.pay('once');
    expect(payment.status).toBe(201);
    const allocations = await db(TABLES.Attribution).where({ eventId: payment.body.eventId });
    const commissions = await f.commissions();
    expect(allocations).toHaveLength(1);
    expect(commissions).toHaveLength(1);
    expect(commissions[0].amount).toBe('200.00');
    expect((await f.identify(await f.click())).body.backfilledAttributions).toBe(0);
    expect((await f.pay('once')).body.replayed).toBe(true);
    const event = await db<EventRow>(TABLES.Event).where({ id: payment.body.eventId }).first();
    expect((await attributeEvent(db, event!, 'linear')).status).toBe('already_attributed');
    expect(await db(TABLES.Attribution).where({ eventId: event!.id })).toEqual(allocations);
    expect(await f.commissions()).toEqual(commissions);
  });

  it('freezes a whole allocation across concurrent first attribution calls with different models', async () => {
    const f = await fixture();
    const payment = await f.pay('unattributed');
    expect(payment.body.attribution.status).toBe('no_identity');
    for (const cref of [await f.click(), await f.click()]) await db(TABLES.Identity).insert({ id: ulid(), tenantId, clickId: cref, userId: f.userId });
    const event = (await db<EventRow>(TABLES.Event).where({ id: payment.body.eventId }).first())!;
    const results = await Promise.all([attributeEvent(db, event, 'first_click'), attributeEvent(db, event, 'linear')]);
    expect(results.map((r) => r.status).sort()).toEqual(['already_attributed', 'attributed']);
    const rows = await db(TABLES.Attribution).where({ eventId: event.id });
    expect(new Set(rows.map((r) => r.model)).size).toBe(1);
    expect(rows.reduce((sum, r) => sum + Number(r.weight), 0)).toBe(1);
    expect(await f.net()).toBe(200);
  });

  it('concurrent identify backfills and concurrent payment retries create one commission', async () => {
    const f = await fixture();
    await f.pay('before-identify');
    const stitched = await Promise.all([f.identify(await f.click()), f.identify(await f.click())]);
    expect(stitched.map((r) => r.status)).toEqual([200, 200]);
    expect(await f.commissions()).toHaveLength(1);
    const retries = await Promise.all([f.pay('same-id'), f.pay('same-id')]);
    expect(retries.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(new Set(retries.map((r) => r.body.eventId)).size).toBe(1);
    expect(await db(TABLES.Event).where({ externalEventId: 'same-id' })).toHaveLength(1);
    expect(await f.commissions()).toHaveLength(2);
    expect(await f.net()).toBe(400);
  });

  it.each([[1000, 0], [400, 120]])('C: refund %i before identity leaves net commission %i after backlog', async (amount, expected) => {
    const f = await fixture();
    await f.pay('before-identity');
    expect((await f.refund('before-identity', 'early-refund', amount)).status).toBe(201);
    expect((await f.identify(await f.click())).body.backfilledAttributions).toBe(1);
    expect(await f.net()).toBe(expected);
    expect(await f.commissions()).toHaveLength(1);
    expect(await db(TABLES.Attribution).join(TABLES.Event, 'Event.id', 'Attribution.eventId').where('Event.type', 'refund')).toHaveLength(0);
  });

  it('D: cumulative 600 + 400 of 1000 is allowed and fully reverses unpaid earnings', async () => {
    const f = await fixture();
    await f.identify(await f.click());
    await f.pay('cumulative');
    expect((await f.refund('cumulative', 'r600', 600)).body.fullRefund).toBe(false);
    const final = await f.refund('cumulative', 'r400', 400);
    expect(final.status).toBe(201);
    expect(final.body.fullRefund).toBe(true);
    expect(await f.net()).toBe(0);
  });

  it('E: cumulative 600 + 600 is rejected without writing a second refund', async () => {
    const f = await fixture();
    await f.pay('cumulative');
    expect((await f.refund('cumulative', 'first', 600)).status).toBe(201);
    const rejected = await f.refund('cumulative', 'too-much', 600);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error).toBe('invalid_refund_amount');
    expect(await db(TABLES.Event).where({ type: 'refund' })).toHaveLength(1);
  });

  it('F: rejects wrong currency, refund originals, and missing/zero original amounts', async () => {
    const f = await fixture();
    await f.pay('payment');
    expect((await f.refund('payment', 'usd', 100, 'USD')).body.error).toBe('refund_currency_mismatch');
    await f.refund('payment', 'refund', 100);
    expect((await f.refund('refund', 'refund-refund', 10)).body.error).toBe('original_event_not_payment');
    await post('/attribution/events', { userId: f.userId, type: 'signup', currency: 'RUB', externalEventId: 'no-value' });
    expect((await f.refund('no-value', 'no-value-refund', 10)).body.error).toBe('original_payment_has_no_amount');
    await f.pay('zero', 0);
    expect((await f.refund('zero', 'zero-refund', 10)).body.error).toBe('original_payment_has_no_amount');
    expect(await db(TABLES.Event).where({ type: 'refund' })).toHaveLength(1);
  });

  it('serializes concurrent over-refunds and makes concurrent identical refunds idempotent', async () => {
    const f = await fixture();
    await f.identify(await f.click());
    await f.pay('racing');
    const racing = await Promise.all([f.refund('racing', 'race-a', 600), f.refund('racing', 'race-b', 600)]);
    expect(racing.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await f.net()).toBe(80);
    const duplicate = await Promise.all([f.refund('racing', 'last-400', 400), f.refund('racing', 'last-400', 400)]);
    expect(duplicate.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await db(TABLES.Event).where({ type: 'refund' })).toHaveLength(2);
    expect(await f.net()).toBe(0);
  });

  it('serializes late attribution against refund and never loses its clawback', async () => {
    const f = await fixture();
    await f.pay('race-backlog');
    const cref = await f.click();
    const responses = await Promise.all([f.identify(cref), f.refund('race-backlog', 'race-backlog-refund', 1000)]);
    expect(responses.map((r) => r.status)).toEqual([200, 201]);
    expect(await f.net()).toBe(0);
    expect((await f.commissions())[0].status).toBe('reversed');
  });

  it.each(['invoice_paid', 'recurring_payment', 'payment', 'custom_money'])('requires an external ID for generic monetary type %s', async (type) => {
    const f = await fixture();
    const invalid = await post('/attribution/events', { userId: f.userId, type, ...(type === 'custom_money' ? { value: 0 } : {}) });
    expect(invalid.status).toBe(400);
    expect(await db(TABLES.Event)).toHaveLength(0);
  });

  it.each(['/attribution/events', '/payments/events'])('directs %s refunds to the refund route with a structured 400', async (path) => {
    const rejected = await post(path, { userId: 'u', type: 'refund', value: 100, externalEventId: 'bypass-refund' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.detail.fieldErrors.type[0]).toContain('/payments/refunds');
    expect(await db(TABLES.Event)).toHaveLength(0);
  });

  it('keeps custom recurring payment originals refundable', async () => {
    const f = await fixture();
    await f.identify(await f.click());
    expect((await f.pay('recurring', 1000, 'recurring_payment')).status).toBe(201);
    expect((await f.refund('recurring', 'recurring-refund', 250)).status).toBe(201);
    expect(await f.net()).toBe(150);
  });

  it('preserves signed CloudPayments custom Pay and Refund contracts and stable IDs', async () => {
    const f = await fixture();
    await f.identify(await f.click());
    const notify = (kind: string, body: object) => {
      const payload = JSON.stringify(body);
      return request(app).post(`/webhooks/cloudpayments/${kind}`).set('Content-Type', 'application/json')
        .set('X-Content-HMAC', createHmac('sha256', SECRET).update(payload).digest('base64')).send(payload);
    };
    const pay = { TransactionId: 'CUSTOM-001', AccountId: f.userId, Amount: 1000, Currency: 'RUB', Data: { eventType: 'custom_settled_charge' } };
    expect((await notify('pay', pay)).body).toEqual({ code: 0 });
    expect((await notify('pay', pay)).body).toEqual({ code: 0 });
    const refund = { PaymentTransactionId: 'CUSTOM-001', TransactionId: 'CUSTOM-REFUND-001', Amount: 250, Currency: 'RUB' };
    expect((await notify('refund', refund)).body).toEqual({ code: 0 });
    expect((await notify('refund', refund)).body).toEqual({ code: 0 });
    expect(await db(TABLES.Event).where({ externalEventId: 'cloud_pay_CUSTOM-001' })).toHaveLength(1);
    expect(await db(TABLES.Event).where({ externalEventId: 'cloud_refund_CUSTOM-REFUND-001' })).toHaveLength(1);
    expect(await f.net()).toBe(150);
    expect(await f.commissions()).toHaveLength(1);
  });

  it('scopes the database idempotency key to tenant and preserves duplicate/null behavior', async () => {
    const otherTenant = `money-${ulid()}`;
    await db(TABLES.Tenant).insert({ id: otherTenant, slug: otherTenant.toLowerCase(), displayName: 'Money test', status: 'active' });
    try {
      const input = { userId: 'shared-user', type: 'payment', value: 100, currency: 'RUB', externalEventId: 'tenant-shared-id' };
      const [first, other] = await Promise.all([ingestPaymentEvent(db, tenantId, input), ingestPaymentEvent(db, otherTenant, input)]);
      expect(first.event.id).not.toBe(other.event.id);
      expect((await ingestPaymentEvent(db, tenantId, input)).replayed).toBe(true);
      for (let i = 0; i < 2; i++) expect((await ingestPaymentEvent(db, tenantId, { userId: 'u', type: 'signup' })).replayed).toBe(false);
      expect(await db(TABLES.Event).where({ externalEventId: input.externalEventId })).toHaveLength(2);
    } finally {
      await db(TABLES.Event).where({ tenantId: otherTenant }).del();
      await db(TABLES.Tenant).where({ id: otherTenant }).del();
    }
  });

  it.each([500, 1000])('paid refund %i keeps cash history, carries debt, and offsets the next manual payout once', async (refundAmount) => {
    const f = await fixture();
    await f.identify(await f.click());
    await f.pay('paid-original');
    await f.approve();
    const paidId = (await f.plan()).body.payouts[0].payoutId;
    await f.confirm(paidId);
    expect((await f.refund('paid-original', 'paid-refund', refundAmount)).status).toBe(201);
    const original = (await f.commissions())[0];
    expect(original).toMatchObject({ status: 'paid', amount: '200.00', payoutId: paidId });
    const group = { tenantId, partnerId: f.partnerId, currency: 'RUB' };
    const debt = refundAmount / 5;
    expect((await manualPayoutBalances(db, [group])).get(commissionGroupKey(group))).toMatchObject({ cashPaid: 200, debt });
    expect((await db(TABLES.Payout).where({ id: paidId }).first()).amount).toBe('200.00');
    await f.pay('next-small', 250);
    await f.approve();
    expect((await f.plan()).body.payouts).toHaveLength(0);
    await f.pay('next-large', 1500);
    await f.approve();
    const planned = (await f.plan()).body.payouts[0];
    expect(planned.amount).toBe(350 - debt);
    // Debt allocation must never alter raw adjustments or net earnings.
    const raw = await adjustmentTotalsByCommission(db, (await f.commissions()).map((c) => c.id));
    expect(raw.get(original.id)).toBe(-debt);
    expect(raw.size).toBe(1);
    expect(await f.net()).toBe(550 - debt);
    expect(await db(TABLES.Commission).where({ payoutId: planned.payoutId })).toHaveLength(2);
    await f.confirm(planned.payoutId);
    expect((await manualPayoutBalances(db, [group])).get(commissionGroupKey(group))!.debt).toBe(0);
    await f.pay('after-settlement', 100);
    await f.approve();
    expect((await f.plan()).body.payouts[0].amount).toBe(20);
    const history = await request(app).get('/payouts').set('Authorization', `Bearer ${ADMIN}`);
    expect(history.body.payouts.find((p: { id: string }) => p.id === paidId).amount).toBe('200.00');
  });

  it('counts only the cash actually paid when a partial refund precedes payment and the rest follows', async () => {
    const f = await fixture();
    await f.identify(await f.click());
    await f.pay('partial-first');
    await f.refund('partial-first', 'pre-paid-600', 600);
    await f.approve();
    const planned = (await f.plan()).body.payouts[0];
    expect(planned.amount).toBe(80);
    await f.confirm(planned.payoutId);
    await f.refund('partial-first', 'post-paid-400', 400);
    const group = { tenantId, partnerId: f.partnerId, currency: 'RUB' };
    expect((await manualPayoutBalances(db, [group])).get(commissionGroupKey(group))).toEqual({ cashPaid: 80, netPaidEarnings: 0, debt: 80 });
    await f.pay('new-earning');
    await f.approve();
    const next = (await f.plan()).body.payouts[0];
    expect(next.amount).toBe(120);
    await f.confirm(next.payoutId);
  });

  it('paid corrections invalidate pending amounts and debt is reserved once across multiple pending payouts', async () => {
    const f = await fixture();
    await f.identify(await f.click());
    await f.pay('paid');
    await f.approve();
    const first = (await f.plan()).body.payouts[0];
    await f.confirm(first.payoutId);
    const original = (await f.commissions())[0];
    await f.pay('second');
    await f.approve();
    const second = (await f.plan()).body.payouts[0];
    expect((await post(`/commissions/${original.id}/adjust`, { amount: -100, reason: 'paid correction' })).status).toBe(201);
    expect((await post(`/payouts/${second.payoutId}/confirm`)).body.error).toBe('payout_amount_changed');
    expect((await post(`/payouts/${second.payoutId}/cancel`)).status).toBe(200);
    const corrected = (await f.plan()).body.payouts[0];
    expect(corrected.amount).toBe(100);
    await f.pay('third');
    await f.approve();
    const third = (await f.plan()).body.payouts[0];
    expect(third.amount).toBe(200);
    // Confirm the newer pending payout first; it must not consume the debt
    // reserved against the older pending payout's gross commission.
    await f.confirm(third.payoutId);
    await f.confirm(corrected.payoutId);
    expect((await manualPayoutBalances(db, [{ tenantId, partnerId: f.partnerId, currency: 'RUB' }])).values().next().value!.debt).toBe(0);
  });

  it('batches debt/payable queries across groups and isolates partner and currency balances', async () => {
    const f = await fixture();
    await f.identify(await f.click());
    await f.pay('ruble');
    await f.approve();
    const paid = (await f.plan()).body.payouts[0];
    await f.confirm(paid.payoutId);
    await f.refund('ruble', 'debt-ruble', 1000);
    await f.pay('dollar', 1000, 'invoice_paid', 'USD');
    await f.approve();
    const g = await fixture();
    await g.identify(await g.click());
    await g.pay('other-partner');
    await g.approve();
    const groups = [
      { tenantId, partnerId: f.partnerId, currency: 'RUB' },
      { tenantId, partnerId: f.partnerId, currency: 'USD' },
      { tenantId, partnerId: g.partnerId, currency: 'RUB' },
    ];
    let count = 0;
    const countQuery = () => { count++; };
    db.on('query', countQuery);
    let payable: Map<string, number>;
    try { payable = await manualPayableAmounts(db, groups); } finally { db.off('query', countQuery); }
    expect(count).toBe(4);
    expect(payable!.get((await f.commissions().where({ currency: 'USD' }))[0].id)).toBe(200);
    expect((await f.plan()).body.payouts[0]).toMatchObject({ amount: 200, currency: 'USD' });
    expect((await g.plan()).body.payouts[0].amount).toBe(200);
  });

  it('rounds cumulative paid refunds to the last commission cent, including zero-cent early clawbacks', async () => {
    const f = await fixture();
    await f.identify(await f.click());
    await f.pay('five-cents', 0.05);
    await f.approve();
    const payout = (await f.plan()).body.payouts[0];
    expect(payout.amount).toBe(0.01);
    await f.confirm(payout.payoutId);
    for (const [id, amount] of [['one', 0.01], ['two', 0.01], ['three', 0.03]] as const) {
      expect((await f.refund('five-cents', id, amount)).status).toBe(201);
    }
    expect(await f.net()).toBe(0);
    const amounts = await db(TABLES.CommissionAdjustment).select('amount');
    expect(amounts.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0)).toBe(-1);
    expect((await db(TABLES.Payout).where({ id: payout.payoutId }).first()).amount).toBe('0.01');
  });

  it('concurrent planning reserves once; concurrent refund/confirmation either blocks payment or records paid debt', async () => {
    const f = await fixture();
    await f.identify(await f.click());
    await f.pay('concurrent-cash');
    await f.approve();
    const runs = await Promise.all([f.plan(), f.plan()]);
    expect(runs.map((r) => r.status)).toEqual([200, 200]);
    const payouts = runs.flatMap((r) => r.body.payouts);
    expect(payouts).toHaveLength(1);
    const payoutId = payouts[0].payoutId;
    const [confirmation, refund] = await Promise.all([
      post(`/payouts/${payoutId}/confirm`), f.refund('concurrent-cash', 'concurrent-refund', 1000),
    ]);
    expect(refund.status).toBe(201);
    expect([200, 409]).toContain(confirmation.status);
    const balance = (await manualPayoutBalances(db, [{ tenantId, partnerId: f.partnerId, currency: 'RUB' }])).values().next().value!;
    if (confirmation.status === 200) {
      expect(balance).toEqual({ cashPaid: 200, netPaidEarnings: 0, debt: 200 });
      expect((await f.commissions())[0].status).toBe('paid');
    } else {
      expect(balance).toEqual({ cashPaid: 0, netPaidEarnings: 0, debt: 0 });
      expect((await f.commissions())[0].status).toBe('reversed');
      expect((await post(`/payouts/${payoutId}/confirm`)).status).toBe(409);
    }
  });
});
