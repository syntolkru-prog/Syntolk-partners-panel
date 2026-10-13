import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ulid } from 'ulid';
import { requireAuth, requireAdmin } from '../auth.js';
import { tenantOf, withTenantTransaction } from '../tenancy.js';
import { CoachError, profileSchema, safePublicationUrl } from '../coach/schemas.js';
import { getSettings, providerState, assertPartner, assertProgram } from '../coach/policy.js';
import { auditCoach } from '../coach/worker.js';
import { coachMetrics } from '../coach/analytics.js';
import { calculateCoachForecast } from '../coach/forecast-adapter.js';
import { createPartnerLink, LinkError } from '../links-service.js';
import { connectionInput, listRouterModels, publicRouterConnection, recordRouterVerification, removeRouterConnection, resolveRouterCredentials, saveRouterConnection, testRouterConnection } from '../coach/connections.js';
import rateLimit from 'express-rate-limit';
import { welcomeMessage } from '../coach/welcome.js';
import { assertOwnContentLinks } from '../coach/content-links.js';
import { behaviorSchema, directivesSchema, effectiveBehavior, getBehavior, getDirectives, saveCoachConfig } from '../coach/behavior.js';
import { buildCoachContext } from '../coach/context.js';
import { actionableStatuses, managementPolicy, managementSnapshot, summarizeManagement } from '../coach/management.js';

function owner(req: Request) {
  const { db, tenantId } = tenantOf(req), p = req.principal;
  const partnerId = p?.role === 'partner' ? p.partnerId : p?.role === 'admin' ? req.params.partnerId : null;
  if (!partnerId || (p?.role === 'partner' && req.params.partnerId && req.params.partnerId !== p.partnerId)) throw new CoachError('forbidden', 403, 'Выберите своего партнёра.');
  return { db, tenantId, partnerId };
}
function csrf(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.header('authorization')) return next();
  const allowed = [process.env.PORTAL_URL, ...(process.env.CORS_EXTRA_ORIGINS ?? '').split(','), ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5673', 'http://127.0.0.1:5673'])].filter(Boolean).map(v => v!.replace(/\/$/, ''));
  if (!req.header('origin') || !allowed.includes(req.header('origin')!)) return void res.status(403).json({ error: 'csrf_rejected', detail: 'Недопустимый источник запроса.' });
  next();
}
function errors(error: unknown, _req: Request, res: Response, next: NextFunction) {
  if (error instanceof CoachError || error instanceof LinkError) return void res.status(error.status).json({ error: error.code, detail: error.message });
  if (error instanceof z.ZodError) return void res.status(422).json({ error: 'invalid_body', detail: 'Проверьте заполненные поля.', fields: error.flatten() });
  next(error);
}
const versionBody = z.object({ version: z.number().int().positive() });
async function profileFor(req: Request) {
  const s = owner(req);
  const row = await s.db('CoachProfile').where({ tenantId: s.tenantId, partnerId: s.partnerId }).forUpdate().first();
  if (!row || row.status !== 'complete') throw new CoachError('onboarding_incomplete', 409, 'Сначала заполните и подтвердите знакомство.');
  return { ...s, row, profile: profileSchema.parse(row.data) };
}
async function enqueue(req: Request, kind: string, input: { programId: string; requestId: string; [key: string]: unknown }) {
  const s = await profileFor(req);
  const settings = await getSettings(s.db, s.tenantId);
  if (settings.takeover.includes(s.partnerId)) throw new CoachError('human_takeover', 409, 'Сопровождение ведёт менеджер. Напишите ему в чате.');
  if (['off', 'paused'].includes(s.profile.mode)) throw new CoachError('coach_paused', 409, 'Возобновите сопровождение в настройках.');
  if (!(await providerState(settings, s.db, s.tenantId)).configured) throw new CoachError('provider_not_configured', 503, 'Администратору нужно настроить и проверить подключение ИИ.');
  await assertProgram(s.db, s.tenantId, s.partnerId, input.programId);
  const old = await s.db('CoachRun').where({ tenantId: s.tenantId, partnerId: s.partnerId, dedupeKey: `${kind}:${input.requestId}` }).first();
  if (old) {
    if (old.programId !== input.programId || (old.data.message ?? '') !== (input.message ?? '') || (old.data.taskId ?? '') !== (input.taskId ?? '') || (old.data.weekStart ?? '') !== (input.weekStart ?? '')) throw new CoachError('idempotency_conflict',409,'Этот идентификатор уже использован для другого запроса.');
    return old;
  }
  if (kind === 'plan' && (await managementPolicy(s.db, s.tenantId, s.partnerId)).preventPlanReplacement) {
    const unfinished = await s.db('CoachTask').where({ tenantId: s.tenantId, partnerId: s.partnerId, programId: input.programId }).whereNotIn('status', ['completed', 'cancelled', 'skipped']).first();
    if (unfinished) throw new CoachError('unfinished_work', 409, 'Сначала завершите или согласуйте отмену текущей работы. Новый платный запрос плана пока не нужен.');
  }
  const counts = await s.db('CoachRun').where({ tenantId: s.tenantId, partnerId: s.partnerId }).where('createdAt', '>', new Date(Date.now() - 86400000)).count({ count: '*' }).first();
  if (Number(counts?.count ?? 0) >= settings.dailyRuns) throw new CoachError('budget_exceeded', 429, 'Дневной лимит обращений исчерпан. Сохранённые планы доступны.');
  const active = await s.db('CoachRun').where({ tenantId: s.tenantId, partnerId: s.partnerId }).whereIn('status', ['queued', 'processing']).count({ count: '*' }).first();
  if (Number(active?.count ?? 0) >= 2) throw new CoachError('rate_limited', 429, 'Дождитесь завершения текущих запросов.');
  const [run] = await s.db('CoachRun').insert({ id: ulid(), tenantId: s.tenantId, partnerId: s.partnerId, programId: input.programId, status: 'queued', kind, dedupeKey: `${kind}:${input.requestId}`, data: JSON.stringify({ ...input, profileVersion: s.row.version }) }).returning('*');
  await auditCoach(s.db, s.tenantId, s.partnerId, 'run_queued', { runId: run.id, kind, actor: req.principal?.role });
  return run;
}

