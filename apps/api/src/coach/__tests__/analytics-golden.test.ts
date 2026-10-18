import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ulid } from 'ulid';
import { DEFAULT_TENANT_ID as tenantId } from '@openpartner/db';
import { createApp } from '../../app.js';
import { db, appDb } from '../../db.js';
import { analyticsFiltersFromQuery, partnerAnalytics, partnerAnalyticsDetails } from '../../partner-analytics.js';
import { assertIsolatedCoachDatabase } from '../test-guard.js';

assertIsolatedCoachDatabase(process.env.DATABASE_URL!, process.env.COACH_WORKING_DB);
if (new URL(process.env.DATABASE_URL!).pathname !== '/syntolk_coach_test_20261012') throw new Error('Golden suite requires the approved isolated database.');
if (process.env.INTEGRATION !== 'run') throw new Error('Run through scripts/coach-test.mts.');
const app = createApp({ enableLogger: false });
const post = (path: string, body = {}) => request(app).post(path).set('Authorization', `Bearer ${process.env.ADMIN_API_KEY}`).send(body);
const get = (path: string) => request(app).get(path).set('Authorization', `Bearer ${process.env.ADMIN_API_KEY}`);
const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00Z`);
afterAll(async () => { await Promise.all([db.destroy(), appDb.destroy()]); });

async function program(model = 'last_click') {
  const result = await post('/programs', { name: `Golden ${ulid()}`, destinationUrl: 'https://example.test', attributionModel: model,
    commissionRule: { type: 'percent', value: 20, recurring: true } });
  expect(result.status, result.text).toBe(201);
  return result.body.id as string;
}

async function fixture(programId = '', existingPartnerId = '') {
  if (!programId) programId = await program();
  let partnerId = existingPartnerId;
  if (!partnerId) {
    const result = await post('/partners', { name: 'Analytics golden', email: `${ulid()}@example.test`, sendInvite: false });
    expect(result.status, result.text).toBe(201);
    partnerId = result.body.id;
  }
  const link = await post(`/partners/${partnerId}/links`, { programId, linkKey: `golden-${ulid()}` });
  expect(link.status, link.text).toBe(201);
  const userId = ulid();
  const click = async (ts = new Date(), extra: object = {}) => {
    const id = ulid();
    const result = await post('/clicks', { id, linkKey: link.body.linkKey, landingUrl: 'https://example.test', ts: ts.toISOString(), ...extra });
    expect(result.status, result.text).toBe(201);
    expect(await db('Click').where({ tenantId, id }).first()).toMatchObject({ partnerId, programId });
    return id;
  };
  const identify = async (cref: string, user = userId) => {
    const result = await post('/attribution/identify', { cref, userId: user });
    expect(result.status, result.text).toBe(200);
    expect(await db('Identity').where({ tenantId, clickId: cref, userId: user })).toHaveLength(1);
    return result.body;
  };
  const signup = async (ts = new Date(), user = userId) => {
    // Deliberately omit currency: generic ingestion defaults it to USD; signup is currency independent.
    const result = await post('/attribution/events', { userId: user, type: 'signup', ts: ts.toISOString(), externalEventId: ulid() });
    expect(result.status, result.text).toBe(200);
    expect(await db('Event').where({ tenantId, id: result.body.eventId }).first()).toMatchObject({ type: 'signup', userId: user, currency: 'USD' });
    return result.body;
  };
  const pay = async (value = 1000, extra: object = {}) => {
    const externalEventId = ulid();
    const result = await post('/payments/events', { userId, value, externalEventId, ...extra });
    expect(result.status, result.text).toBe(201);
    expect(await db('Event').where({ tenantId, id: result.body.eventId }).first()).toMatchObject({ userId, externalEventId });
    return { ...result.body, externalEventId } as { eventId: string; externalEventId: string; attribution: { status: string } };
  };
  const refund = async (originalExternalEventId: string, amount: number, extra: object = {}) => {
    const result = await post('/payments/refunds', { originalExternalEventId, refundExternalEventId: ulid(), amount, ...extra });
    expect(result.status, result.text).toBe(201);
    expect(await db('Event').where({ tenantId, id: result.body.refundEvent.id }).first()).toMatchObject({ type: 'refund', value: (-amount).toFixed(2) });
    return result.body;
  };
  const report = async (extra = '') => {
    const result = await get(`/partners/${partnerId}/analytics?period=all${extra}`);
    expect(result.status, result.text).toBe(200);
    return result.body;
  };
  const commissions = () => db('Commission').where({ tenantId, partnerId });
  const approve = async () => {
    for (const row of await commissions().where({ status: 'accrued' })) {
      const result = await post(`/commissions/${row.id}/approve`);
      expect(result.status, result.text).toBe(200);
    }
  };
  return { partnerId, programId, link: link.body, userId, click, identify, signup, pay, refund, report, commissions, approve };
}

async function allocation(eventId: string, expected: Array<{ partnerId: string; weight: string; model: string }>) {
  const rows = await db('Attribution').where({ tenantId, eventId });
  expect(rows).toHaveLength(expected.length);
  expect(rows).toEqual(expect.arrayContaining(expected.map(row => expect.objectContaining(row))));
  return rows;
}

describe('Gate 2: persisted flows and partner analytics golden contract', () => {
  it('one click, identity, signup and first payment agree with DB, routes and chart identities', async () => {
    const f = await fixture();
    const clickId = await f.click(); await f.identify(clickId); const signup = await f.signup(); const payment = await f.pay();
    await allocation(signup.eventId, [{ partnerId: f.partnerId, weight: '1.0000', model: 'last_click' }]);
    const [a] = await allocation(payment.eventId, [{ partnerId: f.partnerId, weight: '1.0000', model: 'last_click' }]);
    expect(await f.commissions()).toEqual([expect.objectContaining({ attributionId: a.id, amount: '200.00', status: 'accrued', currency: 'RUB' })]);
    const result = await f.report('&includeSeries=true&seriesBy=platform&includeEmpty=true&platformIds=__none__&platformIds=empty');
    expect(result.currency).toBe('RUB');
    expect(result.counts).toMatchObject({ clicks: 1, identities: 1, registrations: 1, paymentCount: 1, payingCustomers: 1, firstPaymentCount: 1, repeatPaymentCount: 0 });
    expect(result.amountsMinor).toEqual({ observedPayments: 100000, refunds: 0, netPayments: 100000, netAccrued: 20000 });
    expect(result.conversions).toMatchObject({ clickToRegistration: 1, registrationToPayment: 1, clickToPayment: 1, cohortPaidRegistrations: 1 });
    expect(result.series.points.reduce((sum: number, p: any) => sum + p.identities, 0)).toBe(1);
    expect(result.series.groups[0].points.reduce((sum: number, p: any) => sum + p.identities, 0)).toBe(1);
    expect(result.views).toBeNull(); expect(result.ctr).toBeNull();
    expect(result.dataQuality).toEqual({ signupTracking: 'not_verified_end_to_end', paymentTracking: 'not_verified_end_to_end', views: 'unavailable', ctr: 'unavailable' });
    expect(result.warnings).toEqual(['signup_tracking_unverified', 'payment_tracking_unverified', 'views_unavailable', 'ctr_unavailable']);
  });

  it('three clicks from one user keep clicks distinct from identities and customers', async () => {
    const f = await fixture();
    for (let i = 0; i < 3; i++) await f.identify(await f.click());
    await f.signup(); const paid = await f.pay();
    expect(await db('Click').where({ tenantId, partnerId: f.partnerId })).toHaveLength(3);
    expect(await db('Identity').where({ tenantId, userId: f.userId })).toHaveLength(3);
    await allocation(paid.eventId, [{ partnerId: f.partnerId, weight: '1.0000', model: 'last_click' }]);
    expect(await f.commissions()).toHaveLength(1);
    const result = await f.report();
    expect(result.counts).toMatchObject({ clicks: 3, identities: 1, registrations: 1, paymentCount: 1, payingCustomers: 1 });
    expect(result.conversions).toMatchObject({ clickToRegistration: 1 / 3, clickToPayment: 1 / 3, registrationToPayment: 1 });
  });

  it('one user with first and repeat payments counts two payments, one customer', async () => {
    const f = await fixture(); await f.identify(await f.click(at(15))); await f.signup(at(15));
    const first = await f.pay(1000, { ts: at(16).toISOString() });
    const repeat = await f.pay(500, { type: 'recurring_payment', ts: at(17).toISOString() });
    expect(await db('Event').where({ tenantId, userId: f.userId }).whereIn('id', [first.eventId, repeat.eventId])).toHaveLength(2);
    expect(await f.commissions()).toHaveLength(2);
    expect((await f.report()).counts).toMatchObject({ paymentCount: 2, payingCustomers: 1, firstPaymentCount: 1, repeatPaymentCount: 1 });
    expect((await f.report()).amountsMinor).toMatchObject({ observedPayments: 150000, netAccrued: 30000 });
  });

  it('late identify backfills once and later identities cannot append commissions or rewrite allocations', async () => {
    const f = await fixture(); const clickId = await f.click(); await f.signup(); const paid = await f.pay();
    expect(paid.attribution.status).toBe('no_identity'); expect(await f.commissions()).toHaveLength(0);
    expect((await f.identify(clickId)).backfilledAttributions).toBe(2);
    const rows = await f.commissions(); const allocations = await db('Attribution').where({ tenantId, partnerId: f.partnerId });
    expect(rows).toHaveLength(1); expect(allocations).toHaveLength(2);
    expect((await f.identify(await f.click())).backfilledAttributions).toBe(0);
    expect(await f.commissions()).toEqual(rows);
    expect(await db('Attribution').where({ tenantId, partnerId: f.partnerId })).toEqual(allocations);
    expect((await f.report()).amountsMinor.netAccrued).toBe(20000);
  });

  it('a full refund before identity leaves payment history and zero earnings after backfill', async () => {
    const f = await fixture(); const clickId = await f.click(); const paid = await f.pay();
    await f.refund(paid.externalEventId, 1000); expect(await f.commissions()).toHaveLength(0);
    await f.identify(clickId);
    expect(await f.commissions()).toEqual([expect.objectContaining({ amount: '200.00', status: 'reversed' })]);
    expect(await db('Attribution').where({ tenantId, eventId: paid.eventId })).toHaveLength(1);
    const result = await f.report();
    expect(result.counts.paymentCount).toBe(1);
    expect(result.amountsMinor).toEqual({ observedPayments: 100000, refunds: 100000, netPayments: 0, netAccrued: 0 });
  });

  it('partial refunds expose gross, refund, net payment and corrected earnings separately', async () => {
    const f = await fixture(); await f.identify(await f.click()); const paid = await f.pay(); await f.refund(paid.externalEventId, 400);
    const [c] = await f.commissions(); expect(c).toMatchObject({ amount: '200.00', status: 'accrued' });
    expect(await db('CommissionAdjustment').where({ tenantId, commissionId: c.id })).toEqual([expect.objectContaining({ amount: '-80.00' })]);
    expect((await f.report()).amountsMinor).toEqual({ observedPayments: 100000, refunds: 40000, netPayments: 60000, netAccrued: 12000 });
  });

  it.each(['last_click', 'linear'])('two partners preserve %s weights, commissions and distinct metrics', async model => {
    const programId = await program(model), a = await fixture(programId), b = await fixture(programId);
    await a.identify(await a.click(at(15))); await b.identify(await b.click(at(16)), a.userId);
    await a.signup(); const paid = await a.pay();
    await allocation(paid.eventId, model === 'linear'
      ? [{ partnerId: a.partnerId, weight: '0.5000', model }, { partnerId: b.partnerId, weight: '0.5000', model }]
      : [{ partnerId: b.partnerId, weight: '1.0000', model }]);
    const expected = model === 'linear' ? [10000, 10000] : [0, 20000];
    for (const [i, f] of [a, b].entries()) {
      const rows = await f.commissions();
      expect(rows).toHaveLength(expected[i] ? 1 : 0);
      if (rows.length) expect(Number(rows[0].amount) * 100).toBe(expected[i]);
      const result = await f.report();
      expect(result.counts.paymentCount).toBe(expected[i] ? 1 : 0);
      expect(result.amountsMinor.netAccrued).toBe(expected[i]);
      expect(result.amountsMinor.observedPayments).toBe(expected[i]! * 5);
    }
  });

  it('fraud clicks remain stored but do not create attribution, commissions or report activity', async () => {
    const f = await fixture(); const clickId = await f.click(new Date(), { fraudFlag: 'manual' });
    await f.identify(clickId); const paid = await f.pay();
    expect(paid.attribution.status).toBe('no_click');
    expect(await db('Click').where({ id: clickId }).first()).toMatchObject({ fraudFlag: 'manual' });
    expect(await db('Attribution').where({ tenantId, eventId: paid.eventId })).toHaveLength(0);
    expect(await f.commissions()).toHaveLength(0);
    const result = await f.report(); expect(result.counts).toMatchObject({ clicks: 0, identities: 0, paymentCount: 0 });
    expect(result.amountsMinor.netAccrued).toBe(0);
  });

  it('model changes preserve frozen history, including mixed programs with differing current models', async () => {
    const f = await fixture(); await f.identify(await f.click(at(15))); await f.signup(); const paid = await f.pay();
    const before = await db('Attribution').where({ tenantId, eventId: paid.eventId }); const commissions = await f.commissions();
    expect((await request(app).patch(`/programs/${f.programId}`).set('Authorization', `Bearer ${process.env.ADMIN_API_KEY}`).send({ attributionModel: 'linear' })).status).toBe(200);
    expect(await db('Program').where({ id: f.programId }).first()).toMatchObject({ attributionModel: 'linear' });
    expect((await f.report()).amountsMinor).toMatchObject({ observedPayments: 100000, netAccrued: 20000 });
    expect(await db('Attribution').where({ tenantId, eventId: paid.eventId })).toEqual(before); expect(await f.commissions()).toEqual(commissions);
    const other = await fixture(await program('linear'), f.partnerId);
    expect((await request(app).patch(`/programs/${f.programId}`).set('Authorization', `Bearer ${process.env.ADMIN_API_KEY}`).send({ attributionModel: 'last_click' })).status).toBe(200);
    await other.identify(await other.click(at(16)), f.userId);
    const mixed = await f.pay(1000);
    const mixedAllocations = await allocation(mixed.eventId, [
      { partnerId: f.partnerId, weight: '0.5000', model: 'linear' }, { partnerId: f.partnerId, weight: '0.5000', model: 'linear' },
    ]);
    expect(mixedAllocations.map(row => row.programId).sort()).toEqual([f.programId, other.programId].sort());
    expect((await f.commissions()).map(row => row.amount).sort()).toEqual(['100.00', '100.00', '200.00']);
    const result = await f.report(); expect(result.amountsMinor).toMatchObject({ observedPayments: 200000, netAccrued: 40000 });
    expect(result.exclusions).not.toContain('non_current_attribution_models');
    expect((await f.report(`&programId=${f.programId}`)).amountsMinor.observedPayments).toBe(150000);
    expect((await f.report(`&programId=${other.programId}`)).amountsMinor.observedPayments).toBe(50000);
  });

  it('defaults every entry point to RUB without dropping USD-default signup; explicit USD is isolated', async () => {
    const f = await fixture(); await f.identify(await f.click()); await f.signup(); const rub = await f.pay(); const usd = await f.pay(500, { currency: 'USD' });
    await f.pay(3000, { type: 'custom_money', currency: 'RUB' });
    expect(await db('Event').where({ tenantId }).whereIn('id', [rub.eventId, usd.eventId]).select('currency')).toEqual([{ currency: 'RUB' }, { currency: 'USD' }]);
    expect(await f.commissions()).toHaveLength(3);
    expect(analyticsFiltersFromQuery({}).currency).toBe('RUB');
    for (const result of [await f.report(), await partnerAnalytics(db, tenantId, f.partnerId)]) {
      expect(result.currency).toBe('RUB'); expect(result.counts).toMatchObject({ registrations: 1, paymentCount: 1, firstPaymentCount: 1 });
      expect(result.amountsMinor.observedPayments).toBe(100000); expect(result.amountsMinor.netAccrued).toBe(80000);
    }
    const explicit = await f.report('&currency=USD'); expect(explicit.counts).toMatchObject({ registrations: 1, paymentCount: 1, firstPaymentCount: 1 });
    expect(explicit.amountsMinor).toMatchObject({ observedPayments: 50000, netAccrued: 10000 });
    for (const endpoint of ['dashboard', 'funnel']) {
      const response = await get(`/partners/${f.partnerId}/${endpoint}?period=all`); expect(response.status, response.text).toBe(200);
      expect(response.body.currency).toBe('RUB'); expect(endpoint === 'dashboard' ? response.body.attributedRevenue : response.body.revenue).toBe(1000);
      const usdResponse = await get(`/partners/${f.partnerId}/${endpoint}?period=all&currency=USD`);
      expect(usdResponse.status, usdResponse.text).toBe(200); expect(usdResponse.body.currency).toBe('USD');
      expect(endpoint === 'dashboard' ? usdResponse.body.attributedRevenue : usdResponse.body.revenue).toBe(500);
    }
    const details = await partnerAnalyticsDetails(db, tenantId, f.partnerId, { since: at(1) });
    expect(details.history.items.filter(i => i.kind === 'first_payment')).toHaveLength(1);
    expect(details.history.items.find(i => i.kind === 'first_payment')?.currency).toBe('RUB');
  });

  it('one simulator call for an existing real user preserves real clicks, payments and earnings', async () => {
    const f = await fixture(); const clickId = await f.click(); await f.identify(clickId); await f.signup(); const paid = await f.pay();
    const simulated = await post('/payments/simulate', { partnerId: f.partnerId, linkKey: f.link.linkKey, userId: f.userId, amount: 9000, externalEventId: ulid() });
    expect(simulated.status, simulated.text).toBe(201); expect(simulated.body.clickId).toBe(clickId);
    expect(await db('Event').where({ id: simulated.body.eventId }).first()).toMatchObject({ metadata: expect.objectContaining({ source: 'local_simulator' }) });
    expect(await f.commissions()).toHaveLength(2); expect(await db('Click').where({ partnerId: f.partnerId })).toHaveLength(1);
    const result = await f.report(); expect(result.counts).toMatchObject({ clicks: 1, identities: 1, registrations: 1, paymentCount: 1 });
    expect(result.amountsMinor).toMatchObject({ observedPayments: 100000, netAccrued: 20000 });
    const history = await partnerAnalyticsDetails(db, tenantId, f.partnerId, { since: at(1) });
    expect(history.history.items.filter(i => i.kind === 'first_payment' || i.kind === 'repeat_payment')).toHaveLength(1);
    expect(history.history.items.some(i => i.id === `e:${paid.eventId}`)).toBe(true);
  });

  it('synthetic clicks are excluded by each marker and a prior synthetic payment does not make a real payment repeat', async () => {
    const f = await fixture();
    const simulated = await post('/payments/simulate', { partnerId: f.partnerId, linkKey: f.link.linkKey, userId: f.userId, amount: 1000, externalEventId: ulid() });
    expect(simulated.status, simulated.text).toBe(201);
    for (const marker of [{ userAgent: 'Syntolk-Local-Payment-Simulator/1' }, { referer: 'syntolk://local-simulator' }, { utmMedium: 'simulator' }]) await f.click(new Date(), marker);
    const real = await fixture(f.programId); await real.identify(await real.click(), f.userId);
    const paid = await f.pay(500);
    expect((await db('Attribution').where({ eventId: paid.eventId }).first()).partnerId).toBe(real.partnerId);
    const synthetic = await f.report(); expect(synthetic.counts.clicks).toBe(0); expect(synthetic.amountsMinor.netAccrued).toBe(0);
    const result = await real.report(); expect(result.counts).toMatchObject({ clicks: 1, identities: 1, paymentCount: 1, firstPaymentCount: 1, repeatPaymentCount: 0 });
    expect(result.amountsMinor.netAccrued).toBe(10000);
  });

  it('Oct 5 click, Oct 8 signup, Oct 15 payment: Oct 1–7 activity is 1/0/0 with 100% cohort rates', async () => {
    const f = await fixture(); await f.identify(await f.click(at(5))); const signup = await f.signup(at(8)); const paid = await f.pay(1000, { ts: at(15).toISOString() });
    expect((await db('Event').where({ id: signup.eventId }).first()).ts).toEqual(at(8));
    expect((await db('Event').where({ id: paid.eventId }).first()).ts).toEqual(at(15));
    const query = 'period=custom&from=2026-10-01&to=2026-10-07';
    const result = await get(`/partners/${f.partnerId}/analytics?${query}&includeFunnel=true`); expect(result.status, result.text).toBe(200);
    expect(result.body.counts).toMatchObject({ clicks: 1, identities: 1, registrations: 0, paymentCount: 0 });
    expect(result.body.conversions).toEqual({ clickToRegistration: 1, registrationToPayment: 1, clickToPayment: 1, cohortRegistrations: 1, cohortPayingCustomers: 1, cohortPaidRegistrations: 1 });
    expect(result.body.metricBasis.conversions).toBe('selected_click_cohort_through_generated_at');
    for (const endpoint of ['dashboard', 'funnel']) {
      const response = await get(`/partners/${f.partnerId}/${endpoint}?${query}`); expect(response.status, response.text).toBe(200);
      expect(response.body.conversions).toEqual(result.body.conversions); expect(response.body.metricBasis).toEqual(result.body.metricBasis);
      if (endpoint === 'funnel') {
        expect(response.body.stages).toEqual({ clicks: 1, identities: 1, signups: 0, paid: 0 });
        expect(response.body.cohort).toEqual({ clicks: 1, identities: 1, signups: 1, paid: 1, paidSignups: 1 });
        expect(response.body.rates).toEqual({ stitchRate: 1, signupRate: 1, paidRate: 1, overall: 1 });
      }
    }
  });

  it('refund-only activity is negative net payment while earnings restate the accrual period', async () => {
    const f = await fixture(); await f.identify(await f.click(at(5))); const paid = await f.pay(1000, { ts: at(8).toISOString() });
    await f.refund(paid.externalEventId, 400, { ts: at(15).toISOString() });
    const [commission] = await f.commissions(); expect(commission.amount).toBe('200.00');
    expect(await db('CommissionAdjustment').where({ commissionId: commission.id })).toEqual([expect.objectContaining({ amount: '-80.00' })]);
    const result = await f.report('&since=2026-10-15T00:00:00Z&until=2026-10-16T00:00:00Z');
    expect(result.amountsMinor).toEqual({ observedPayments: 0, refunds: 40000, netPayments: -40000, netAccrued: 0 });
    expect((await f.report()).amountsMinor.netAccrued).toBe(12000);
    const accrual = new Date(commission.accruedAt);
    const selected = await f.report(`&since=${new Date(accrual.getTime() - 1).toISOString()}&until=${new Date(accrual.getTime() + 1).toISOString()}`);
    expect(selected.amountsMinor.netAccrued).toBe(12000);
  });

  it('completed cash survives refunds; debt reduces payable once without reducing raw earnings again', async () => {
    const previous = await db('Tenant').where({ id: tenantId }).first();
    await db('Tenant').where({ id: tenantId }).update({ payoutThresholdCents: 0 });
    try {
      const f = await fixture(); await f.identify(await f.click()); const paid = await f.pay(); await f.approve();
      const planned = await post('/payouts/run', { partnerId: f.partnerId }); expect(planned.status, planned.text).toBe(200);
      const payoutId = planned.body.payouts[0].payoutId;
      expect((await f.report()).balances).toMatchObject({ paid: 0, pending: 200, available: 0, total: 200 });
      expect((await post(`/payouts/${payoutId}/confirm`)).status).toBe(200);
      await f.refund(paid.externalEventId, 500);
      expect(await db('Payout').where({ id: payoutId }).first()).toMatchObject({ status: 'paid', method: 'manual', amount: '200.00', completedAt: expect.any(Date) });
      const [original] = await f.commissions(); expect(original).toMatchObject({ amount: '200.00', status: 'paid', payoutId });
      expect(await db('CommissionAdjustment').where({ commissionId: original.id })).toEqual([expect.objectContaining({ amount: '-100.00' })]);
      let result = await f.report(); expect(result.balances).toMatchObject({ paid: 200, netPaidEarnings: 100, debt: 100, total: 100 });
      expect(result.amountsMinor.netAccrued).toBe(10000);
      await f.pay(250); await f.approve(); result = await f.report();
      expect(result.balances).toMatchObject({ paid: 200, debt: 100, available: 0, total: 150 }); expect(result.amountsMinor.netAccrued).toBe(15000);
      await f.pay(1500); await f.approve(); result = await f.report();
      expect(result.balances).toMatchObject({ paid: 200, available: 250, pending: 0, debt: 100, total: 450 });
      expect(result.amountsMinor.netAccrued).toBe(45000); expect(result.commissionByStatus).toMatchObject({ paid: 100, approved: 350 });
      const filtered = await f.report('&programId=unrelated&sourceId=unrelated&since=2026-10-01T00:00:00Z&until=2026-10-02T00:00:00Z');
      expect(filtered.balances).toEqual(result.balances); expect(filtered.amountsMinor.netAccrued).toBe(0);
      expect(filtered.balanceBasis).toMatchObject({ scope: 'lifetime_partner_currency', ignoresActivityFilters: true, paid: 'completed_manual_payout_cash' });
      const next = await post('/payouts/run', { partnerId: f.partnerId }); expect(next.status, next.text).toBe(200);
      const nextId = next.body.payouts[0].payoutId;
      expect(await db('Payout').where({ id: nextId }).first()).toMatchObject({ status: 'pending', amount: '250.00' });
      expect((await f.report()).balances).toMatchObject({ paid: 200, available: 0, pending: 250, debt: 100, total: 450 });
      expect((await post(`/payouts/${nextId}/confirm`)).status).toBe(200);
      expect((await f.report()).balances).toMatchObject({ paid: 450, debt: 0, netPaidEarnings: 450, available: 0, pending: 0, total: 450 });
    } finally { await db('Tenant').where({ id: tenantId }).update({ payoutThresholdCents: previous.payoutThresholdCents }); }
  });
});
