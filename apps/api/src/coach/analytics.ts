import type { Knex } from 'knex';
import type { LinkRow } from '@openpartner/db';
import { partnerAnalytics, type AnalyticsFilters } from '../partner-analytics.js';

/** Compatibility projection. All partner-facing metrics use the same calculation. */
export async function coachMetrics(db: Knex, tenantId: string, partnerId: string, programId?: string, days=30, window?: { since: Date; until: Date }, filters: AnalyticsFilters = {}) {
  const report = await partnerAnalytics(db, tenantId, partnerId, {
    programId, since: window?.since ?? new Date(Date.now()-Math.min(90,Math.max(1,days))*86400000),
    until: window?.until ?? new Date(), currency: 'RUB', groupBy: 'link', ...filters,
  });
  const partnerLinks = await db<LinkRow>('Link').where({ tenantId, partnerId }).modify(q => { if (programId) q.where({ programId }); }).select('id','linkKey','label','channel') as Array<Pick<LinkRow,'id'|'linkKey'|'label'|'channel'>>;
  return { ...report, currency: 'RUB',
    links: partnerLinks.map(link => {
      const row = report.groupBy === 'link' ? report.rows.find(row => row.id === link.id) : undefined;
      return { linkId: link.id as string, linkKey: link.linkKey as string, label: link.label as string|null, channel: link.channel as string|null,
        clicks: row?.counts.clicks ?? 0, registrations: row?.counts.registrations ?? 0, payingCustomers: row?.counts.payingCustomers ?? 0, netAccruedMinor: row?.amountsMinor.netAccrued ?? 0 };
    }),
    balancesLifetime: { accrued: Math.round(report.balances.accrued*100), available: Math.round(report.balances.available*100), pendingPayout: Math.round(report.balances.pending*100), paid: Math.round(report.balances.paid*100) },
  };
}
