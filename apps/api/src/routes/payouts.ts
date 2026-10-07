import { Router } from 'express';
import { TABLES, type CommissionRow, type PartnerRow, type PayoutRow } from '@openpartner/db';
import type { Knex } from 'knex';
import { requireAdmin, requireAuth, requirePartnerOrAdmin } from '../auth.js';
import { z } from 'zod';
import { runPayouts } from '../payouts.js';
import { tenantOf, withTenantTransaction } from '../tenancy.js';
import { tryTenantPayoutLock } from '../payout-lock.js';
import { adjustmentTotalsByCommission, netCommissionAmount } from '../commission-net.js';
import { dispatchEvent } from '../webhook-dispatcher.js';

export const payoutsRouter = Router();

const providerStatusSchema = z.object({
  providerOperationId: z.string().trim().min(1).max(160),
  providerStatus: z.string().trim().min(1).max(40),
});

/** Admin-wide payout ledger. Partner accounts remain scoped to their own
 * history below; the admin view needs one source of truth for reconciliation
 * and manual confirmations. */
payoutsRouter.get('/payouts', requireAuth, requireAdmin, async (req, res) => {
  const { db } = tenantOf(req);
  const partnerId = typeof req.query.partnerId === 'string' ? req.query.partnerId : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const limitRaw = Number(req.query.limit ?? 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 500) : 200;

  const query = db<PayoutRow>(TABLES.Payout)
    .leftJoin(TABLES.Partner, `${TABLES.Partner}.id`, `${TABLES.Payout}.partnerId`)
    .select(`${TABLES.Payout}.*`, `${TABLES.Partner}.name as partnerName`, `${TABLES.Partner}.email as partnerEmail`)
    .orderBy(`${TABLES.Payout}.createdAt`, 'desc')
    .limit(limit);
  if (partnerId) query.where(`${TABLES.Payout}.partnerId`, partnerId);
  if (status) query.andWhere(`${TABLES.Payout}.status`, status);

  const payouts = await query;
  res.json({ payouts });
});

/**
 * Admin "run payouts". Deliberately does NOT use `req.db`: the request
 * transaction stays open until the response is written, and money must
 * never move inside a transaction that can still roll back (audit #10 —
 * a failed commit after a successful transfer used to re-run under a new
 * payout id, i.e. a new idempotency key, i.e. a double-pay).
 *
 * So: plan in a transaction of its own and COMMIT the intents, then post
 * the transfers outside any transaction, then report the merged outcome.
 */
payoutsRouter.post('/payouts/run', requireAuth, requireAdmin, async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  const body = z.object({ partnerId: z.string().min(1).optional() }).safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: 'invalid_body' });
  if (body.data.partnerId && !(await db<PartnerRow>(TABLES.Partner).where({ id: body.data.partnerId }).first())) {
    return res.status(404).json({ error: 'partner_not_found' });
  }
  const result = await withTenantTransaction(tenantId, (trx) => runPayouts(trx, tenantId, body.data.partnerId));
  res.json(result);
});

/**
 * Manual-rail confirmation. runPayouts creates manual payouts as
 * 'pending' with reserved, approved commissions; this endpoint is the operator saying
 * "I actually sent it" — the payout becomes 'paid' with a completion
 * timestamp, which is what revenue reporting and the Network payout
 * aggregation count.
 */
