import { Router } from 'express';
import { z } from 'zod';
import type { Knex } from 'knex';
import { requireAdmin, requireAuth } from '../auth.js';
import { tenantOf } from '../tenancy.js';
import {
  adminAnalyticsTableQuerySchema, analyticsDetailsQuerySchema, analyticsFiltersFromQuery,
  analyticsPartnerIds, analyticsPartnerOptions, analyticsQuerySchema, partnerAnalytics, partnerAnalyticsDetails,
} from '../partner-analytics.js';

export const adminOverviewRouter = Router();

async function filtersForAdmin(db: Knex, tenantId: string, query: unknown) {
  const input = analyticsQuerySchema.parse(query), ids = analyticsPartnerIds(input);
  // Resolve a single partner's civil dates exactly as the partner route does.
  // More than one requested partner uses the explicit tenant-wide default.
  const profile = ids?.length === 1 ? await db('CoachProfile').where({ tenantId, partnerId: ids[0] }).first() : undefined;
  return analyticsFiltersFromQuery(query, profile?.data?.timezone ?? 'Europe/Moscow');
}

adminOverviewRouter.get('/admin/analytics', requireAuth, requireAdmin, async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  try {
    const table = adminAnalyticsTableQuerySchema.parse(req.query);
    const filters = await filtersForAdmin(db, tenantId, req.query);
    res.json(await partnerAnalytics(db, tenantId, undefined, { ...filters, groupBy: filters.groupBy ?? 'partner' }, table));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'invalid_query', detail: error.flatten() });
    throw error;
  }
});

adminOverviewRouter.get('/admin/analytics/details', requireAuth, requireAdmin, async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  try {
    const filters = await filtersForAdmin(db, tenantId, req.query);
    const { cursor } = analyticsDetailsQuerySchema.parse(req.query);
    res.json(await partnerAnalyticsDetails(db, tenantId, undefined, filters, cursor));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'invalid_query', detail: error.flatten() });
    throw error;
  }
});

const partnerOptionsQuery = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
adminOverviewRouter.get('/admin/analytics/partners', requireAuth, requireAdmin, async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  try { res.json(await analyticsPartnerOptions(db, tenantId, partnerOptionsQuery.parse(req.query))); }
  catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'invalid_query', detail: error.flatten() });
    throw error;
  }
});

// Keep the existing overview wire shape, but derive every metric from the
// canonical scope, taxonomy, saved allocations and corrected ledger.
adminOverviewRouter.get('/admin/overview', requireAuth, requireAdmin, async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  try {
    const filters = await filtersForAdmin(db, tenantId, req.query);
    const report = await partnerAnalytics(db, tenantId, undefined, { ...filters, groupBy: 'partner' },
      { ...adminAnalyticsTableQuerySchema.parse({ sort: 'createdAt', direction: 'desc' }), pageSize: 200 });
    const partnerRows = report.partnerTable!.rows.map(row => ({ id: row.id, name: row.name, email: row.email,
      clicks: row.counts.clicks, revenue: row.amountsMinor.observedPayments/100, events: row.counts.attributedEvents,
      commission: { ...row.commissionByStatus, paid: row.balances.paid }, netRevenue: (row.amountsMinor.netPayments-row.amountsMinor.netAccrued)/100 }));
    res.json({ since: report.period.since.toISOString(), totals: {
      partners: report.summary!.partners, clicks: report.counts.clicks, attributedRevenue: report.amountsMinor.observedPayments/100,
      attributedEvents: report.counts.attributedEvents, commissionAccrued: report.commissionByStatus.accrued ?? 0,
      commissionApproved: report.commissionByStatus.approved ?? 0, commissionPending: report.commissionByStatus.pending ?? 0,
      commissionPaid: report.balances.paid, netRevenue: (report.amountsMinor.netPayments-report.amountsMinor.netAccrued)/100,
    }, partners: partnerRows });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'invalid_query', detail: error.flatten() });
    throw error;
  }
});
