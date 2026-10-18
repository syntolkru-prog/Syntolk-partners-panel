import type { Knex } from 'knex';
import { ulid } from 'ulid';
import {
  TABLES,
  type CommissionRow,
  type EventRow,
} from '@openpartner/db';
import { attributeEvent, type AttributeResult } from './attribution.js';
import { payoutLockKey } from './payout-lock.js';

/** Known monetary types require an ID even if a caller omits the amount.
 * Custom events carrying a value are monetary too, even when that value is 0. */
export function requiresExternalEventId(input: Pick<PaymentEventInput, 'type' | 'value'>): boolean {
  return ['invoice_paid', 'recurring_payment', 'payment', 'refund'].includes(input.type) || input.value != null;
}

export interface PaymentEventInput {
  userId: string;
  type: string;
  value?: number;
  currency?: string;
  externalEventId?: string | null;
  metadata?: Record<string, unknown>;
  ts?: Date;
}

export interface IngestedPaymentEvent {
  event: EventRow;
  attribution: AttributeResult | null;
  replayed: boolean;
}

/**
 * Provider-neutral payment event ingestion.
 *
 * CloudPayments, Syntolk's backend and the local simulator all use this same
 * path. `externalEventId` is the idempotency key, so a provider retry can
 * never create a second Event or a second commission.
 */
export async function ingestPaymentEvent(
  db: Knex,
  tenantId: string,
  input: PaymentEventInput,
): Promise<IngestedPaymentEvent> {
  const externalEventId = input.externalEventId?.trim() || null;
  if (requiresExternalEventId(input) && !externalEventId) throw new PaymentEventError('external_event_id_required');
  // Refunds must pass the original-payment validation and ledger compensation.
  if (input.type === 'refund') throw new PaymentEventError('invalid_payment_notification');
  if (!db.isTransaction) return db.transaction((trx) => ingestPaymentEvent(trx, tenantId, input));

  const eventId = ulid();
  const row = {
    id: eventId,
    tenantId,
    userId: input.userId,
    type: input.type,
    value: input.value != null ? input.value.toFixed(2) : null,
    currency: input.currency?.toUpperCase() ?? null,
    externalEventId,
    metadata: input.metadata ?? {},
    ts: input.ts ?? new Date(),
  };

  // ON CONFLICT keeps the surrounding tenant transaction usable on a race;
  // catching 23505 without a savepoint leaves PostgreSQL transactions aborted.
  const [event] = await db<EventRow>(TABLES.Event).insert(row)
    .onConflict(['tenantId', 'externalEventId']).ignore().returning('*');
  if (!event) {
    const existing = await db<EventRow>(TABLES.Event).where({ tenantId, externalEventId }).first();
    if (!existing) throw new Error('Conflicting payment event not found');
    return { event: existing, attribution: null, replayed: true };
  }

  const attribution = await attributeEvent(db, event);
  return { event, attribution, replayed: false };
}

export interface PaymentRefundInput {
  originalExternalEventId: string;
  refundExternalEventId: string;
  amount: number;
  currency?: string;
  metadata?: Record<string, unknown>;
  ts?: Date;
}

export interface PaymentRefundResult {
  refundEvent: EventRow;
  originalEventId: string;
  replayed: boolean;
  fullRefund: boolean;
  reversedCommissionIds: string[];
  adjustmentCount: number;
}

/**
 * Record a payment refund and compensate the commission ledger.
 *
 * Unpaid commissions from a full refund become `reversed`. Paid commissions
 * remain immutable and receive a negative CommissionAdjustment. Partial
 * refunds always use adjustments so the original payment remains auditable.
 */
export async function recordPaymentRefund(
  db: Knex,
  tenantId: string,
  input: PaymentRefundInput,
): Promise<PaymentRefundResult> {
  if (!db.isTransaction) return db.transaction((trx) => recordPaymentRefund(trx, tenantId, input));
  // Wait rather than rejecting a concurrent retry. All refund/payout actors
  // take this lock before any Event row lock, avoiding inverted lock order.
  await db.raw('select pg_advisory_xact_lock(?, ?)', payoutLockKey(tenantId));
  const original = await db<EventRow>(TABLES.Event)
    .where({ tenantId, externalEventId: input.originalExternalEventId })
    .forUpdate().first();
  if (!original) throw new PaymentEventError('original_payment_not_found');
  if (original.type === 'refund') throw new PaymentEventError('original_event_not_payment');
  const currency = input.currency?.toUpperCase() ?? original.currency;
  if (currency !== original.currency) throw new PaymentEventError('refund_currency_mismatch');

  const originalAmount = Number(original.value ?? 0);
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
    throw new PaymentEventError('original_payment_has_no_amount');
  }
  const refundMinor = Math.round(input.amount * 100);
  if (!Number.isFinite(input.amount) || refundMinor <= 0 || input.amount > originalAmount) {
    throw new PaymentEventError('invalid_refund_amount');
  }

  const existingRefund = await db<EventRow>(TABLES.Event)
    .where({ tenantId, externalEventId: input.refundExternalEventId }).first();
  if (existingRefund) return refundReplay(existingRefund, original, refundMinor, currency);

  const priorRefunds = await refundsForPayment(db, original);
  const refundedMinor = priorRefunds.reduce((sum, refund) => sum - Math.round(Number(refund.value) * 100), 0);
  const originalMinor = Math.round(originalAmount * 100);
  if (refundedMinor + refundMinor > originalMinor) throw new PaymentEventError('invalid_refund_amount');
  const fullRefund = refundedMinor + refundMinor === originalMinor;
  const [refundEvent] = await db<EventRow>(TABLES.Event)
    .insert({
      id: ulid(),
      tenantId,
      userId: original.userId,
      type: 'refund',
      value: (-refundMinor / 100).toFixed(2),
      currency,
      externalEventId: input.refundExternalEventId,
      metadata: {
        ...(input.metadata ?? {}),
        source: 'payment_refund',
        originalEventId: original.id,
        originalExternalEventId: input.originalExternalEventId,
        fullRefund,
      },
      ts: input.ts ?? new Date(),
    })
    .onConflict(['tenantId', 'externalEventId']).ignore().returning('*');
  if (!refundEvent) {
    const existing = await db<EventRow>(TABLES.Event)
      .where({ tenantId, externalEventId: input.refundExternalEventId }).first();
    if (!existing) throw new Error('Conflicting refund event not found');
    return refundReplay(existing, original, refundMinor, currency);
  }

  const { reversedCommissionIds, adjustmentCount } = await reconcilePaymentRefunds(db, original);
  return { refundEvent, originalEventId: original.id, replayed: false, fullRefund, reversedCommissionIds, adjustmentCount };
}

