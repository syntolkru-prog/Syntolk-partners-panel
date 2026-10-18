import { Router } from 'express';
import { z } from 'zod';
import { grantScope, requireAdmin, requireAuth } from '../auth.js';
import { ingestPaymentEvent, requiresExternalEventId } from '../payment-events.js';
import { tenantOf } from '../tenancy.js';

const schema = z.object({
  userId: z.string().min(1),
  type: z.string().min(1),
  value: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  externalEventId: z.string().trim().min(1).max(120).optional(),
  metadata: z.record(z.unknown()).optional(),
  ts: z.string().datetime().optional(),
}).refine((event) => !requiresExternalEventId(event) || !!event.externalEventId, {
  path: ['externalEventId'], message: 'Monetary events require externalEventId',
}).refine((event) => event.type !== 'refund', {
  path: ['type'], message: 'Use /payments/refunds to record a refund',
});

export const eventsRouter = Router();

// Server-to-server conversion event ingest — requires admin credentials
// (this is the merchant's backend speaking, not a browser). A scoped key
// with `events:write` is also accepted so brands can wire CRMs / Zapier /
// HubSpot workflows into this route without sharing a full admin key.
eventsRouter.post('/attribution/events', requireAuth, grantScope('events:write'), requireAdmin, async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  const body = schema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid_body', detail: body.error.flatten() });

  const result = await ingestPaymentEvent(db, tenantId, {
    ...body.data,
    currency: body.data.currency ?? 'USD',
    ts: body.data.ts ? new Date(body.data.ts) : undefined,
  });
  // Keep the original Syntolk conversion-event contract stable: callers use
  // the response body to inspect `replayed`, so both a first delivery and an
  // idempotent retry remain HTTP 200.
  res.status(200).json({
    ok: true,
    eventId: result.event.id,
    replayed: result.replayed,
    attribution: result.attribution,
  });
});
