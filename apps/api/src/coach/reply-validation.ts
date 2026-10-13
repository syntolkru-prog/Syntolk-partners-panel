import { CoachError, type CoachOutput } from './schemas.js';
import type { CoachContext } from './provider.js';

interface Generated { output: CoachOutput; usage: Record<string, unknown>; model: string }

/** Narrow regression checks, not a claim of complete semantic verification. */
export function replyQualityIssues(output: CoachOutput, context: CoachContext, request: string): string[] {
  const text = output.message;
  const factsText = [text, ...output.limitations].join('\n');
  const issues: string[] = [];
  const clock = (context.management as { clock?: { tomorrowLocalDate?: string } } | undefined)?.clock;
  const proposedDate = text.match(/(?:укажи|поставь|выбери|перенеси|новый срок\s*[:—-])\s*(\d{2}\.\d{2}\.\d{4})/i)?.[1];
  if (/завтра/i.test(request) && clock?.tomorrowLocalDate && proposedDate && proposedDate !== clock.tomorrowLocalDate) {
    issues.push(`«Завтра» — ${clock.tomorrowLocalDate} в часовом поясе партнёра, а не следующий день от dueAt задания. Укажи именно эту дату; чат срок сам не меняет.`);
  }
  const sentences = text.split(/[.!?](?:»|”)?(?:\s+|$)/u).filter(part => /[\p{L}\p{N}]/u.test(part)).length;
  if (/коротк(?:о|ий|ую|ое)|без лекций|не засыпай теорией|только пять минут/i.test(request) && (text.length > 1100 || sentences > 6)) {
    issues.push('Партнёр просит короткий ответ: максимум пять коротких предложений, до 1100 символов. Убери повтор анкеты, дедлайнов и цели, если об этом не спрашивали.');
  }
  if (/у тебя (?:нет |не было )?ни одной публикации|у тебя нет публикаций|ты (?:ничего|ещ[её] ничего) не публиковал|(?:но|[,;—])\s*(?:внешней )?публикации нет/i.test(text)) {
    issues.push('Нельзя утверждать отсутствие внешних публикаций: система знает только сохранённые записи. Напиши «в кабинете пока нет записи о публикации» и уточни последнее сообщение партнёра.');
  }
  const counts = (context.metrics as { counts?: { clicks?: number } } | null)?.counts;
  if ((counts?.clicks ?? 0) < 30 && /не от (?:числа|количества) (?:роликов|публикаций|видео|постов)|(?:рост|результат)\s+(?:да[её]т|приносит|ид[её]т)\s+не\s+(?:число|количество)|(?:заход|призыв).{0,35}не срабатыва(?:ет|ют)(?!.*гипотез)/i.test(text)) {
    issues.push('По малой выборке нельзя объявлять причиной заход или количество роликов. Удали причинный вывод; предложи один замер для проверки гипотезы, не отвергая просмотры из самоотчёта.');
  }
  if (/(?:пришли|присылай|скинь|отправь).{0,45}(?:голосов|аудио).{0,100}(?:разберу|послушаю|интонаци)/is.test(text)) {
    issues.push('Автоматического разбора аудио нет. Проси текст или расшифровку; проговорить фразу для себя можно, прислать аудио на прослушивание нельзя.');
  }
  if (/я подключу менеджера|(?:завтра|сегодня|обязательно|точно).{0,70}не останется без ответа/i.test(text)) {
    issues.push('Чат не назначает менеджера и не гарантирует срок его ответа. Можно сообщить только о существующей отметке в контроле администратора.');
  }
  if (!context.forecast && /расч[её]т (?:просто )?не создавался|ты (?:ещ[её] )?ничего не считал/i.test(text)) {
    issues.push('Отсутствие подтверждённого снимка не означает отсутствие расчёта в браузере. Сообщи только, что снимок не сохранён; путь сохранения возьми точно из capabilities.calculator.instructions.');
  }
  if (/(?:тестовый прогон|миграция|тест) (?:обнулил[аи]?|удалил[аи]?|сбросил[аи]?)/i.test(text)) {
    issues.push('Отсутствие заданий не доказывает сброс или удаление карточек. Причина не известна; назови только текущий факт из management, не выдумывай историю изменения базы.');
  }
  if (/(?:данные|переходы|начисления).{0,100}(?:только после|после фактического) (?:размещ|публик)/i.test(factsText)) {
    issues.push('Счётчик переходов работает при открытии URL, даже без публикации и без сдачи задания. Нельзя обещать появление данных только после размещения; регистрации/оплаты учитываются отдельными событиями интеграции.');
  }
  return issues;
}

/** One bounded repair; an unchanged known-bad reply is never marked successful. */
export async function validateCoachReply(result: Generated, context: CoachContext, request: string, repair: (feedback: string) => Promise<Generated>): Promise<Generated> {
  const issues = replyQualityIssues(result.output, context, request);
  if (!issues.length) return result;
  const fixed = await repair(`Сервер отклонил предыдущую реплику по проверкам качества. Ответь заново на исходный вопрос, используя актуальные факты, а не ошибки прежних ответов. Исправь:\n${issues.join('\n')}\nВерни JSON исходной схемы. Для диалога tasks=[]; не создавай новый план.`);
  if (replyQualityIssues(fixed.output, context, request).length) throw new CoachError('invalid_ai_output', 422, 'ИИ не прошёл проверку качества ответа. Сообщение сохранено; попробуйте уточнить вопрос.');
  return fixed;
}
