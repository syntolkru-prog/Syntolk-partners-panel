/**
 * Payout PLANNER.
 *
 * Finds approved commissions, groups by (partner, currency), and writes a
 * Payout row per group. Manual-rail payouts are complete when this returns
 * (the operator owns the transfer). Connect-rail payouts are written as
 * durable *intents* — `metadata.transferState = 'intent'` — and the money
 * is moved later by `executePayoutTransfers` (payout-transfers.ts), which
 * runs OUTSIDE any transaction.
 *
 * Why the split (audit #10): this function runs inside the caller's tenant
 * transaction (scheduler tick / request middleware). Calling Stripe from
 * in here meant a transfer could succeed and the surrounding commit then
 * fail — the Payout row rolled back, the money gone, and the next run
 * minted a NEW payoutId, hence a NEW idempotency key, hence a DUPLICATE
 * transfer. Same for an ambiguous (timeout) Stripe error. The fix mirrors
 * `funding/executor.ts`: freeze the intent (its id, and with it its
 * idempotency key `payout_<payoutId>`) and its commission set in the DB,
 * COMMIT, and only then talk to Stripe.
 *
 * The commission set is frozen by claiming the rows — `Commission.payoutId`
 * is stamped while `status` stays 'approved'. Claimed rows are invisible to
 * the next planning run (every lookup here filters `payoutId is null`), so
 * a retry re-uses the same intent instead of regrouping a larger set under
 * a new key. Claims are released if the intent is abandoned.
 *
 * Mode semantics:
 *   - selfhost / flat   → no platform fee; transfer the full amount.
 *   - revshare          → we retain 3% as our platform fee. The transfer still
 *                         sends the full commission amount to the partner;
 *                         the 3% is reconciled against merchant billing (tracked
 *                         on Payout.metadata.platformFee for the ledger).
 *
 * Multi-tenant: takes (db, tenantId). Pass req.db from a route handler, or
 * the privileged db with app.tenant_id pinned in the calling transaction
 * from the scheduler.
 */

import type { Knex } from 'knex';
import { ulid } from 'ulid';
import {
  TABLES,
  type CommissionRow,
  type PartnerRow,
  type PayoutMethod,
  type TenantRow,
} from '@openpartner/db';
import { REVSHARE_FEE_BPS, type OpenPartnerMode } from './deployment.js';
import { getTenantBillingState } from './billing-plan.js';
import { dispatchEvent } from './webhook-dispatcher.js';
import { tryTenantPayoutLock } from './payout-lock.js';
import { adjustmentTotalsByCommission, netCommissionAmount } from './commission-net.js';

export interface PayoutRunResult {
  runId: string;
  mode: OpenPartnerMode;
  /** Group totals that didn't meet the tenant's payoutThresholdCents are
   *  reported here instead of in payouts. Commissions stay 'approved' so
   *  they accumulate to the next run. */
  skippedBelowThreshold: Array<{ partnerId: string; currency: string; amount: number }>;
  /** Hosted-tenant Connect payouts refused because there is no mechanism
   *  funding the commission principal — transfers would spend the
   *  PLATFORM's Stripe balance with no way to collect from the brand
   *  (audit 2026-07-10). Commissions stay 'approved'; no Payout row is
   *  written so retries don't accumulate failure rows. */
  skippedUnfunded: Array<{ partnerId: string; currency: string; amount: number }>;
  /** Connect-rail rows come back 'pending': the Payout intent is written
   *  and its commissions are frozen, but the transfer is posted later by
   *  `executePayoutTransfers`. Manual-rail rows are 'pending' too (the
   *  operator confirms out-of-band). */
  payouts: Array<{
    payoutId: string;
    partnerId: string;
    amount: number;
    currency: string;
    method: PayoutMethod;
    status: 'pending' | 'paid' | 'failed';
    platformFee?: number;
    error?: string;
  }>;
}