const partnerCoach = Router({ mergeParams: true });
partnerCoach.use(requireAuth, csrf, async (req, _res, next) => {
  const s = owner(req);
  await assertPartner(s.db, s.tenantId, s.partnerId);
  const settings = await getSettings(s.db, s.tenantId);
  if (req.method !== 'GET' && !settings.enabled) throw new CoachError('coach_disabled', 409, 'ИИ-куратор отключён администратором.');
  next();
});
partnerCoach.get('/', async (req, res) => {
  const s = owner(req);
  const [profile, settings, programs, behavior] = await Promise.all([
    s.db('CoachProfile').where({ tenantId: s.tenantId, partnerId: s.partnerId }).first(), getSettings(s.db, s.tenantId),
    s.db('PartnerProgram as g').join('Program as p', 'p.id', 'g.programId').where({ 'g.tenantId': s.tenantId, 'g.partnerId': s.partnerId, 'p.tenantId': s.tenantId }).select('p.id', 'p.name', 'p.commissionRule', 'p.destinationUrl'),
    getBehavior(s.db, s.tenantId),
  ]);
  res.json({ profile: profile ?? null, programs, interviewQuestions: behavior.behavior.interviewQuestions, assistant: { name: behavior.behavior.name, greeting: behavior.behavior.greeting, mascotEnabled: behavior.behavior.mascotEnabled }, enabled: settings.enabled, schedulerEnabled:process.env.COACH_SCHEDULER_ENABLED==='1', takeover: settings.takeover.includes(s.partnerId), ...await providerState(settings, s.db, s.tenantId) });
});
partnerCoach.get('/welcome', async (req, res) => {
  const s = owner(req);
  const partner = await assertPartner(s.db, s.tenantId, s.partnerId);
  const settings = await getSettings(s.db, s.tenantId);
  const row = await s.db('CoachProfile').where({tenantId:s.tenantId,partnerId:s.partnerId}).first();
  const profile = row?.status === 'complete' ? profileSchema.parse(row.data) : undefined;
  const task = await s.db('CoachTask').where({tenantId:s.tenantId,partnerId:s.partnerId}).whereIn('status',['planned','in_progress','changes_requested']).orderBy('dueAt').first();
  const paused = !!profile && ['off','paused'].includes(profile.mode);
  const { behavior } = await getBehavior(s.db, s.tenantId);
  const { directives } = await getDirectives(s.db, s.tenantId, s.partnerId);
  res.json({enabled:settings.enabled,paused,needsOnboarding:!profile,takeover:settings.takeover.includes(s.partnerId),message:welcomeMessage(partner.name,profile,task?.data.title,settings.takeover.includes(s.partnerId),effectiveBehavior(behavior,directives)),task:task?{title:task.data.title,minutes:task.minutes}:null});
});
partnerCoach.patch('/profile', async (req, res) => {
  const body = z.object({ version: z.number().int().min(0), profile: profileSchema, complete: z.boolean() }).strict().parse(req.body);
  const s = owner(req);
  // Serialize both first creation and later edits for this owner.
  if (body.complete && body.profile.onboardingVersion === 1) {
    const { behavior } = await getBehavior(s.db, s.tenantId);
    const missing = behavior.interviewQuestions.filter(q => q.required && !body.profile.interviewAnswers.some(a => a.id === q.id && a.answer.trim()));
    if (missing.length) throw new CoachError('interview_incomplete', 422, `Ответьте своими словами: ${missing.map(q => q.question).join(' ')}`);
    // Snapshot the admin's actual question, not a replacement supplied by a client.
    body.profile.interviewAnswers = body.profile.interviewAnswers.map(answer => ({ ...answer, question: behavior.interviewQuestions.find(q => q.id === answer.id)?.question ?? answer.question }));
  }
  await s.db('Partner').where({ tenantId: s.tenantId, id: s.partnerId }).forUpdate().first();
  const old = await s.db('CoachProfile').where({ tenantId: s.tenantId, partnerId: s.partnerId }).first();
  if ((old?.version ?? 0) !== body.version) throw new CoachError('version_conflict', 409, 'Анкета уже изменена. Обновите страницу.');
  const value = { status: body.complete ? 'complete' : 'draft', version: body.version + 1, data: JSON.stringify(body.profile), updatedAt: new Date() };
  const [row] = old ? await s.db('CoachProfile').where({ id: old.id }).update(value).returning('*') : await s.db('CoachProfile').insert({ ...value, id: ulid(), tenantId: s.tenantId, partnerId: s.partnerId }).returning('*');
  await auditCoach(s.db, s.tenantId, s.partnerId, 'profile_updated', { version: row.version, mode: body.profile.mode, actor: req.principal?.role });
  res.json({ profile: row });
});
partnerCoach.post('/plans/generate', async (req, res) => {
  const body = z.object({ programId: z.string().min(1), requestId: z.string().min(8).max(100), weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().parse(req.body);
  res.status(202).json({ run: await enqueue(req, 'plan', body) });
});
partnerCoach.post('/weekly-review',async(req,res)=>{const body=z.object({programId:z.string().min(1),requestId:z.string().min(8).max(100)}).strict().parse(req.body);res.status(202).json({run:await enqueue(req,'weekly',body)});});
partnerCoach.get('/plans', async (req, res) => { const s = owner(req); res.json({ plans: await s.db('CoachPlan').where({ tenantId: s.tenantId, partnerId: s.partnerId }).orderBy('createdAt', 'desc').limit(30) }); });
partnerCoach.post('/plans/:id/accept', async (req, res) => {
  const body = versionBody.parse(req.body), s = await profileFor(req);
  const plan = await s.db('CoachPlan').where({ id: req.params.id, tenantId: s.tenantId, partnerId: s.partnerId }).forUpdate().first();
  if (!plan) throw new CoachError('not_found', 404, 'План не найден.');
  if (plan.status === 'active') return res.json({ plan, replayed: true });
  if (plan.version !== body.version || plan.status !== 'draft' || plan.data.profileVersion !== s.row.version) throw new CoachError('version_conflict', 409, 'План или анкета изменились. Создайте актуальный план.');
  await assertProgram(s.db, s.tenantId, s.partnerId, plan.programId);
  const { validatePlan } = await import('../coach/schemas.js'); validatePlan(plan.data.tasks, s.profile);
  const policy = await managementPolicy(s.db, s.tenantId, s.partnerId);
  const unfinished = await s.db('CoachTask').where({ tenantId: s.tenantId, partnerId: s.partnerId, programId: plan.programId }).whereNotIn('status', ['completed', 'cancelled', 'skipped']).first();
  if (policy.preventPlanReplacement && unfinished) throw new CoachError('unfinished_work', 409, 'Сначала завершите текущую работу или явно согласуйте её отмену: новый план не должен скрывать незавершённые задания.');
  await s.db('CoachPlan').where({ tenantId: s.tenantId, partnerId: s.partnerId, programId: plan.programId, status: 'active' }).update({ status: 'superseded', updatedAt: new Date() });
  await s.db('CoachTask').where({ tenantId: s.tenantId, partnerId: s.partnerId, programId: plan.programId }).whereIn('status', ['planned', 'in_progress', 'changes_requested']).update({ status: 'cancelled', updatedAt: new Date() });
  for (const [i, task] of plan.data.tasks.entries()) await s.db('CoachTask').insert({ id: ulid(), tenantId: s.tenantId, partnerId: s.partnerId, programId: plan.programId, planId: plan.id, status: 'planned', minutes: task.minutes, dueAt: new Date(Date.now() + policy.deadlineHours * 3600000 + i * 86400000), data: JSON.stringify(task) });
  await s.db('CoachPlan').where({ id: plan.id }).update({ status: 'active', version: plan.version + 1, updatedAt: new Date() });
  await auditCoach(s.db, s.tenantId, s.partnerId, 'plan_accepted', { planId: plan.id, actor: req.principal?.role });
  res.json({ ok: true });
});
partnerCoach.get('/tasks', async (req, res) => {
  const s = owner(req);
  const tasks = await s.db('CoachTask').where({ tenantId: s.tenantId, partnerId: s.partnerId }).orderBy('dueAt','asc').orderBy('createdAt', 'asc').limit(100);
  const placements = await s.db('CoachPlacement as p').join('Link as l', 'l.id', 'p.linkId').where({ 'p.tenantId': s.tenantId, 'p.partnerId': s.partnerId, 'l.tenantId': s.tenantId, 'l.partnerId': s.partnerId }).select('p.taskId', 'p.id', 'l.linkKey');
  const origin = (process.env.PUBLIC_ROUTER_URL ?? process.env.PORTAL_URL ?? 'http://127.0.0.1:5673').replace(/\/$/, '');
  res.json({ tasks: tasks.map(t => ({ ...t, placement: placements.find(p => p.taskId === t.id) ?? null })), routerOrigin: origin, policy: await managementPolicy(s.db, s.tenantId, s.partnerId) });
});
partnerCoach.get('/management', async (req, res) => {
  const s = owner(req), programId = z.string().min(1).optional().parse(req.query.programId);
  if (programId) await assertProgram(s.db, s.tenantId, s.partnerId, programId, false);
  res.json(await managementSnapshot(s.db, s.tenantId, s.partnerId, programId));
});
partnerCoach.post('/tasks/:id/:action', async (req, res, next) => {
  if (!['start', 'skip', 'reschedule', 'prepare-link', 'submit', 'check-in'].includes(req.params.action!)) return next();
  const body = z.object({ version: z.number().int().positive(), requestId: z.string().min(8).max(100).optional(), text: z.string().trim().max(8000).optional(), publicationUrl: z.string().max(2048).optional(), dueAt: z.string().datetime().optional(), reason: z.string().trim().max(1000).optional(), state: z.enum(['progress', 'blocked']).optional() }).strict().parse(req.body);
  const s = await profileFor(req);
  const task = await s.db('CoachTask').where({ id: req.params.id, tenantId: s.tenantId, partnerId: s.partnerId }).forUpdate().first();
  if (!task) throw new CoachError('not_found', 404, 'Задание не найдено.');
  await assertProgram(s.db, s.tenantId, s.partnerId, task.programId);
  const policy = await managementPolicy(s.db, s.tenantId, s.partnerId);
  if(req.params.action==='submit'&&body.requestId){const old=await s.db('CoachRun').where({tenantId:s.tenantId,partnerId:s.partnerId,dedupeKey:`review:${body.requestId}`}).first();if(old){if(old.data.taskId!==task.id||old.data.message!==body.text)throw new CoachError('idempotency_conflict',409,'Этот запрос уже использован.');return res.status(202).json({run:old,replayed:true});}}
  if (['cancelled', 'completed', 'skipped'].includes(task.status)) throw new CoachError('version_conflict', 409, 'Задание уже завершено или отменено.');
  if (req.params.action === 'prepare-link') {
    const old = await s.db('CoachPlacement').where({ tenantId: s.tenantId, partnerId: s.partnerId, taskId: task.id }).first();
    if (old) return res.json({ placement: old, replayed: true });
  }
  if (task.version !== body.version) throw new CoachError('version_conflict', 409, 'Задание изменено. Обновите данные.');
  if (req.params.action === 'check-in') {
    if (!body.text?.trim() || !body.state) throw new CoachError('invalid_body', 422, 'Напишите, что сделано или где нужна помощь.');
    if (!actionableStatuses.includes(task.status)) throw new CoachError('version_conflict', 409, 'Отчёт доступен только по незавершённой работе.');
    const history = task.data.checkIns ?? [];
    if (history.length >= 50) throw new CoachError('revision_limit', 422, 'Для продолжения нужен разбор менеджера.');
    const checkIn = { at: new Date().toISOString(), state: body.state, text: body.text.slice(0, 3000) };
    await s.db('CoachTask').where({ id: task.id, tenantId: s.tenantId }).update({ version: task.version + 1, data: JSON.stringify({ ...task.data, checkIns: [...history, checkIn] }), updatedAt: new Date() });
    await auditCoach(s.db, s.tenantId, s.partnerId, 'task_check_in', { taskId: task.id, state: body.state });
    return res.json({ ok: true });
  }
  if (req.params.action === 'prepare-link') {
    const link = await createPartnerLink(s.db, s.tenantId, s.partnerId, false, { programId: task.programId, linkKey: `st-${ulid().toLowerCase()}`, label: String(task.data.title).slice(0,120), channel: task.data.platform });
    const [placement] = await s.db('CoachPlacement').insert({ id: ulid(), tenantId: s.tenantId, partnerId: s.partnerId, programId: task.programId, taskId: task.id, linkId: link.id, status: 'prepared', data: '{}' }).returning('*');
    await auditCoach(s.db, s.tenantId, s.partnerId, 'link_prepared', { taskId: task.id, linkId: link.id });
    return res.json({ placement, link });
  }
  if (req.params.action === 'submit') {
    if (!body.requestId || !body.text) throw new CoachError('invalid_body', 422, 'Добавьте текст результата и идентификатор отправки.');
    if (!['planned', 'in_progress', 'changes_requested', 'submitted', 'needs_human'].includes(task.status)) throw new CoachError('version_conflict', 409, 'Проверка уже выполняется.');
    const publicationUrl = body.publicationUrl ? safePublicationUrl(body.publicationUrl) : null;
    if (policy.requirePublicationUrl && task.data.platform !== 'preparation' && !publicationUrl) throw new CoachError('publication_required', 422, 'Для этого задания нужна ссылка на публикацию.');
    await assertOwnContentLinks(s.db,s.tenantId,s.partnerId,body.text);
    const history = [...(task.data.submissionHistory ?? []), ...(task.data.submission ? [task.data.submission] : [])];
    if (history.length >= 50) throw new CoachError('revision_limit',422,'Сохранено 50 версий материала. Обратитесь к менеджеру, чтобы продолжить.');
    const submissionVersion = (task.data.submission?.submissionVersion ?? 0) + 1;
    const run = await enqueue(req, 'review', { programId: task.programId, requestId: body.requestId, taskId: task.id, taskVersion: task.version + 1, evidence: { text: body.text, publicationUrl, taskCriteria: task.data.criteria, submissionVersion }, message: body.text });
    await s.db('CoachTask').where({ id: task.id }).update({ status: 'reviewing', version: task.version + 1, data: JSON.stringify({ ...task.data, submissionHistory:history, submission: { submissionVersion, text: body.text, publicationUrl, receivedAt: new Date(), verificationLevel: 'self_reported' } }), updatedAt: new Date() });
    return res.status(202).json({ run });
  }
  if (!['planned', 'in_progress', 'changes_requested', 'needs_human', 'submitted'].includes(task.status)) throw new CoachError('version_conflict', 409, 'Сейчас действие недоступно.');
  if (['start', 'reschedule', 'skip'].includes(req.params.action!) && !actionableStatuses.includes(task.status)) throw new CoachError('version_conflict', 409, 'Работа уже отправлена: дождитесь проверки, не меняйте её статус.');
  if (['skip', 'reschedule'].includes(req.params.action!) && policy.requireReason && !body.reason) throw new CoachError('reason_required', 422, 'Укажите причину: она поможет куратору скорректировать работу.');
  const history = task.data.rescheduleHistory ?? [];
  const dueAt = body.dueAt ? new Date(body.dueAt) : new Date(Date.now() + 86400000);
  if (req.params.action === 'reschedule') {
    if (history.length >= 50) throw new CoachError('revision_limit', 422, 'Достигнут предел истории переносов.');
    if (req.principal?.role !== 'admin' && history.length >= policy.maxReschedules) throw new CoachError('manager_required', 409, 'Лимит переносов исчерпан. Обратитесь к менеджеру для согласования нового срока.');
    if (dueAt.getTime() <= Date.now() || dueAt.getTime() > Date.now() + 90 * 86400000) throw new CoachError('invalid_due_date', 422, 'Выберите будущий срок в пределах 90 дней.');
    history.push({ at: new Date().toISOString(), reason: body.reason ?? '', from: task.dueAt ? new Date(task.dueAt).toISOString() : null, to: dueAt.toISOString() });
  }
  const patch = req.params.action === 'reschedule' ? { dueAt } : { status: req.params.action === 'start' ? 'in_progress' : 'skipped' };
  await s.db('CoachTask').where({ id: task.id }).update({ ...patch, version: task.version+1, data: JSON.stringify({ ...task.data, reason: body.reason ?? null, rescheduleHistory: history }), updatedAt: new Date() });
  await auditCoach(s.db, s.tenantId, s.partnerId, `task_${req.params.action}`, { taskId: task.id, reason: body.reason, dueAt: req.params.action === 'reschedule' ? dueAt.toISOString() : undefined });
  res.json({ ok: true });
});
partnerCoach.get('/reviews', async (req, res) => { const s = owner(req); res.json({ reviews: await s.db('CoachReview').where({ tenantId: s.tenantId, partnerId: s.partnerId }).orderBy('createdAt', 'desc').limit(50) }); });
partnerCoach.post('/reviews/:id/dispute', async (req, res) => {
  const s = owner(req), body = z.object({ reason: z.string().min(1).max(2000) }).parse(req.body);
  const n = await s.db('CoachReview').where({ id: req.params.id, tenantId: s.tenantId, partnerId: s.partnerId }).update({ status: 'disputed', updatedAt: new Date() });
  if (!n) throw new CoachError('not_found', 404, 'Проверка не найдена.');
  await auditCoach(s.db, s.tenantId, s.partnerId, 'review_disputed', { reviewId: req.params.id, reason: body.reason }); res.json({ ok: true });
});
partnerCoach.get('/messages', async (req, res) => { const s = owner(req); res.json({ messages: (await s.db('CoachMessage').where({ tenantId: s.tenantId, partnerId: s.partnerId }).orderBy('createdAt','desc').limit(100)).reverse() }); });
partnerCoach.post('/messages', async (req, res) => {
  const body = z.object({ programId: z.string().min(1), requestId: z.string().min(8).max(100), text: z.string().trim().min(1).max(8000) }).strict().parse(req.body), s = owner(req);
  // Human-takeover messages do not have a CoachRun. Serialize them as well,
  // instead of silently accepting different text under an old message ID.
  await s.db('Partner').where({ tenantId:s.tenantId,id:s.partnerId }).forUpdate().first();
  const previous = await s.db('CoachMessage').where({tenantId:s.tenantId,partnerId:s.partnerId,clientMessageId:body.requestId}).first();
  if(previous){
    if(previous.programId!==body.programId||previous.data.body!==body.text)throw new CoachError('idempotency_conflict',409,'Этот идентификатор уже использован для другого сообщения.');
    const oldRun=await s.db('CoachRun').where({tenantId:s.tenantId,partnerId:s.partnerId,dedupeKey:`message:${body.requestId}`}).first();
    return res.status(202).json({run:oldRun??null,awaitingHuman:!oldRun,replayed:true});
  }
  const settings = await getSettings(s.db, s.tenantId);
  const run = settings.takeover.includes(s.partnerId) ? null : await enqueue(req, 'message', { programId: body.programId, requestId: body.requestId, message: body.text });
  await assertProgram(s.db,s.tenantId,s.partnerId,body.programId);
  await s.db('CoachMessage').insert({ id: ulid(), tenantId: s.tenantId, partnerId: s.partnerId, programId: body.programId, clientMessageId: body.requestId, role: req.principal?.role === 'admin' ? 'admin' : 'partner', status: 'sent', data: JSON.stringify({ body: body.text }) }).onConflict(['tenantId','partnerId','clientMessageId']).ignore();
  res.status(202).json({ run, awaitingHuman: !run });
});
partnerCoach.get('/runs', async (req,res) => { const s=owner(req); res.json({ runs: await s.db('CoachRun').where({tenantId:s.tenantId,partnerId:s.partnerId}).orderBy('createdAt','desc').limit(30) }); });
partnerCoach.get('/runs/:id', async (req,res) => { const s=owner(req); const run=await s.db('CoachRun').where({id:req.params.id,tenantId:s.tenantId,partnerId:s.partnerId}).first(); if(!run) throw new CoachError('not_found',404,'Запрос не найден.'); res.json({run}); });
partnerCoach.post('/runs/:id/cancel', async (req,res) => {
  const s=owner(req);const run=await s.db('CoachRun').where({id:req.params.id,tenantId:s.tenantId,partnerId:s.partnerId}).forUpdate().first();
  if(!run)throw new CoachError('not_found',404,'Запрос не найден.');
  if(['queued','processing'].includes(run.status)){
    await s.db('CoachRun').where({id:run.id}).update({status:'cancelled',leaseUntil:null,updatedAt:new Date()});
    if(run.kind==='review')await s.db('CoachTask').where({id:run.data.taskId,tenantId:s.tenantId,partnerId:s.partnerId,version:run.data.taskVersion,status:'reviewing'}).update({status:'submitted',version:run.data.taskVersion+1,updatedAt:new Date()});
    await auditCoach(s.db,s.tenantId,s.partnerId,'run_cancelled',{runId:run.id});
  }
  res.json({ok:true});
});
partnerCoach.get('/results', async (req,res) => { const s=owner(req);const programId=z.string().min(1).optional().parse(req.query.programId);if(programId)await assertProgram(s.db,s.tenantId,s.partnerId,programId,false);res.json(await coachMetrics(s.db,s.tenantId,s.partnerId,programId)); });
partnerCoach.get('/notifications', async (req,res) => { const s=owner(req); res.json({notifications:await s.db('CoachNotification').where({tenantId:s.tenantId,partnerId:s.partnerId}).orderBy('createdAt','desc').limit(30)}); });
partnerCoach.post('/notifications/:id/read', async (req,res) => { const s=owner(req); await s.db('CoachNotification').where({id:req.params.id,tenantId:s.tenantId,partnerId:s.partnerId}).update({status:'read',updatedAt:new Date()}); res.json({ok:true}); });
partnerCoach.post('/forecast-snapshots', async (req,res) => {
  const s=owner(req), body=z.object({programId:z.string().min(1),confirmed:z.literal(true),settings:z.record(z.unknown())}).strict().parse(req.body);
  await assertProgram(s.db,s.tenantId,s.partnerId,body.programId);
  if(JSON.stringify(body.settings).length>20000) throw new CoachError('invalid_body',422,'Сценарий слишком большой.');
  const forecast=await calculateCoachForecast(body.settings);
  const [snapshot]=await s.db('CoachForecastSnapshot').insert({id:ulid(),tenantId:s.tenantId,partnerId:s.partnerId,programId:body.programId,status:'confirmed',data:JSON.stringify({source:'browser_confirmed',...forecast})}).returning('*');res.status(201).json({snapshot});
});
partnerCoach.get('/forecast-snapshots', async (req,res) => { const s=owner(req); res.json({snapshots:await s.db('CoachForecastSnapshot').where({tenantId:s.tenantId,partnerId:s.partnerId}).orderBy('createdAt','desc').limit(10)}); });
partnerCoach.use(errors);

export const coachRouter = Router();
coachRouter.use('/coach/me', partnerCoach);
export const adminCoachRouter = Router();
adminCoachRouter.use('/admin/coach', requireAuth, requireAdmin, csrf);
adminCoachRouter.get('/admin/coach/overview', async (req,res) => {
  const {db,tenantId}=tenantOf(req);
  const [settings,partners,runs,reviews,audit]=await Promise.all([getSettings(db,tenantId),db('Partner').where({tenantId}).select('id','name','email','activatedAt','revokedAt').limit(200),db('CoachRun').where({tenantId}).orderBy('createdAt','desc').limit(50),db('CoachTask').where({tenantId}).whereIn('status',['needs_human','submitted','changes_requested']).orderBy('updatedAt','desc').limit(100),db('CoachAuditEvent').where({tenantId}).orderBy('createdAt','desc').limit(50)]);
  res.json({settings,provider:await providerState(settings,db,tenantId),partners,runs,reviews,audit});
});
adminCoachRouter.get('/admin/coach/control', async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  const partners = await db('Partner').where({ tenantId }).whereNull('revokedAt').orderBy('createdAt', 'desc').limit(200);
  const ids = partners.map(p => p.id);
  const [tasks, profiles, configs, { behavior }] = await Promise.all([
    db('CoachTask').where({ tenantId }).whereIn('partnerId', ids).where(q=>q.whereNotIn('status', ['completed', 'cancelled', 'skipped']).orWhere(q2=>q2.where({status:'skipped'}).where('updatedAt','>=',new Date(Date.now()-30*86400000)))),
    db('CoachProfile').where({ tenantId }).whereIn('partnerId', ids).select('partnerId', 'status'),
    db('Config').where({ tenantId }).whereIn('key', ids.map(id => `coach_partner_directives:${id}`)),
    getBehavior(db, tenantId),
  ]);
  const items = partners.map(partner => {
    const config = configs.find(c => c.key === `coach_partner_directives:${partner.id}`);
    const policy = config?.value?.directives?.management ?? behavior.management;
    const summary = summarizeManagement(tasks.filter(t => t.partnerId === partner.id), policy);
    return { partnerId: partner.id, name: partner.name, profileComplete: profiles.some(p => p.partnerId === partner.id && p.status === 'complete'), ...summary };
  }).sort((a, b) => b.counts.needsManager - a.counts.needsManager || b.counts.overdue - a.counts.overdue);
  res.json({ items, limit: 200, generatedAt: new Date() });
});
adminCoachRouter.patch('/admin/coach/settings', async (req,res) => {
  const {db,tenantId}=tenantOf(req), body=z.object({enabled:z.boolean(),provider:z.enum(['template','openai','openrouter']),dailyRuns:z.number().int().min(1).max(100)}).strict().parse(req.body);
  await db('Tenant').where({id:tenantId}).forUpdate().first();
  if(body.enabled&&body.provider==='openrouter'&&!(await providerState({...body,takeover:[]},db,tenantId)).configured)throw new CoachError('provider_not_configured',409,'Сначала сохраните и проверьте подключение OpenRouter в разделе «Подключение ИИ».');
  const old=await getSettings(db,tenantId);
  await db('Config').insert({tenantId,key:'coach_settings',value:JSON.stringify({...old,...body})}).onConflict(['tenantId','key']).merge({value:JSON.stringify({...old,...body}),updatedAt:new Date()});
  await auditCoach(db,tenantId,null,'settings_updated',body);res.json({ok:true});
});
adminCoachRouter.get('/admin/coach/behavior', async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  res.json(await getBehavior(db, tenantId));
});
adminCoachRouter.patch('/admin/coach/behavior', async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  const body = z.object({ version: z.number().int().min(0), behavior: behaviorSchema }).strict().parse(req.body);
  const saved = await saveCoachConfig(db, tenantId, 'coach_behavior', body.version, { behavior: body.behavior });
  await auditCoach(db, tenantId, null, 'behavior_updated', { version: saved.version });
  res.json(saved);
});
adminCoachRouter.get('/admin/coach/partners/:partnerId/directives', async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  await assertPartner(db, tenantId, req.params.partnerId!);
  res.json({ ...await getDirectives(db, tenantId, req.params.partnerId!), schedulerEnabled: process.env.COACH_SCHEDULER_ENABLED === '1' });
});
adminCoachRouter.patch('/admin/coach/partners/:partnerId/directives', async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  const body = z.object({ version: z.number().int().min(0), directives: directivesSchema }).strict().parse(req.body);
  await assertPartner(db, tenantId, req.params.partnerId!);
  const saved = await saveCoachConfig(db, tenantId, `coach_partner_directives:${req.params.partnerId}`, body.version, { directives: body.directives });
  await auditCoach(db, tenantId, req.params.partnerId!, 'directives_updated', { version: saved.version, dailyReviewEnabled: body.directives.dailyReviewEnabled });
  res.json(saved);
});
adminCoachRouter.get('/admin/coach/partners/:partnerId/context', async (req, res) => {
  const { db, tenantId } = tenantOf(req);
  await assertPartner(db, tenantId, req.params.partnerId!);
  const grant = await db('PartnerProgram').where({ tenantId, partnerId: req.params.partnerId! }).orderBy('id').first();
  const programId = z.string().min(1).optional().parse(req.query.programId) ?? grant?.programId;
  if (!programId) throw new CoachError('program_not_granted', 409, 'Сначала назначьте партнёру программу.');
  const context = await buildCoachContext(db, tenantId, req.params.partnerId!, programId);
  res.json({ generatedAt: new Date(), context, capabilities: { profile: true, links: true, metrics: true, tasks: true, submittedText: true, calculatorSnapshot: !!context.forecast, externalVideo: false, browserScreen: false, financialActions: false },
    limits: ['Доступны действия и события, сохранённые в партнёрской системе; экран и работа в сторонних приложениях не отслеживаются.', 'Содержание внешних видео и публикаций автоматически не загружается. Для проверки партнёр присылает текст или сценарий.', 'Калькулятор доступен после сохранения подтверждённого снимка для этого партнёра и программы.', 'В контексте последние 24 сообщения выбранной программы; вся история остаётся в кабинете.', 'Метрики исключают тестовые платежи симулятора. Просмотры и CTR требуют подключения источника просмотров.'] });
});
adminCoachRouter.get('/admin/coach/openrouter', async (req,res) => {
  const {db,tenantId}=tenantOf(req);res.setHeader('Cache-Control','no-store');res.json(await publicRouterConnection(db,tenantId));
});
adminCoachRouter.put('/admin/coach/openrouter', async (req,res) => {
  const {db,tenantId}=tenantOf(req),body=connectionInput.parse(req.body);
  const result = await saveRouterConnection(db,tenantId,body);
  await auditCoach(db,tenantId,null,'connection_saved',{provider:'openrouter',model:body.model,keyRotated:result.keyRotated,changed:result.changed});
  res.setHeader('Cache-Control','no-store');res.json(await publicRouterConnection(db,tenantId));
});
adminCoachRouter.delete('/admin/coach/openrouter', async (req,res) => {
  const {db,tenantId}=tenantOf(req),body=z.object({version:z.string()}).strict().parse(req.body);
  await removeRouterConnection(db,tenantId,body.version);await auditCoach(db,tenantId,null,'connection_removed',{provider:'openrouter'});
  res.json(await publicRouterConnection(db,tenantId));
});
let modelCatalogCache:{until:number;models:Awaited<ReturnType<typeof listRouterModels>>}|null=null;
let loadingModelCatalog:Promise<Awaited<ReturnType<typeof listRouterModels>>>|null=null;
adminCoachRouter.get('/admin/coach/openrouter/models', async (req,res) => {
  await req.releaseTenantTransaction!();
  try {
    if(modelCatalogCache&&modelCatalogCache.until>Date.now())return res.json({models:modelCatalogCache.models});
    loadingModelCatalog??=listRouterModels().then(models=>{modelCatalogCache={until:Date.now()+300000,models};return models;}).finally(()=>{loadingModelCatalog=null;});
    res.json({models:await loadingModelCatalog});
  }catch(error){if(error instanceof CoachError)throw error;throw new CoachError('catalog_unavailable',503,'Не удалось загрузить каталог. Повторите позже или укажите ID модели вручную.');}
});
const probeLimiter=rateLimit({windowMs:60000,limit:2,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'probe_rate_limited',detail:'Проверка уже запускалась. Подождите минуту.'}});
adminCoachRouter.post('/admin/coach/openrouter/test',probeLimiter,async(req,res)=>{
  const {db,tenantId}=tenantOf(req),body=z.object({version:z.string(),acceptCost:z.literal(true)}).strict().parse(req.body);
  const connection=await publicRouterConnection(db,tenantId);
  if(connection.version==='env')throw new CoachError('save_first',409,'Сначала сохраните подключение.');
  if(connection.version!==body.version)throw new CoachError('version_conflict',409,'Настройки изменились. Обновите страницу.');
  const credentials=await resolveRouterCredentials(db,tenantId);
  await req.releaseTenantTransaction!(); // Never hold a database transaction during model generation.
  let result:{ok:boolean;detail:string;model:string};
  try{result=await testRouterConnection(credentials);}catch(error){result={ok:false,model:credentials.model,detail:error instanceof CoachError?error.message:'Не удалось связаться с OpenRouter или разобрать ответ. Проверьте сеть, баланс и выбранную модель.'};}
  await withTenantTransaction(tenantId,async trx=>{
    const tenant=await trx('Tenant').where({id:tenantId}).first();if(tenant?.status!=='active'||tenant.pendingDeletionAt)throw new CoachError('tenant_inactive',403,'Организация не активна.');
    await recordRouterVerification(trx,tenantId,body.version,result);await auditCoach(trx,tenantId,null,'connection_tested',{provider:'openrouter',ok:result.ok,model:result.model});
  });
  res.setHeader('Cache-Control','no-store');res.json(result);
});
adminCoachRouter.post('/admin/coach/partners/:partnerId/takeover', async (req,res) => {
  const {db,tenantId}=tenantOf(req), body=z.object({enabled:z.boolean()}).strict().parse(req.body);
  await assertPartner(db,tenantId,req.params.partnerId!);
  await db('Tenant').where({id:tenantId}).forUpdate().first();
  const old=await getSettings(db,tenantId); const takeover=[...new Set(old.takeover.filter(id=>id!==req.params.partnerId))];if(body.enabled)takeover.push(req.params.partnerId!);
  await db('Config').insert({tenantId,key:'coach_settings',value:JSON.stringify({...old,takeover})}).onConflict(['tenantId','key']).merge({value:JSON.stringify({...old,takeover}),updatedAt:new Date()});
  await auditCoach(db,tenantId,req.params.partnerId!,'takeover_updated',{enabled:body.enabled});res.json({ok:true});
});
adminCoachRouter.post('/admin/coach/tasks/:id/resolve', async (req,res) => {
  const {db,tenantId}=tenantOf(req), body=z.object({version:z.number().int().positive(),verdict:z.enum(['completed','changes_requested']),comment:z.string().trim().min(1).max(3000)}).strict().parse(req.body);
  const task=await db('CoachTask').where({id:req.params.id,tenantId}).forUpdate().first();
  if(!task)throw new CoachError('not_found',404,'Задание не найдено.');
  if(task.version!==body.version||!['needs_human','submitted','changes_requested'].includes(task.status))throw new CoachError('version_conflict',409,'Задание изменено или не ожидает проверки.');
  const policy=await managementPolicy(db,tenantId,task.partnerId);
  if(body.verdict==='completed'&&(!task.data.submission?.text||(policy.requirePublicationUrl&&task.data.platform!=='preparation'&&!task.data.submission.publicationUrl)))throw new CoachError('evidence_required',422,'Для завершения нужен присланный материал и предусмотренная правилами ссылка.');
  await db('CoachTask').where({id:task.id,tenantId}).update({status:body.verdict,version:task.version+1,updatedAt:new Date(),...(body.verdict==='changes_requested'?{dueAt:new Date(Date.now()+policy.deadlineHours*3600000)}:{})});
  await db('CoachReview').insert({id:ulid(),tenantId,partnerId:task.partnerId,programId:task.programId,taskId:task.id,status:body.verdict,data:JSON.stringify({message:body.comment,reviewer:'admin',verificationLevel:'human_reviewed_self_report',submissionVersion:task.version})});
  await db('CoachNotification').insert({id:ulid(),tenantId,partnerId:task.partnerId,programId:task.programId,status:'unread',dedupeKey:`human-review:${task.id}:${task.version}`,data:JSON.stringify({title:body.verdict==='completed'?'Менеджер подтвердил выполнение':'Менеджер запросил исправления',body:body.comment})}).onConflict(['tenantId','partnerId','dedupeKey']).ignore();
  await auditCoach(db,tenantId,task.partnerId,'human_review',{taskId:task.id,verdict:body.verdict});res.json({ok:true});
});
adminCoachRouter.get('/admin/coach/knowledge', async (req,res) => {const {db,tenantId}=tenantOf(req);res.json({items:await db('CoachKnowledgeItem').where({tenantId}).orderBy('updatedAt','desc').limit(100)});});
adminCoachRouter.post('/admin/coach/knowledge', async (req,res) => {
  const {db,tenantId}=tenantOf(req), body=z.object({title:z.string().trim().min(1).max(200),body:z.string().trim().min(1).max(8000),source:z.string().max(2048),approved:z.boolean()}).strict().parse(req.body);
  const [item]=await db('CoachKnowledgeItem').insert({id:ulid(),tenantId,status:body.approved?'approved':'draft',data:JSON.stringify({...body,approvedAt:body.approved?new Date():null})}).returning('*');
  await auditCoach(db,tenantId,null,'knowledge_created',{knowledgeId:item.id,status:item.status});res.status(201).json({item});
});
adminCoachRouter.use('/admin/coach/partners/:partnerId', partnerCoach);
adminCoachRouter.use(errors);
