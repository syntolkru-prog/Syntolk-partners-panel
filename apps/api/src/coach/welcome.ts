import type { CoachProfile } from './schemas.js';

/** No paid request or external disclosure on login. */
export function welcomeMessage(name: string, profile?: CoachProfile, taskTitle?: string, takeover = false) {
  const first = name.trim().split(/\s+/)[0] || 'партнёр';
  if (takeover) return `Привет, ${first}! Сейчас тебя сопровождает менеджер Syntolk. Напиши в чат — сообщение сохранится для него.`;
  if (profile && ['paused', 'off'].includes(profile.mode)) return `Привет, ${first}! Сопровождение на паузе. Твои планы и история сохранены. Вернуться можно в любое время в настройках.`;
  if (!profile) return `Привет, ${first}! Я твой ИИ-помощник Syntolk. Давай вместе разберёмся, как продвигать продукт: помогу с идеями, текстами, ссылками и разбором результатов. Для начала расскажи о своей цели и времени — начнём с посильного шага.`;
  const goal = (profile.goalMinor / 100).toLocaleString('ru-RU');
  return `Привет, ${first}! Я твой ИИ-помощник. Продолжим вместе. Помню твою цель: ${goal} ₽ в месяц (${profile.goalMetric === 'monthly_paid' ? 'выплаты' : 'чистые начисления'}), к ${profile.targetDate}. У нас ${profile.weeklyMinutes} минут в неделю. ${taskTitle ? `Ближайший шаг — «${taskTitle}».` : 'Выберем один полезный шаг на сегодня.'} Если сложно, разберём и упростим задачу. Доход зависит от результатов, а план можно менять или поставить на паузу.`;
}
