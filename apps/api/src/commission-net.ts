import type { Knex } from 'knex';
import { TABLES, type CommissionAdjustmentRow, type CommissionRow } from '@openpartner/db';

export async function adjustmentTotalsByCommission(
  db: Knex,
  commissionIds: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (commissionIds.length === 0) return totals;
  const rows = await db<CommissionAdjustmentRow>(TABLES.CommissionAdjustment)
    .whereIn('commissionId', commissionIds)
    .select('commissionId', 'amount');
  for (const row of rows) {
    totals.set(row.commissionId, (totals.get(row.commissionId) ?? 0) + Number(row.amount));
  }
  return totals;
}

export type CommissionGroup = Pick<CommissionRow, 'tenantId' | 'partnerId' | 'currency'>;
export const commissionGroupKey = (group: CommissionGroup): string => JSON.stringify([group.tenantId, group.partnerId, group.currency]);

export interface ManualPayoutBalance {
  cashPaid: number;
  netPaidEarnings: number;
  debt: number;
}

/** Two batched queries, independent of partner count. Cash history comes from
 * completed manual Payouts; signed earnings include all their corrections.
 * Debt is a balance, never another CommissionAdjustment or an earnings cut. */
export async function manualPayoutBalances(db: Knex, groups: CommissionGroup[]): Promise<Map<string, ManualPayoutBalance>> {
  const balances = new Map(groups.map((g) => [commissionGroupKey(g), { cashPaid: 0, netPaidEarnings: 0, debt: 0 }]));
  if (!groups.length) return balances;
  const keys = groups.map((g) => [g.tenantId, g.partnerId, g.currency]);
  const cash = await db(TABLES.Payout).whereIn(['tenantId', 'partnerId', 'currency'], keys)
    .where({ status: 'paid', method: 'manual' }).groupBy('tenantId', 'partnerId', 'currency')
    .select('tenantId', 'partnerId', 'currency').sum({ amount: 'amount' }) as Array<CommissionGroup & { amount: string }>;
  const adjustments = db(TABLES.CommissionAdjustment).whereIn('tenantId', groups.map((g) => g.tenantId))
    .select('commissionId').sum({ amount: 'amount' }).groupBy('commissionId').as('adj');
  const earnings = await db(`${TABLES.Commission} as c`).join(`${TABLES.Payout} as p`, 'p.id', 'c.payoutId')
    .leftJoin(adjustments, 'adj.commissionId', 'c.id')
    .whereIn(['c.tenantId', 'c.partnerId', 'c.currency'], keys)
    .where({ 'p.status': 'paid', 'p.method': 'manual' })
    .groupBy('c.tenantId', 'c.partnerId', 'c.currency').select('c.tenantId', 'c.partnerId', 'c.currency')
    .select(db.raw(`sum(case when c.status = 'reversed' then 0 else c.amount + coalesce(adj.amount, 0) end) as amount`)) as Array<CommissionGroup & { amount: string }>;
  for (const row of cash) balances.get(commissionGroupKey(row))!.cashPaid = Number(row.amount);
  for (const row of earnings) balances.get(commissionGroupKey(row))!.netPaidEarnings = Number(row.amount);
  for (const balance of balances.values()) balance.debt = Math.max(0, Math.round((balance.cashPaid - balance.netPaidEarnings) * 100) / 100);
  return balances;
}

/** Separate cash allocation for planning and confirmation. Caller holds the
 * tenant payout lock. Pending reservations consume debt before new earnings,
 * ordered by payout creation/id and then commission accrual/id. A positive
 * payout must claim its fully offset commissions too, so confirming it settles
 * those earnings against debt. Cancelling it releases that allocation. */
export async function manualPayableAmounts(db: Knex, groups: CommissionGroup[], knownBalances?: Map<string, ManualPayoutBalance>): Promise<Map<string, number>> {
  const amounts = new Map<string, number>();
  if (!groups.length) return amounts;
  const rows = await db(`${TABLES.Commission} as c`).leftJoin(`${TABLES.Payout} as p`, 'p.id', 'c.payoutId')
    .whereIn(['c.tenantId', 'c.partnerId', 'c.currency'], groups.map((g) => [g.tenantId, g.partnerId, g.currency]))
    .where((q) => q.where('c.status', 'approved').orWhere((legacy) => legacy.where('c.status', 'paid').where('p.status', 'pending')))
    .orderByRaw('"p"."createdAt" asc nulls last').orderByRaw('"p"."id" asc nulls last')
    .orderBy('c.accruedAt').orderBy('c.id').select('c.*') as CommissionRow[];
  const adjustments = await adjustmentTotalsByCommission(db, rows.map((c) => c.id));
  const balances = knownBalances ?? await manualPayoutBalances(db, groups);
  const remainingDebt = new Map([...balances].map(([key, balance]) => [key, Math.round(balance.debt * 100)]));
  for (const row of rows) {
    const key = commissionGroupKey(row);
    const netMinor = Math.round(netCommissionAmount(row, adjustments, row.id) * 100);
    const offsetMinor = Math.min(remainingDebt.get(key) ?? 0, netMinor);
    amounts.set(row.id, (netMinor - offsetMinor) / 100);
    remainingDebt.set(key, (remainingDebt.get(key) ?? 0) - offsetMinor);
  }
  return amounts;
}

export function netCommissionAmount(
  commission: Pick<CommissionRow, 'amount'>,
  adjustments: Map<string, number>,
  commissionId: string,
): number {
  return Math.max(0, Math.round((Number(commission.amount) + (adjustments.get(commissionId) ?? 0)) * 100) / 100);
}
