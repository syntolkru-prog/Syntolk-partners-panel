import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ulid } from 'ulid';
import { DEFAULT_TENANT_ID, TABLES, type CommissionRow, type CommissionAdjustmentRow } from '@openpartner/db';
import { db } from '../db.js';
import { createApp } from '../app.js';

const ADMIN_KEY = 'op_test_payment_admin_0123456789abcdef0123';
const CLOUD_SECRET = 'cloudpayments-test-secret';
process.env.ADMIN_API_KEY = ADMIN_KEY;
process.env.CLOUDPAYMENTS_WEBHOOK_SECRET = CLOUD_SECRET;
process.env.OPENPARTNER_MODE = 'selfhost';
process.env.OPENPARTNER_TENANCY = 'single';

const skipIntegration = !process.env.DATABASE_URL || process.env.INTEGRATION === 'skip';
const app = createApp({ enableLogger: false });

const TABLES_TO_CLEAN = [
  TABLES.CommissionAdjustment,
  TABLES.Commission,
  TABLES.Attribution,
  TABLES.Event,
  TABLES.Identity,
  TABLES.Click,
  TABLES.Link,
  TABLES.Coupon,
  TABLES.Program,
  TABLES.Payout,
  TABLES.Partner,
  TABLES.Config,
];

beforeEach(async () => {
  if (skipIntegration) return;
  for (const table of TABLES_TO_CLEAN) await db(table).del();
});

afterAll(async () => {
  await db.destroy();
});

async function fixture() {
  const partner = await request(app)
    .post('/partners')
    .set('Authorization', `Bearer ${ADMIN_KEY}`)
    .send({ email: 'payments@example.com', name: 'Payment Partner', sendInvite: false });
  expect(partner.status).toBe(201);

  const program = await request(app)
    .post('/programs')
    .set('Authorization', `Bearer ${ADMIN_KEY}`)
    .send({
      name: 'CloudPayments test',
      commissionRule: { type: 'percent', value: 20, recurring: true },
      destinationUrl: 'https://syntolk.ru',
    });
  expect(program.status).toBe(201);

  const link = await request(app)
    .post(`/partners/${partner.body.id}/links`)
    .set('Authorization', `Bearer ${ADMIN_KEY}`)
    .send({ linkKey: 'payments-test', programId: program.body.id });
  expect(link.status).toBe(201);
  return { partnerId: partner.body.id as string, programId: program.body.id as string, linkKey: link.body.linkKey as string };
}

