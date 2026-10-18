import { Router } from 'express';
import { z } from 'zod';
import { ulid } from 'ulid';
import { TABLES, type ClickRow, type IdentityRow } from '@openpartner/db';
import { attributeBacklogForUser } from '../attribution.js';
import { ipRateLimit } from '../middleware/rate-limit.js';
import { tenantOf } from '../tenancy.js';
import { grantScope, requireAdmin, requireAuth } from '../auth.js';

const schema = z.object({
  cref: z.string().min(1),
  userId: z.string().min(1),
  ts: z.number().optional(),
});

export const identifyRouter = Router();

// The merchant backend supplies userId from its authenticated session.
// A browser or partner must not be able to bind an arbitrary customer to
// a referral. Reuse the same trusted credentials as conversion ingestion.
identifyRouter.post(
  '/attribution/identify',
  requireAuth,
  grantScope('events:write'),
  requireAdmin,
  ipRateLimit({ name: 'identify', max: 120, windowMs: 60_000 }),
  async (req, res) => {
    const { db, tenantId } = tenantOf(req);
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'invalid_body', detail: body.error.flatten() });

    const { cref, userId } = body.data;

    const click = await db<ClickRow>(TABLES.Click).where({ id: cref }).first();
    if (!click) return res.status(404).json({ error: 'click_not_found' });

    // Multi-touch: every (clickId, userId) pair kept. Unique constraint makes
    // re-identify() calls for the same click a no-op.
    const identityId = ulid();
    const inserted = await db<IdentityRow>(TABLES.Identity)
      .insert({ id: identityId, tenantId, clickId: cref, userId })
      .onConflict(['clickId', 'userId'])
      .ignore()
      .returning('id');

    const firstStitch = inserted.length > 0;
    const attributed = firstStitch ? await attributeBacklogForUser(db, userId) : 0;

    res.json({
      ok: true,
      identityId: firstStitch ? identityId : null,
      firstStitch,
      backfilledAttributions: attributed,
    });
  },
);
