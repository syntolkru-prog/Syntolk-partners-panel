import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePartnerOrAdmin } from '../auth.js';
import { tenantOf } from '../tenancy.js';
import { analyticsFiltersFromQuery, partnerAnalytics } from '../partner-analytics.js';

export const funnelRouter = Router();

funnelRouter.get('/partners/:id/funnel', requireAuth, requirePartnerOrAdmin('id'), async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  try {
    const profile = await db('CoachProfile').where({ tenantId, partnerId: req.params.id! }).first();
    const filters = analyticsFiltersFromQuery(req.query, profile?.data?.timezone ?? 'Europe/Moscow');
    const report = await partnerAnalytics(db, tenantId, req.params.id!, filters);
    res.json({ partnerId: req.params.id, since: report.period.since.toISOString(), until: report.period.until.toISOString(), currency: report.currency,
      stages: { clicks: report.counts.clicks, identities: report.counts.identities, signups: report.counts.registrations, paid: report.counts.payingCustomers },
      cohort: { clicks: report.counts.clicks, identities: report.counts.identities, signups: report.conversions.cohortRegistrations,
        paid: report.conversions.cohortPayingCustomers, paidSignups: report.conversions.cohortPaidRegistrations },
      conversions: report.conversions, metricBasis: report.metricBasis, generatedAt: report.generatedAt,
      dataQuality: report.dataQuality, warnings: report.warnings, views: report.views, ctr: report.ctr,
      rates: { stitchRate: report.counts.clicks ? report.counts.identities/report.counts.clicks : 0, signupRate: report.counts.identities ? report.conversions.cohortRegistrations/report.counts.identities : 0, paidRate: report.conversions.registrationToPayment ?? 0, overall: report.conversions.clickToPayment ?? 0 },
      revenue: report.amountsMinor.observedPayments/100,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'invalid_query', detail: error.flatten() });
    throw error;
  }
});
