import { Router } from 'express';
import { grantScope, requireAuth, requirePartnerOrAdmin } from '../auth.js';
import { tenantOf } from '../tenancy.js';
import { createLinkSchema, createPartnerLink, LinkError, listPartnerLinks } from '../links-service.js';
import { createTrackingSource, partnerTrackingSources, trackingSourceSchema } from '../tracking-sources.js';
import { z } from 'zod';

export const linksRouter = Router();
linksRouter.get('/partners/:id/links', requireAuth, requirePartnerOrAdmin('id'), async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  const query=z.object({programId:z.string().min(1).optional()}).safeParse(req.query);
  if(!query.success)return res.status(400).json({error:'invalid_query',detail:query.error.flatten()});
  const {links,archivedCount}=await listPartnerLinks(db,tenantId,req.params.id!,query.data.programId);
  res.json({links:links.filter(link=>req.query.archived==='1'||!link.archived),archivedCount});
});
linksRouter.get('/partners/:id/link-sources', requireAuth, requirePartnerOrAdmin('id'), async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  const query=z.object({programId:z.string().min(1).optional(),scenarioId:z.string().min(1).max(100).optional()}).safeParse(req.query);
  if(!query.success)return res.status(400).json({error:'invalid_query',detail:query.error.flatten()});
  res.json({ sources: await partnerTrackingSources(db, tenantId, req.params.id!, query.data.programId, query.data.scenarioId) });
});
linksRouter.post('/partners/:id/links/:linkId/sources', requireAuth, grantScope('links:write'), requirePartnerOrAdmin('id'), async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  const body = trackingSourceSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid_body', detail: body.error.flatten() });
  try { res.status(200).json(await createTrackingSource(db, tenantId, req.params.id!, req.params.linkId!, body.data)); }
  catch (error) { if (error instanceof LinkError) return res.status(error.status).json({ error: error.code, detail: error.message }); throw error; }
});
linksRouter.post('/partners/:id/links', requireAuth, grantScope('links:write'), requirePartnerOrAdmin('id'), async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  const body = createLinkSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid_body', detail: body.error.flatten() });
  try { res.status(201).json(await createPartnerLink(db, tenantId, req.params.id!, req.principal?.role === 'admin', body.data)); }
  catch (error) { if (error instanceof LinkError) return res.status(error.status).json({ error: error.code, detail: error.message }); throw error; }
});