function refundReplay(refund: EventRow, original: EventRow, amountMinor: number, currency: string | null): PaymentRefundResult {
  if (refund.type !== 'refund' || refund.metadata.originalEventId !== original.id ||
      -Math.round(Number(refund.value) * 100) !== amountMinor || refund.currency !== currency) {
    throw new PaymentEventError('refund_id_conflict');
  }
  return {
    refundEvent: refund, originalEventId: original.id, replayed: true,
    fullRefund: Boolean(refund.metadata.fullRefund), reversedCommissionIds: [], adjustmentCount: 0,
  };
}

function refundsForPayment(db: Knex, original: EventRow): PromiseLike<EventRow[]> {
  return db<EventRow>(TABLES.Event).where({ tenantId: original.tenantId, type: 'refund' })
    .whereRaw(`"metadata"->>'originalEventId' = ?`, [original.id]).orderBy('id');
}

/** Caller holds the original Event lock, both on live refunds and on backlog.
 * Cumulative rounding ensures the final refund removes every commission cent. */
export async function reconcilePaymentRefunds(
  db: Knex, original: EventRow,
): Promise<{ reversedCommissionIds: string[]; adjustmentCount: number }> {
  const refunds = await refundsForPayment(db, original);
  const reversedCommissionIds: string[] = [];
  let adjustmentCount = 0;
  if (!refunds.length) return { reversedCommissionIds, adjustmentCount };
  const originalMinor = Math.round(Number(original.value) * 100);
  if (original.type === 'refund' || !Number.isFinite(originalMinor) || originalMinor <= 0) return { reversedCommissionIds, adjustmentCount };
  const commissions = (await db(`${TABLES.Commission} as c`)
    .join(`${TABLES.Attribution} as a`, 'a.id', 'c.attributionId')
    .where('a.eventId', original.id)
    .where('c.tenantId', original.tenantId)
    .select('c.*')) as CommissionRow[];
  const totalRefundMinor = refunds.reduce((sum, refund) => sum - Math.round(Number(refund.value) * 100), 0);

  for (const commission of commissions) {
    if (commission.status === 'reversed') continue;
    if (totalRefundMinor === originalMinor && (commission.status === 'accrued' || commission.status === 'approved')) {
      await db(TABLES.Commission)
        .where({ id: commission.id, status: commission.status })
        .update({ status: 'reversed' });
      reversedCommissionIds.push(commission.id);
      continue;
    }

    const commissionMinor = Math.round(Math.abs(Number(commission.amount)) * 100);
    const recorded = await db(TABLES.CommissionAdjustment)
      .where({ tenantId: original.tenantId, commissionId: commission.id, reason: 'refund_clawback' });
    const recordedIds = new Set(recorded.map((adjustment) => adjustment.metadata.refundExternalEventId));
    let cumulativeMinor = refunds.filter((refund) => recordedIds.has(refund.externalEventId))
      .reduce((sum, refund) => sum - Math.round(Number(refund.value) * 100), 0);
    let recordedClawbackMinor = recorded.reduce((sum, adjustment) => sum - Math.round(Number(adjustment.amount) * 100), 0);
    for (const refund of refunds.filter((row) => !recordedIds.has(row.externalEventId))) {
      cumulativeMinor -= Math.round(Number(refund.value) * 100);
      const clawbackMinor = Math.round(commissionMinor * cumulativeMinor / originalMinor) - recordedClawbackMinor;
      if (clawbackMinor <= 0) continue;
      await db(TABLES.CommissionAdjustment).insert({
        id: ulid(),
        tenantId: original.tenantId,
        commissionId: commission.id,
        amount: (-clawbackMinor / 100).toFixed(2),
        currency: commission.currency,
        reason: 'refund_clawback',
        actorAdminId: null,
        metadata: {
          refundExternalEventId: refund.externalEventId,
          originalExternalEventId: original.externalEventId,
          fullRefund: cumulativeMinor === originalMinor,
        },
      });
      recordedClawbackMinor += clawbackMinor;
      adjustmentCount += 1;
    }
  }

  return { reversedCommissionIds, adjustmentCount };
}

export class PaymentEventError extends Error {
  constructor(public code: 'original_payment_not_found' | 'original_payment_has_no_amount' | 'invalid_refund_amount' | 'invalid_payment_notification' | 'payout_busy' | 'external_event_id_required' | 'original_event_not_payment' | 'refund_currency_mismatch' | 'refund_id_conflict') {
    super(code);
  }
}
