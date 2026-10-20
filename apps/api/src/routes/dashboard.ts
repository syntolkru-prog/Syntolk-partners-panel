import { Router } from 'express';
import { z } from 'zod';
import { TABLES, type ClickRow } from '@openpartner/db';
import { grantScope, requireAuth, requirePartnerOrAdmin } from '../auth.js';
import { tenantOf } from '../tenancy.js';
import { parseUserAgent } from '../ua-parse.js';
import { analyticsDetailsQuerySchema, analyticsFiltersFromQuery, partnerAnalytics, partnerAnalyticsDetails, partnerAnalyticsOverview } from '../partner-analytics.js';
import {calculatorCurrentValues} from '../calculator-current-values.js';
import {assertProgram} from '../coach/policy.js';
import {CoachError} from '../coach/schemas.js';

export const dashboardRouter = Router();

dashboardRouter.get('/partners/:id/analytics/current',requireAuth,grantScope('partners:read'),requirePartnerOrAdmin('id'),async(req,res)=>{
  const {db,tenantId}=tenantOf(req),partnerId=req.params.id!;
  try{
    const input=z.object({programId:z.string().min(1),scenarioId:z.string().min(1).max(100).optional(),
      period:z.enum(['today','7d','30d','all','custom']).default('30d'),from:z.string().optional(),to:z.string().optional()}).strict().parse(req.query);
    await assertProgram(db,tenantId,partnerId,input.programId,false);
    const profile=await db('CoachProfile').where({tenantId,partnerId}).first('data');
    const filters=analyticsFiltersFromQuery(input,profile?.data?.timezone??'Europe/Moscow');
    if(filters.since!>=new Date(Math.min(filters.until!.getTime(),Date.now())))throw new z.ZodError([{code:'custom',path:['from'],message:'Выберите прошедший или текущий период.'}]);
    res.json(await calculatorCurrentValues(db,tenantId,partnerId,filters));
  }catch(error){
    if(error instanceof z.ZodError)return res.status(400).json({error:'invalid_query',detail:'Проверьте даты фактических значений.'});
    if(error instanceof CoachError)return res.status(error.status).json({error:error.code,detail:error.message});
    throw error;
  }
});

// Compatibility endpoints below use the same metric definitions as Results.

// Partner dashboard — top-line counts, attributed revenue, commission by status.
// Read-optimized via denormalized partnerId on Click/Attribution/Commission.
//
// Optional `?includeLinks=true` adds a per-Link breakdown so the partner /
// creator portal can show channel-level performance ("newsletter converted
// at 8%, TikTok bio at 0.3% — focus on the newsletter").
dashboardRouter.get('/partners/:id/analytics', requireAuth, grantScope('partners:read'), requirePartnerOrAdmin('id'), async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  try {
    const profile = await db('CoachProfile').where({ tenantId, partnerId: req.params.id! }).first();
    const filters = analyticsFiltersFromQuery(req.query, profile?.data?.timezone ?? 'Europe/Moscow');
    res.json(await partnerAnalytics(db, tenantId, req.params.id!, filters));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'invalid_query', detail: error.flatten() });
    throw error;
  }
});

dashboardRouter.get('/partners/:id/analytics/details', requireAuth, grantScope('partners:read'), requirePartnerOrAdmin('id'), async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  try {
    const profile = await db('CoachProfile').where({ tenantId, partnerId: req.params.id! }).first();
    const filters = analyticsFiltersFromQuery(req.query, profile?.data?.timezone ?? 'Europe/Moscow');
    const { cursor } = analyticsDetailsQuerySchema.parse(req.query);
    res.json(await partnerAnalyticsDetails(db, tenantId, req.params.id!, filters, cursor));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'invalid_query', detail: error.flatten() });
    throw error;
  }
});

