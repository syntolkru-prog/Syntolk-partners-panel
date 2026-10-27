import type { Knex } from 'knex';
import { z } from 'zod';
import type { LinkRow, PartnerLinkSourceRow, PartnerMaterialRow } from '@openpartner/db';
import { trackingSourceParams } from '@openpartner/db';
import { adjustmentTotalsByCommission, commissionGroupKey, manualPayableAmounts, manualPayoutBalances, netCommissionAmount } from './commission-net.js';
import { todayWindow } from './coach/daily-plan.js';
import { parseUserAgent } from './ua-parse.js';
import { analyticsSourceOptions } from './analytics-source-options.js';

const selectionSchema = z.preprocess(value => {
  // qs represents repeated values as a numeric-keyed object above its array
  // limit (20). Accept only its contiguous array representation, then apply
  // exactly the same item and 50-selection limits as an ordinary array.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length && keys.every((key, index) => key === String(index))) return Object.values(value);
  }
  return value;
}, z.union([z.string().min(1).max(100), z.array(z.string().min(1).max(100)).min(1).max(50)])
  .transform(value => [...new Set(Array.isArray(value) ? value : [value])]));
export const analyticsQuerySchema = z.object({
  partnerId: z.string().min(1).max(100).optional(), partnerIds: selectionSchema.optional(),
  programId: z.string().min(1).optional(), scenarioId: z.string().min(1).max(100).optional(),
  platformId: z.string().min(1).max(100).optional(), formatId: z.string().min(1).max(100).optional(),
  scenarioIds: selectionSchema.optional(), platformIds: selectionSchema.optional(), formatIds: selectionSchema.optional(),
  seriesBy: z.enum(['platform', 'format', 'scenario', 'partner']).optional(),
  timezone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Invalid timezone').optional(),
  bucket: z.enum(['day','week','month']).optional(),
  materialId: z.string().min(1).max(32).optional(), linkId: z.string().min(1).max(32).optional(), sourceId: z.string().min(1).max(32).optional(),
  since: z.string().datetime().optional(), until: z.string().datetime().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  groupBy: z.enum(['scenario', 'platform', 'format', 'material', 'source', 'link', 'partner']).optional(),
  includeEmpty: z.enum(['true', 'false']).optional(), includeSeries: z.enum(['true', 'false']).optional(),
  includeComparison: z.enum(['true', 'false']).optional(), includeFunnel: z.enum(['true', 'false']).optional(),
  period: z.enum(['today', '7d', '30d', 'all', 'custom']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  compareFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), compareTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(input => new Set([...(input.partnerId ? [input.partnerId] : []), ...(input.partnerIds ?? [])]).size <= 50,
  { path: ['partnerIds'], message: 'Select at most 50 partners.' });
export type AnalyticsFilters = Omit<z.infer<typeof analyticsQuerySchema>, 'since' | 'until'> & { since?: Date; until?: Date; timezone?: string };
export type AnalyticsGroup = NonNullable<AnalyticsFilters['groupBy']>;
type TimeBucket = 'day' | 'week' | 'month';
type SeriesDimension = NonNullable<AnalyticsFilters['seriesBy']>;
type TimeGroup = TimeBucket | { bucket: TimeBucket; dimension: SeriesDimension };
type BreakdownGroup = AnalyticsGroup | 'platformFormat';
type Group = BreakdownGroup | TimeGroup;
type Scope = { db: Knex; tenantId: string; partnerIds?: string[]; filters: AnalyticsFilters; since: Date; until: Date; asOf: Date };
export type AnalyticsTrackingStatus = 'not_verified_end_to_end' | 'unavailable';
export type AnalyticsWarning = 'signup_tracking_unverified' | 'payment_tracking_unverified' | 'views_unavailable' | 'ctr_unavailable';
const GROUPS: Record<BreakdownGroup, string> = { scenario: 'src.scenarioId', platform: 'src.platformId', format: 'src.formatId', material: 'src.materialId', source: 'src.id', link: 'cl.linkId', partner: 'cl.partnerId', platformFormat:'src.platformId' };
const isTimeBucket = (group?: Group): group is TimeGroup => typeof group === 'object' || group === 'day' || group === 'week' || group === 'month';
const groupExpression = (group: BreakdownGroup) => group === 'platformFormat' ? `jsonb_build_array(??, src."formatId")::text` : group === 'link' ? `COALESCE(??, src."linkId", '__none__')` : `COALESCE(??, '__none__')`;
const selectedIds = (filters: AnalyticsFilters, field: 'scenarioId' | 'platformId' | 'formatId' | 'materialId') => {
  const multiple = field === 'materialId' ? [] : filters[`${field}s`] ?? [];
  return [...new Set([...(filters[field] ? [filters[field]!] : []), ...multiple])];
};
const matchesSelection = (value: string | null, selected: string[]) => !selected.length || selected.includes(value ?? '__none__');
export function analyticsPartnerIds(filters: Pick<AnalyticsFilters, 'partnerId' | 'partnerIds'>): string[] | undefined {
  const ids = [...new Set([...(filters.partnerId ? [filters.partnerId] : []), ...(filters.partnerIds ?? [])])];
  return ids.length ? ids : undefined;
}
function scopePartners(query: Knex.QueryBuilder, s: Scope, column = 'partnerId') {
  if (s.partnerIds) query.whereIn(column, s.partnerIds);
  return query;
}
function partners(s: Scope) { return scopePartners(s.db('Partner as partner').where('partner.tenantId', s.tenantId), s, 'partner.id'); }

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

export function analyticsFiltersFromQuery(query: unknown, defaultTimezone = 'Europe/Moscow'): AnalyticsFilters {
  const input = analyticsQuerySchema.parse(query), now = new Date();
  const invalid = (field: string, message: string): never => { throw new z.ZodError([{ code: 'custom', path: [field], message }]); };
  if (!!input.from !== !!input.to) invalid('from', 'Выберите начало и конец периода.');
  if (input.from && input.to && input.from > input.to) invalid('from', 'Конец периода не может быть раньше начала.');
  if (!!input.compareFrom !== !!input.compareTo) throw new z.ZodError([{ code: 'custom', path: ['compareFrom'], message: 'Выберите начало и конец периода сравнения.' }]);
  if (input.compareFrom && input.compareTo && input.compareFrom > input.compareTo) throw new z.ZodError([{ code: 'custom', path: ['compareFrom'], message: 'Начало периода сравнения должно быть раньше конца.' }]);
  const timezone = input.timezone ?? defaultTimezone;
  for (const value of [input.from, input.to, input.compareFrom, input.compareTo]) if (value) dayStart(value, timezone);
  if (input.includeComparison === 'true' && (!input.compareFrom || !input.compareTo)) invalid('compareFrom', 'Выберите даты обоих сравниваемых периодов.');
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
  return { ...input, currency: input.currency ?? 'RUB', since, until, timezone };
}

function scopeClicks(query: Knex.QueryBuilder, s: Scope, includeFlagged = false) {
  scopePartners(query.where('cl.tenantId', s.tenantId), s, 'cl.partnerId');
  if (!includeFlagged) query.whereNull('cl.fraudFlag');
  // Exclude the synthetic touch itself, never the real history of its user.
  query.whereRaw("COALESCE(cl.\"userAgent\", '') <> 'Syntolk-Local-Payment-Simulator/1'")
    .whereRaw("COALESCE(cl.referer, '') <> 'syntolk://local-simulator'")
    .whereRaw("COALESCE(cl.\"utmMedium\", '') <> 'simulator'");
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
function clicks(s: Scope, includeFlagged = false) {
  return scopeClicks(s.db('Click as cl').leftJoin('PartnerLinkSource as src', function () {
    this.on('src.id', '=', 'cl.trackingSourceId').andOn('src.tenantId', '=', 'cl.tenantId').andOn('src.partnerId', '=', 'cl.partnerId');
  }), s, includeFlagged);
}
function attributions(s: Scope) {
  return clicks(s).join('Attribution as a', 'a.clickId', 'cl.id').join('Event as e', 'e.id', 'a.eventId')
    .where({ 'a.tenantId': s.tenantId, 'e.tenantId': s.tenantId })
    .modify(q => scopePartners(q, s, 'a.partnerId'))
    // Attribution is a frozen allocation; the program's current model is not historical evidence.
    .where('a.weight', '>', 0)
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
function paidExpression(alias = 'e') {
  return `${alias}.type IN ('invoice_paid','recurring_payment') AND ${alias}.value > 0 AND ${alias}.currency = :currency`;
}
const bindings = (s: Scope) => ({ currency: s.filters.currency ?? 'RUB' });
const recurringExpression = `(e.type = 'recurring_payment' OR EXISTS (SELECT 1 FROM "Event" prev WHERE prev."tenantId" = e."tenantId" AND prev."userId" = e."userId" AND prev.type IN ('invoice_paid','recurring_payment') AND prev.value > 0 AND prev.currency = e.currency AND COALESCE(prev.metadata->>'source', '') <> 'local_simulator' AND (prev.ts < e.ts OR (prev.ts = e.ts AND prev.id < e.id))))`;

function aggregateQueries(s: Scope, group?: Group) {
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
  const paid = paidExpression();
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
    .whereRaw(paid, bindings(s)).where('refund.currency', s.filters.currency ?? 'RUB')
    .whereRaw("COALESCE(refund.metadata->>'source', '') <> 'local_simulator'");
  const adjustments = s.db('CommissionAdjustment').where({ tenantId: s.tenantId }).groupBy('commissionId').select('commissionId').sum({ adjustment: 'amount' }).as('ca');
  const earnings = attributions(s).join('Commission as c', 'c.attributionId', 'a.id')
    .leftJoin(adjustments, 'ca.commissionId', 'c.id')
    .where({ 'c.tenantId': s.tenantId }).whereRaw('c."partnerId" = a."partnerId"')
    .where('c.accruedAt', '>=', s.since).where('c.accruedAt', '<', s.until)
    .modify(q => { if (s.filters.currency) q.where('c.currency', s.filters.currency); });
  // Conversion rates follow clicks in this period, including their later conversions.
  // Activity totals above follow event dates; this prevents unrelated daily counts becoming a rate.
  const cohort = attributions(s).whereIn('cl.id', periodClicks.clone().select('cl.id')).where('e.ts', '<=', s.asOf);
  const signups = cohort.clone().where('e.type', 'signup').distinct('e.userId')
    .modify(q => { if (group && !isTimeBucket(group)) q.select(s.db.raw(`${groupExpression(group)} AS gid`, [GROUPS[group]])); }).as('registered');
  const paidSignups = cohort.clone().join(signups, function () {
    this.on('registered.userId', '=', 'e.userId');
    if (group && !isTimeBucket(group)) this.andOn(s.db.raw(`${groupExpression(group)} = ??`, [GROUPS[group], 'registered.gid']));
  }).whereRaw(paid, bindings(s));
  return [
    grouped(periodClicks.clone(), s, group).count({ clicks: '*' }), eventQuery,
    grouped(refunds, s, group, 'refund.ts').select(s.db.raw('COALESCE(SUM(-refund.value*a.weight),0)::text AS refunds')),
    grouped(earnings, s, group, 'c.accruedAt').select(s.db.raw(`COALESCE(SUM(CASE WHEN c.status != 'reversed' THEN GREATEST(0,c.amount+COALESCE(ca.adjustment,0)) ELSE 0 END),0)::text AS earnings`)),
    timed ? null : grouped(cohort.clone(), s, group).select(s.db.raw(`COUNT(DISTINCT CASE WHEN e.type='signup' THEN e."userId" END)::int AS "cohortRegistrations", COUNT(DISTINCT CASE WHEN ${paid} THEN e."userId" END)::int AS "cohortPayingCustomers"`, bindings(s))),
    timed ? null : grouped(paidSignups, s, group).countDistinct({ cohortPaidRegistrations: 'e.userId' }),
    grouped(periodClicks.clone().join('Identity as i', 'i.clickId', 'cl.id').where('i.tenantId', s.tenantId), s, group).countDistinct({ identities: 'i.userId' }),
  ];
}
type AggregateValues = Record<string, string | number | undefined>;
function aggregateRow(row: AggregateValues) {
  const counts = { clicks: Number(row.clicks ?? 0), identities: Number(row.identities ?? 0), attributedEvents: Number(row.attributedEvents ?? 0), registrations: Number(row.registrations ?? 0), paymentCount: Number(row.paymentCount ?? 0), payingCustomers: Number(row.payingCustomers ?? 0), firstPaymentCount: Number(row.firstPaymentCount ?? 0), repeatPaymentCount: Number(row.repeatPaymentCount ?? 0) };
  const rate = (n: number, d: number) => d > 0 ? n / d : null;
  return { id: row.id as string, ...(row.seriesId ? { seriesId: String(row.seriesId) } : {}), counts,
    amountsMinor: { observedPayments: Math.round(Number(row.revenue ?? 0)*100), refunds: Math.round(Number(row.refunds ?? 0)*100), netPayments: Math.round((Number(row.revenue ?? 0)-Number(row.refunds ?? 0))*100), netAccrued: Math.round(Number(row.earnings ?? 0)*100) },
    conversions: { clickToRegistration: rate(Number(row.cohortRegistrations ?? 0), counts.clicks), registrationToPayment: rate(Number(row.cohortPaidRegistrations ?? 0), Number(row.cohortRegistrations ?? 0)), clickToPayment: rate(Number(row.cohortPayingCustomers ?? 0), counts.clicks), cohortRegistrations: Number(row.cohortRegistrations ?? 0), cohortPayingCustomers: Number(row.cohortPayingCustomers ?? 0), cohortPaidRegistrations: Number(row.cohortPaidRegistrations ?? 0) },
  };
}
async function aggregates(s: Scope, group?: Group) {
  const collections = await Promise.all(aggregateQueries(s, group).map(query => query ?? []));
  const rows = new Map<string, AggregateValues>();
  for (const collection of collections) {
    for (const row of collection) {
      const key = JSON.stringify([row.seriesId ?? null, row.id]);
      rows.set(key, { ...rows.get(key), ...row });
    }
  }
  return [...rows.values()].map(aggregateRow);
}

const emptyBalances = () => ({ accrued: 0, available: 0, pending: 0, paid: 0, debt: 0, netPaidEarnings: 0, total: 0 });
async function globalBalances(s: Scope) {
  const [rows, partnerRows, paidInPeriod] = await Promise.all([
    scopePartners(s.db('Commission as c').leftJoin('Payout as p', 'p.id', 'c.payoutId')
      .where({ 'c.tenantId': s.tenantId, 'c.currency': s.filters.currency ?? 'RUB' }), s, 'c.partnerId')
      .select('c.id', 'c.partnerId', 'c.amount', 'c.status', 'c.payoutId', 'c.accruedAt', 'p.status as payoutStatus') as PromiseLike<Array<{id:string;partnerId:string;amount:string;status:string;payoutId:string|null;accruedAt:Date;payoutStatus:string|null}>>,
    partners(s).select('partner.id') as PromiseLike<Array<{ id: string }>>,
    scopePartners(s.db('Payout as p').where({ 'p.tenantId':s.tenantId, 'p.currency':s.filters.currency??'RUB', 'p.status':'paid', 'p.method':'manual' }),s,'p.partnerId')
      .where('p.completedAt','>=',s.since).where('p.completedAt','<',s.until)
      .sum({amount:'p.amount'}).first() as PromiseLike<{amount:string|null}>,
  ]);
  const adjustments = await adjustmentTotalsByCommission(s.db, rows.map(row => row.id));
  const groups = partnerRows.map(row => ({ tenantId: s.tenantId, partnerId: row.id, currency: s.filters.currency ?? 'RUB' }));
  const cashBalances = await manualPayoutBalances(s.db, groups);
  const payable = await manualPayableAmounts(s.db, groups, cashBalances);
  const byPartner = new Map(groups.map(group => {
    const cash = cashBalances.get(commissionGroupKey(group))!;
    return [group.partnerId, { balances: { ...emptyBalances(), paid: cash.cashPaid, debt: cash.debt, netPaidEarnings: cash.netPaidEarnings }, commissionByStatus: {} as Record<string, number> }];
  }));
  const commissionByStatus: Record<string, number> = {};
  const periodBalances={total:0,available:0,pending:0,paid:Number(paidInPeriod?.amount??0)};
  for (const row of rows) {
    const ledger = byPartner.get(row.partnerId);
    if (!ledger) continue;
    const balances = ledger.balances;
    const status = row.payoutId && row.status !== 'reversed' && row.payoutStatus !== 'paid' ? 'pending' : row.status;
    const amount = netCommissionAmount(row, adjustments, row.id);
    if (new Date(row.accruedAt) >= s.since && new Date(row.accruedAt) < s.until) {
      commissionByStatus[status] = (commissionByStatus[status] ?? 0) + amount;
      ledger.commissionByStatus[status] = (ledger.commissionByStatus[status] ?? 0) + amount;
      if(status!=='reversed'){
        periodBalances.total+=amount;
        if(status==='approved')periodBalances.available+=payable.get(row.id)??0;
        if(status==='pending')periodBalances.pending+=payable.get(row.id)??0;
      }
    }
    if (status === 'reversed') continue;
    if (status === 'accrued') balances.accrued += amount;
    if (status === 'approved') balances.available += payable.get(row.id) ?? 0;
    if (status === 'pending') balances.pending += payable.get(row.id) ?? 0;
    balances.total += amount;
  }
  const balances = emptyBalances();
  for (const ledger of byPartner.values()) {
    for (const key of Object.keys(balances) as Array<keyof typeof balances>) {
      ledger.balances[key] = Math.round(ledger.balances[key]*100)/100;
      balances[key] += ledger.balances[key];
    }
    for (const key of Object.keys(ledger.commissionByStatus)) ledger.commissionByStatus[key] = Math.round(ledger.commissionByStatus[key]!*100)/100;
  }
  for (const key of Object.keys(balances) as Array<keyof typeof balances>) balances[key] = Math.round(balances[key]*100)/100;
  for (const key of Object.keys(commissionByStatus)) commissionByStatus[key] = Math.round(commissionByStatus[key]!*100)/100;
  for(const key of Object.keys(periodBalances) as Array<keyof typeof periodBalances>){
    periodBalances[key]=s.filters.period==='all'?balances[key]:Math.round(periodBalances[key]*100)/100;
  }
  return { balances, periodBalances, commissionByStatus, byPartner,
    periodBalanceBasis:{since:s.since,until:s.until,asOf:s.asOf,
      total:'selected_accrual_period_current_net_earnings' as const,
      availableAndPending:'current_payable_of_selected_accrual_period_after_lifetime_debt' as const,
      paid:'manual_payout_cash_by_completion_date' as const},
    balanceBasis: { scope: s.partnerIds?.length === 1 ? 'lifetime_partner_currency' as const : 'lifetime_selected_partners_currency' as const, asOf: s.asOf, ignoresActivityFilters: true,
      paid: 'completed_manual_payout_cash' as const, availableAndPending: 'current_payable_after_debt' as const,
      total: 'current_net_earnings_before_debt' as const },
    commissionByStatusBasis: 'selected_accrual_period_current_net_earnings' as const };
}

export const adminAnalyticsTableQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.enum(['name', 'email', 'status', 'createdAt', 'clicks', 'identities', 'registrations', 'payingCustomers', 'paymentCount', 'observedPayments', 'netAccrued']).default('netAccrued'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  activity: z.enum(['results','all']).default('all'),
}).transform(input => ({ ...input, pageSize: input.pageSize ?? input.limit ?? 20 }));
export type AdminAnalyticsTableOptions = z.infer<typeof adminAnalyticsTableQuerySchema>;

const partnerStatus = `CASE WHEN partner."revokedAt" IS NOT NULL THEN 'revoked' WHEN partner."activatedAt" IS NOT NULL THEN 'active' ELSE 'pending' END`;
const metricColumns = [
  ['clicks'], ['attributedEvents', 'registrations', 'paymentCount', 'payingCustomers', 'firstPaymentCount', 'repeatPaymentCount', 'revenue'],
  ['refunds'], ['earnings'], ['cohortRegistrations', 'cohortPayingCustomers'], ['cohortPaidRegistrations'], ['identities'],
] as const;
/** Join the same grouped metric builders used by totals/charts. Pagination and
 * sorting happen in PostgreSQL; no per-partner report or client-side slicing. */
function partnerTableQuery(s: Scope) {
  const query = partners(s).select('partner.id', 'partner.name', 'partner.email', 'partner.createdAt')
    .select(s.db.raw(`${partnerStatus} AS status`));
  for (const [index, metrics] of aggregateQueries(s, 'partner').entries()) {
    const alias = `metric_${index}`;
    query.leftJoin(metrics!.as(alias), `${alias}.id`, 'partner.id');
    for (const column of metricColumns[index]!) query.select(s.db.raw('COALESCE(??::numeric, 0) AS ??', [`${alias}.${column}`, column]));
  }
  return query;
}

async function adminPartnerTable(s: Scope, input: AdminAnalyticsTableOptions, ledger?: Awaited<ReturnType<typeof globalBalances>>) {
  const all = s.db.from(partnerTableQuery(s).as('metrics'));
  const searched = all.clone();
  if(input.activity==='results') searched.where(q=>q.where('clicks','>',0).orWhere('registrations','>',0).orWhere('paymentCount','>',0).orWhere('refunds','<>',0).orWhere('earnings','<>',0));
  if (input.search) searched.where(q => q.whereILike('name', `%${input.search}%`).orWhereILike('email', `%${input.search}%`));
  const sortColumns: Partial<Record<AdminAnalyticsTableOptions['sort'], string>> = { observedPayments: 'revenue', netAccrued: 'earnings' };
  const column = sortColumns[input.sort] ?? input.sort;
  const [pageRows, count, summary] = await Promise.all([
    searched.clone().select('*').orderBy(column, input.direction).orderBy('id').limit(input.pageSize).offset((input.page - 1)*input.pageSize),
    searched.clone().count({ count: '*' }).first(),
    all.clone().select(s.db.raw(`COUNT(*)::int AS partners, COUNT(*) FILTER (WHERE clicks > 0 OR "attributedEvents" > 0 OR refunds > 0 OR earnings > 0)::int AS "activePartners"`)).first(),
  ]);
  const rows = pageRows.map(row => ({ ...aggregateRow(row), name: String(row.name), email: String(row.email), status: String(row.status), createdAt: row.createdAt,
    ...(ledger ? { balances: ledger.byPartner.get(row.id)?.balances ?? emptyBalances(), commissionByStatus: ledger.byPartner.get(row.id)?.commissionByStatus ?? {} } : {}) }));
  const total = Number(count?.count ?? 0);
  return { rows, pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total/input.pageSize), sort: input.sort, direction: input.direction, search: input.search ?? '' },
    summary: { partners: Number(summary?.partners ?? 0), activePartners: Number(summary?.activePartners ?? 0) } };
}

/** Lightweight views share metric builders, but never load lifetime ledgers or calendar snapshots. */
function reportScope(db: Knex, tenantId: string, partnerId: string | undefined, input: AnalyticsFilters): Scope {
  const filters={...input,currency:input.currency??'RUB'};
  return {db,tenantId,partnerIds:partnerId?[partnerId]:analyticsPartnerIds(filters),filters,
    since:filters.since??new Date(Date.now()-30*86400000),until:filters.until??new Date(),asOf:new Date()};
}
export async function analyticsPartnerResults(db: Knex,tenantId:string,filters:AnalyticsFilters,input:AdminAnalyticsTableOptions) {
  const result=await adminPartnerTable(reportScope(db,tenantId,undefined,filters),input);
  const {page,pageSize,total,totalPages}=result.pagination;
  return {items:result.rows,pagination:{page,pageSize,total,totalPages},summary:result.summary};
}
async function availableCurrencies(s:Scope) {
  const [commissions,events]=await Promise.all([
    attributions(s).join('Commission as currency_commission','currency_commission.attributionId','a.id').where('currency_commission.tenantId',s.tenantId).whereRaw('currency_commission."partnerId" = a."partnerId"').distinct('currency_commission.currency as currency'),
    attributions(s).whereIn('e.type',['invoice_paid','recurring_payment']).where('e.value','>',0).distinct('e.currency as currency'),
  ]);
  return [...new Set([...commissions,...events].map(row=>String(row.currency)))].sort();
}
function trackingMetadata() {return {views:null,ctr:null,dataQuality:{signupTracking:'not_verified_end_to_end',paymentTracking:'not_verified_end_to_end',views:'unavailable',ctr:'unavailable'},warnings:['signup_tracking_unverified','payment_tracking_unverified','views_unavailable','ctr_unavailable']};}
export async function partnerAnalyticsDiagnostics(db:Knex,tenantId:string,filters:AnalyticsFilters) {
  const s=reportScope(db,tenantId,undefined,filters),owners=await partners(s).select('partner.id');
  const cash=await manualPayoutBalances(db,owners.map((owner:{id:string})=>({tenantId,partnerId:String(owner.id),currency:filters.currency??'RUB'})));
  return {...trackingMetadata(),diagnostics:await adminDiagnostics(s,[...cash.values()].reduce((total,item)=>total+item.debt,0))};
}
export async function partnerAnalyticsOverview(db:Knex,tenantId:string,partnerId:string|undefined,filters:AnalyticsFilters,withOptions=true) {
  const s=reportScope(db,tenantId,partnerId,filters);
  const [totals,series,comparison]=await Promise.all([aggregates(s),filters.includeSeries==='true'?timeSeries(s):undefined,
    filters.includeComparison==='true'?comparisonPeriod(s):undefined]);
  const options=withOptions?await analyticsSourceOptions(db,tenantId,s.partnerIds,filters.programId,selectedIds(filters,'scenarioId')):{platforms:[],formats:[]};
  const ids=[...new Set([...(s.partnerIds??[]),...(filters.seriesBy==='partner'?series?.groups?.map(g=>g.id)??[]:[])])];
  const selectedPartners=ids.length?await db('Partner').where({tenantId}).whereIn('id',ids).select('id','name'):[];
  const dimension=filters.seriesBy;
  const names=dimension==='partner'?selectedPartners:dimension==='platform'?options.platforms:dimension==='format'?options.formats:dimension?await scopePartners(db('PartnerLinkSource').where({tenantId}),s).whereIn(`${dimension}Id`,series?.groups?.map(g=>g.id)??[]).distinct(`${dimension}Id as id`,`${dimension}Name as name`):[];
  const currencies=withOptions?await availableCurrencies(s):[];
  return {...totals[0]!,groupBy:'partner',rows:[],period:{since:s.since,until:s.until},currency:s.filters.currency,timezone:s.filters.timezone??'Europe/Moscow',generatedAt:s.asOf,availableCurrencies:currencies,
    options:{scenarios:[],...options,partners:selectedPartners},selectedPartners,
    ...(series?{series:{...series,...(dimension?{groups:series.groups?.map(g=>({...g,name:names.find(n=>n.id===g.id)?.name??'Не указан'}))}:{})}}:{}),...(comparison?{comparison}:{})};
}

/** Reuse Results counts, cohort denominators and exclusions for calculator facts. */
export async function calculatorAnalyticsBreakdown(db:Knex,tenantId:string,partnerId:string,filters:AnalyticsFilters) {
  const scope=reportScope(db,tenantId,partnerId,filters);
  const [formats,platforms,platformFormats]=await Promise.all([
    aggregates(scope,'format'),aggregates(scope,'platform'),aggregates(scope,'platformFormat'),
  ]);
  return {formats,platforms,platformFormats};
}

async function adminDiagnostics(s: Scope, debt: number) {
  const scoped = s.partnerIds !== undefined || !!s.filters.programId || !!s.filters.linkId || !!s.filters.sourceId ||
    (['scenarioId', 'platformId', 'formatId', 'materialId'] as const).some(field => selectedIds(s.filters, field).length);
  const legacy = s.db('Event as legacy').where({ 'legacy.tenantId': s.tenantId, 'legacy.currency': s.filters.currency ?? 'RUB' })
    .where('legacy.ts', '>=', s.since).where('legacy.ts', '<', s.until)
    .where(q => q.whereNull('legacy.externalEventId').orWhereRaw("btrim(legacy.\"externalEventId\") = ''"))
    .where(q => q.whereNotNull('legacy.value').orWhereIn('legacy.type', ['invoice_paid', 'recurring_payment', 'payment', 'refund']))
    .whereRaw("COALESCE(legacy.metadata->>'source', '') <> 'local_simulator'");
  if (scoped) legacy.where(q => q.whereIn('legacy.id', attributions(s).select('e.id'))
    .orWhereExists(attributions(s).select(s.db.raw('1')).whereRaw("e.id = legacy.metadata->>'originalEventId'")));
  const [flagged, missing, corrections] = await Promise.all([
    clicks(s, true).whereNotNull('cl.fraudFlag').where('cl.ts', '>=', s.since).where('cl.ts', '<', s.until).countDistinct({ count: 'cl.id' }).first(),
    legacy.countDistinct({ count: 'legacy.id' }).first(),
    attributions(s).join('Commission as diagnostic_c', 'diagnostic_c.attributionId', 'a.id')
      .join('CommissionAdjustment as diagnostic_adj', 'diagnostic_adj.commissionId', 'diagnostic_c.id')
      .where({ 'diagnostic_c.tenantId': s.tenantId, 'diagnostic_adj.tenantId': s.tenantId, 'diagnostic_c.currency': s.filters.currency ?? 'RUB' })
      .whereNotNull('diagnostic_adj.metadata')
      .whereRaw("diagnostic_adj.metadata->>'refundExternalEventId' IS NOT NULL")
      .where('diagnostic_adj.createdAt', '>=', s.since).where('diagnostic_adj.createdAt', '<', s.until)
      .countDistinct({ count: 'diagnostic_adj.id' }).sum({ amount: 'diagnostic_adj.amount' }).first(),
  ]);
  return { flaggedClicks: Number(flagged?.count ?? 0), legacyFinancialEventsWithoutExternalId: Number(missing?.count ?? 0),
    refundAdjustments: { count: Number(corrections?.count ?? 0), amountMinor: Math.round(Number(corrections?.amount ?? 0)*100) },
    outstandingDebtMinor: Math.round(debt*100), basis: { activity: 'selected_period_currency_and_source_scope', legacyEvents: scoped ? 'selected_attributions_and_linked_refunds' : 'tenant_including_unattributed', debt: 'lifetime_selected_partners_currency' } };
}

async function timeSeries(s: Scope) {
  const days = (s.until.getTime() - s.since.getTime()) / 86400000;
  const bucket: TimeBucket = s.filters.bucket ?? (days <= 90 ? 'day' : days <= 730 ? 'week' : 'month');
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
  const points: Array<{date:string;since:string;until:string;clicks:number;identities:number;registrations:number;payingCustomers:number;payments:number;firstPayments:number;repeatPayments:number;customerPaymentsMinor:number;earningsMinor:number}> = [];
  while (cursor <= last) {
    const date = cursor.toISOString().slice(0, 10), row = byDate.get(date);
    const next = new Date(cursor);
    if (bucket === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
    else next.setUTCDate(next.getUTCDate() + (bucket === 'week' ? 7 : 1));
    points.push({ date, since: new Date(Math.max(s.since.getTime(),dayStart(date,timezone).getTime())).toISOString(),
      until: new Date(Math.min(s.until.getTime(),dayStart(next.toISOString().slice(0,10),timezone).getTime())).toISOString(),
      clicks: row?.counts.clicks ?? 0, identities: row?.counts.identities ?? 0, registrations: row?.counts.registrations ?? 0,
      payingCustomers: row?.counts.payingCustomers ?? 0,
      payments: row?.counts.paymentCount ?? 0, firstPayments: row?.counts.firstPaymentCount ?? 0,
      repeatPayments: row?.counts.repeatPaymentCount ?? 0, customerPaymentsMinor: row?.amountsMinor.observedPayments ?? 0, earningsMinor: row?.amountsMinor.netAccrued ?? 0 });
    cursor.setTime(next.getTime());
  }
  const groupedPoints = new Map(groupedRows.map(row => [JSON.stringify([row.seriesId, row.id]), row]));
  const groups = [...new Set(groupedRows.map(row => row.seriesId!))].map(id => ({ id, points: points.map(point => {
    const row = groupedPoints.get(JSON.stringify([id, point.date]));
    return { date: point.date, since: point.since, until: point.until, clicks: row?.counts.clicks ?? 0, registrations: row?.counts.registrations ?? 0,
      identities: row?.counts.identities ?? 0, payingCustomers: row?.counts.payingCustomers ?? 0, payments: row?.counts.paymentCount ?? 0,
      firstPayments: row?.counts.firstPaymentCount ?? 0, repeatPayments: row?.counts.repeatPaymentCount ?? 0,
      customerPaymentsMinor: row?.amountsMinor.observedPayments ?? 0, earningsMinor: row?.amountsMinor.netAccrued ?? 0 };
  }) }));
  return { bucket, points, ...(s.filters.seriesBy ? { by: s.filters.seriesBy, groups } : {}) };
}

async function comparisonPeriod(s: Scope) {
  const compareFrom = s.filters.compareFrom, compareTo = s.filters.compareTo;
  if (!compareFrom || !compareTo) throw new z.ZodError([{ code: 'custom', path: ['compareFrom'], message: 'Выберите даты периода сравнения.' }]);
  const timezone = s.filters.timezone ?? 'Europe/Moscow';
  const since = dayStart(compareFrom, timezone);
  dayStart(compareTo, timezone);
  const until = dayStart(new Date(Date.parse(compareTo) + 86400000).toISOString().slice(0, 10), timezone);
  if (since >= until) throw new Error('invalid_comparison_period');
  const [total] = await aggregates({ ...s, since, until });
  return { period: { since, until }, counts: total!.counts, amountsMinor: total!.amountsMinor };
}

async function conversionFunnel(s: Scope) {
  const selectedClicks = clicks(s).where('cl.ts', '>=', s.since).where('cl.ts', '<', s.until).select('cl.id');
  const cohort = attributions(s).whereIn('cl.id', selectedClicks).where('e.ts', '<=', s.asOf).whereRaw('e.ts >= cl.ts');
  const registered = cohort.clone().where('e.type', 'signup').select('e.userId').min({ signupAt: 'e.ts' }).groupBy('e.userId');
  const [registration, paying] = await Promise.all([
    s.db.from(registered.clone().as('registered')).count({ count: '*' }).first(),
    cohort.clone().join(registered.clone().as('registered'), 'registered.userId', 'e.userId')
      .whereRaw('e.ts >= registered."signupAt"').whereRaw(paidExpression(), bindings(s)).whereRaw(`NOT ${recurringExpression}`)
      .countDistinct({ count: 'e.userId' }).first(),
  ]);
  return { registrations: Number(registration?.count ?? 0), firstPayingCustomers: Number(paying?.count ?? 0) };
}

const historyCursor = z.object({ ts: z.string().datetime(), id: z.string().min(1).max(70) });
export const analyticsDetailsQuerySchema = z.object({ cursor: z.string().max(300).optional(), includeRegistrations: z.enum(['true', 'false']).optional() });
export const analyticsRegistrationsQuerySchema=z.object({cursor:z.string().max(300).optional(),limit:z.coerce.number().int().min(1).max(100).default(50)});
const referrerName=(value:unknown)=>{try{return new URL(String(value)).hostname||'Источник не передан';}catch{return 'Источник не передан';}};

async function registrationPage(s:Scope,limit:number,rawCursor?:string){
  const {db,since,until}=s;
  let cursor:z.infer<typeof historyCursor>|undefined;
  if(rawCursor){try{cursor=historyCursor.parse(JSON.parse(rawCursor));}catch{throw new z.ZodError([{code:'custom',path:['cursor'],message:'Некорректный курсор регистраций.'}]);}}
  // The same unique signup users and exclusions as the registration KPI.
  const signups=attributions(s).where('e.type','signup').where('e.ts','>=',since).where('e.ts','<',until)
    .distinctOn('e.userId').orderBy('e.userId').orderBy('e.ts').orderBy('e.id').select('e.id','e.userId','e.ts');
  const base=()=>db.from(signups.clone().as('registered'));
  const [totalRow,page]=await Promise.all([
    base().count({total:'*'}).first(),
    base().select('*').modify(q=>{if(cursor)q.whereRaw('(ts,id) < (?::timestamptz, ?)',[cursor.ts,cursor.id]);}).orderBy('ts','desc').orderBy('id','desc').limit(limit+1),
  ]);
  const latest=(page as Array<{id:string;userId:string;ts:Date}>).slice(0,limit);
  const paid:Array<{userId:string;amountMinor:string|number;paymentCount:number}>=latest.length?await attributions(s).whereIn('e.userId',latest.map(row=>row.userId))
    .where('e.ts','>=',since).where('e.ts','<',until).whereRaw(paidExpression(),bindings(s))
    .groupBy('e.userId').select('e.userId').select(db.raw('ROUND(SUM(e.value*a.weight)*100) AS "amountMinor", COUNT(DISTINCT e.id)::int AS "paymentCount"')):[];
  const sources:Array<{id:string;referer:string|null}>=latest.length?await attributions(s).whereIn('e.id',latest.map(row=>row.id)).distinct('e.id','cl.referer'):[];
  const registrations=latest.map(row=>{
    const origins=[...new Set(sources.filter(item=>item.id===row.id).map(item=>referrerName(item.referer)))].sort();
    const payment=paid.find(item=>item.userId===row.userId);
    return {id:String(row.id),userId:String(row.userId),registeredAt:new Date(row.ts).toISOString(),source:origins.join(', ')||'Источник не передан',paidMinor:payment?Number(payment.amountMinor):null,paymentCount:Number(payment?.paymentCount??0),currency:s.filters.currency!};
  });
  const last=registrations.at(-1);
  return {registrations,total:Number(totalRow?.total??0),nextCursor:page.length>limit&&last?JSON.stringify({ts:last.registeredAt,id:last.id}):null};
}

export async function partnerAnalyticsRegistrations(db:Knex,tenantId:string,partnerId:string,filters:AnalyticsFilters={},cursor?:string,limit=50){
  const s=reportScope(db,tenantId,partnerId,{...filters,currency:filters.currency??'RUB'});
  return {...await registrationPage(s,limit,cursor),timezone:s.filters.timezone??'Europe/Moscow',currency:s.filters.currency,period:{since:s.since,until:s.until}};
}

/** Read-only detail view. Reuses the exact scope, payment taxonomy and exclusions of the report. */
export async function partnerAnalyticsDetails(db: Knex, tenantId: string, partnerId?: string, filters: AnalyticsFilters = {}, rawCursor?: string, includeRegistrations = false) {
  filters = { ...filters, currency: filters.currency ?? 'RUB' };
  const since = filters.since ?? new Date(Date.now() - 30 * 86400000), until = filters.until ?? new Date();
  const s: Scope = { db, tenantId, partnerIds: partnerId ? [partnerId] : analyticsPartnerIds(filters), filters, since, until, asOf: new Date() };
  let cursor: z.infer<typeof historyCursor> | undefined;
  if (rawCursor) {
    try { cursor = historyCursor.parse(JSON.parse(rawCursor)); }
    catch { throw new z.ZodError([{ code: 'custom', path: ['cursor'], message: 'Некорректный курсор истории.' }]); }
  }
  const periodClicks = () => clicks(s).where('cl.ts', '>=', since).where('cl.ts', '<', until);
  const owner=(q:Knex.QueryBuilder)=>q.leftJoin('Partner as history_partner',function(){this.on('history_partner.id','cl.partnerId').andOn('history_partner.tenantId','cl.tenantId');}).leftJoin('Link as history_link',function(){this.on('history_link.id','cl.linkId').andOn('history_link.tenantId','cl.tenantId');});
  const clickEvents = owner(periodClicks()).select(db.raw(`'c:' || cl.id AS id, 'click'::text AS kind, cl.ts, NULL::numeric AS "amountMinor", NULL::text AS currency, ARRAY[history_partner.name] AS "partnerNames", ARRAY[history_link."linkKey"] AS "linkKeys"`));
  const events = owner(attributions(s)).where('e.ts', '>=', since).where('e.ts', '<', until)
    .where(q => q.where('e.type', 'signup').orWhereRaw(paidExpression(), bindings(s)))
    .select(db.raw(`'e:' || e.id AS id, CASE WHEN e.type='signup' THEN 'signup' WHEN ${recurringExpression} THEN 'repeat_payment' ELSE 'first_payment' END AS kind, e.ts,
      CASE WHEN e.type='signup' THEN NULL ELSE ROUND(SUM(e.value*a.weight)*100) END AS "amountMinor", e.currency, ARRAY_AGG(DISTINCT history_partner.name) AS "partnerNames", ARRAY_AGG(DISTINCT history_link."linkKey") AS "linkKeys"`))
    .groupBy('e.id');
  const refunds = owner(attributions(s)).join('Event as refund', function () { this.on(db.raw("refund.metadata->>'originalEventId' = e.id")); })
    .where({ 'refund.tenantId': tenantId, 'refund.type': 'refund' }).whereRaw(paidExpression(), bindings(s))
    .where('refund.ts', '>=', since).where('refund.ts', '<', until)
    .whereRaw("COALESCE(refund.metadata->>'source', '') <> 'local_simulator'")
    .modify(q => { if (filters.currency) q.where('refund.currency', filters.currency); })
    .select(db.raw(`'r:' || refund.id AS id, 'refund'::text AS kind, refund.ts, ROUND(SUM(refund.value*a.weight)*100) AS "amountMinor", refund.currency, ARRAY_AGG(DISTINCT history_partner.name) AS "partnerNames", ARRAY_AGG(DISTINCT history_link."linkKey") AS "linkKeys"`)).groupBy('refund.id');
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
    const name = referrerName(row.referer);
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
  // Optional homepage rows use the same attribution scope/exclusions as Results.
  // This is an additive read model: existing history and metric definitions stay unchanged.
  const page=includeRegistrations?await registrationPage(s,4):undefined;
  return { ...(page ? { registrations:page.registrations,registrationsTotal:page.total } : {}), traffic: { referrers: [...referrers].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)), devices: top(devices) }, history: { items,
    nextCursor: actions.length > 20 && last ? JSON.stringify({ ts: last.ts, id: last.id }) : null } };
}

