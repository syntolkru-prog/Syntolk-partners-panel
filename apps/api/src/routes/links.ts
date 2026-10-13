import { Router } from 'express';
import { grantScope, requireAuth, requirePartnerOrAdmin } from '../auth.js';
import { tenantOf } from '../tenancy.js';
import { createLinkSchema, createPartnerLink, LinkError, listPartnerLinks } from '../links-service.js';

export const linksRouter = Router();
linksRouter.get('/partners/:id/links', requireAuth, requirePartnerOrAdmin('id'), async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  const {links,archivedCount}=await listPartnerLinks(db,tenantId,req.params.id!);
  res.json({links:links.filter(link=>req.query.archived==='1'||!link.archived),archivedCount});
});
linksRouter.post('/partners/:id/links', requireAuth, grantScope('links:write'), requirePartnerOrAdmin('id'), async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  const body = createLinkSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid_body', detail: body.error.flatten() });
  try { res.status(201).json(await createPartnerLink(db, tenantId, req.params.id!, req.principal?.role === 'admin', body.data)); }
  catch (error) { if (error instanceof LinkError) return res.status(error.status).json({ error: error.code, detail: error.message }); throw error; }
});