export async function runPayouts(db: Knex, tenantId: string): Promise<PayoutRunResult> {
  // Serialize every payout actor for this tenant — the weekly scheduler
  // tick, the admin run-payouts endpoint, and funding reservation — on one
  // advisory xact lock (audit: concurrent runs could double-transfer).
  // Callers always run inside a transaction (scheduler + tenantMiddleware),
  // so the xact-scoped lock self-releases.
  if (db.isTransaction && !(await tryTenantPayoutLock(db as Knex.Transaction, tenantId))) {
    return {
      runId: 'locked',
      mode: 'flat',
      payouts: [],
      skippedBelowThreshold: [],
      skippedUnfunded: [],
    };
  }

  // Per-TENANT billing mode, not the global env — on the hosted deployment
  // OPENPARTNER_MODE says 'flat' while individual tenants are on revshare,
  // which zeroed platformFee for every hosted revshare payout (audit
  // finding). Also drives the funding guard below.
  const billing = await getTenantBillingState(db, tenantId);
  const mode = billing.mode;
  const runId = ulid();

  const tenant = await db<TenantRow>(TABLES.Tenant).where({ id: tenantId }).first();
  // null / 0 / negative all collapse to "no threshold" — keeps the legacy
  // behavior intact for tenants who haven't touched the setting.
  const thresholdCents = Math.max(0, tenant?.payoutThresholdCents ?? 0);

  // `payoutId is null` is the un-claimed filter: a commission already
  // frozen onto an open transfer intent must NOT be regrouped, or the
  // retry would pay it twice under a different idempotency key (audit
  // #10). Claims are stamped by this function and released by the
  // executor when an intent is abandoned.
  const groups = (await db(TABLES.Commission)
    .where({ status: 'approved' })
    .whereNull('payoutId')
    .groupBy('partnerId', 'currency')
    .select('partnerId', 'currency')) as Array<{ partnerId: string; currency: string }>;

  const results: PayoutRunResult['payouts'] = [];
  const skipped: PayoutRunResult['skippedBelowThreshold'] = [];
  const skippedUnfunded: PayoutRunResult['skippedUnfunded'] = [];

  for (const group of groups) {
    const partner = await db<PartnerRow>(TABLES.Partner).where({ id: group.partnerId }).first();
    if (!partner) continue;

    // Read the exact rows first and derive the total from them, in minor
    // units. The group total and a later SELECT can disagree under READ
    // COMMITTED (each statement takes a fresh snapshot), and the transfer
    // amount must equal the sum of the commissions we actually claim —
    // never a stale aggregate.
    const commissions = await db<CommissionRow>(TABLES.Commission)
      .where({ partnerId: group.partnerId, currency: group.currency, status: 'approved' })
      .whereNull('payoutId');
    if (commissions.length === 0) continue;
    const adjustments = await adjustmentTotalsByCommission(db, commissions.map((c) => c.id));
    const payableCommissions = commissions.filter((c) => netCommissionAmount(c, adjustments, c.id) > 0);
    if (payableCommissions.length === 0) continue;
    const amountMinor = payableCommissions.reduce(
      (s, c) => s + Math.round(netCommissionAmount(c, adjustments, c.id) * 100),
      0,
    );
    const amount = amountMinor / 100;

    // Threshold gate: balances below the tenant minimum stay 'approved'
    // and roll over to the next run. Cents are the storage unit on the
    // tenant column, so the comparison happens in minor units.
    if (thresholdCents > 0 && amountMinor < thresholdCents) {
      skipped.push({ partnerId: partner.id, currency: group.currency, amount });
      continue;
    }

    const platformFee = mode === 'revshare' ? Math.round(amount * REVSHARE_FEE_BPS) / 10000 : 0;

    const payoutId = ulid();
    // CloudPayments payout splitting is not enabled until the merchant
    // activates the corresponding product and supplies its private API
    // contract. Until then every payout is an auditable manual ledger entry;
    // no third-party payout API is called from the local Syntolk build.
    const method: PayoutMethod = 'manual';
    const finalStatus: 'pending' = 'pending';

    await db(TABLES.Payout).insert({
      id: payoutId,
      tenantId,
      partnerId: partner.id,
      amount: amount.toFixed(2),
      currency: group.currency,
      method,
      status: finalStatus,
      metadata: {
        runId,
        platformFee,
        commissionCount: payableCommissions.length,
        adjustmentCount: commissions.length - payableCommissions.length,
      },
    });
    await db(TABLES.Commission)
      .whereIn('id', payableCommissions.map((c) => c.id))
      .update({ status: 'paid', paidAt: new Date(), payoutId });

    // Manual path: commissions are already marked paid in the tx above.
    // Fire webhooks now — the operator owns the out-of-band transfer.
    dispatchEvent(tenantId, 'payout.created', {
        payoutId,
        partnerId: partner.id,
        amount: amount.toFixed(2),
        currency: group.currency,
        method,
        commissionIds: payableCommissions.map((c) => c.id),
        platformFee: platformFee || undefined,
      });
    for (const c of payableCommissions) {
      const netAmount = netCommissionAmount(c, adjustments, c.id);
      dispatchEvent(tenantId, 'commission.paid', {
          commissionId: c.id,
          partnerId: c.partnerId,
          amount: netAmount.toFixed(2),
          currency: c.currency,
          payoutId,
        });
    }
    results.push({
        payoutId,
        partnerId: partner.id,
        amount,
        currency: group.currency,
        method,
        status: 'pending',
        platformFee: platformFee || undefined,
    });
  }

  return { runId, mode, payouts: results, skippedBelowThreshold: skipped, skippedUnfunded };
}