describe.skipIf(skipIntegration)('Syntolk payment events and refunds', () => {
  it('does not redeem a deactivated coupon', async () => {
    const { partnerId, programId } = await fixture();
    await db(TABLES.Coupon).insert({
      id: `cpn_${ulid()}`,
      tenantId: DEFAULT_TENANT_ID,
      partnerId,
      programId,
      code: 'DEACTIVATED-CHECK',
      stripeCouponId: null,
      stripePromotionCodeId: null,
      deactivatedAt: new Date(),
    });

    const redemption = await request(app)
      .post('/coupons/redeem')
      .set('Authorization', `Bearer ${ADMIN_KEY}`)
      .send({
        code: 'DEACTIVATED-CHECK',
        eventType: 'invoice_paid',
        value: 100,
        currency: 'RUB',
        externalEventId: 'deactivated-coupon-check',
        userId: 'deactivated-coupon-user',
      });

    expect(redemption.status).toBe(404);
    expect(redemption.body.error).toBe('coupon_not_found');
    expect(await db(TABLES.Event).where({ externalEventId: 'deactivated-coupon-check' })).toHaveLength(0);
    expect(await db(TABLES.Commission).where({ partnerId })).toHaveLength(0);
  });

  it('partial refund creates one proportional clawback and is idempotent', async () => {
    const { partnerId, linkKey } = await fixture();
    const payment = await request(app)
      .post('/payments/simulate')
      .set('Authorization', `Bearer ${ADMIN_KEY}`)
      .send({ partnerId, linkKey, userId: 'refund-user', amount: 100, currency: 'RUB', externalEventId: 'payment-001' });
    expect(payment.status).toBe(201);

    const refund = await request(app)
      .post('/payments/refunds')
      .set('Authorization', `Bearer ${ADMIN_KEY}`)
      .send({ originalExternalEventId: 'payment-001', refundExternalEventId: 'refund-001', amount: 50, currency: 'RUB' });
    expect(refund.status).toBe(201);
    expect(refund.body.fullRefund).toBe(false);
    expect(refund.body.adjustmentCount).toBe(1);

    const commission = await db<CommissionRow>(TABLES.Commission).where({ partnerId }).first();
    const adjustment = await db<CommissionAdjustmentRow>(TABLES.CommissionAdjustment).where({ commissionId: commission!.id }).first();
    expect(commission?.status).toBe('accrued');
    expect(adjustment?.amount).toBe('-10.00');

    const replay = await request(app)
      .post('/payments/refunds')
      .set('Authorization', `Bearer ${ADMIN_KEY}`)
      .send({ originalExternalEventId: 'payment-001', refundExternalEventId: 'refund-001', amount: 50, currency: 'RUB' });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(await db(TABLES.CommissionAdjustment).where({ commissionId: commission!.id })).toHaveLength(1);
  });

  it('full refund reverses an unpaid commission', async () => {
    const { partnerId, linkKey } = await fixture();
    const payment = await request(app)
      .post('/payments/simulate')
      .set('Authorization', `Bearer ${ADMIN_KEY}`)
      .send({ partnerId, linkKey, userId: 'full-refund-user', amount: 100, currency: 'RUB', externalEventId: 'payment-002' });
    expect(payment.status).toBe(201);

    const refund = await request(app)
      .post('/payments/refunds')
      .set('Authorization', `Bearer ${ADMIN_KEY}`)
      .send({ originalExternalEventId: 'payment-002', refundExternalEventId: 'refund-002', amount: 100, currency: 'RUB' });
    expect(refund.status).toBe(201);
    expect(refund.body.fullRefund).toBe(true);
    expect(refund.body.reversedCommissionIds).toHaveLength(1);

    const commission = await db<CommissionRow>(TABLES.Commission).where({ partnerId }).first();
    expect(commission?.status).toBe('reversed');
  });

  it('accepts a signed CloudPayments Pay notification once and deduplicates the retry', async () => {
    const { partnerId, linkKey } = await fixture();
    const payment = await request(app)
      .post('/payments/simulate')
      .set('Authorization', `Bearer ${ADMIN_KEY}`)
      .send({ partnerId, linkKey, userId: 'cloud-user', amount: 200, currency: 'RUB', externalEventId: 'cloud_pay_TX-001' });
    expect(payment.status).toBe(201);
    await db(TABLES.CommissionAdjustment).del();
    await db(TABLES.Commission).del();
    await db(TABLES.Attribution).del();
    await db(TABLES.Event).where({ externalEventId: 'cloud_pay_TX-001' }).del();

    const payload = JSON.stringify({ TransactionId: 'TX-001', Amount: 200, Currency: 'RUB', AccountId: 'cloud-user', DateTime: '2026-10-06 22:00:00' });
    const signature = createHmac('sha256', CLOUD_SECRET).update(payload).digest('base64');
    const first = await request(app)
      .post('/webhooks/cloudpayments/pay')
      .set('Content-Type', 'application/json')
      .set('X-Content-HMAC', signature)
      .send(payload);
    expect(first.status).toBe(200);
    expect(first.body.code).toBe(0);

    const retry = await request(app)
      .post('/webhooks/cloudpayments/recurrent')
      .set('Content-Type', 'application/json')
      .set('X-Content-HMAC', signature)
      .send(payload);
    expect(retry.status).toBe(200);
    expect(await db(TABLES.Event).where({ externalEventId: 'cloud_pay_TX-001' })).toHaveLength(1);
  });

  it('acknowledges signed Fail, Cancel, and Confirm notifications without creating earnings', async () => {
    await fixture();
    const payload = JSON.stringify({
      TransactionId: 'TX-STATE-001',
      Amount: 200,
      Currency: 'RUB',
      AccountId: 'cloud-user',
      DateTime: '2026-10-06 22:10:00',
    });
    const signature = createHmac('sha256', CLOUD_SECRET).update(payload).digest('base64');
    const beforeEvents = await db(TABLES.Event).select('id');

    for (const kind of ['fail', 'cancel', 'confirm'] as const) {
      const response = await request(app)
        .post(`/webhooks/cloudpayments/${kind}`)
        .set('Content-Type', 'application/json')
        .set('X-Content-HMAC', signature)
        .send(payload);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ code: 0 });
    }

    expect(await db(TABLES.Event).select('id')).toHaveLength(beforeEvents.length);
    expect(await db(TABLES.Commission).select('id')).toHaveLength(0);
  });
});

