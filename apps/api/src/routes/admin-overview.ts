import { Router } from 'express';
import { TABLES, type PartnerRow } from '@openpartner/db';
import { requireAdmin, requireAuth } from '../auth.js';
import { tenantOf } from '../tenancy.js';
import { adjustmentTotalsByCommission, netCommissionAmount } from '../commission-net.js';

export const adminOverviewRouter = Router();

/**
 * One-shot admin dashboard payload. Composed in a single endpoint so the
 * portal's home view doesn't need N+1 per-partner fetches.
 *
 * Window defaults to 30 days; the Dub-style partner cards don't need more
 * granularity than that for the high-level view.
 */
adminOverviewRouter.get('/admin/overview', requireAuth, requireAdmin, async (req, res) => {
  const { db } = tenantOf(req);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const partners = await db<PartnerRow>(TABLES.Partner).orderBy('createdAt', 'desc').limit(200);

  const clicksByPartner = (await db(TABLES.Click)
    .where('ts', '>=', since)
    .groupBy('partnerId')
    .select('partnerId')
    .count<{ partnerId: string; count: string }[]>({ count: '*' })) as Array<{ partnerId: string; count: string }>;

  const revenueByPartner = (await db(TABLES.Attribution)
    .join(TABLES.Event, `${TABLES.Event}.id`, `${TABLES.Attribution}.eventId`)
    .where(`${TABLES.Attribution}.computedAt`, '>=', since)
    .groupBy(`${TABLES.Attribution}.partnerId`)
    .select(`${TABLES.Attribution}.partnerId as partnerId`)
    .select(
      db.raw('COALESCE(SUM("Event".value * "Attribution".weight), 0) as revenue'),
      db.raw('COUNT(*) as events'),
    )) as Array<{ partnerId: string; revenue: string; events: string }>;

  const commissionRows = (await db(`${TABLES.Commission} as c`)
    .leftJoin(`${TABLES.Payout} as p`, 'p.id', 'c.payoutId')
    .where('c.accruedAt', '>=', since)
    .select('c.id', 'c.partnerId', 'c.amount')
    .select(db.raw(`CASE WHEN "c"."payoutId" IS NOT NULL AND "c"."status" IN ('approved','paid') AND COALESCE("p"."status", 'pending') <> 'paid' THEN 'pending' ELSE "c"."status" END as status`))) as Array<{
    id: string;
    partnerId: string;
    status: string;
    amount: string;
  }>;
  const adjustments = await adjustmentTotalsByCommission(db, commissionRows.map((c) => c.id));

  const clicks = new Map(clicksByPartner.map((r) => [r.partnerId, Number(r.count ?? 0)]));
  const rev = new Map(revenueByPartner.map((r) => [r.partnerId, { revenue: Number(r.revenue ?? 0), events: Number(r.events ?? 0) }]));
  const comm = new Map<string, Record<string, number>>();
  for (const row of commissionRows) {
    const bucket = comm.get(row.partnerId) ?? {};
    bucket[row.status] = (bucket[row.status] ?? 0) + netCommissionAmount(row, adjustments, row.id);
    comm.set(row.partnerId, bucket);
  }

  const partnerRows = partners.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    clicks: clicks.get(p.id) ?? 0,
    revenue: rev.get(p.id)?.revenue ?? 0,
    events: rev.get(p.id)?.events ?? 0,
    commission: comm.get(p.id) ?? {},
    netRevenue: Math.round(((rev.get(p.id)?.revenue ?? 0) - Object.values(comm.get(p.id) ?? {}).reduce((a, b) => a + b, 0)) * 100) / 100,
  }));

  const totals = {
    partners: partners.length,
    clicks: Array.from(clicks.values()).reduce((a, b) => a + b, 0),
    attributedRevenue: Array.from(rev.values()).reduce((a, b) => a + b.revenue, 0),
    attributedEvents: Array.from(rev.values()).reduce((a, b) => a + b.events, 0),
    commissionAccrued: partnerRows.reduce((a, p) => a + (p.commission.accrued ?? 0), 0),
    commissionApproved: partnerRows.reduce((a, p) => a + (p.commission.approved ?? 0), 0),
    commissionPending: partnerRows.reduce((a, p) => a + (p.commission.pending ?? 0), 0),
    commissionPaid: partnerRows.reduce((a, p) => a + (p.commission.paid ?? 0), 0),
    netRevenue: partnerRows.reduce((a, p) => a + p.netRevenue, 0),
  };

  res.json({
    since: since.toISOString(),
    totals,
    partners: partnerRows,
  });
});