dashboardRouter.get('/partners/:id/dashboard', requireAuth, grantScope('partners:read'), requirePartnerOrAdmin('id'), async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  try {
    const profile = await db('CoachProfile').where({ tenantId, partnerId: req.params.id! }).first();
    const filters = analyticsFiltersFromQuery(req.query, profile?.data?.timezone ?? 'Europe/Moscow');
    const report = await partnerAnalytics(db, tenantId, req.params.id!, { ...filters, groupBy: 'link' });
    res.json({ partnerId: req.params.id, since: report.period.since.toISOString(), until: report.period.until.toISOString(), currency: report.currency,
      clicks: report.counts.clicks, identities: report.counts.identities, attributedEvents: report.counts.attributedEvents, generatedAt: report.generatedAt,
      registrations: report.counts.registrations, payingClients: report.counts.payingCustomers,
      conversionRate: report.conversions.clickToPayment ?? 0, attributedRevenue: report.amountsMinor.observedPayments/100, periodEarnings: report.amountsMinor.netAccrued/100,
      commissionByStatus: report.commissionByStatus, balances: report.balances,
      conversions: report.conversions, metricBasis: report.metricBasis, balanceBasis: report.balanceBasis, commissionByStatusBasis: report.commissionByStatusBasis,
      dataQuality: report.dataQuality, warnings: report.warnings, views: report.views, ctr: report.ctr,
      ...((req.query.includeLinks === 'true' || req.query.includeLinks === '1') ? { links: report.rows.map(row => ({ linkKey: row.linkKey ?? row.id, clicks: row.counts.clicks, attributedEvents: row.counts.attributedEvents, attributedRevenue: row.amountsMinor.observedPayments/100 })) } : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'invalid_query', detail: error.flatten() });
    throw error;
  }
});

// ---------- Time-series for charting ----------
//
// Daily (or weekly, when the range exceeds ~90 days) buckets of:
//   clicks   — Click rows for this partner
//   leads    — Events of type signup / trial_started
//   sales    — Events with non-null value > 0 (subscription_created,
//              invoice_paid, custom paid events)
//   revenue  — Σ(Event.value × Attribution.weight) for sales events
//   earnings — Σ(Commission.amount) accrued in the bucket
//
// All filterable by programId so the per-partnership detail page on the
// creator portal scopes the chart correctly. The Network forwards the
// programId from Partnership.offering.vendorProgramId.

const timeseriesQuerySchema = z.object({
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  programId: z.string().min(1).optional(),
  bucket: z.enum(['day', 'week']).optional(),
});

dashboardRouter.get(
  '/partners/:id/timeseries',
  requireAuth,
  grantScope('partners:read'),
  requirePartnerOrAdmin('id'),
  async (req, res) => {
    const { db } = tenantOf(req);
    const partnerId = req.params.id;
    const q = timeseriesQuerySchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'invalid_query', detail: q.error.flatten() });

    const since = q.data.since ? new Date(q.data.since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const until = q.data.until ? new Date(q.data.until) : new Date();
    try {
      const profile=await db('CoachProfile').where({partnerId,tenantId:tenantOf(req).tenantId}).first();
      const bucket=q.data.bucket??((until.getTime()-since.getTime())/86400000>90?'week':'day');
      const filters=analyticsFiltersFromQuery({...q.data,since:since.toISOString(),until:until.toISOString(),bucket,includeSeries:'true',currency:req.query.currency??'RUB'},profile?.data?.timezone??'Europe/Moscow');
      const report=await partnerAnalyticsOverview(db,tenantOf(req).tenantId,partnerId,filters,false);
      res.json({partnerId,since:report.period.since.toISOString(),until:report.period.until.toISOString(),bucket:report.series!.bucket,
        buckets:report.series!.points.map(p=>({bucket:p.date+'T00:00:00.000Z',clicks:p.clicks,leads:p.registrations,sales:p.payments,revenue:p.customerPaymentsMinor/100,earnings:p.earningsMinor/100}))});
    } catch(error) { if(error instanceof z.ZodError)return res.status(400).json({error:'invalid_query'});throw error; }
  },
);

// ---------- Raw event stream (paginated) ----------
//
// Powers the creator portal's Events tab: every attributed Event for
// this partner, newest first. Includes Click context (linkKey, referer)
// and Attribution weight so the partner can see why they were credited.

