import type { Knex } from 'knex';
import { CoachError } from './schemas.js';
import { saveCoachConfig } from './behavior.js';
import { actionableStatuses } from './management.js';

export function localDay(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Calendar midnight in the partner's timezone, including 23/25-hour days. */
export function todayWindow(timezone: string, at = new Date()) {
  const day = localDay(at, timezone);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  let low = Math.floor((midnight - 36 * 3600000) / 1000);
  let high = Math.ceil((midnight + 36 * 3600000) / 1000);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (localDay(new Date(middle * 1000), timezone) < day) low = middle + 1;
    else high = middle;
  }
  return { day, timezone, since: new Date(low * 1000), until: at };
}

const planKey = (partnerId: string, programId: string, day: string) => `coach_daily_plan:${partnerId}:${programId}:${day}`;
const submittedStatuses = ['submitted', 'reviewing', 'needs_human', 'completed'];
interface SavedDay { version: number; taskIds: string[]; targetMinutes: number; day: string; timezone: string }

export async function dailyPlan(db: Knex, tenantId: string, partnerId: string, programId: string, timezone: string, sessionMinutes: number, at = new Date()) {
  const period = todayWindow(timezone, at);
  const saved = await db('Config').where({ tenantId, key: planKey(partnerId, programId, period.day) }).first();
  const selection = saved?.value as SavedDay | undefined;
  const selectedIds = selection?.taskIds ?? [];
  const rows = await db('CoachTask').where({ tenantId, partnerId, programId })
    .where(q => q.whereIn('status', actionableStatuses).orWhereIn('id', selectedIds))
    .orderBy('dueAt').orderBy('id').limit(200);
  const simplify = (task: typeof rows[number]) => ({ id: task.id, title: String(task.data.title ?? 'Задание'), minutes: task.minutes, status: task.status, dueAt: task.dueAt, format: task.data.format, platform: task.data.platform });
  const tasks = selectedIds.map(id => rows.find(task => task.id === id)).filter((task): task is typeof rows[number] => Boolean(task)).map(simplify);
  const candidates = rows.filter(task => actionableStatuses.includes(task.status)).map(simplify);
  const targetMinutes = selection?.targetMinutes ?? Math.max(1, Math.min(240, sessionMinutes));
  let remaining = targetMinutes;
  const suggestedTaskIds: string[] = [];
  for (const task of candidates) if (task.minutes <= remaining && suggestedTaskIds.length < 12) { suggestedTaskIds.push(task.id); remaining -= task.minutes; }
  const submitted = tasks.filter(task => submittedStatuses.includes(task.status)).length;
  const confirmed = tasks.filter(task => task.status === 'completed').length;
  return { ...period, programId, version: selection?.version ?? 0, saved: Boolean(selection), targetMinutes, taskIds: selectedIds, tasks, candidates, suggestedTaskIds,
    progress: { total: tasks.length, submitted, confirmed, stars: submitted, plannedMinutes: tasks.reduce((sum, task) => sum + task.minutes, 0) } };
}

export async function saveDailyPlan(db: Knex, tenantId: string, partnerId: string, timezone: string,
  input: { programId: string; day: string; version: number; targetMinutes: number; taskIds: string[] }, at = new Date()) {
  if (input.day !== localDay(at, timezone)) throw new CoachError('day_changed', 409, 'Начался новый день. Обновите список задач.');
  if (new Set(input.taskIds).size !== input.taskIds.length) throw new CoachError('duplicate_tasks', 422, 'Каждое задание можно добавить в день только один раз.');
  // Serialize version checks and validation with other edits of this day.
  await db('Tenant').where({ id: tenantId }).forUpdate().first();
  const key = planKey(partnerId, input.programId, input.day);
  const old = await db('Config').where({ tenantId, key }).first();
  if (Number(old?.value?.version ?? 0) !== input.version) throw new CoachError('version_conflict', 409, 'План на сегодня уже изменён. Обновите его.');
  const oldIds: string[] = old?.value?.taskIds ?? [];
  const rows = await db('CoachTask').where({ tenantId, partnerId, programId: input.programId }).whereIn('id', [...new Set([...oldIds, ...input.taskIds])]).forUpdate();
  const chosen = input.taskIds.map(id => rows.find(task => task.id === id));
  if (chosen.some(task => !task)) throw new CoachError('task_not_owned', 403, 'Можно выбрать только свои задания этой программы.');
  if (chosen.some(task => !actionableStatuses.includes(task!.status) && !oldIds.includes(task!.id))) throw new CoachError('task_not_available', 409, 'Выберите незавершённые задания из своего плана.');
  if (rows.some(task => oldIds.includes(task.id) && submittedStatuses.includes(task.status) && !input.taskIds.includes(task.id))) throw new CoachError('submitted_task_locked', 409, 'Отправленные результаты остаются в итогах сегодняшнего дня.');
  if (chosen.reduce((sum, task) => sum + task!.minutes, 0) > input.targetMinutes) throw new CoachError('daily_time_exceeded', 422, 'Выбранные задания не помещаются в ваше время на сегодня.');
  await saveCoachConfig(db, tenantId, key, input.version, { day: input.day, timezone, programId: input.programId, targetMinutes: input.targetMinutes, taskIds: input.taskIds });
}
