import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { ulid } from 'ulid';
import { db } from '../db.js';
import { withTenantTransaction } from '../tenancy.js';
import { getSettings, assertPartner, assertProgram, providerState } from './policy.js';
import { publicRouterConnection, resolveRouterCredentials } from './connections.js';
import { CoachError, profileSchema, shouldRemind } from './schemas.js';
import { coachMetrics } from './analytics.js';
import { generateCoachOutput } from './provider.js';
import { validateGeneratedPlan, planSummary } from './plan-validation.js';

export async function auditCoach(trx: Knex, tenantId: string, partnerId: string | null, action: string, details: unknown) {
  await trx('CoachAuditEvent').insert({ id: ulid(), tenantId, partnerId, status: action, data: JSON.stringify(details) });
}

/** Claim durable work, release DB transaction, then call the provider. */
export async function processCoachJob(): Promise<boolean> {
  await db.transaction(async trx => {
    const expired = await trx('CoachRun').where({status:'processing'}).where('leaseUntil','<',new Date()).where('attempts','>=',3).update({status:'failed',leaseUntil:null,updatedAt:new Date(),data:trx.raw(`jsonb_set(data, '{error}', ?::jsonb)`,[JSON.stringify({code:'retry_limit',message:'Запрос не завершился после восстановления. Создайте новый запрос.'})])}).returning('*');
    for (const stopped of expired) {
      if (stopped.kind === 'review') await trx('CoachTask').where({id:stopped.data.taskId,tenantId:stopped.tenantId,partnerId:stopped.partnerId,version:stopped.data.taskVersion,status:'reviewing'}).update({status:'submitted',version:stopped.data.taskVersion+1,updatedAt:new Date()});
      await auditCoach(trx,stopped.tenantId,stopped.partnerId,'run_failed',{runId:stopped.id,code:'retry_limit'});
    }
  });
  const token = randomUUID();
  const run = await db.transaction(async trx => {
    const row = await trx('CoachRun').where(q => q.where({ status: 'queued' }).where('availableAt', '<=', new Date()).orWhere(q2 => q2.where({ status: 'processing' }).where('leaseUntil', '<', new Date())))
      .where('attempts', '<', 3).orderBy('createdAt').forUpdate().skipLocked().first();
    if (!row) return null;
    await trx('CoachRun').where({ id: row.id }).update({ status: 'processing', lockedBy: token, leaseUntil: new Date(Date.now() + 180000), attempts: row.attempts + 1, updatedAt: new Date() });
    return row;
  });
  if (!run) return false;
  let measured: {usage:Record<string,unknown>;model:string}|undefined;
  try {
    const prepared = await withTenantTransaction(run.tenantId, async trx => {
      await assertPartner(trx, run.tenantId, run.partnerId);
      const settings = await getSettings(trx, run.tenantId);
      if (!settings.enabled || settings.takeover.includes(run.partnerId)) throw new CoachError('coach_paused', 409, 'Сопровождение приостановлено или передано менеджеру.');
      if (!(await providerState(settings,trx,run.tenantId)).configured) throw new CoachError('provider_not_configured',503,'Подключение ИИ не настроено или не проверено.');
      const credentials=settings.provider==='openrouter'?await resolveRouterCredentials(trx,run.tenantId):undefined;
      const profileRow = await trx('CoachProfile').where({ tenantId: run.tenantId, partnerId: run.partnerId }).first();
      const profile = profileSchema.parse(profileRow.data);
      if(settings.provider!=='template'&&!profile.aiConsent)throw new CoachError('ai_consent_required',403,'Нет согласия на обработку данных ИИ-провайдером.');
      if (profileRow.version !== run.data.profileVersion || ['off', 'paused'].includes(profile.mode)) throw new CoachError('context_changed', 409, 'Настройки изменены. Запросите новый ответ.');
      const program = await assertProgram(trx, run.tenantId, run.partnerId, run.programId);
      const rawMessages = await trx('CoachMessage').where({ tenantId: run.tenantId, partnerId: run.partnerId }).orderBy('createdAt', 'desc').limit(8).select('role', 'data');
      const messages = rawMessages.reverse().map(m=>({role:m.role,body:String(m.data.body??'').slice(0,1000)}));
      const rawKnowledge = await trx('CoachKnowledgeItem').where({ tenantId: run.tenantId, status: 'approved' }).orderBy('updatedAt', 'desc').limit(6).select('id', 'version', 'data');
      const knowledge = rawKnowledge.map(k=>({id:k.id,version:k.version,title:k.data.title,body:String(k.data.body??'').slice(0,1500),source:k.data.source}));
      const snap=await trx('CoachForecastSnapshot').where({tenantId:run.tenantId,partnerId:run.partnerId,programId:run.programId,status:'confirmed'}).orderBy('createdAt','desc').first();
      const forecast=snap?{source:'confirmed_forecast_not_actual',modelHash:snap.data.modelHash,verified:snap.data.verified,commission:snap.data.commission,createdAt:snap.createdAt,scenarios:snap.data.scenarios.map((s:{scenario:string;result:{months:Array<{reward:number;cumulative:number}>}})=>({scenario:s.scenario,month3:s.result.months[2]?.reward,month12:s.result.months[11]?.reward,yearTotal:s.result.months[11]?.cumulative}))}:null;
      const tasks=await trx('CoachTask').where({tenantId:run.tenantId,partnerId:run.partnerId,programId:run.programId}).whereIn('status',['planned','in_progress','changes_requested','submitted','needs_human']).orderBy('dueAt').limit(10);
      const currentTasks=tasks.map(t=>({status:t.status,minutes:t.minutes,dueAt:t.dueAt,title:String(t.data.title??'').slice(0,200),format:t.data.format,platform:t.data.platform,draft:String(t.data.draft??'').slice(0,1000),criteria:String(t.data.criteria??'').slice(0,300)}));
      return { settings, credentials, profileVersion: profileRow.version, context: { profile, metrics: await coachMetrics(trx, run.tenantId, run.partnerId, run.programId,run.kind==='weekly'?7:30), messages, knowledge, forecast, currentTasks, program: { name: program.name, commissionRule: program.commissionRule, attributionWindowDays: program.attributionWindowDays }, evidence: run.data.evidence } };
    });
    const contextSize = JSON.stringify(prepared.context).length;
    if (contextSize > 50000) throw new CoachError('context_limit', 422, 'Контекст слишком большой. Сократите сообщение или материалы.');
    const intent = run.data.message ?? (run.kind==='plan' ? 'Составь новый непустой недельный план по подтверждённому профилю: доступные площадки, форматы и время. Верни конкретные задания в tasks. Это запрос плана, не продолжение предыдущей реплики чата.' : run.kind==='weekly' ? 'Разбери результаты недели: наблюдаемый факт, осторожная гипотеза и один измеримый следующий шаг. Не меняй цель и бюджет времени.' : 'Проверь предоставленный материал по критериям задания.');
    const deadline=AbortSignal.timeout(110000);
    const invoke=async (instruction:string)=>{
      const output=await generateCoachOutput(prepared.settings.provider,run.kind,instruction,prepared.context,deadline,prepared.credentials);
      const usage={...measured?.usage};
      for(const [key,value] of Object.entries(output.usage))if(typeof value==='number')usage[key]=Number(usage[key]??0)+value;
      measured={usage,model:output.model};
      return {...output,usage};
    };
    let result=await invoke(intent);
    if(run.kind==='plan')result=await validateGeneratedPlan(result,prepared.context.profile,prepared.settings.provider==='template'?undefined:feedback=>invoke(`${intent}\n${feedback}`));
    // Numbers in free-form model prose may contradict validated tasks. Display
    // a computed summary, not an unchecked second source of plan arithmetic.
    const providerComment=run.kind==='plan'?result.output.message:undefined;
    if(run.kind==='plan')result={...result,output:{...result.output,message:planSummary(result.output.tasks,prepared.context.profile)}};
    await withTenantTransaction(run.tenantId, async trx => {
      const currentRun = await trx('CoachRun').where({ id: run.id, tenantId: run.tenantId, partnerId: run.partnerId, status: 'processing', lockedBy: token }).forUpdate().first();
      if (!currentRun) return;
      await assertPartner(trx, run.tenantId, run.partnerId);
      await assertProgram(trx, run.tenantId, run.partnerId, run.programId);
      const settings = await getSettings(trx, run.tenantId);
      if(prepared.credentials&&(await publicRouterConnection(trx,run.tenantId)).version!==prepared.credentials.version)throw new CoachError('context_changed',409,'Подключение ИИ изменилось во время ответа. Запросите новый ответ.');
      const profile = await trx('CoachProfile').where({ tenantId: run.tenantId, partnerId: run.partnerId }).forUpdate().first();
      if (!settings.enabled || settings.provider !== prepared.settings.provider || settings.takeover.includes(run.partnerId) || profile.version !== prepared.profileVersion || ['paused', 'off'].includes(profile.data.mode)) throw new CoachError('context_changed', 409, 'Настройки или права изменились во время ответа.');
      let objectId: string | null = null;
      if (run.kind === 'plan') {
        objectId = ulid();
        await trx('CoachPlan').insert({ id: objectId, tenantId: run.tenantId, partnerId: run.partnerId, programId: run.programId, weekStart: run.data.weekStart, status: 'draft', data: JSON.stringify({ ...result.output, plannedMinutes: result.output.tasks.reduce((sum,t) => sum+t.minutes,0), profileVersion: prepared.profileVersion, model: result.model, metrics: prepared.context.metrics }) });
      }
      if (run.kind === 'review') {
        const task = await trx('CoachTask').where({ id: run.data.taskId, tenantId: run.tenantId, partnerId: run.partnerId }).forUpdate().first();
        if (!task || task.status !== 'reviewing' || task.version !== run.data.taskVersion) throw new CoachError('version_conflict', 409, 'Задание уже изменено.');
        objectId = ulid();
        await trx('CoachReview').insert({ id: objectId, tenantId: run.tenantId, partnerId: run.partnerId, programId: run.programId, taskId: task.id, runId: run.id, status: result.output.verdict, data: JSON.stringify({ ...result.output, verificationLevel: 'self_reported', model: result.model, submissionVersion: task.data.submission?.submissionVersion ?? task.version }) });
        // A model review is not proof of publication or a financial result.
        const next = result.output.verdict === 'changes_requested' ? 'changes_requested' : 'needs_human';
        await trx('CoachTask').where({ id: task.id }).update({ status: next, version: task.version + 1, updatedAt: new Date() });
      }
      await trx('CoachMessage').insert({ id: ulid(), tenantId: run.tenantId, partnerId: run.partnerId, programId: run.programId, role: 'assistant', status: 'sent', data: JSON.stringify({ body: result.output.message, limitations: result.output.limitations, model: result.model, objectId, runId: run.id }) });
      await trx('CoachRun').where({ id: run.id }).update({ status: 'completed', leaseUntil: null, updatedAt: new Date(), data: JSON.stringify({ ...run.data, output: result.output, providerComment, objectId, usage: result.usage, model: result.model }) });
      await trx('CoachNotification').insert({ id: ulid(), tenantId: run.tenantId, partnerId: run.partnerId, programId: run.programId, status: 'unread', dedupeKey: `run:${run.id}`, data: JSON.stringify({ title: run.kind === 'plan' ? 'Ваш план готов' : run.kind === 'review' ? 'Проверка материала завершена' : 'Куратор ответил', body: result.output.message.slice(0, 500) }) }).onConflict(['tenantId', 'partnerId', 'dedupeKey']).ignore();
      await auditCoach(trx, run.tenantId, run.partnerId, 'run_completed', { runId: run.id, model: result.model, kind: run.kind });
    });
  } catch (error) {
    const code = error instanceof CoachError ? error.code : 'run_failed';
    await withTenantTransaction(run.tenantId, async trx => {
      const failed = await trx('CoachRun').where({ id: run.id, tenantId: run.tenantId, status: 'processing', lockedBy: token }).update({ status: 'failed', leaseUntil: null, updatedAt: new Date(), data: JSON.stringify({ ...run.data, ...measured, error: { code, message: error instanceof CoachError ? error.message : 'Не удалось выполнить запрос. Повторите позже.' } }) });
      if (!failed) return; // Cancellation or another recovered worker won the lease.
      if (run.kind === 'review') await trx('CoachTask').where({ id: run.data.taskId, tenantId: run.tenantId, partnerId: run.partnerId, version: run.data.taskVersion, status: 'reviewing' }).update({ status: 'submitted', version: run.data.taskVersion+1, updatedAt: new Date() });
      await auditCoach(trx, run.tenantId, run.partnerId, 'run_failed', { runId: run.id, code });
    });
  }
  return true;
}

