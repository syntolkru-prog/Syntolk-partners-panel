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

export function netCommissionAmount(
  commission: Pick<CommissionRow, 'amount'>,
  adjustments: Map<string, number>,
  commissionId: string,
): number {
  return Math.max(0, Math.round((Number(commission.amount) + (adjustments.get(commissionId) ?? 0)) * 100) / 100);
}
