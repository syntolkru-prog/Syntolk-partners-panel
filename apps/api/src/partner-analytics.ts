import type { Knex } from 'knex';
import { z } from 'zod';
import type { LinkRow, PartnerLinkSourceRow, PartnerMaterialRow } from '@openpartner/db';
import { trackingSourceParams } from '@openpartner/db';
import { adjustmentTotalsByCommission, netCommissionAmount } from './commission-net.js';
import { todayWindow } from './coach/daily-plan.js';
import { parseUserAgent } from './ua-parse.js';

const selectionSchema = z.union([z.string().min(1).max(100), z.array(z.string().min(1).max(100)).min(1).max(50)])
  .transform(value => [...new Set(Array.isArray(value) ? value : [value])]);
export const analyticsQuerySchema = z.object({
  programId: z.string().min(1).optional(), scenarioId: z.string().min(1).max(100).optional(),
  platformId: z.string().min(1).max(100).optional(), formatId: z.string().min(1).max(100).optional(),
  scenarioIds: selectionSchema.optional(), platformIds: selectionSchema.optional(), formatIds: selectionSchema.optional(),
  seriesBy: z.enum(['platform', 'format', 'scenario']).optional(),
  materialId: z.string().min(1).max(32).optional(), linkId: z.string().min(1).max(32).optional(), sourceId: z.string().min(1).max(32).optional(),
  since: z.string().datetime().optional(), until: z.string().datetime().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  groupBy: z.enum(['scenario', 'platform', 'format', 'material', 'source', 'link']).optional(),
  includeEmpty: z.enum(['true', 'false']).optional(), includeSeries: z.enum(['true', 'false']).optional(),
  includeComparison: z.enum(['true', 'false']).optional(), includeFunnel: z.enum(['true', 'false']).optional(),
  period: z.enum(['today', '7d', '30d', 'all', 'custom']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type AnalyticsFilters = Omit<z.infer<typeof analyticsQuerySchema>, 'since' | 'until'> & { since?: Date; until?: Date; timezone?: string };
export type AnalyticsGroup = NonNullable<AnalyticsFilters['groupBy']>;
type TimeBucket = 'day' | 'week' | 'month';
type SeriesDimension = NonNullable<AnalyticsFilters['seriesBy']>;
type TimeGroup = TimeBucket | { bucket: TimeBucket; dimension: SeriesDimension };
type Group = AnalyticsGroup | TimeGroup;
type Scope = { db: Knex; tenantId: string; partnerId: string; filters: AnalyticsFilters; since: Date; until: Date };
const GROUPS: Record<AnalyticsGroup, string> = { scenario: 'src.scenarioId', platform: 'src.platformId', format: 'src.formatId', material: 'src.materialId', source: 'src.id', link: 'cl.linkId' };
const isTimeBucket = (group?: Group): group is TimeGroup => typeof group === 'object' || group === 'day' || group === 'week' || group === 'month';
const groupExpression = (group: AnalyticsGroup) => group === 'link' ? `COALESCE(??, src."linkId", '__none__')` : `COALESCE(??, '__none__')`;
const selectedIds = (filters: AnalyticsFilters, field: 'scenarioId' | 'platformId' | 'formatId' | 'materialId') => {
  const multiple = field === 'materialId' ? [] : filters[`${field}s`] ?? [];
  return [...new Set([...(filters[field] ? [filters[field]!] : []), ...multiple])];
};
const matchesSelection = (value: string | null, selected: string[]) => !selected.length || selected.includes(value ?? '__none__');

function dayStart(day: string, timezone: string) {
  if (!Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10) !== day) throw new z.ZodError([{ code: 'custom', path: ['from'], message: 'Некорректная дата.' }]);
  // Find an instant on this local date, then use the shared midnight calculation.
  for (let h = -24; h <= 24; h += 6) {
    const instant = new Date(Date.parse(`${day}T12:00:00Z`)+h*3600000);
    const window = todayWindow(timezone, instant);
    if (window.day === day) return window.since;
  }
  throw new z.ZodError([{ code: 'custom', path: ['from'], message: 'Некорректная дата.' }]);
}

export function analyticsFiltersFromQuery(query: unknown, timezone = 'Europe/Moscow'): AnalyticsFilters {
  const input = analyticsQuerySchema.parse(query), now = new Date();
  let since = input.since ? new Date(input.since) : new Date(now.getTime()-30*86400000);
  let until = input.until ? new Date(input.until) : now;
  if (!input.since) {
    if (input.period === 'today') since = todayWindow(timezone, now).since;
    if (input.period === '7d' || input.period === '30d') {
      const day = todayWindow(timezone, now).day;
      since = dayStart(new Date(Date.parse(day)-(input.period === '7d' ? 6 : 29)*86400000).toISOString().slice(0,10), timezone);
    }
    if (input.period === 'all') since = new Date('2000-01-01T00:00:00Z');
    if (input.period === 'custom') {
      if (!input.from || !input.to) throw new z.ZodError([{ code: 'custom', path: ['from'], message: 'Выберите начало и конец периода.' }]);
      since = dayStart(input.from, timezone);
      dayStart(input.to, timezone);
      until = dayStart(new Date(Date.parse(input.to)+86400000).toISOString().slice(0,10), timezone);
    }
  }
  if (since >= until) throw new z.ZodError([{ code: 'custom', path: ['since'], message: 'Начало периода должно быть раньше конца.' }]);
  return { ...input, since, until, timezone };
}

function scopeClicks(query: Knex.QueryBuilder, s: Scope) {
  query.where({ 'cl.tenantId': s.tenantId, 'cl.partnerId': s.partnerId }).whereNull('cl.fraudFlag');
  query.whereNotIn('cl.id', s.db('Identity as i').join('Event as sim', 'sim.userId', 'i.userId')
    .where({ 'i.tenantId': s.tenantId, 'sim.tenantId': s.tenantId }).whereRaw("sim.metadata->>'source' = 'local_simulator'").select('i.clickId'));
  if (s.filters.programId) query.where('cl.programId', s.filters.programId);
  for (const field of ['scenarioId', 'platformId', 'formatId', 'materialId'] as const) {
    const values = selectedIds(s.filters, field);
    if (values.length) query.where(function () {
      this.whereIn(`src.${field}`, values.filter(value => value !== '__none__'));
      if (values.includes('__none__')) this.orWhereNull(`src.${field}`);
    });
  }
  if (s.filters.linkId === '__none__') query.whereRaw('COALESCE(cl."linkId", src."linkId") IS NULL');
  else if (s.filters.linkId) query.whereRaw('COALESCE(cl."linkId", src."linkId") = ?', [s.filters.linkId]);
  if (s.filters.sourceId === '__none__') query.whereNull('src.id');
  else if (s.filters.sourceId) query.where('src.id', s.filters.sourceId);
  return query;
}
function clicks(s: Scope) {
  return scopeClicks(s.db('Click as cl').leftJoin('PartnerLinkSource as src', function () {
    this.on('src.id', '=', 'cl.trackingSourceId').andOn('src.tenantId', '=', 'cl.tenantId').andOn('src.partnerId', '=', 'cl.partnerId');
  }), s);
}
function attributions(s: Scope) {
  return clicks(s).join('Attribution as a', 'a.clickId', 'cl.id').join('Event as e', 'e.id', 'a.eventId')
    .join('Program as p', 'p.id', 'a.programId')
    .where({ 'a.tenantId': s.tenantId, 'a.partnerId': s.partnerId, 'e.tenantId': s.tenantId, 'p.tenantId': s.tenantId })
    .whereRaw('a.model = p."attributionModel"').where('a.weight', '>', 0)
    .whereRaw("COALESCE(e.metadata->>'source', '') <> 'local_simulator'");
}
function grouped(query: Knex.QueryBuilder, s: Scope, group?: Group, timestamp = 'cl.ts') {
  if (!group) return query.select(s.db.raw("'total' AS id"));
  if (isTimeBucket(group)) {
    const expression = "to_char(date_trunc(?, ?? AT TIME ZONE ?), 'YYYY-MM-DD')";
    const values = [typeof group === 'object' ? group.bucket : group, timestamp, s.filters.timezone ?? 'Europe/Moscow'];
    query.select(s.db.raw(`${expression} AS id`, values));
    if (typeof group === 'object') return query.select(s.db.raw(`${groupExpression(group.dimension)} AS "seriesId"`, [GROUPS[group.dimension]])).groupByRaw('1, 2');
    return query.groupByRaw('1');
  }
  return query.select(s.db.raw(`${groupExpression(group)} AS id`, [GROUPS[group]]))
    .groupByRaw(groupExpression(group), [GROUPS[group]]);
}
function paidExpression(s: Scope, alias = 'e') {
  return `${alias}.type IN ('invoice_paid','recurring_payment') AND ${alias}.value > 0${s.filters.currency ? ` AND ${alias}.currency = :currency` : ''}`;
}
const bindings = (s: Scope) => s.filters.currency ? { currency: s.filters.currency } : {};
const recurringExpression = `(e.type = 'recurring_payment' OR EXISTS (SELECT 1 FROM "Event" prev WHERE prev."tenantId" = e."tenantId" AND prev."userId" = e."userId" AND prev.type IN ('invoice_paid','recurring_payment') AND prev.value > 0 AND prev.currency = e.currency AND (prev.ts < e.ts OR (prev.ts = e.ts AND prev.id < e.id))))`;

async function aggregates(s: Scope, group?: Group) {
  const timed = isTimeBucket(group);
  const periodClicks = clicks(s).where('cl.ts', '>=', s.since).where('cl.ts', '<', s.until);
  const events = attributions(s).where('e.ts', '>=', s.since).where('e.ts', '<', s.until);
  // One registration per person in the selected scope, also when chart buckets are added up.
  if (timed) {
    const firstSignups = events.clone().where('e.type', 'signup');
    if (typeof group === 'object') {
      firstSignups.select(s.db.raw(`DISTINCT ON (${groupExpression(group.dimension)}, e."userId") e.id, ${groupExpression(group.dimension)} AS "signupGroup"`, [GROUPS[group.dimension], GROUPS[group.dimension]])).orderByRaw(groupExpression(group.dimension), [GROUPS[group.dimension]]);
    } else firstSignups.distinctOn('e.userId').select('e.id');
    firstSignups.orderBy('e.userId').orderBy('e.ts').orderBy('e.id').as('first_signup');
    events.leftJoin(firstSignups, function () {
      this.on('first_signup.id', '=', 'e.id');
      if (typeof group === 'object') this.andOn(s.db.raw(`${groupExpression(group.dimension)} = first_signup."signupGroup"`, [GROUPS[group.dimension]]));
    });
  }
  const paid = paidExpression(s);
  const recurring = recurringExpression;
  const eventQuery = grouped(events, s, group, 'e.ts').select(s.db.raw(`
    COUNT(DISTINCT e.id)::int AS "attributedEvents",
    COUNT(DISTINCT CASE WHEN e.type='signup' ${timed ? 'AND first_signup.id IS NOT NULL' : ''} THEN e."userId" END)::int AS registrations,
    COUNT(DISTINCT CASE WHEN ${paid} THEN e.id END)::int AS "paymentCount",
    COUNT(DISTINCT CASE WHEN ${paid} THEN e."userId" END)::int AS "payingCustomers",
    COUNT(DISTINCT CASE WHEN ${paid} AND NOT ${recurring} THEN e.id END)::int AS "firstPaymentCount",
    COUNT(DISTINCT CASE WHEN ${paid} AND ${recurring} THEN e.id END)::int AS "repeatPaymentCount",
    COALESCE(SUM(CASE WHEN ${paid} THEN e.value*a.weight ELSE 0 END),0)::text AS revenue`, bindings(s)));
  const refunds = attributions(s).join('Event as refund', function () { this.on(s.db.raw("refund.metadata->>'originalEventId' = e.id")); })
    .where({ 'refund.tenantId': s.tenantId, 'refund.type': 'refund' }).where('refund.ts', '>=', s.since).where('refund.ts', '<', s.until)
    .modify(q => { if (s.filters.currency) q.where('refund.currency', s.filters.currency); });
  const adjustments = s.db('CommissionAdjustment').where({ tenantId: s.tenantId }).groupBy('commissionId').select('commissionId').sum({ adjustment: 'amount' }).as('ca');
  const earnings = clicks(s).join('Attribution as a', 'a.clickId', 'cl.id').join('Commission as c', 'c.attributionId', 'a.id')
    .leftJoin(adjustments, 'ca.commissionId', 'c.id')
    .where({ 'a.tenantId': s.tenantId, 'a.partnerId': s.partnerId, 'c.tenantId': s.tenantId, 'c.partnerId': s.partnerId })
    .where('c.accruedAt', '>=', s.since).where('c.accruedAt', '<', s.until)
    .modify(q => { if (s.filters.currency) q.where('c.currency', s.filters.currency); });
  // Conversion rates follow clicks in this period, including their later conversions.
  // Activity totals above follow event dates; this prevents unrelated daily counts becoming a rate.
  const cohort = attributions(s).whereIn('cl.id', periodClicks.clone().select('cl.id')).where('e.ts', '<=', new Date());
  const signups = cohort.clone().where('e.type', 'signup').distinct('e.userId')
    .modify(q => { if (group && !isTimeBucket(group)) q.select(s.db.raw(`${groupExpression(group)} AS gid`, [GROUPS[group]])); }).as('registered');
  const paidSignups = cohort.clone().join(signups, function () {
    this.on('registered.userId', '=', 'e.userId');
    if (group && !isTimeBucket(group)) this.andOn(s.db.raw(`${groupExpression(group)} = ??`, [GROUPS[group], 'registered.gid']));
  }).whereRaw(paid, bindings(s));
  const [clickRows, eventRows, refundRows, earningRows, cohortRows, paidSignupRows, identityRows] = await Promise.all([
    grouped(periodClicks.clone(), s, group).count({ clicks: '*' }), eventQuery,
    grouped(refunds, s, group, 'refund.ts').select(s.db.raw('COALESCE(SUM(-refund.value*a.weight),0)::text AS refunds')),
    grouped(earnings, s, group, 'c.accruedAt').select(s.db.raw(`COALESCE(SUM(CASE WHEN c.status != 'reversed' THEN GREATEST(0,c.amount+COALESCE(ca.adjustment,0)) ELSE 0 END),0)::text AS earnings`)),
    timed ? [] : grouped(cohort.clone(), s, group).select(s.db.raw(`COUNT(DISTINCT CASE WHEN e.type='signup' THEN e."userId" END)::int AS "cohortRegistrations", COUNT(DISTINCT CASE WHEN ${paid} THEN e."userId" END)::int AS "cohortPayingCustomers"`, bindings(s))),
    timed ? [] : grouped(paidSignups, s, group).countDistinct({ cohortPaidRegistrations: 'e.userId' }),
    timed ? [] : grouped(periodClicks.clone().join('Identity as i', 'i.clickId', 'cl.id').where('i.tenantId', s.tenantId), s, group).countDistinct({ identities: 'i.userId' }),
  ]);
  const rows = new Map<string, Record<string, string|number|undefined>>();
  for (const collection of [clickRows, eventRows, refundRows, earningRows, cohortRows, paidSignupRows, identityRows]) {
    for (const row of collection) {
      const key = JSON.stringify([row.seriesId ?? null, row.id]);
      rows.set(key, { ...rows.get(key), ...row });
    }
  }
  return [...rows.values()].map(row => {
    const counts = { clicks: Number(row.clicks ?? 0), identities: Number(row.identities ?? 0), attributedEvents: Number(row.attributedEvents ?? 0), registrations: Number(row.registrations ?? 0), paymentCount: Number(row.paymentCount ?? 0), payingCustomers: Number(row.payingCustomers ?? 0), firstPaymentCount: Number(row.firstPaymentCount ?? 0), repeatPaymentCount: Number(row.repeatPaymentCount ?? 0) };
    const rate = (n: number, d: number) => d > 0 ? n / d : null;
    return { id: row.id as string, ...(row.seriesId ? { seriesId: String(row.seriesId) } : {}), counts,
      amountsMinor: { observedPayments: Math.round(Number(row.revenue ?? 0)*100), refunds: Math.round(Number(row.refunds ?? 0)*100), netPayments: Math.round((Number(row.revenue ?? 0)-Number(row.refunds ?? 0))*100), netAccrued: Math.round(Number(row.earnings ?? 0)*100) },
      conversions: { clickToRegistration: rate(Number(row.cohortRegistrations ?? 0), counts.clicks), registrationToPayment: rate(Number(row.cohortPaidRegistrations ?? 0), Number(row.cohortRegistrations ?? 0)), clickToPayment: rate(Number(row.cohortPayingCustomers ?? 0), counts.clicks), cohortRegistrations: Number(row.cohortRegistrations ?? 0), cohortPayingCustomers: Number(row.cohortPayingCustomers ?? 0) },
    };
  });
}

async function globalBalances(s: Scope) {
  const rows = await s.db('Commission as c').leftJoin('Payout as p', 'p.id', 'c.payoutId')
    .where({ 'c.tenantId': s.tenantId, 'c.partnerId': s.partnerId })
    .modify(q => { if (s.filters.currency) q.where('c.currency', s.filters.currency); })
    .select('c.id', 'c.amount', 'c.status', 'c.payoutId', 'c.accruedAt', 'p.status as payoutStatus') as Array<{id:string;amount:string;status:string;payoutId:string|null;accruedAt:Date;payoutStatus:string|null}>;
  const adjustments = await adjustmentTotalsByCommission(s.db, rows.map(row => row.id));
  const balances = { accrued: 0, available: 0, pending: 0, paid: 0, total: 0 };
  const commissionByStatus: Record<string, number> = {};
  for (const row of rows) {
    const status = row.payoutId && row.status !== 'reversed' && row.payoutStatus !== 'paid' ? 'pending' : row.status;
    const amount = netCommissionAmount(row, adjustments, row.id);
    if (new Date(row.accruedAt) >= s.since && new Date(row.accruedAt) < s.until) commissionByStatus[status] = (commissionByStatus[status] ?? 0) + amount;
    if (status === 'reversed') continue;
    if (status === 'accrued') balances.accrued += amount;
    if (status === 'approved') balances.available += amount;
    if (status === 'pending') balances.pending += amount;
    if (status === 'paid') balances.paid += amount;
    balances.total += amount;
  }
  for (const key of Object.keys(balances) as Array<keyof typeof balances>) balances[key] = Math.round(balances[key]*100)/100;
  for (const key of Object.keys(commissionByStatus)) commissionByStatus[key] = Math.round(commissionByStatus[key]!*100)/100;
  return { balances, commissionByStatus };
}

async function timeSeries(s: Scope) {
  const days = (s.until.getTime() - s.since.getTime()) / 86400000;
  const bucket: TimeBucket = days <= 90 ? 'day' : days <= 730 ? 'week' : 'month';
  const [rows, groupedRows] = await Promise.all([
    aggregates(s, bucket),
    s.filters.seriesBy ? aggregates(s, { bucket, dimension: s.filters.seriesBy }) : [],
  ]);
  const byDate = new Map(rows.map(row => [row.id, row]));
  const start = (day: string) => {
    const date = new Date(`${day}T00:00:00Z`);
    if (bucket === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    if (bucket === 'month') date.setUTCDate(1);
    return date;
  };
  const timezone = s.filters.timezone ?? 'Europe/Moscow';
  const first = s.filters.period === 'all' ? [...byDate.keys()].sort()[0] : todayWindow(timezone, s.since).day;
  if (!first) return { bucket, points: [], by: s.filters.seriesBy, groups: s.filters.seriesBy ? [] : undefined };
  const cursor = start(first), last = start(todayWindow(timezone, new Date(s.until.getTime() - 1)).day);
  const points: Array<{date:string;since:string;until:string;clicks:number;registrations:number;payingCustomers:number;payments:number;firstPayments:number;repeatPayments:number;customerPaymentsMinor:number;earningsMinor:number}> = [];
  while (cursor <= last) {
    const date = cursor.toISOString().slice(0, 10), row = byDate.get(date);
    const next = new Date(cursor);
    if (bucket === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
    else next.setUTCDate(next.getUTCDate() + (bucket === 'week' ? 7 : 1));
    points.push({ date, since: new Date(Math.max(s.since.getTime(),dayStart(date,timezone).getTime())).toISOString(),
      until: new Date(Math.min(s.until.getTime(),dayStart(next.toISOString().slice(0,10),timezone).getTime())).toISOString(),
      clicks: row?.counts.clicks ?? 0, registrations: row?.counts.registrations ?? 0,
      payingCustomers: row?.counts.payingCustomers ?? 0,
      payments: row?.counts.paymentCount ?? 0, firstPayments: row?.counts.firstPaymentCount ?? 0,
      repeatPayments: row?.counts.repeatPaymentCount ?? 0, customerPaymentsMinor: row?.amountsMinor.observedPayments ?? 0, earningsMinor: row?.amountsMinor.netAccrued ?? 0 });
    cursor.setTime(next.getTime());
  }
  const groupedPoints = new Map(groupedRows.map(row => [JSON.stringify([row.seriesId, row.id]), row]));
  const groups = [...new Set(groupedRows.map(row => row.seriesId!))].map(id => ({ id, points: points.map(point => {
    const row = groupedPoints.get(JSON.stringify([id, point.date]));
    return { date: point.date, since: point.since, until: point.until, clicks: row?.counts.clicks ?? 0, registrations: row?.counts.registrations ?? 0,
      payingCustomers: row?.counts.payingCustomers ?? 0, payments: row?.counts.paymentCount ?? 0,
      firstPayments: row?.counts.firstPaymentCount ?? 0, repeatPayments: row?.counts.repeatPaymentCount ?? 0,
      customerPaymentsMinor: row?.amountsMinor.observedPayments ?? 0, earningsMinor: row?.amountsMinor.netAccrued ?? 0 };
  }) }));
  return { bucket, points, ...(s.filters.seriesBy ? { by: s.filters.seriesBy, groups } : {}) };
}

async function previousPeriod(s: Scope) {
  const timezone = s.filters.timezone ?? 'Europe/Moscow';
  const firstDay = todayWindow(timezone, s.since).day;
  if(s.since.getTime()!==dayStart(firstDay,timezone).getTime()) {
    const since=new Date(s.since.getTime()-(s.until.getTime()-s.since.getTime())),until=s.since;
    const [total]=await aggregates({...s,since,until});
    return {period:{since,until},counts:total!.counts,amountsMinor:total!.amountsMinor};
  }
  const lastDay = todayWindow(timezone, new Date(s.until.getTime() - 1)).day;
  const days = Math.round((Date.parse(lastDay) - Date.parse(firstDay)) / 86400000) + 1;
  const shift = (day: string) => new Date(Date.parse(day) - days * 86400000).toISOString().slice(0, 10);
  const since = dayStart(shift(firstDay), timezone);
  const endWindow = todayWindow(timezone, s.until);
  const until = new Date(dayStart(shift(endWindow.day), timezone).getTime() + s.until.getTime() - endWindow.since.getTime());
  const [total] = await aggregates({ ...s, since, until });
  return { period: { since, until }, counts: total!.counts, amountsMinor: total!.amountsMinor };
}

async function conversionFunnel(s: Scope) {
  const selectedClicks = clicks(s).where('cl.ts', '>=', s.since).where('cl.ts', '<', s.until).select('cl.id');
  const cohort = attributions(s).whereIn('cl.id', selectedClicks).where('e.ts', '<=', new Date()).whereRaw('e.ts >= cl.ts');
  const registered = cohort.clone().where('e.type', 'signup').select('e.userId').min({ signupAt: 'e.ts' }).groupBy('e.userId');
  const [registration, paying] = await Promise.all([
    s.db.from(registered.clone().as('registered')).count({ count: '*' }).first(),
    cohort.clone().join(registered.clone().as('registered'), 'registered.userId', 'e.userId')
      .whereRaw('e.ts >= registered."signupAt"').whereRaw(paidExpression(s), bindings(s)).whereRaw(`NOT ${recurringExpression}`)
      .countDistinct({ count: 'e.userId' }).first(),
  ]);
  return { registrations: Number(registration?.count ?? 0), firstPayingCustomers: Number(paying?.count ?? 0) };
}

const historyCursor = z.object({ ts: z.string().datetime(), id: z.string().min(1).max(70) });
export const analyticsDetailsQuerySchema = z.object({ cursor: z.string().max(300).optional() });

/** Read-only detail view. Reuses the exact scope, payment taxonomy and exclusions of the report. */
export async function partnerAnalyticsDetails(db: Knex, tenantId: string, partnerId: string, filters: AnalyticsFilters, rawCursor?: string) {
  const since = filters.since ?? new Date(Date.now() - 30 * 86400000), until = filters.until ?? new Date();
  const s: Scope = { db, tenantId, partnerId, filters, since, until };
  let cursor: z.infer<typeof historyCursor> | undefined;
  if (rawCursor) {
    try { cursor = historyCursor.parse(JSON.parse(rawCursor)); }
    catch { throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'Некорректный курсор истории.' }]); }
  }
  const periodClicks = () => clicks(s).where('cl.ts', '>=', since).where('cl.ts', '<', until);
  const clickEvents = periodClicks().select(db.raw(`'c:' || cl.id AS id, 'click'::text AS kind, cl.ts, NULL::numeric AS "amountMinor", NULL::text AS currency`));
  const events = attributions(s).where('e.ts', '>=', since).where('e.ts', '<', until)
    .where(q => q.where('e.type', 'signup').orWhereRaw(paidExpression(s), bindings(s)))
    .select(db.raw(`'e:' || e.id AS id, CASE WHEN e.type='signup' THEN 'signup' WHEN ${recurringExpression} THEN 'repeat_payment' ELSE 'first_payment' END AS kind, e.ts,
      CASE WHEN e.type='signup' THEN NULL ELSE ROUND(SUM(e.value*a.weight)*100) END AS "amountMinor", e.currency`))
    .groupBy('e.id');
  const refunds = attributions(s).join('Event as refund', function () { this.on(db.raw("refund.metadata->>'originalEventId' = e.id")); })
    .where({ 'refund.tenantId': tenantId, 'refund.type': 'refund' }).whereRaw(paidExpression(s), bindings(s))
    .where('refund.ts', '>=', since).where('refund.ts', '<', until)
    .whereRaw("COALESCE(refund.metadata->>'source', '') <> 'local_simulator'")
    .modify(q => { if (filters.currency) q.where('refund.currency', filters.currency); })
    .select(db.raw(`'r:' || refund.id AS id, 'refund'::text AS kind, refund.ts, ROUND(SUM(refund.value*a.weight)*100) AS "amountMinor", refund.currency`)).groupBy('refund.id');
  const history = db.from(db.unionAll([clickEvents, events, refunds], true).as('history')).select('*')
    .modify(q => { if (cursor) q.whereRaw('(ts, id) < (?::timestamptz, ?)', [cursor.ts, cursor.id]); })
    .orderBy('ts', 'desc').orderBy('id', 'desc').limit(21);
  const [actions, referrerRows, uaRows] = await Promise.all([
    history as PromiseLike<Array<{ id: string; kind: string; ts: Date; amountMinor: string | null; currency:string|null }>>,
    periodClicks().select('cl.referer').count({ count: '*' }).groupBy('cl.referer'),
    periodClicks().select('cl.userAgent').count({ count: '*' }).groupBy('cl.userAgent'),
  ]);
  const referrers = new Map<string, number>(), devices = new Map<string, number>();
  for (const row of referrerRows) {
    let name = 'Источник не передан';
    if (row.referer) { try { name = new URL(String(row.referer)).hostname || name; } catch { /* No inferred source for invalid referrers. */ } }
    referrers.set(name, (referrers.get(name) ?? 0) + Number(row.count));
  }
  const deviceLabels = { desktop: 'Компьютер', mobile: 'Телефон', tablet: 'Планшет', bot: 'Сервисные / боты', other: 'Не определено' };
  for (const row of uaRows) {
    const parsed = parseUserAgent(row.userAgent as string | null);
    const device = parsed.browser === 'unknown' && parsed.os === 'unknown' ? 'other' : parsed.device;
    const name = deviceLabels[device];
    devices.set(name, (devices.get(name) ?? 0) + Number(row.count));
  }
  const top = (map: Map<string, number>) => {
    const rows = [...map].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return rows.length <= 8 ? rows : [...rows.slice(0, 8), { name: 'Остальные', count: rows.slice(8).reduce((sum, row) => sum + row.count, 0) }];
  };
  const items = actions.slice(0, 20).map(row => ({ ...row, ts: new Date(row.ts).toISOString(), amountMinor: row.amountMinor === null ? null : Number(row.amountMinor) }));
  const last = items.at(-1);
  return { traffic: { referrers: top(referrers), devices: top(devices) }, history: { items,
    nextCursor: actions.length > 20 && last ? JSON.stringify({ ts: last.ts, id: last.id }) : null } };
}

export async function partnerAnalytics(db: Knex, tenantId: string, partnerId: string, filters: AnalyticsFilters = {}) {
  const since = filters.since ?? new Date(Date.now()-30*86400000), until = filters.until ?? new Date();
  if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since >= until) throw new Error('invalid_analytics_period');
  const s: Scope = { db, tenantId, partnerId, filters, since, until };
  const scenarioSelection = selectedIds(filters, 'scenarioId'), platformSelection = selectedIds(filters, 'platformId'), formatSelection = selectedIds(filters, 'formatId');
  const group = filters.groupBy ?? (scenarioSelection.length === 1 && scenarioSelection[0] !== '__none__' ? 'platform' : 'scenario');
  const [totals, rows, ledger, sourceRows, snapshotRows, linkRows, materialRows, series, comparison, funnel] = await Promise.all([
    aggregates(s), aggregates(s, group), globalBalances(s),
    db('PartnerLinkSource').where({ tenantId, partnerId }).modify(q => { if (filters.programId) q.where({ programId: filters.programId }); }),
    db('CoachForecastSnapshot').where({ tenantId, partnerId }).whereIn('status', ['confirmed', 'archived']).modify(q => { if (filters.programId) q.where({ programId: filters.programId }); }).orderBy('createdAt', 'desc').select('id', 'status', 'data'),
    db('Link').where({ tenantId, partnerId }).modify(q => { if (filters.programId) q.where({ programId: filters.programId }); }).select('id', 'linkKey', 'label', 'channel', 'createdAt'),
    db<PartnerMaterialRow>('PartnerMaterial').where({tenantId,partnerId}).modify(q=>{if(filters.programId)q.where({programId:filters.programId});}),
    filters.includeSeries === 'true' ? timeSeries(s) : undefined,
    filters.includeComparison === 'true' && filters.period !== 'all' ? previousPeriod(s) : undefined,
    filters.includeFunnel === 'true' ? conversionFunnel(s) : undefined,
  ]);
  const sources = sourceRows as PartnerLinkSourceRow[];
  const snapshots = snapshotRows as Array<{id:string;status:string;data:{scenarioId?:string;scenarioName?:string;formats?:Array<{id:string;name:string}>;channels?:Array<{id:string;name:string}>;settings?:{frequency?:Record<string,number>;channels?:Record<string,{enabled:boolean;formats:string[]}>}}}>;
  const links = linkRows as LinkRow[];
  const materials=materialRows as PartnerMaterialRow[];
  const scenarios = new Map<string, { id: string; name: string; archived: boolean }>();
  for (const snapshot of snapshots) {
    const id = String(snapshot.data.scenarioId ?? snapshot.id);
    if (!scenarios.has(id)) scenarios.set(id, { id, name: snapshot.data.scenarioName || 'Сценарий', archived: snapshot.status === 'archived' });
  }
  const scopedSources = sources.filter(source => matchesSelection(source.scenarioId,scenarioSelection)&&matchesSelection(source.platformId,platformSelection)&&matchesSelection(source.formatId,formatSelection)&&matchesSelection(source.materialId,selectedIds(filters,'materialId'))&&(!filters.linkId||source.linkId===filters.linkId)&&(!filters.sourceId||source.id===filters.sourceId));
  const emptyRow=(id:string)=>({id,counts:{clicks:0,identities:0,attributedEvents:0,registrations:0,paymentCount:0,payingCustomers:0,firstPaymentCount:0,repeatPaymentCount:0},amountsMinor:{observedPayments:0,refunds:0,netPayments:0,netAccrued:0},conversions:{clickToRegistration:null,registrationToPayment:null,clickToPayment:null,cohortRegistrations:0,cohortPayingCustomers:0}});
  // Only measured activity is a result. Empty rows are an explicit view of existing links, never calendar placeholders.
  const resultRows=rows.filter(row=>row.counts.clicks>0||row.counts.registrations>0||row.counts.paymentCount>0||Object.values(row.amountsMinor).some(value=>value!==0));
  if(filters.includeEmpty==='true'){
    const field:Record<AnalyticsGroup,keyof PartnerLinkSourceRow>={scenario:'scenarioId',platform:'platformId',format:'formatId',material:'materialId',source:'id',link:'linkId'};
    const ids=new Set(scopedSources.filter(source=>new Date(source.createdAt)<until).map(source=>String(source[field[group]]??'__none__')));
    if(!scenarioSelection.length&&!platformSelection.length&&!formatSelection.length&&!filters.materialId&&!filters.sourceId){
      for(const link of links)if(new Date(link.createdAt)<until&&(!filters.linkId||link.id===filters.linkId))ids.add(group==='link'?link.id:'__none__');
    }
    for(const id of ids)if(!resultRows.some(row=>row.id===id))resultRows.push(emptyRow(id));
  }
  const scenarioOptions=[...scenarios.values()].filter(scenario=>!scenario.archived||scenarioSelection.includes(scenario.id)||sources.some(source=>source.scenarioId===scenario.id));
  const options = (id: 'platformId' | 'formatId', name: 'platformName' | 'formatName') => {
    // Keep the program's choices available while selecting more than one value.
    const entries=new Map(sources.map(source=>[source[id],{id:source[id] as string,name:source[name] as string}]));
    for(const material of materials){
      if(material.archivedAt)continue;
      if(id==='formatId')entries.set(material.formatId,{id:material.formatId,name:material.formatName});
      else for(const platform of material.platforms)entries.set(platform.id,{id:platform.id,name:platform.name});
    }
    const seen=new Set<string>();
    for(const snapshot of snapshots){
      const scenarioId=String(snapshot.data.scenarioId??snapshot.id);
      if(seen.has(scenarioId))continue;seen.add(scenarioId);
      if(!scenarioOptions.some(s=>s.id===scenarioId))continue;
      if(id==='platformId')for(const platform of snapshot.data.channels??[]){
        const configured=snapshot.data.settings?.channels?.[platform.id];
        if(configured?.enabled&&configured.formats.some(format=>(snapshot.data.settings?.frequency?.[format]??0)>0))entries.set(platform.id,{id:platform.id,name:platform.name});
      }
      if(id==='formatId')for(const format of snapshot.data.formats??[])if((snapshot.data.settings?.frequency?.[format.id]??0)>0)entries.set(format.id,{id:format.id,name:format.name});
    }
    return [...entries.values()];
  };
  const label = (id: string) => {
    if (id === '__none__') return group === 'link' ? 'Без привязки к ссылке' : group === 'material' ? 'Общие ссылки' : group === 'scenario' ? 'Без сценария' : 'Без указанного источника';
    if (group === 'scenario') return scenarios.get(id)?.name ?? sources.find(source => source.scenarioId === id)?.scenarioName ?? 'Сценарий';
    if (group === 'link') return links.find(link => link.id === id)?.label || links.find(link => link.id === id)?.linkKey || 'Ссылка без названия';
    if (group === 'material') {const material=materials.find(m=>m.id===id);if(material)return material.title;}
    const field = { platform: 'platformId', format: 'formatId', material: 'materialId', source: 'id' }[group] as string;
    const source = sources.find(source => source[field as keyof PartnerLinkSourceRow] === id);
    if (!source) return 'Источник не указан';
    return group === 'platform' ? source.platformName : group === 'format' ? source.formatName : group === 'material' ? source.materialTitle || 'Материал' : `${materials.find(m=>m.id===source.materialId)?.title||source.materialTitle||source.formatName} · ${source.channelName||source.platformName}${source.materialId?'':' (общая ссылка)'}`;
  };
  const reportOptions = { scenarios: scenarioOptions, platforms: options('platformId', 'platformName'), formats: options('formatId', 'formatName') };
  const chartSeries = series && filters.seriesBy ? (() => {
    const dimension = filters.seriesBy!, choices = reportOptions[`${dimension}s`];
    const grouped = new Map((series.groups ?? []).map(item => [item.id, item]));
    for (const id of selectedIds(filters, `${dimension}Id`)) {
      if (!grouped.has(id) && (id === '__none__' || choices.some(choice => choice.id === id))) grouped.set(id, { id, points: series.points.map(point => ({...point,clicks:0,registrations:0,payingCustomers:0,payments:0,firstPayments:0,repeatPayments:0,customerPaymentsMinor:0,earningsMinor:0})) });
    }
    return { ...series, by: dimension, groups: [...grouped.values()].map(item => ({ ...item, name: choices.find(choice => choice.id === item.id)?.name ?? (dimension === 'scenario' ? 'Без сценария' : dimension === 'platform' ? 'Площадка не указана' : 'Формат не указан') })) };
  })() : series;
  return {
    ...totals[0]!, period: { since, until }, generatedAt: new Date(), currency: filters.currency ?? null, timezone: filters.timezone ?? 'Europe/Moscow',
    ...(chartSeries ? { series: chartSeries } : {}),
    ...(comparison ? { comparison } : {}),
    ...(funnel ? { funnel: { clicks: totals[0]!.counts.clicks, ...funnel } } : {}),
    definitionVersion: 'partner-analytics-v2', groupBy: group, rows: resultRows.map(row => {
      const material=group==='material'?materials.find(m=>m.id===row.id):undefined;
      const source=group==='source'?sources.find(s=>s.id===row.id):undefined;
      const base=links.find(link=>link.id===(group==='link'?row.id:source?.linkId));
      const placements=material?sources.filter(s=>s.materialId===material.id):[];
      const relatedSources=scopedSources.filter(s=>String(s[({link:'linkId',material:'materialId',source:'id',platform:'platformId',scenario:'scenarioId',format:'formatId'} as const)[group]]??'__none__')===row.id);
      return {...row,name:label(row.id),linkKey:group==='link'?links.find(link=>link.id===row.id)?.linkKey??null:null,
        platformNames:[...new Set(relatedSources.map(s=>s.platformName))],
        createdAt: base && group==='link' ? base.createdAt : material?.createdAt ?? source?.createdAt ?? null,
        archived:group==='scenario'?scenarios.get(row.id)?.archived??false:!!scenarios.get((material?.scenarioId??source?.scenarioId)??'')?.archived||!!material?.archivedAt,
        ...(source?{placement:{materialTitle:materials.find(m=>m.id===source.materialId)?.title??source.materialTitle,
          formatName:source.formatName,platformName:source.platformName,channelName:source.channelName,
          publicationUrl:source.publicationUrl,publishedAt:source.publishedAt,linkKey:base?.linkKey??null,trackingParams:trackingSourceParams(source)}}:{}),
        ...(material?{material:{id:material.id,programId:material.programId,formatName:material.formatName,scheduledDay:material.scheduledDay,scenarioName:scenarios.get(material.scenarioId??'')?.name??null,
          published:placements.filter(p=>p.publishedAt).length,placements:placements.length+material.platforms.filter(p=>!placements.some(s=>s.platformId===p.id)).length}}:{}),
      };
    }),
    options: reportOptions,
    ...ledger, views: null, ctr: null,
    exclusions: ['local_simulator', 'flagged_clicks', 'non_current_attribution_models'],
    dataQuality: { signupTracking: 'not_verified_end_to_end', paymentTracking: 'not_verified_end_to_end', views: 'unavailable' },
    warnings: [],
  };
}
