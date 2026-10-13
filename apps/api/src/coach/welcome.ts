import type { CoachProfile } from './schemas.js';
import { defaultBehavior, type CoachBehavior } from './behavior.js';

/** No paid request or external disclosure on login. */
export function welcomeMessage(name: string, profile?: CoachProfile, taskTitle?: string, takeover = false, behavior: CoachBehavior = defaultBehavior) {
  const first = name.trim().split(/\s+/)[0] || 'партнёр';
  if (takeover) return `Привет, ${first}! Сейчас тебя сопровождает менеджер Syntolk. Напиши в чат — сообщение сохранится для него.`;
  if (profile && ['paused', 'off'].includes(profile.mode)) return `Привет, ${first}! Сопровождение на паузе. Твои планы и история сохранены. Вернуться можно в любое время в настройках.`;
  if (behavior.greeting) return behavior.greeting.replace(/\{(name|assistant|goal)\}/g, (_, key: string) => ({ name: first, assistant: behavior.name, goal: profile ? `${(profile.goalMinor / 100).toLocaleString('ru-RU')} ₽` : 'твоя цель' })[key]!);
  const formal = behavior.address === 'vy';
  if (!profile) return `Привет, ${first}! Я ${behavior.name}, ${formal ? 'ваш' : 'твой'} ИИ-помощник Syntolk. Вместе пройдём путь от идеи до первых результатов: помогу с текстами, роликами и ссылками. ${formal ? 'Расскажите' : 'Расскажи'} о цели и времени — подберём первый шаг.`;
  const goal = (profile.goalMinor / 100).toLocaleString('ru-RU');
  return `Привет, ${first}! Продолжим вместе. ${formal ? 'Ваша' : 'Твоя'} цель — ${goal} ₽ в месяц (${profile.goalMetric === 'monthly_paid' ? 'выплаты' : 'начисления'}). У нас ${profile.weeklyMinutes} минут в неделю. ${taskTitle ? `Ближайший шаг — «${taskTitle}».` : 'Выберем шаг на сегодня.'} ${formal ? 'Хотите' : 'Хочешь'}, помогу с идеей или сразу подготовим материал?`;
}