export async function scheduleCoachReminders(): Promise<void> {
  const profiles = await db('CoachProfile').where({ status: 'complete' }).limit(1000);
  for (const row of profiles) {
    const profile = profileSchema.safeParse(row.data);
    if (!profile.success || !shouldRemind(profile.data, new Date())) continue;
    await withTenantTransaction(row.tenantId, async trx => {
      const settings = await getSettings(trx, row.tenantId);
      if (!settings.enabled || settings.takeover.includes(row.partnerId)) return;
      const current = await trx('CoachProfile').where({ id: row.id, tenantId: row.tenantId }).forUpdate().first();
      if (!shouldRemind(profileSchema.parse(current.data), new Date())) return;
      const partner = await trx('Partner').where({ id: row.partnerId, tenantId: row.tenantId }).first();
      if (!partner?.activatedAt || partner.revokedAt) return;
      const tenant = await trx('Tenant').where({id:row.tenantId}).first();
      if (tenant?.status !== 'active' || tenant.pendingDeletionAt) return;
      const task = await trx('CoachTask').where({ tenantId: row.tenantId, partnerId: row.partnerId }).whereIn('status', ['planned', 'in_progress', 'changes_requested']).orderBy('dueAt').first();
      if (!task) return;
      const recent = await trx('CoachNotification').where({ tenantId: row.tenantId, partnerId: row.partnerId }).where('dedupeKey', 'like', 'reminder:%').where('createdAt', '>', new Date(Date.now() - 7*86400000)).count({ count: '*' }).first();
      if (Number(recent?.count ?? 0) >= 3) return;
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: profile.data.timezone }).format(new Date());
      await trx('CoachNotification').insert({ id: ulid(), tenantId: row.tenantId, partnerId: row.partnerId, programId: task.programId, status: 'unread', dedupeKey: `reminder:${day}`, data: JSON.stringify({ title: 'Готовы к короткой сессии?', body: `Задание «${task.data.title}» займёт ${task.minutes} минут. Можно начать, перенести или поставить сопровождение на паузу.` }) }).onConflict(['tenantId', 'partnerId', 'dedupeKey']).ignore();
    });
  }
}

export function startCoachWorker(): () => Promise<void> {
  let stopping = false, busy = false;
  const tick = async () => { if (stopping || busy) return; busy = true; try { await processCoachJob(); } catch { console.error('[coach] worker tick failed'); } finally { busy = false; } };
  const interval = setInterval(() => { void tick(); }, 1500);
  const reminders = process.env.COACH_SCHEDULER_ENABLED === '1' ? setInterval(() => { void scheduleCoachReminders().catch(() => console.error('[coach] reminder tick failed')); }, 60000) : null;
  void tick();
  return async () => { stopping = true; clearInterval(interval); if (reminders) clearInterval(reminders); while (busy) await new Promise(resolve => setTimeout(resolve, 50)); };
}
