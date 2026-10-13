import type { Knex } from 'knex';
import { assertPartner, assertProgram } from './policy.js';
import { profileSchema } from './schemas.js';
import { coachMetrics } from './analytics.js';
import { managementSnapshot } from './management.js';

/** Shared by the worker and the admin inspector: same scoped source of facts. */
export async function buildCoachContext(db: Knex, tenantId: string, partnerId: string, programId: string, days = 30) {
  const partner = await assertPartner(db, tenantId, partnerId);
  const program = await assertProgram(db, tenantId, partnerId, programId, false);
  const profileRow = await db('CoachProfile').where({ tenantId, partnerId }).first();
  const profile = profileRow?.status === 'complete' ? profileSchema.parse(profileRow.data) : null;
  const metrics = await coachMetrics(db, tenantId, partnerId, programId, days);
  const origin = (process.env.PUBLIC_ROUTER_URL ?? process.env.PORTAL_URL ?? 'http://127.0.0.1:5673').replace(/\/$/, '');
  const rawLinks = await db('Link').where({ tenantId, partnerId, programId }).orderBy('createdAt', 'desc').limit(100);
  const links = rawLinks.map(link => ({ id: link.id, key: link.linkKey, label: link.label, channel: link.channel, url: `${origin}/r/${encodeURIComponent(link.linkKey)}` }));
  const rawMessages = await db('CoachMessage').where({ tenantId, partnerId }).where(q => q.where({ programId }).orWhereNull('programId')).orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(24);
  const messages = rawMessages.reverse().map(m => ({ role: m.role, createdAt: m.createdAt, body: String(m.data.body ?? '').slice(0, 1200) }));
  const rawKnowledge = await db('CoachKnowledgeItem').where({ tenantId, status: 'approved' }).orderBy('updatedAt', 'desc').limit(6);
  const knowledge = rawKnowledge.map(k => ({ id: k.id, version: k.version, title: k.data.title, body: String(k.data.body ?? '').slice(0, 1500), source: k.data.source }));
  const snapshot = await db('CoachForecastSnapshot').where({ tenantId, partnerId, programId, status: 'confirmed' }).orderBy('createdAt', 'desc').first();
  const forecast = snapshot ? { source: 'confirmed_forecast_not_actual', modelHash: snapshot.data.modelHash, verified: snapshot.data.verified, commission: snapshot.data.commission, createdAt: snapshot.createdAt,
    settings: snapshot.data.settings,
    scenarios: snapshot.data.scenarios.map((s: { scenario: string; result: { months: Array<{ reward: number; cumulative: number }> } }) => ({ scenario: s.scenario, month3: s.result.months[2]?.reward, month12: s.result.months[11]?.reward, yearTotal: s.result.months[11]?.cumulative })) } : null;
  const rawTasks = await db('CoachTask').where({ tenantId, partnerId, programId }).whereNotIn('status', ['cancelled', 'skipped']).orderBy('updatedAt', 'desc').limit(12);
  const currentTasks = rawTasks.map(t => ({ id: t.id, status: t.status, minutes: t.minutes, dueAt: t.dueAt, updatedAt: t.updatedAt, title: String(t.data.title ?? '').slice(0, 200), format: t.data.format, platform: t.data.platform, draft: String(t.data.draft ?? '').slice(0, 700), criteria: String(t.data.criteria ?? '').slice(0, 300), submission: t.data.submission ? { text: String(t.data.submission.text ?? '').slice(0, 1000), publicationUrl: t.data.submission.publicationUrl } : null }));
  const rawActivity = await db('CoachAuditEvent').where({ tenantId, partnerId }).orderBy('createdAt', 'desc').limit(15);
  const recentActivity = rawActivity.map(a => ({ action: a.status, at: a.createdAt }));
  const plan = await db('CoachPlan').where({ tenantId, partnerId, programId, status: 'active' }).orderBy('createdAt', 'desc').first();
  const lastReview = await db('CoachRun').where({ tenantId, partnerId, programId, kind: 'daily', status: 'completed' }).orderBy('createdAt', 'desc').first();
  const previousReview = lastReview?.data.metrics ? { at: lastReview.updatedAt, period: lastReview.data.metrics.period, counts: lastReview.data.metrics.counts, amountsMinor: lastReview.data.metrics.amountsMinor, comparison: 'rolling_windows_not_daily_delta' } : null;
  const snapshotManagement = await managementSnapshot(db, tenantId, partnerId, programId);
  const rawReviews = await db('CoachReview').where({ tenantId, partnerId, programId }).orderBy('createdAt', 'desc').limit(8);
  const timezone = profile?.timezone ?? 'UTC';
  const formatLocal = (date: Date|string) => `${new Intl.DateTimeFormat('ru-RU', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(date))} (${timezone})`;
  const localTask = (task: typeof snapshotManagement.tasks[number]) => ({ ...task, dueAtLocal: task.dueAt ? formatLocal(task.dueAt) : null });
  const management = { ...snapshotManagement,
    clock: { timezone, now: snapshotManagement.generatedAt, nowLocal: formatLocal(snapshotManagement.generatedAt) },
    nextTask: snapshotManagement.nextTask ? localTask(snapshotManagement.nextTask) : null,
    tasks: snapshotManagement.tasks.slice(0, 30).map(localTask), tasksTruncated: snapshotManagement.tasks.length > 30, recentReviews: rawReviews.map(review => ({ taskId: review.taskId, status: review.status, at: review.createdAt, feedback: String(review.data.message ?? '').slice(0, 1500) })) };
  return { partner: { name: partner.name }, profile, metrics, links, knowledge, messages, forecast, currentTasks, recentActivity, management,
    previousReview,
    activePlan: plan ? { weekStart: plan.weekStart, plannedMinutes: plan.data.plannedMinutes, summary: String(plan.data.message ?? '').slice(0, 600) } : null,
    program: { name: program.name, commissionRule: program.commissionRule, attributionWindowDays: program.attributionWindowDays } };
}
