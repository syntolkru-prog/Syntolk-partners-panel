import type { Knex } from 'knex';
import { ulid } from 'ulid';
import {
  TABLES,
  type CommissionRow,
  type EventRow,
} from '@openpartner/db';
import { attributeEvent, type AttributeResult } from './attribution.js';
import { tryTenantPayoutLock } from './payout-lock.js';

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

  if (externalEventId) {
    const existing = await db<EventRow>(TABLES.Event)
      .where({ tenantId, externalEventId })
      .first();
    if (existing) return { event: existing, attribution: null, replayed: true };
  }

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

  let event: EventRow;
  try {
    const [inserted] = await db<EventRow>(TABLES.Event).insert(row).returning('*');
    event = inserted!;
  } catch (error) {
    // Two provider deliveries can race before either request sees the other.
    // The unique DB constraint is the final idempotency guard.
    if (externalEventId && isUniqueViolation(error)) {
      const existing = await db<EventRow>(TABLES.Event)
        .where({ tenantId, externalEventId })
        .first();
      if (existing) return { event: existing, attribution: null, replayed: true };
    }
    throw error;
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
  if (db.isTransaction && !(await tryTenantPayoutLock(db as Knex.Transaction, tenantId))) {
    throw new PaymentEventError('payout_busy');
  }
  const existingRefund = await db<EventRow>(TABLES.Event)
    .where({ tenantId, externalEventId: input.refundExternalEventId })
    .first();
  if (existingRefund) {
    return {
      refundEvent: existingRefund,
      originalEventId: String(existingRefund.metadata.originalEventId ?? ''),
      replayed: true,
      fullRefund: Boolean(existingRefund.metadata.fullRefund),
      reversedCommissionIds: [],
      adjustmentCount: 0,
    };
  }

  const original = await db<EventRow>(TABLES.Event)
    .where({ tenantId, externalEventId: input.originalExternalEventId })
    .first();
  if (!original) throw new PaymentEventError('original_payment_not_found');

  const originalAmount = Math.abs(Number(original.value ?? 0));
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
    throw new PaymentEventError('original_payment_has_no_amount');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > originalAmount) {
    throw new PaymentEventError('invalid_refund_amount');
  }

  const refundAmount = Math.round(input.amount * 100) / 100;
  const fullRefund = refundAmount >= Math.round(originalAmount * 100) / 100;
  const [refundEvent] = await db<EventRow>(TABLES.Event)
    .insert({
      id: ulid(),
      tenantId,
      userId: original.userId,
      type: 'refund',
      value: (-refundAmount).toFixed(2),
      currency: input.currency?.toUpperCase() ?? original.currency,
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
    .returning('*');

  const commissions = (await db(`${TABLES.Commission} as c`)
    .join(`${TABLES.Attribution} as a`, 'a.id', 'c.attributionId')
    .where('a.eventId', original.id)
    .select('c.*')) as CommissionRow[];

  const ratio = Math.min(1, refundAmount / originalAmount);
  const reversedCommissionIds: string[] = [];
  let adjustmentCount = 0;

  for (const commission of commissions) {
    if (commission.status === 'reversed') continue;
    const clawback = Math.min(
      Math.abs(Number(commission.amount)),
      Math.round(Math.abs(Number(commission.amount)) * ratio * 100) / 100,
    );
    if (clawback <= 0) continue;

    if (fullRefund && (commission.status === 'accrued' || commission.status === 'approved')) {
      await db(TABLES.Commission)
        .where({ id: commission.id, status: commission.status })
        .update({ status: 'reversed' });
      reversedCommissionIds.push(commission.id);
      continue;
    }

    const alreadyRecorded = await db(TABLES.CommissionAdjustment)
      .where({ commissionId: commission.id, reason: 'refund_clawback' })
      .whereRaw(`"metadata"->>'refundExternalEventId' = ?`, [input.refundExternalEventId])
      .first('id');
    if (alreadyRecorded) continue;

    await db(TABLES.CommissionAdjustment).insert({
      id: ulid(),
      tenantId,
      commissionId: commission.id,
      amount: (-clawback).toFixed(2),
      currency: commission.currency,
      reason: 'refund_clawback',
      actorAdminId: null,
      metadata: {
        refundExternalEventId: input.refundExternalEventId,
        originalExternalEventId: input.originalExternalEventId,
        fullRefund,
      },
    });
    adjustmentCount += 1;
  }

  return {
    refundEvent: refundEvent!,
    originalEventId: original.id,
    replayed: false,
    fullRefund,
    reversedCommissionIds,
    adjustmentCount,
  };
}

export class PaymentEventError extends Error {
  constructor(public code: 'original_payment_not_found' | 'original_payment_has_no_amount' | 'invalid_refund_amount' | 'invalid_payment_notification' | 'payout_busy') {
    super(code);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}