const eventsQuerySchema = z.object({
  programId: z.string().min(1).optional(),
  type: z.string().min(1).max(80).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

dashboardRouter.get(
  '/partners/:id/events',
  requireAuth,
  grantScope('partners:read'),
  requirePartnerOrAdmin('id'),
  async (req, res) => {
    const { db } = tenantOf(req);
    const partnerId = req.params.id;
    const q = eventsQuerySchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'invalid_query', detail: q.error.flatten() });

    const limit = q.data.limit ?? 50;
    const offset = q.data.offset ?? 0;

    const rows = (await db(`${TABLES.Attribution} as a`)
      .join(`${TABLES.Event} as e`, 'e.id', 'a.eventId')
      .leftJoin(`${TABLES.Click} as cl`, 'cl.id', 'a.clickId')
      .leftJoin(`${TABLES.Link} as l`, 'l.id', 'cl.linkId')
      .where('a.partnerId', partnerId)
      .modify((qb) => {
        if (q.data.programId) qb.andWhere('a.programId', q.data.programId);
        if (q.data.type) qb.andWhere('e.type', q.data.type);
        if (q.data.since) qb.andWhere('e.ts', '>=', new Date(q.data.since));
        if (q.data.until) qb.andWhere('e.ts', '<=', new Date(q.data.until));
      })
      .orderBy('e.ts', 'desc')
      .limit(limit)
      .offset(offset)
      .select(
        'a.id as attributionId',
        'a.weight as attributionWeight',
        'a.model as attributionModel',
        'e.id as eventId',
        'e.type as eventType',
        'e.value as eventValue',
        'e.currency as eventCurrency',
        'e.ts as eventTs',
        'e.userId as userId',
        'cl.id as clickId',
        'cl.referer as clickReferer',
        'cl.landingUrl as clickLandingUrl',
        'cl.ts as clickTs',
        'l.linkKey as linkKey',
      )) as Array<{
        attributionId: string;
        attributionWeight: string;
        attributionModel: string;
        eventId: string;
        eventType: string;
        eventValue: string | null;
        eventCurrency: string | null;
        eventTs: Date;
        userId: string;
        clickId: string | null;
        clickReferer: string | null;
        clickLandingUrl: string | null;
        clickTs: Date | null;
        linkKey: string | null;
      }>;

    res.json({
      partnerId,
      events: rows.map((r) => ({
        attributionId: r.attributionId,
        weight: Number(r.attributionWeight),
        model: r.attributionModel,
        eventId: r.eventId,
        type: r.eventType,
        value: r.eventValue != null ? Number(r.eventValue) : null,
        currency: r.eventCurrency,
        ts: r.eventTs.toISOString(),
        userId: r.userId,
        click: r.clickId
          ? {
              id: r.clickId,
              linkKey: r.linkKey,
              referer: r.clickReferer,
              landingUrl: r.clickLandingUrl,
              ts: r.clickTs?.toISOString() ?? null,
            }
          : null,
      })),
      limit,
      offset,
    });
  },
);

// ---------- Customers (distinct attributed userIds) ----------
//
// Each row = one customer (userId) attributed to this partner, with
// first-touch click + lifetime attributed revenue. Useful for the
// Customers tab where a creator wants to see who they brought in.

const customersQuerySchema = z.object({
  programId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

dashboardRouter.get(
  '/partners/:id/customers',
  requireAuth,
  grantScope('partners:read'),
  requirePartnerOrAdmin('id'),
  async (req, res) => {
    const { db } = tenantOf(req);
    const partnerId = req.params.id;
    const q = customersQuerySchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'invalid_query', detail: q.error.flatten() });

    const limit = q.data.limit ?? 50;
    const offset = q.data.offset ?? 0;

    // Rolled-up per-customer view via knex query builder so the bindings
    // stay typed. Each row = one userId attributed to this partner with
    // first-event / last-event timestamps + lifetime attributed revenue
    // + event count, ordered by revenue desc.
    const rows = (await db(`${TABLES.Attribution} as a`)
      .join(`${TABLES.Event} as e`, 'e.id', 'a.eventId')
      .where('a.partnerId', partnerId)
      .modify((qb) => {
        if (q.data.programId) qb.andWhere('a.programId', q.data.programId);
      })
      .groupBy('e.userId')
      .select('e.userId as userId')
      .select(
        db.raw(`MIN("e"."ts") as "firstEventAt"`),
        db.raw(`MAX("e"."ts") as "lastEventAt"`),
        db.raw(`COUNT(DISTINCT "e"."id") as "eventCount"`),
        db.raw(`COALESCE(SUM("e".value * "a".weight), 0) as "revenue"`),
      )
      .orderByRaw(`COALESCE(SUM("e".value * "a".weight), 0) desc, MAX("e"."ts") desc`)
      .limit(limit)
      .offset(offset)) as Array<{
        userId: string;
        firstEventAt: Date;
        lastEventAt: Date;
        eventCount: string;
        revenue: string;
      }>;

    res.json({
      partnerId,
      customers: rows.map((r) => ({
        userId: r.userId,
        firstEventAt: r.firstEventAt.toISOString(),
        lastEventAt: r.lastEventAt.toISOString(),
        eventCount: Number(r.eventCount),
        revenue: Number(r.revenue),
      })),
      limit,
      offset,
    });
  },
);

