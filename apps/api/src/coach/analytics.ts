import type { Knex } from 'knex';

/** Read-only facts. Never infers views, unique visitors or unobserved retention. */
export async function coachMetrics(db: Knex, tenantId: string, partnerId: string, programId?: string, days=30) {
  const since = new Date(Date.now() - Math.min(90,Math.max(1,days)) * 86400000);
  const until = new Date();
  const base = db('Attribution as a').join('Event as e', 'e.id', 'a.eventId').join('Program as p', 'p.id', 'a.programId').join('Click as cl', 'cl.id', 'a.clickId')
    .where({ 'a.tenantId': tenantId, 'a.partnerId': partnerId, 'e.tenantId': tenantId, 'p.tenantId': tenantId, 'cl.tenantId': tenantId })
    .whereRaw('?? = ??', ['a.model', 'p.attributionModel']).whereNull('cl.fraudFlag')
    .whereRaw("COALESCE(e.metadata->>'source','') <> 'local_simulator'");
  if (programId) base.andWhere('a.programId', programId);
  const period = base.clone().andWhere('e.ts', '>=', since).andWhere('e.ts', '<', until);
  const summary = await period.clone().select(db.raw(`COUNT(DISTINCT CASE WHEN e.type='signup' THEN e."userId" END)::int AS registrations,
    COUNT(DISTINCT CASE WHEN e.type IN ('invoice_paid','recurring_payment') AND e.value>0 AND e.currency='RUB' THEN e.id END)::int AS payments,
    COUNT(DISTINCT CASE WHEN e.type IN ('invoice_paid','recurring_payment') AND e.value>0 AND e.currency='RUB' THEN e."userId" END)::int AS "payingCustomers",
    COALESCE(SUM(CASE WHEN e.type IN ('invoice_paid','recurring_payment') AND e.currency='RUB' THEN e.value*a.weight ELSE 0 END),0)::text AS revenue`)).first();
  const clicks = db('Click').where({ tenantId, partnerId }).whereNull('fraudFlag').where('ts', '>=', since).where('ts', '<', until);
  if (programId) clicks.andWhere({ programId });
  // Synthetic simulator clicks can exist without metadata. Exclude any whose
  // stitched customer has a simulator event; conservative rather than fake growth.
  clicks.whereNotIn('id', db('Identity as i').join('Event as ev', 'ev.userId', 'i.userId').where({ 'i.tenantId': tenantId, 'ev.tenantId': tenantId }).whereRaw("ev.metadata->>'source' = 'local_simulator'").select('i.clickId'));
  const clickCount = await clicks.clone().count({ count: '*' }).first();
  const clicksByLink=await clicks.clone().groupBy('linkId').select('linkId').count({count:'*'}) as Array<{linkId:string;count:string|number}>;
  const eventsByLink=await period.clone().groupBy('cl.linkId').select('cl.linkId').select(db.raw(`COUNT(DISTINCT CASE WHEN e.type='signup' THEN e."userId" END)::int AS registrations,COUNT(DISTINCT CASE WHEN e.type IN ('invoice_paid','recurring_payment') AND e.value>0 AND e.currency='RUB' THEN e."userId" END)::int AS "payingCustomers"`));
  const partnerLinks=await db('Link').where({tenantId,partnerId}).modify(q=>{if(programId)q.where({programId});}).select('id','linkKey','label','channel').limit(200) as Array<{id:string;linkKey:string;label:string|null;channel:string|null}>;
  const ledger = base.clone().join('Commission as c', 'c.attributionId', 'a.id').leftJoin('Payout as pay', 'pay.id', 'c.payoutId').where('c.tenantId', tenantId).where('c.currency','RUB').select('c.id', 'c.status', 'c.amount', 'c.accruedAt', 'c.payoutId', 'pay.status as payoutStatus','cl.linkId');
  const rows = await ledger;
  const ids = rows.map((r: { id: string }) => r.id);
  const adjustments = ids.length ? await db('CommissionAdjustment').where({ tenantId }).whereIn('commissionId', ids).select('commissionId', 'amount') : [];
  const sums = new Map<string, number>();
  for (const a of adjustments) sums.set(a.commissionId, (sums.get(a.commissionId) ?? 0) + Math.round(Number(a.amount) * 100));
  const balancesLifetime = { accrued: 0, available: 0, pendingPayout: 0, paid: 0 };
  let netAccrued = 0;
  const earningsByLink=new Map<string,number>();
  for (const row of rows) {
    if (row.status === 'reversed') continue;
    const minor = Math.max(0, Math.round(Number(row.amount) * 100) + (sums.get(row.id) ?? 0));
    if (new Date(row.accruedAt) >= since && new Date(row.accruedAt) < until) {netAccrued += minor;earningsByLink.set(row.linkId,(earningsByLink.get(row.linkId)??0)+minor);}
    if (row.payoutId && row.payoutStatus !== 'paid') balancesLifetime.pendingPayout += minor;
    else if (row.status === 'paid') balancesLifetime.paid += minor;
    else if (row.status === 'approved') balancesLifetime.available += minor;
    else if (row.status === 'accrued') balancesLifetime.accrued += minor;
  }
  return { period: { since, until }, generatedAt: until, definitionVersion: 'coach-metrics-v1', currency: 'RUB',
    links:partnerLinks.map(l=>({linkId:l.id,linkKey:l.linkKey,label:l.label,channel:l.channel,clicks:Number(clicksByLink.find(c=>c.linkId===l.id)?.count??0),registrations:eventsByLink.find(e=>e.linkId===l.id)?.registrations??0,payingCustomers:eventsByLink.find(e=>e.linkId===l.id)?.payingCustomers??0,netAccruedMinor:earningsByLink.get(l.id)??0})),
    counts: { clicks: Number(clickCount?.count ?? 0), registrations: summary?.registrations ?? 0, paymentCount: summary?.payments ?? 0, payingCustomers: summary?.payingCustomers ?? 0 },
    amountsMinor: { observedPayments: Math.round(Number(summary?.revenue ?? 0) * 100), netAccrued }, balancesLifetime, views: null, ctr: null,
    exclusions: ['local_simulator', 'flagged_clicks', 'non_current_attribution_models', 'non_RUB_payments'],
    dataQuality: { signupTracking: 'not_verified_end_to_end', paymentTracking: 'not_verified_end_to_end', views: 'unavailable' },
    warnings: ['Внешняя регистрация и платежи требуют отдельной сквозной проверки.', 'Повторные оплаты за пределами окна атрибуции требуют утверждённой политики.', 'Оплаты показаны до возвратов; начисления учитывают сохранённые корректировки.'] };
}
