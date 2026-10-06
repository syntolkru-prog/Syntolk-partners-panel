import { Router } from 'express';
import { z } from 'zod';
import { ulid } from 'ulid';
import { TABLES, type ClickRow, type IdentityRow, type LinkRow, type ProgramRow } from '@openpartner/db';
import { grantScope, requireAdmin, requireAuth } from '../auth.js';
import {
  ingestPaymentEvent,
  PaymentEventError,
  recordPaymentRefund,
} from '../payment-events.js';
import { tenantOf } from '../tenancy.js';

const paymentSchema = z.object({
  userId: z.string().min(1).max(120),
  type: z.string().min(1).max(80).default('invoice_paid'),
  value: z.number().nonnegative(),
  currency: z.string().length(3).default('RUB'),
  externalEventId: z.string().min(1).max(120),
  metadata: z.record(z.unknown()).optional(),
  ts: z.string().datetime().optional(),
});

const refundSchema = z.object({
  originalExternalEventId: z.string().min(1).max(120),
  refundExternalEventId: z.string().min(1).max(120),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  metadata: z.record(z.unknown()).optional(),
  ts: z.string().datetime().optional(),
});

const simulatorSchema = z.object({
  partnerId: z.string().min(1),
  linkKey: z.string().min(3).max(64),
  userId: z.string().min(1).max(120),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).default('RUB'),
  type: z.string().min(1).max(80).default('invoice_paid'),
  externalEventId: z.string().min(1).max(120),
});

export const paymentsRouter = Router();

/**
 * Local-only friendly wrapper around the real flow. It creates a click and
 * identity when the selected demo user has not been stitched yet, then sends
 * the payment through the same idempotent ingestion path as production.
 */
paymentsRouter.post('/payments/simulate', requireAuth, requireAdmin, async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  const body = simulatorSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: 'invalid_body', detail: body.error.flatten() });

  const link = await db<LinkRow>(TABLES.Link).where({ linkKey: body.data.linkKey }).first();
  if (!link || link.partnerId !== body.data.partnerId) {
    return res.status(404).json({ error: 'link_not_found_for_partner' });
  }
  const program = await db<ProgramRow>(TABLES.Program).where({ id: link.programId }).first();
  if (!program) return res.status(404).json({ error: 'program_not_found' });

  let identity = await db<IdentityRow>(TABLES.Identity).where({ userId: body.data.userId }).first();
  let clickId = identity?.clickId ?? null;
  if (!identity) {
    clickId = ulid();
    await db<ClickRow>(TABLES.Click).insert({
      id: clickId,
      tenantId,
      linkId: link.id,
      partnerId: link.partnerId,
      programId: link.programId,
      landingUrl: link.destinationUrl ?? program.destinationUrl,
      ipHash: null,
      userAgent: 'Syntolk-Local-Payment-Simulator/1',
      referer: 'syntolk://local-simulator',
      utmSource: 'local',
      utmMedium: 'simulator',
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
      country: 'ru',
      fraudFlag: null,
      ts: new Date(),
    });
    const [created] = await db<IdentityRow>(TABLES.Identity)
      .insert({ id: ulid(), tenantId, clickId, userId: body.data.userId })
      .returning('*');
    identity = created!;
  }

  const result = await ingestPaymentEvent(db, tenantId, {
    userId: body.data.userId,
    type: body.data.type,
    value: body.data.amount,
    currency: body.data.currency,
    externalEventId: body.data.externalEventId,
    metadata: { source: 'local_simulator', linkKey: body.data.linkKey, partnerId: body.data.partnerId },
  });
  res.status(result.replayed ? 200 : 201).json({
    ok: true,
    clickId,
    identityId: identity?.id ?? null,
    eventId: result.event.id,
    replayed: result.replayed,
    attribution: result.attribution,
  });
});

/**
 * Stable provider-neutral contract for Syntolk's billing backend.
 * CloudPayments and the local simulator will both feed this endpoint after
 * the provider adapter has normalized their payloads.
 */
paymentsRouter.post(
  '/payments/events',
  requireAuth,
  grantScope('events:write'),
  requireAdmin,
  async (req, res) => {
    const { db, tenantId } = tenantOf(req);
    const body = paymentSchema.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: 'invalid_body', detail: body.error.flatten() });

    const result = await ingestPaymentEvent(db, tenantId, {
      ...body.data,
      ts: body.data.ts ? new Date(body.data.ts) : undefined,
    });
    res.status(result.replayed ? 200 : 201).json({
      ok: true,
      eventId: result.event.id,
      replayed: result.replayed,
      attribution: result.attribution,
    });
  },
);

/** Record a full or partial payment refund and compensate partner earnings. */
paymentsRouter.post(
  '/payments/refunds',
  requireAuth,
  grantScope('events:write'),
  requireAdmin,
  async (req, res) => {
    const { db, tenantId } = tenantOf(req);
    const body = refundSchema.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: 'invalid_body', detail: body.error.flatten() });

    try {
      const result = await recordPaymentRefund(db, tenantId, {
        ...body.data,
        ts: body.data.ts ? new Date(body.data.ts) : undefined,
      });
      res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof PaymentEventError) {
        const status = error.code === 'original_payment_not_found' ? 404 : 409;
        return res.status(status).json({ error: error.code });
      }
      throw error;
    }
  },
);
