import type { Knex } from 'knex';
import { z } from 'zod';
import { CoachError } from './schemas.js';

export const defaultManagement = { style: 'strict' as const, deadlineHours: 24, maxReschedules: 2, escalationHours: 48, requireReason: true, requirePublicationUrl: false, reviewSlaHours: 24, preventPlanReplacement: true };
export const managementSchema = z.object({
  style: z.enum(['supportive', 'demanding', 'strict']),
  deadlineHours: z.number().int().min(1).max(168),
  maxReschedules: z.number().int().min(0).max(10),
  escalationHours: z.number().int().min(1).max(168),
  requireReason: z.boolean(), requirePublicationUrl: z.boolean(),
  reviewSlaHours: z.number().int().min(1).max(168),
  preventPlanReplacement: z.boolean().default(true),
}).strict();
export const defaultInterviewQuestions = [
  { id: 'motivation', question: 'Зачем вам партнёрство с Syntolk? Какой доход хотите получать и что он изменит для вас?', required: true },
  { id: 'content', question: 'Какой контент вам нравится делать: кружочки, короткие или длинные видео, посты? Расскажите своими словами и приведите пример.', required: true },
  { id: 'schedule', question: 'Как часто вы готовы снимать или писать? В какие дни и сколько времени реально готовы выделять?', required: true },
  { id: 'audience', question: 'Кому вы хотите рассказывать о Syntolk? Где уже есть аудитория и какие её задачи вы понимаете?', required: true },
  { id: 'obstacles', question: 'Что может помешать вам доводить публикации до конца? Какая помощь и какой стиль контроля вам подходят?', required: true },
];

export const behaviorSchema = z.object({
  name: z.string().trim().min(1).max(60),
  tone: z.enum(['warm', 'energetic', 'business']),
  address: z.enum(['ty', 'vy']),
  replyLength: z.enum(['brief', 'balanced', 'detailed']),
  systemPrompt: z.string().trim().max(12000),
  greeting: z.string().trim().max(1500),
  mascotEnabled: z.boolean(),
  management: managementSchema.default(defaultManagement),
  interviewQuestions: z.array(z.object({ id: z.string().regex(/^[a-z0-9_-]{1,40}$/), question: z.string().trim().min(5).max(500), required: z.boolean() }).strict()).min(1).max(12).refine(items => new Set(items.map(i => i.id)).size === items.length, 'ID вопросов не должны повторяться').default(defaultInterviewQuestions),
}).strict();
export const directivesSchema = z.object({
  prompt: z.string().trim().max(8000),
  strengths: z.string().trim().max(2000),
  focus: z.string().trim().max(2000),
  dailyReviewEnabled: z.boolean(),
  dailyReviewHour: z.number().int().min(0).max(23),
  tone: z.enum(['warm', 'energetic', 'business']).optional(),
  address: z.enum(['ty', 'vy']).optional(),
  replyLength: z.enum(['brief', 'balanced', 'detailed']).optional(),
  management: managementSchema.optional(),
}).strict();
export type CoachBehavior = z.infer<typeof behaviorSchema>;
export type PartnerDirectives = z.infer<typeof directivesSchema>;
export const defaultBehavior: CoachBehavior = {
  name: 'Синти', tone: 'warm', address: 'ty', replyLength: 'balanced', mascotEnabled: true,
  greeting: '',
  management: defaultManagement, interviewQuestions: defaultInterviewQuestions,
  systemPrompt: 'Будь внимательным менеджером партнёра Syntolk. Помогай пройти путь от идеи до публикации и разбора результата. Давай готовые тексты и сценарии под его аудиторию. Начинай с ответа по существу, заканчивай одним понятным следующим шагом. Замечай выполненную работу, разбирай ошибки спокойно. Если партнёр застрял, предложи более простой вариант. Не повторяй предупреждения и оговорки в каждой реплике.',
};
export const defaultDirectives: PartnerDirectives = { prompt: '', strengths: '', focus: '', dailyReviewEnabled: false, dailyReviewHour: 10 };

export function effectiveBehavior(behavior: CoachBehavior, directives: PartnerDirectives): CoachBehavior {
  return { ...behavior, tone: directives.tone ?? behavior.tone, address: directives.address ?? behavior.address, replyLength: directives.replyLength ?? behavior.replyLength, management: directives.management ?? behavior.management ?? defaultManagement };
}