// ---------- Click breakdowns (referrer / UTM / country / device) ----------
//
// Single endpoint, dimension picked via ?dimension=<name>. Returns the
// top-N values for that dimension within the partner's clicks in the
// requested window, with a click count per value.
//
// SQL dimensions (referer, utm*, country) aggregate in Postgres — fast
// even on large click volumes since the partnerId-scoped subset is
// tiny. UA dimensions (device, browser, os) parse-on-read in JS over a
// pulled raw-userAgent column; capped at the most recent N clicks
// (DEFAULT_UA_SAMPLE_LIMIT) so we don't pull a million UAs into memory
// for a top-10 chart.

const SQL_DIMENSIONS = ['referer', 'utm_source', 'utm_medium', 'utm_campaign', 'country'] as const;
const UA_DIMENSIONS = ['device', 'browser', 'os'] as const;
type SqlDimension = (typeof SQL_DIMENSIONS)[number];
type UaDimension = (typeof UA_DIMENSIONS)[number];
type AnyDimension = SqlDimension | UaDimension;

const DIMENSION_COLUMN: Record<SqlDimension, string> = {
  referer: 'referer',
  utm_source: 'utmSource',
  utm_medium: 'utmMedium',
  utm_campaign: 'utmCampaign',
  country: 'country',
};

const DEFAULT_UA_SAMPLE_LIMIT = 5000;

const breakdownQuerySchema = z.object({
  dimension: z.enum([...SQL_DIMENSIONS, ...UA_DIMENSIONS] as [AnyDimension, ...AnyDimension[]]),
  programId: z.string().min(1).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

dashboardRouter.get(
  '/partners/:id/breakdowns',
  requireAuth,
  grantScope('partners:read'),
  requirePartnerOrAdmin('id'),
  async (req, res) => {
    const { db } = tenantOf(req);
    const partnerId = req.params.id;
    const q = breakdownQuerySchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'invalid_query', detail: q.error.flatten() });

    const since = q.data.since ? new Date(q.data.since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const until = q.data.until ? new Date(q.data.until) : new Date();
    const limit = q.data.limit ?? 10;
    const dimension = q.data.dimension;

    const baseQuery = db<ClickRow>(TABLES.Click)
      .where({ partnerId })
      .modify((qb) => {
        if (q.data.programId) qb.andWhere({ programId: q.data.programId });
      })
      .andWhere('ts', '>=', since)
      .andWhere('ts', '<=', until);

    if ((SQL_DIMENSIONS as readonly string[]).includes(dimension)) {
      const col = DIMENSION_COLUMN[dimension as SqlDimension];
      const rows = (await baseQuery
        .clone()
        .whereNotNull(col)
        .groupBy(col)
        .select(`${col} as value`)
        .count<{ value: string; count: string }[]>({ count: '*' })
        .orderBy('count', 'desc')
        .limit(limit)) as Array<{ value: string; count: string }>;
      return res.json({
        dimension,
        rows: rows.map((r) => ({ value: r.value, count: Number(r.count) })),
      });
    }

    // UA dimensions: pull recent userAgents (capped) and bucket in JS.
    // We sort by ts desc so a creator's recent traffic shape dominates
    // the chart — same intent as the SQL dimensions which aren't
    // sample-capped (they're cheap GROUP BYs).
    const uaRows = (await baseQuery
      .clone()
      .whereNotNull('userAgent')
      .orderBy('ts', 'desc')
      .limit(DEFAULT_UA_SAMPLE_LIMIT)
      .select('userAgent as ua')) as Array<{ ua: string }>;

    const counts = new Map<string, number>();
    for (const { ua } of uaRows) {
      const parsed = parseUserAgent(ua);
      const key = parsed[dimension as UaDimension];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }));
    return res.json({
      dimension,
      rows: sorted,
      sampleSize: uaRows.length,
      sampleCapped: uaRows.length === DEFAULT_UA_SAMPLE_LIMIT,
    });
  },
);
