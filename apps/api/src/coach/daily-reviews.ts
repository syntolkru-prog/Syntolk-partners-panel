import { ulid } from 'ulid';
import { db } from '../db.js';
import { withTenantTransaction } from '../tenancy.js';
import { getDirectives } from './behavior.js';
import { assertProgram, getSettings, providerState } from './policy.js';
import { profileSchema, canRunDailyReview } from './schemas.js';

export function localReviewTime(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return { day: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

/** One durable review per local day. Reuses the existing provider queue. */
export async function scheduleDailyReviews(at = new Date()) {
  const profiles = await db('CoachProfile').where({ status: 'complete' }).limit(1000);
  for (const row of profiles) {
    await withTenantTransaction(row.tenantId, async trx => {
      const current = await trx('CoachProfile').where({ id: row.id, tenantId: row.tenantId }).forUpdate().first();
      const parsed = profileSchema.safeParse(current?.data);
      if (!parsed.success || !canRunDailyReview(parsed.data, at)) return;
      const profile = parsed.data;
      const settings = await getSettings(trx, row.tenantId);
      const { directives } = await getDirectives(trx, row.tenantId, row.partnerId);
      if (!settings.enabled || settings.takeover.includes(row.partnerId) || !directives.dailyReviewEnabled) return;
      const time = localReviewTime(at, profile.timezone);
      if (time.hour < directives.dailyReviewHour) return;
      const partner = await trx('Partner').where({ tenantId: row.tenantId, id: row.partnerId }).first();
      const tenant = await trx('Tenant').where({ id: row.tenantId }).first();
      if (!partner?.activatedAt || partner.revokedAt || tenant?.status !== 'active' || tenant.pendingDeletionAt) return;
      if (!(await providerState(settings, trx, row.tenantId)).configured) return;
      const dedupeKey = `daily:${time.day}`;
      if (await trx('CoachRun').where({ tenantId: row.tenantId, partnerId: row.partnerId, dedupeKey }).first()) return;
      const quota = await trx('CoachRun').where({ tenantId: row.tenantId, partnerId: row.partnerId }).where('createdAt', '>', new Date(at.getTime() - 86400000)).count({ count: '*' }).first();
      if (Number(quota?.count ?? 0) >= settings.dailyRuns) return;
      const active = await trx('CoachRun').where({ tenantId: row.tenantId, partnerId: row.partnerId }).whereIn('status', ['queued', 'processing']).first();
      if (active) return;
      const grants = await trx('PartnerProgram').where({ tenantId: row.tenantId, partnerId: row.partnerId }).orderBy('id').limit(20);
      let programId: string | undefined;
      for (const grant of grants) {
        try { await assertProgram(trx, row.tenantId, row.partnerId, grant.programId); programId = grant.programId; break; } catch { /* Try another active program. */ }
      }
      if (!programId) return;
      const id = ulid();
      await trx('CoachRun').insert({ id, tenantId: row.tenantId, partnerId: row.partnerId, programId, status: 'queued', kind: 'daily', dedupeKey, data: JSON.stringify({ profileVersion: current.version, scheduledDay: time.day }) }).onConflict(['tenantId', 'partnerId', 'dedupeKey']).ignore();
      await trx('CoachAuditEvent').insert({ id: ulid(), tenantId: row.tenantId, partnerId: row.partnerId, status: 'daily_review_queued', data: JSON.stringify({ runId: id, day: time.day }) });
    });
  }
}
