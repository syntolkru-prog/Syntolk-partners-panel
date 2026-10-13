import type { Knex } from 'knex';
import { defaultManagement, effectiveBehavior, getBehavior, getDirectives, type CoachBehavior } from './behavior.js';

export type ManagementPolicy = CoachBehavior['management'];
export interface ManagedTask {
  id: string; programId?: string; status: string; dueAt: Date|string|null; updatedAt: Date|string; version?: number;
  data: { title?: string; criteria?: string; reason?: string; submission?: { receivedAt?: string }; checkIns?: Array<{ at: string; state: string; text: string }>; rescheduleHistory?: Array<{ at: string; reason: string; from: string|null; to: string }> };
}
export const actionableStatuses = ['planned', 'in_progress', 'changes_requested'];
const reviewStatuses = ['reviewing', 'submitted', 'needs_human'];

export async function managementPolicy(db: Knex, tenantId: string, partnerId: string) {
  const [{ behavior }, { directives }] = await Promise.all([getBehavior(db, tenantId), getDirectives(db, tenantId, partnerId)]);
  return effectiveBehavior(behavior, directives).management;
}

/** Computed from durable task facts, never from the model's claims of success. */
export function summarizeManagement(tasks: ManagedTask[], policy: ManagementPolicy = defaultManagement, at = new Date()) {
  const items = tasks.map(task => {
    const due = task.dueAt ? new Date(task.dueAt).getTime() : NaN;
    const overdueHours = actionableStatuses.includes(task.status) && Number.isFinite(due) ? Math.max(0, (at.getTime() - due) / 3600000) : 0;
    const lastCheckIn = task.data.checkIns?.at(-1) ?? null;
    const reschedules = task.data.rescheduleHistory?.length ?? 0;
    const received = new Date(task.data.submission?.receivedAt ?? task.updatedAt).getTime();
    const waitingHours = reviewStatuses.includes(task.status) && Number.isFinite(received) ? Math.max(0, (at.getTime() - received) / 3600000) : 0;
    const reasons = [overdueHours >= policy.escalationHours ? 'Длительная просрочка' : '', actionableStatuses.includes(task.status) && reschedules > policy.maxReschedules ? 'Превышен лимит переносов' : '', waitingHours >= policy.reviewSlaHours ? 'Просрочена проверка менеджером' : '', lastCheckIn?.state === 'blocked' && actionableStatuses.includes(task.status) ? 'Партнёр сообщил о препятствии' : '', task.status === 'skipped' ? `Отказ от задания: ${task.data.reason || 'причина не указана'}` : ''].filter(Boolean);
    return { id: task.id, programId: task.programId, version: task.version, title: task.data.title ?? 'Задание', status: task.status, dueAt: task.dueAt, criteria: task.data.criteria ?? '', overdueHours: Math.floor(overdueHours), overdue: overdueHours > 0, waitingHours: Math.floor(waitingHours), reschedules, lastCheckIn, needsManager: reasons.length > 0, reasons };
  });
  const open = items.filter(task => actionableStatuses.includes(task.status));
  const priority = [...open].sort((a, b) => Number(b.needsManager) - Number(a.needsManager) || Number(b.overdue) - Number(a.overdue) || new Date(a.dueAt ?? at).getTime() - new Date(b.dueAt ?? at).getTime());
  return { generatedAt: at.toISOString(), policy, counts: { open: open.length, overdue: open.filter(t => t.overdue).length, waitingReview: items.filter(t => reviewStatuses.includes(t.status)).length, completed: items.filter(t => t.status === 'completed').length, needsManager: items.filter(t => t.needsManager).length }, nextTask: priority[0] ?? null, tasks: items };
}

export async function managementSnapshot(db: Knex, tenantId: string, partnerId: string, programId?: string, at = new Date()) {
  const query = db('CoachTask').where({ tenantId, partnerId }).where(q => q.whereNotIn('status', ['completed', 'cancelled', 'skipped']).orWhere('updatedAt', '>=', new Date(at.getTime() - 30 * 86400000))).orderBy('dueAt');
  if (programId) query.andWhere({ programId });
  const [tasks, policy] = await Promise.all([query, managementPolicy(db, tenantId, partnerId)]);
  const summary = summarizeManagement(tasks, policy, at);
  return { ...summary, completedPeriodDays: 30 };
}
