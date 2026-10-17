import type { Knex } from 'knex';
import { assertPartner, assertProgram } from './policy.js';
import { profileSchema } from './schemas.js';
import { coachMetrics } from './analytics.js';
import { managementSnapshot } from './management.js';
import { calculatorPlanView } from './calculator-plan.js';
import { listPartnerLinks } from '../links-service.js';

/** Shared by the worker and the admin inspector: same scoped source of facts. */
export async function buildCoachContext(db: Knex, tenantId: string, partnerId: string, programId: string, days = 30) {
  const partner = await assertPartner(db, tenantId, partnerId);
  const program = await assertProgram(db, tenantId, partnerId, programId, false);
  const commissionSnapshot = await db('PartnerCommission').where({ tenantId, partnerId }).first();
  const commissionRule = commissionSnapshot?.commissionRules ?? (commissionSnapshot ? [{ trigger: 'every', type: commissionSnapshot.commissionType, value: Number(commissionSnapshot.commissionValue), recurring: commissionSnapshot.recurring }] : program.commissionRule);
  const profileRow = await db('CoachProfile').where({ tenantId, partnerId }).first();
  const profile = profileRow?.status === 'complete' ? profileSchema.parse(profileRow.data) : null;
  const metrics = await coachMetrics(db, tenantId, partnerId, programId, days);
  const origin = (process.env.PUBLIC_ROUTER_URL ?? process.env.PORTAL_URL ?? 'http://127.0.0.1:5673').replace(/\/$/, '');
  const rawLinks = (await listPartnerLinks(db,tenantId,partnerId,programId)).links.filter(link=>!link.archived).slice(0,100);
  const links = rawLinks.map(link => ({ id: link.id, key: link.linkKey, label: link.label, channel: link.channel, url: `${origin}/r/${encodeURIComponent(link.linkKey)}` }));
  const rawMessages = await db('CoachMessage').where({ tenantId, partnerId }).whereNot('status','archived').where(q => q.where({ programId }).orWhereNull('programId')).orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(24);
  const messages = rawMessages.reverse().map(m => ({ role: m.role, source: m.role === 'assistant' ? 'previous_model_output_not_verified_facts' : 'partner_self_report_at_that_time', createdAt: m.createdAt, body: String(m.data.body ?? '').slice(0, 1200) }));
  const rawKnowledge = await db('CoachKnowledgeItem').where({ tenantId, status: 'approved' }).orderBy('updatedAt', 'desc').limit(6);
  const knowledge = rawKnowledge.map(k => ({ id: k.id, version: k.version, title: k.data.title, body: String(k.data.body ?? '').slice(0, 1500), source: k.data.source }));
  const calculator = await calculatorPlanView(db,tenantId,partnerId,programId);
  const snapshotQuery = db('CoachForecastSnapshot').where({ tenantId, partnerId, programId, status: 'confirmed' });
  if(calculator.plan?.data.snapshotId)snapshotQuery.andWhere({id:calculator.plan.data.snapshotId});
  const snapshot = await snapshotQuery.orderBy('createdAt','desc').first();
  const forecast = snapshot ? { source: 'confirmed_forecast_not_actual', modelHash: snapshot.data.modelHash, verified: snapshot.data.verified, commission: snapshot.data.commission, createdAt: snapshot.createdAt,
    settings: snapshot.data.settings,
    scenarios: snapshot.data.scenarios.map((s: { scenario: string; result: { months: Array<{ reward: number; cumulative: number }> } }) => ({ scenario: s.scenario, month3: s.result.months[2]?.reward, month12: s.result.months[11]?.reward, yearTotal: s.result.months[11]?.cumulative })) } : null;
  const rawTasks = calculator.tasks.slice(0,60);
  const currentTasks = rawTasks.map(t => ({ id: t.id, status: t.status, dueAt: t.dueAt, updatedAt: t.updatedAt, title: String(t.data.title ?? '').slice(0, 200), format: t.data.format, platform: t.data.platform,
    note:String(t.data.note??'').slice(0,700),estimatedViews:Number(t.data.estimatedViews)||0,estimatedClicks:Number(t.data.estimatedClicks)||0,
    placements:(t.data.placements??[]).slice(0,30).map((item:Record<string,unknown>)=>({id:item.id,name:item.name,url:item.url,expectedViews:item.expectedViews,expectedClicks:item.expectedClicks})),
    additionalCompatibleResources:(t.data.suggestedResources??[]).filter((item:Record<string,unknown>)=>!item.selected).slice(0,30).map((item:Record<string,unknown>)=>({id:item.id,name:item.name,url:item.url,note:String(item.note??'').slice(0,240),expectedViews:item.expectedViews})),
    trackingLinks:t.links??[],draft: String(t.data.draft ?? '').slice(0, 700), criteria: String(t.data.criteria ?? '').slice(0, 300), submission: t.data.submission ? { text: String(t.data.submission.text ?? '').slice(0, 1000), publicationUrl: t.data.submission.publicationUrl } : null }));
  const rawActivity = await db('CoachAuditEvent').where({ tenantId, partnerId }).orderBy('createdAt', 'desc').limit(15);
  const recentActivity = rawActivity.map(a => ({ action: a.status, at: a.createdAt }));
  const plan = calculator.plan;
  const lastReview = await db('CoachRun').where({ tenantId, partnerId, programId, kind: 'daily', status: 'completed' }).orderBy('createdAt', 'desc').first();
  const previousReview = lastReview?.data.metrics ? { at: lastReview.updatedAt, period: lastReview.data.metrics.period, counts: lastReview.data.metrics.counts, amountsMinor: lastReview.data.metrics.amountsMinor, comparison: 'rolling_windows_not_daily_delta' } : null;
  const snapshotManagement = await managementSnapshot(db, tenantId, partnerId, programId, new Date(), plan?.id??'no-calculator-plan');
  const rawReviews = await db('CoachReview').where({ tenantId, partnerId, programId }).orderBy('createdAt', 'desc').limit(8);
  const timezone = profile?.timezone ?? 'UTC';
  const formatLocal = (date: Date|string) => `${new Intl.DateTimeFormat('ru-RU', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(date))} (${timezone})`;
  const localTask = (task: typeof snapshotManagement.tasks[number]) => ({ ...task, dueAtLocal: task.dueAt ? formatLocal(task.dueAt) : null });
  // Calendar arithmetic in the partner's timezone, not 24 hours from a dueAt.
  const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(snapshotManagement.generatedAt));
  const part = (name: string) => Number(calendar.find(p => p.type === name)!.value);
  const localDate = (offset: number) => new Date(Date.UTC(part('year'), part('month') - 1, part('day') + offset)).toISOString().slice(0, 10).split('-').reverse().join('.');
  const management = { ...snapshotManagement,
    clock: { timezone, now: snapshotManagement.generatedAt, nowLocal: formatLocal(snapshotManagement.generatedAt), todayLocalDate: localDate(0), tomorrowLocalDate: localDate(1) },
    nextTask: snapshotManagement.nextTask ? localTask(snapshotManagement.nextTask) : null,
    tasks: snapshotManagement.tasks.slice(0, 30).map(localTask), tasksTruncated: snapshotManagement.tasks.length > 30, recentReviews: rawReviews.map(review => ({ taskId: review.taskId, status: review.status, at: review.createdAt, feedback: String(review.data.message ?? '').slice(0, 1500) })) };
  const todayTasks=calculator.tasks.filter(task=>task.data.scheduledDay===calculator.today);
  const contextMetrics={...metrics,links:[...metrics.links].sort((a,b)=>b.clicks-a.clicks||b.netAccruedMinor-a.netAccruedMinor).slice(0,100),linksTruncated:metrics.links.length>100};
  return { partner: { name: partner.name }, profile, metrics:contextMetrics, links, knowledge, messages, forecast, currentTasks, recentActivity, management,
    today: {day:calculator.today,source:'calculator_schedule_v1',tasks:todayTasks.map(task=>({id:task.id,title:task.data.title,status:task.status,format:task.data.format,note:task.data.note,estimatedViews:task.data.estimatedViews,estimatedClicks:task.data.estimatedClicks,placements:task.data.placements,links:task.links??[]})),completed:todayTasks.filter(task=>task.status==='completed').length},
    previousReview,
    activePlan: plan ? {source:plan.data.source,snapshotId:plan.data.snapshotId,startDate:plan.data.startDate,days:plan.data.days,weekdays:plan.data.weekdays,originals:plan.data.originals,placements:plan.data.placements} : null,
    capabilities: { automaticAudioVideoReview: false, automaticImageReview: false, chatCanChangeTasks: false, chatCanTransferToHuman: false, externalPublicationCoverage: 'unknown_not_absent',
      linkTracking: 'Переход фиксируется при открытии партнёрского URL /r/ в браузере. Для самого счётчика переходов публикация, сдача задания или подтверждение менеджера НЕ нужны. Регистрации и оплаты требуют соответствующих событий интеграции; публикация сама по себе их не создаёт.',
    calculator: { automaticScreenAccess: false, savedSnapshotAvailable: !!forecast, instructions: 'Единственный источник рабочего плана — калькулятор. Партнёр выбирает форматы, объём, площадки и рабочие дни, затем нажимает «Сохранить сценарий и составить план». Каждая content-задача содержит выбранные площадки, прогноз и дополнительные совместимые ресурсы. Партнёрские ссылки никогда не создаются автоматически: trackingLinks содержит только ссылки, которые партнёр сам создал в разделе «Ссылки». Если trackingLinks пуст, направь партнёра создать собственную ссылку вручную; не выдумывай и не создавай её сам. Не создавай параллельный план и не выдумывай формат или объём. Помогай выполнить конкретную задачу: подготовить материал и адаптировать его под перечисленные площадки. Прогноз — не реальные оплаты и не гарантия.' },
      taskActions: { complete: 'Готово', help: 'Помочь с этим шагом', link: 'Скопировать ссылку' } },
    program: { name: program.name, commissionRule, commissionSource: commissionSnapshot ? 'partner_snapshot' : 'program', attributionWindowDays: program.attributionWindowDays,
      attributionPolicy: 'В текущем обработчике окно проверяется от перехода до каждого события оплаты. recurring разрешает повторные начисления, recurringMonths отдельно ограничивает длительность. recurring не отменяет проверку окна. Бессрочная привязка клиента к партнёру не подтверждена.' } };
}