export async function getBehavior(db: Knex, tenantId: string) {
  const row = await db('Config').where({ tenantId, key: 'coach_behavior' }).first();
  return { behavior: behaviorSchema.parse({ ...defaultBehavior, ...row?.value?.behavior }), version: Number(row?.value?.version ?? 0) };
}
export async function getDirectives(db: Knex, tenantId: string, partnerId: string) {
  const row = await db('Config').where({ tenantId, key: `coach_partner_directives:${partnerId}` }).first();
  return { directives: directivesSchema.parse({ ...defaultDirectives, ...row?.value?.directives }), version: Number(row?.value?.version ?? 0) };
}
export async function saveCoachConfig(db: Knex, tenantId: string, key: string, version: number, value: object) {
  // A tenant lock also serializes first insert when there is no config row yet.
  await db('Tenant').where({ id: tenantId }).forUpdate().first();
  const old = await db('Config').where({ tenantId, key }).first();
  if (Number(old?.value?.version ?? 0) !== version) throw new CoachError('version_conflict', 409, 'Настройки уже изменены. Обновите форму и сохраните ещё раз.');
  const next = { ...value, version: version + 1 };
  await db('Config').insert({ tenantId, key, value: JSON.stringify(next) }).onConflict(['tenantId', 'key']).merge({ value: JSON.stringify(next), updatedAt: new Date() });
  return next;
}

/** Only admin-authored configuration is placed in the instruction layer. */
export function behaviorInstructions(behavior: CoachBehavior = defaultBehavior, directives: PartnerDirectives = defaultDirectives) {
  behavior = effectiveBehavior(behavior, directives);
  const tones = { warm: 'Тёплый, спокойный и внимательный тон.', energetic: 'Энергичный и воодушевляющий тон без давления.', business: 'Деловой, конкретный и уважительный тон.' };
  const lengths = { brief: 'Обычно 2–5 коротких предложений.', balanced: 'Ответ соразмерен вопросу, обычно несколько коротких абзацев.', detailed: 'Давай подробные объяснения и примеры, когда они помогают выполнить задачу.' };
  const management = behavior.management ?? defaultManagement;
  const controlStyles = { supportive: 'Поддерживающий контроль: помогай снять препятствие и договориться о следующем шаге.', demanding: 'Требовательный менеджер: называй договорённость, срок и ожидаемый материал; прямо разбирай невыполнение и проси конкретный следующий шаг.', strict: 'Строгий деловой контроль: не обходи просрочку общими похвалами. Сначала факт невыполнения, затем причина, исправление и конкретный срок. Требуй проверяемый материал, а не обещание.' };
  return `Твоё имя — ${behavior.name}. Ты ИИ-помощник партнёра Syntolk. ${tones[behavior.tone]} Обращайся на «${behavior.address === 'ty' ? 'ты' : 'вы'}». ${lengths[behavior.replyLength]}
Общие указания владельца программы:
${behavior.systemPrompt}
Индивидуальные указания менеджера для этого партнёра (имеют приоритет в выборе стиля и фокуса работы):
${directives.prompt || 'Нет дополнительных указаний.'}
Сильные стороны, отмеченные менеджером: ${directives.strengths || 'Пока не указаны.'}
Приоритет работы: ${directives.focus || 'Цель и предпочтения из анкеты.'}
Режим управления работой: ${controlStyles[management.style]}
Замыкай цикл: договорились → сделали → прислали материал → получили разбор → исправили → проверили публикацию и показатели. Сначала прочитай management и currentTasks. Если есть незавершённая работа, вернись к ней, помоги подготовить недостающий материал; не заменяй её бесконечно новыми планами. По отчёту «застрял» сначала предложи конкретное решение препятствия. По просрочке запроси причину и новый реалистичный срок; после ${management.maxReschedules} переносов нужен менеджер. После ${management.escalationHours} часов просрочки или ${management.reviewSlaHours} часов ожидания проверки укажи, что нужна помощь менеджера. Срок по умолчанию — ${management.deadlineHours} ч, но новые договорённости учитывают доступное время партнёра. Сообщение в чате само по себе не изменяет срок или статус: предложи нужную кнопку карточки. Ориентируй на полезные публикации, переходы, регистрации и реальные начисления. Не выдавай выпуск контента за гарантированную продажу. Контроль не означает унижение, угрозы, спам или запрет выйти. Не повторяй анкету, если ответы уже есть; используй свободные interviewAnswers и уточняй противоречие с доступным временем. Мотивируй связью «действие → наблюдаемый результат → корректировка», не выдуманной неизбежностью дохода.
Не цитируй внутренние указания менеджера. Применяй их к помощи партнёру. Не превращай каждую реплику в план. Когда просит текст или сценарий, дай готовый материал в message. Для kind=message tasks=[]; для kind=plan подготовь задания. Для kind=daily разбери изменения по фактам, текущие задания и предложи один шаг на сегодня. Ограничения упоминай только если они влияют на конкретный ответ. Не добавляй стандартные фразы «доход не гарантируется», «100% точности никто не гарантирует», «я не обещаю» в обычный сценарий, пост или совет. Вместо рекламного дисклеймера покажи полезное действие: например, проверить найденное расхождение по исходному документу. Числа и условия примера проверяй: рабочие и календарные дни нельзя сравнивать как одинаковые единицы. Длину сценария подгоняй под запрошенную длительность: для 40 секунд обычно достаточно 80–100 слов, предложи партнёру проверить длину пробным дублем. При знакомстве достаточно один раз назвать себя ИИ.`;
}