payoutsRouter.post('/payouts/:id/confirm', requireAuth, requireAdmin, async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  if (!(await tryTenantPayoutLock(db as Knex.Transaction, tenantId))) {
    return res.status(409).json({ error: 'payout_busy', detail: 'Расчёт выплаты уже выполняется. Повторите позже.' });
  }
  const existing = await db<PayoutRow>(TABLES.Payout).where({ id: req.params.id }).first();
  if (!existing) return res.status(404).json({ error: 'payout_not_found' });
  if (existing.method !== 'manual' || existing.status !== 'pending') {
    return res.status(409).json({ error: 'not_confirmable', detail: 'Подтвердить можно только ожидающую ручную выплату.' });
  }
  const commissions = await db<CommissionRow>(TABLES.Commission).where({ payoutId: existing.id });
  const adjustments = await adjustmentTotalsByCommission(db, commissions.map((c) => c.id));
  const netMinor = commissions.reduce((sum, c) => sum + Math.round(netCommissionAmount(c, adjustments, c.id) * 100), 0);
  if (commissions.length === 0 || commissions.some((c) => !['approved', 'paid'].includes(c.status)) || netMinor !== Math.round(Number(existing.amount) * 100)) {
    return res.status(409).json({ error: 'payout_amount_changed', detail: 'Начисления изменились после расчёта. Отмените заявку и рассчитайте выплату заново.' });
  }
  const completedAt = new Date();
  const updated = await db<PayoutRow>(TABLES.Payout)
    .where({ id: req.params.id, method: 'manual', status: 'pending' })
    .update({ status: 'paid', completedAt })
    .returning('*');
  if (updated.length === 0) {
    const existing = await db<PayoutRow>(TABLES.Payout).where({ id: req.params.id }).first();
    if (!existing) return res.status(404).json({ error: 'payout_not_found' });
    return res.status(409).json({
      error: 'not_confirmable',
      detail: `only pending manual payouts can be confirmed (this one is ${existing.method}/${existing.status})`,
    });
  }
  await db(TABLES.Commission).where({ payoutId: existing.id }).update({ status: 'paid', paidAt: completedAt });
  for (const commission of commissions.filter((c) => c.status !== 'paid')) {
    dispatchEvent(tenantId, 'commission.paid', {
      commissionId: commission.id, partnerId: commission.partnerId,
      amount: netCommissionAmount(commission, adjustments, commission.id).toFixed(2),
      currency: commission.currency, payoutId: existing.id,
    });
  }
  res.json({ payout: updated[0]! });
});

/** Cancel a still-unsettled manual request and release its reservations.
 * Does not cancel/reverse any bank transfer. Keeps the failed row for audit. */
payoutsRouter.post('/payouts/:id/cancel', requireAuth, requireAdmin, async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  if (!(await tryTenantPayoutLock(db as Knex.Transaction, tenantId))) return res.status(409).json({ error: 'payout_busy' });
  const payout = await db<PayoutRow>(TABLES.Payout).where({ id: req.params.id }).first();
  if (!payout) return res.status(404).json({ error: 'payout_not_found' });
  if (payout.method !== 'manual' || payout.status !== 'pending') return res.status(409).json({ error: 'not_cancellable' });
  await db(TABLES.Payout).where({ id: payout.id }).update({ status: 'failed', metadata: { ...payout.metadata, cancelledAt: new Date().toISOString(), cancellationReason: 'manual_cancel' } });
  // Older local versions prematurely stamped paid on pending payouts.
  // Repair only this cancelled reservation, never completed payouts.
  await db(TABLES.Commission).where({ payoutId: payout.id }).whereIn('status', ['approved', 'paid']).update({ status: 'approved', paidAt: null, payoutId: null });
  await db(TABLES.Commission).where({ payoutId: payout.id, status: 'reversed' }).update({ payoutId: null });
  res.json({ ok: true });
});

/** Provider-neutral callback/update point. CloudPayments integration can call
 * this after it has created or settled the real payout; the local ledger keeps
 * the operation ID for reconciliation and support. */
payoutsRouter.patch('/payouts/:id/provider', requireAuth, requireAdmin, async (req, res) => {
  const { db } = tenantOf(req);
  const body = providerStatusSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: 'invalid_body', detail: body.error.flatten() });
  const updated = await db<PayoutRow>(TABLES.Payout)
    .where({ id: req.params.id })
    .update({ providerOperationId: body.data.providerOperationId, providerStatus: body.data.providerStatus })
    .returning('*');
  if (updated.length === 0) return res.status(404).json({ error: 'payout_not_found' });
  res.json({ payout: updated[0] });
});

payoutsRouter.get(
  '/partners/:id/payouts',
  requireAuth,
  requirePartnerOrAdmin('id'),
  async (req, res) => {
    const { db } = tenantOf(req);
    const payouts = await db<PayoutRow>(TABLES.Payout)
      .where({ partnerId: req.params.id })
      .orderBy('createdAt', 'desc')
      .limit(200);
    res.json({ payouts });
  },
);
