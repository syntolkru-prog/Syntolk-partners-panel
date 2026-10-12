import { Router } from 'express';
import { TABLES, type LinkRow } from '@openpartner/db';
import { grantScope, requireAuth, requirePartnerOrAdmin } from '../auth.js';
import { tenantOf } from '../tenancy.js';
import { createLinkSchema, createPartnerLink, LinkError } from '../links-service.js';

export const linksRouter = Router();
linksRouter.get('/partners/:id/links', requireAuth, requirePartnerOrAdmin('id'), async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  res.json({ links: await db<LinkRow>(TABLES.Link).where({ tenantId, partnerId: req.params.id }).orderBy('createdAt', 'desc') });
});
linksRouter.post('/partners/:id/links', requireAuth, grantScope('links:write'), requirePartnerOrAdmin('id'), async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  const body = createLinkSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid_body', detail: body.error.flatten() });
  try { res.status(201).json(await createPartnerLink(db, tenantId, req.params.id!, req.principal?.role === 'admin', body.data)); }
  catch (error) { if (error instanceof LinkError) return res.status(error.status).json({ error: error.code, detail: error.message }); throw error; }
});