export async function partnerAnalytics(db: Knex, tenantId: string, partnerId?: string, filters: AnalyticsFilters = {}, tableOptions?: AdminAnalyticsTableOptions) {
  filters = { ...filters, currency: filters.currency ?? 'RUB' };
  const since = filters.since ?? new Date(Date.now()-30*86400000), until = filters.until ?? new Date();
  if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || since >= until) throw new Error('invalid_analytics_period');
  const s: Scope = { db, tenantId, partnerIds: partnerId ? [partnerId] : analyticsPartnerIds(filters), filters, since, until, asOf: new Date() };
  const scenarioSelection = selectedIds(filters, 'scenarioId'), platformSelection = selectedIds(filters, 'platformId'), formatSelection = selectedIds(filters, 'formatId');
  const group = filters.groupBy ?? (tableOptions ? 'partner' : scenarioSelection.length === 1 && scenarioSelection[0] !== '__none__' ? 'platform' : 'scenario');
  const partnerList=group==='partner'&&!filters.seriesBy;
  const storedSources=()=>scopePartners(db('PartnerLinkSource').where({tenantId}),s).modify(q=>{if(filters.programId)q.where({programId:filters.programId});});
  const [totals, rows, ledger, sourceRows, snapshotRows, linkRows, materialRows, series, comparison, funnel, sourceOptions] = await Promise.all([
    aggregates(s), group === 'partner' ? [] : aggregates(s, group), globalBalances(s),
    partnerList?[]:storedSources(),
    partnerList?[]:scopePartners(db('CoachForecastSnapshot').where({ tenantId }), s).whereIn('status',['confirmed','archived']).modify(q=>{if(filters.programId)q.where({programId:filters.programId});}).select(db.raw('COALESCE("data"->>\'scenarioId\', id) AS "scenarioKey"')).distinctOn('scenarioKey').orderBy('scenarioKey').orderBy('createdAt','desc').orderBy('id','desc').select('id','status',db.raw('jsonb_build_object(\'scenarioId\',data->>\'scenarioId\',\'scenarioName\',data->>\'scenarioName\') AS data')),
    partnerList?[]:scopePartners(db('Link').where({ tenantId }), s).modify(q => { if (filters.programId) q.where({ programId: filters.programId }); }).select('id', 'linkKey', 'label', 'channel', 'createdAt'),
    partnerList||!['material','source'].includes(group)?[]:scopePartners(db<PartnerMaterialRow>('PartnerMaterial').where({tenantId}), s).whereIn('id',storedSources().select('materialId')),
    filters.includeSeries === 'true' ? timeSeries(s) : undefined,
    filters.includeComparison === 'true' ? comparisonPeriod(s) : undefined,
    filters.includeFunnel === 'true' ? conversionFunnel(s) : undefined,
    partnerList?{platforms:[],formats:[]}:analyticsSourceOptions(db,tenantId,s.partnerIds,filters.programId,scenarioSelection),
  ]);
  const [table, diagnostics] = await Promise.all([
    tableOptions || group === 'partner' ? adminPartnerTable(s, tableOptions ?? adminAnalyticsTableQuerySchema.parse({}), ledger) : undefined,
    tableOptions ? adminDiagnostics(s, ledger.balances.debt) : undefined,
  ]);
  const partnerRows = new Map((table?.rows ?? []).map(row => [row.id, row]));
  const publicLedger = { balances: ledger.balances, periodBalances:ledger.periodBalances, periodBalanceBasis:ledger.periodBalanceBasis, commissionByStatus: ledger.commissionByStatus,
    balanceBasis: ledger.balanceBasis, commissionByStatusBasis: ledger.commissionByStatusBasis };
  const sources = sourceRows as PartnerLinkSourceRow[];
  const snapshots = snapshotRows as Array<{id:string;status:string;data:{scenarioId?:string;scenarioName?:string}}>;
  const links = linkRows as LinkRow[];
  const materials=materialRows as PartnerMaterialRow[];
  const scenarios = new Map<string, { id: string; name: string; archived: boolean }>();
  for (const snapshot of snapshots) {
    const id = String(snapshot.data.scenarioId ?? snapshot.id);
    if (!scenarios.has(id)) scenarios.set(id, { id, name: snapshot.data.scenarioName || 'Сценарий', archived: snapshot.status === 'archived' });
  }
  const scopedSources = sources.filter(source => matchesSelection(source.scenarioId,scenarioSelection)&&matchesSelection(source.platformId,platformSelection)&&matchesSelection(source.formatId,formatSelection)&&matchesSelection(source.materialId,selectedIds(filters,'materialId'))&&(!filters.linkId||source.linkId===filters.linkId)&&(!filters.sourceId||source.id===filters.sourceId));
  const emptyRow=(id:string)=>({id,counts:{clicks:0,identities:0,attributedEvents:0,registrations:0,paymentCount:0,payingCustomers:0,firstPaymentCount:0,repeatPaymentCount:0},amountsMinor:{observedPayments:0,refunds:0,netPayments:0,netAccrued:0},conversions:{clickToRegistration:null,registrationToPayment:null,clickToPayment:null,cohortRegistrations:0,cohortPayingCustomers:0,cohortPaidRegistrations:0}});
  // Only measured activity is a result. Empty rows are an explicit view of existing links, never calendar placeholders.
  const resultRows=group === 'partner' ? [...table!.rows] : rows.filter(row=>row.counts.clicks>0||row.counts.registrations>0||row.counts.paymentCount>0||Object.values(row.amountsMinor).some(value=>value!==0));
  if(filters.includeEmpty==='true' && group !== 'partner'){
    const field:Record<AnalyticsGroup,keyof PartnerLinkSourceRow>={scenario:'scenarioId',platform:'platformId',format:'formatId',material:'materialId',source:'id',link:'linkId',partner:'partnerId'};
    const ids=new Set(scopedSources.filter(source=>new Date(source.createdAt)<until).map(source=>String(source[field[group]]??'__none__')));
    if(!scenarioSelection.length&&!platformSelection.length&&!formatSelection.length&&!filters.materialId&&!filters.sourceId){
      for(const link of links)if(new Date(link.createdAt)<until&&(!filters.linkId||link.id===filters.linkId))ids.add(group==='link'?link.id:'__none__');
    }
    for(const id of ids)if(!resultRows.some(row=>row.id===id))resultRows.push(emptyRow(id));
  }
  const scenarioOptions=[...scenarios.values()].filter(scenario=>!scenario.archived||scenarioSelection.includes(scenario.id)||sources.some(source=>source.scenarioId===scenario.id));
  const label = (id: string) => {
    if (group === 'partner') return partnerRows.get(id)?.name ?? 'Партнёр';
    if (id === '__none__') return group === 'link' ? 'Без привязки к ссылке' : group === 'material' ? 'Общие ссылки' : group === 'scenario' ? 'Без сценария' : 'Без указанного источника';
    if (group === 'scenario') return scenarios.get(id)?.name ?? sources.find(source => source.scenarioId === id)?.scenarioName ?? 'Сценарий';
    if (group === 'link') return links.find(link => link.id === id)?.label || links.find(link => link.id === id)?.linkKey || 'Ссылка без названия';
    if (group === 'material') {const material=materials.find(m=>m.id===id);if(material)return material.title;}
    const field = { platform: 'platformId', format: 'formatId', material: 'materialId', source: 'id' }[group] as string;
    const source = sources.find(source => source[field as keyof PartnerLinkSourceRow] === id);
    const configured=(group==='platform'?sourceOptions.platforms:group==='format'?sourceOptions.formats:[]).find(option=>option.id===id);
    if(configured)return configured.name;
    if (!source) return 'Источник не указан';
    return group === 'platform' ? source.platformName : group === 'format' ? source.formatName : group === 'material' ? source.materialTitle || 'Материал' : `${materials.find(m=>m.id===source.materialId)?.title||source.materialTitle||source.formatName} · ${source.channelName||source.platformName}${source.materialId?'':' (общая ссылка)'}`;
  };
  const seriesPartners=filters.seriesBy==='partner'?await partners(s).whereIn('partner.id',series?.groups?.map(g=>g.id)??[]).select('partner.id','partner.name'):[];
  const reportOptions = { scenarios: scenarioOptions, ...sourceOptions,partners:seriesPartners };
  const chartSeries = series && filters.seriesBy ? (() => {
    const dimension = filters.seriesBy!, choices: Array<{id:string;name:string}> = reportOptions[`${dimension}s`];
    const grouped = new Map((series.groups ?? []).map(item => [item.id, item]));
    for (const id of (dimension==='partner'?analyticsPartnerIds(filters)??[]:selectedIds(filters, `${dimension}Id`))) {
      if (!grouped.has(id) && (id === '__none__' || choices.some(choice => choice.id === id))) grouped.set(id, { id, points: series.points.map(point => ({...point,clicks:0,identities:0,registrations:0,payingCustomers:0,payments:0,firstPayments:0,repeatPayments:0,customerPaymentsMinor:0,earningsMinor:0})) });
    }
    return { ...series, by: dimension, groups: [...grouped.values()].map(item => ({ ...item, name: choices.find(choice => choice.id === item.id)?.name ?? (dimension === 'scenario' ? 'Без сценария' : dimension === 'platform' ? 'Площадка не указана' : 'Формат не указан') })) };
  })() : series;
  return {
    ...totals[0]!, period: { since, until }, generatedAt: s.asOf, currency: filters.currency!, timezone: filters.timezone ?? 'Europe/Moscow',
    metricBasis: { counts: 'activity_in_selected_period' as const, conversions: 'selected_click_cohort_through_generated_at' as const,
      identities: 'distinct_users_on_selected_clicks' as const, seriesIdentities: 'distinct_users_per_click_time_bucket_not_additive' as const,
      registrations: 'distinct_users' as const, payments: 'positive_invoice_paid_or_recurring_payment_events' as const,
      earnings: 'commission_accrued_at_with_current_corrections' as const, refunds: 'refund_event_time' as const },
    ...(chartSeries ? { series: chartSeries } : {}),
    ...(comparison ? { comparison } : {}),
    ...(funnel ? { funnel: { clicks: totals[0]!.counts.clicks, ...funnel } } : {}),
    definitionVersion: 'partner-analytics-v2', groupBy: group, rows: resultRows.map(row => {
      const material=group==='material'?materials.find(m=>m.id===row.id):undefined;
      const source=group==='source'?sources.find(s=>s.id===row.id):undefined;
      const base=links.find(link=>link.id===(group==='link'?row.id:source?.linkId));
      const placements=material?sources.filter(s=>s.materialId===material.id):[];
      const relatedSources=scopedSources.filter(s=>String(s[({link:'linkId',material:'materialId',source:'id',platform:'platformId',scenario:'scenarioId',format:'formatId',partner:'partnerId'} as const)[group]]??'__none__')===row.id);
      return {...row,...(group === 'partner' ? partnerRows.get(row.id) : {}),name:label(row.id),linkKey:group==='link'?links.find(link=>link.id===row.id)?.linkKey??null:null,
        platformNames:[...new Set(relatedSources.map(s=>s.platformName))],
        createdAt: group === 'partner' ? partnerRows.get(row.id)?.createdAt ?? null : base && group==='link' ? base.createdAt : material?.createdAt ?? source?.createdAt ?? null,
        archived:group==='scenario'?scenarios.get(row.id)?.archived??false:!!scenarios.get((material?.scenarioId??source?.scenarioId)??'')?.archived||!!material?.archivedAt,
        ...(source?{placement:{materialTitle:materials.find(m=>m.id===source.materialId)?.title??source.materialTitle,
          formatName:source.formatName,platformName:source.platformName,channelName:source.channelName,
          publicationUrl:source.publicationUrl,publishedAt:source.publishedAt,linkKey:base?.linkKey??null,trackingParams:trackingSourceParams(source)}}:{}),
        ...(material?{material:{id:material.id,programId:material.programId,formatName:material.formatName,scheduledDay:material.scheduledDay,scenarioName:scenarios.get(material.scenarioId??'')?.name??null,
          published:placements.filter(p=>p.publishedAt).length,placements:placements.length+material.platforms.filter(p=>!placements.some(s=>s.platformId===p.id)).length}}:{}),
      };
    }),
    ...(tableOptions && table ? { partnerTable: { rows: table.rows, pagination: table.pagination }, pagination: table.pagination,
      summary: table.summary, activePartners: table.summary.activePartners, diagnostics } : {}),
    options: reportOptions,availableCurrencies:await availableCurrencies(s),
    ...publicLedger,...trackingMetadata(),
    exclusions: ['local_simulator', 'flagged_clicks'],
    // No persisted production verification evidence exists. Test success cannot verify tracking in production.
  };
}
