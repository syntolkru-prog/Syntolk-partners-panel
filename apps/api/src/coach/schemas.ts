import { z } from 'zod';

export class CoachError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export const formats = ['post', 'circle', 'short', 'long', 'article'] as const;
export const profileSchema = z.object({
  goalMinor: z.number().int().min(100).max(100_000_000),
  goalMetric: z.enum(['monthly_net_accrual', 'monthly_paid']),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Некорректная дата'),
  weeklyMinutes: z.number().int().min(0).max(10080),
  sessionMinutes: z.number().int().min(10).max(240),
  daysPerWeek: z.number().int().min(1).max(7),
  timezone: z.string().max(80).refine(v => { try { new Intl.DateTimeFormat('ru', { timeZone: v }).format(); return true; } catch { return false; } }, 'Некорректный часовой пояс'),
  channels: z.array(z.object({ platform: z.enum(['telegram', 'vk', 'youtube', 'blog', 'email', 'other']), label: z.string().trim().min(1).max(120), formats: z.array(z.enum(formats)).min(1).max(5), audience: z.string().max(1500), views: z.number().int().min(0).max(100_000_000).nullable() }).strict()).max(10),
  experience: z.enum(['new', 'tried', 'regular']),
  productUnderstanding: z.string().max(3000),
  preferences: z.string().max(3000),
  mode: z.enum(['on_request', 'gentle', 'active', 'paused', 'off']),
  quietStart: z.number().int().min(0).max(23), quietEnd: z.number().int().min(0).max(23),
  proactiveConsent: z.boolean(),
  aiConsent: z.boolean().default(false),
}).strict();
export type CoachProfile = z.infer<typeof profileSchema>;
export const taskProposalSchema = z.object({
  title: z.string().min(1).max(200), format: z.enum(formats), platform: z.string().min(1).max(40),
  minutes: z.number().int().min(1).max(240),
  steps: z.array(z.object({ title: z.string().min(1).max(500), minutes: z.number().int().min(1).max(240) }).strict()).min(1).max(8),
  draft: z.string().max(8000), criteria: z.string().min(1).max(2000),
}).strict();
export const outputSchema = z.object({
  message: z.string().min(1).max(10000), tasks: z.array(taskProposalSchema).max(7),
  verdict: z.enum(['not_applicable', 'changes_requested', 'needs_human', 'reviewed']),
  limitations: z.array(z.string().max(1000)).max(10),
}).strict();
export type CoachOutput = z.infer<typeof outputSchema>;
export function validatePlan(tasks: CoachOutput['tasks'], profile: CoachProfile): void {
  if (!tasks.length) throw new CoachError('invalid_plan', 422, 'В плане нет заданий.');
  const total = tasks.reduce((sum, t) => sum + t.minutes, 0);
  if (total > profile.weeklyMinutes || tasks.length > profile.daysPerWeek) throw new CoachError('invalid_plan', 422, 'План превышает доступное время или число рабочих дней.');
  for (const task of tasks) {
    if (task.minutes > profile.sessionMinutes || task.steps.reduce((s, step) => s + step.minutes, 0) !== task.minutes) throw new CoachError('invalid_plan', 422, 'Время шагов не соответствует заданию.');
    if (profile.channels.length && !profile.channels.some(c => c.platform === task.platform && c.formats.includes(task.format))) throw new CoachError('invalid_plan', 422, 'Формат недоступен на выбранной площадке.');
    if (!profile.channels.length && task.platform !== 'preparation') throw new CoachError('invalid_plan', 422, 'Сначала выберите доступную площадку.');
  }
}
export function shouldRemind(profile: CoachProfile, at: Date): boolean {
  if (!profile.proactiveConsent || !['gentle', 'active'].includes(profile.mode)) return false;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: profile.timezone, hour: '2-digit', hourCycle: 'h23' }).format(at));
  const { quietStart: s, quietEnd: e } = profile;
  const quiet = s === e ? false : s < e ? hour >= s && hour < e : hour >= s || hour < e;
  return !quiet;
}
export function safePublicationUrl(value: string): string {
  let u: URL;
  try { u = new URL(value); } catch { throw new CoachError('invalid_url', 422, 'Нужна корректная HTTPS-ссылка.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new CoachError('invalid_url', 422, 'Нужна публичная HTTPS-ссылка без логина и пароля.');
  return u.toString();
}
