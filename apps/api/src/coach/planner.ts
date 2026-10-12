import { type CoachProfile, type CoachOutput, validatePlan } from './schemas.js';

const names = { post: 'полезный пост', circle: 'кружочек и сообщение со ссылкой', short: 'короткий демонстрационный ролик', long: 'подготовку подробного обзора', article: 'полезную статью' };
export function templatePlan(profile: CoachProfile): CoachOutput {
  const minutes = Math.min(profile.sessionMinutes, profile.weeklyMinutes);
  if (minutes < 10) return { message: 'Сейчас времени для сессии недостаточно. Можно изменить доступное время или поставить сопровождение на паузу.', tasks: [], verdict: 'not_applicable', limitations: ['Демонстрационный шаблон, не ответ ИИ.'] };
  const channel = profile.channels[0];
  const format = channel?.formats.find(f => f === 'post' || f === 'circle') ?? channel?.formats[0] ?? 'post';
  const prepare = !channel || profile.experience === 'new' || (['long', 'article'].includes(format) && minutes < 60);
  const count = Math.min(profile.daysPerWeek, Math.floor(profile.weeklyMinutes / minutes), 3);
  const tasks = Array.from({ length: count }, (_, i) => {
    const start = Math.max(2, Math.floor(minutes * .2));
    const finish = Math.max(3, Math.floor(minutes * .2));
    return {
      title: prepare ? 'Разобраться в Syntolk и подготовить демонстрационный пример' : `Подготовить ${names[format]}${i ? `: новая задача аудитории №${i + 1}` : ''}`,
      platform: channel?.platform ?? 'preparation', format, minutes,
      steps: [
        { title: 'Выбрать одну понятную задачу аудитории и разрешённый пример', minutes: start },
        { title: prepare ? 'На синтетическом документе попробовать поиск или сравнение; записать наблюдения' : `Адаптировать материал под аудиторию: ${channel?.audience || 'ваши читатели'}`, minutes: minutes - start - finish },
        { title: prepare ? 'Прислать выводы и выбрать будущую площадку' : 'Подготовить собственную ссылку, разместить материал и прислать URL публикации', minutes: finish },
      ],
      draft: 'Syntolk помогает искать информацию и сравнивать документы. Покажите один пример: какие условия отличаются в двух синтетических редакциях договора. Проверьте ответ по источникам. Добавьте собственную ссылку после её создания в задании. Не обещайте безошибочность и гарантированный доход.',
      criteria: prepare ? 'Описана проверенная задача продукта, выбрана площадка. Доход не является условием выполнения.' : 'Понятный кейс Syntolk, корректный призыв попробовать продукт и собственная ссылка. Пришлите URL и текст публикации.',
    };
  });
  validatePlan(tasks, profile);
  return { message: `План на ${tasks.reduce((s,t) => s + t.minutes, 0)} минут. Начните с одного полезного примера. Это демонстрационный план по шаблонам; доход не гарантируется.`, tasks, verdict: 'not_applicable', limitations: ['Охваты и конверсии не предсказываются без данных.', 'Демонстрационный режим: ИИ-провайдер не используется.'] };
}
export function templateReply(message: string, profile: CoachProfile): CoachOutput {
  return { message: `Вы написали: «${message.slice(0, 160)}». Доступно ${profile.weeklyMinutes} минут в неделю. Откройте активное задание: я помогу с полезным примером Syntolk, текстом и собственной ссылкой. В демонстрационном режиме ответы шаблонные; для свободного диалога администратору нужно подключить ИИ.`, tasks: [], verdict: 'not_applicable', limitations: ['Демонстрационный ответ, не языковая модель.'] };
}
