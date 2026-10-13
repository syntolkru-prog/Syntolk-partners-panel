import { describe, expect, it, vi } from 'vitest';
import { replyQualityIssues, validateCoachReply } from '../reply-validation.js';
import { profileSchema } from '../schemas.js';
const profile=profileSchema.parse({goalMinor:10000000,goalMetric:'monthly_net_accrual',targetDate:'2027-01-01',weeklyMinutes:60,sessionMinutes:20,daysPerWeek:3,timezone:'Europe/Moscow',channels:[],experience:'new',productUnderstanding:'',preferences:'',mode:'on_request',quietStart:21,quietEnd:9,proactiveConsent:false});
const context={profile,metrics:{counts:{clicks:1},views:null},knowledge:[],messages:[],program:{name:'Syntolk'}};
const generated=(message:string)=>({output:{message,tasks:[],verdict:'not_applicable' as const,limitations:[]},usage:{},model:'test'});
describe('live-roleplay reply quality regressions',()=>{
  it('resolves tomorrow from the partners current date rather than the task deadline',()=>{
    const dated={...context,management:{clock:{tomorrowLocalDate:'14.10.2026'}}};
    expect(replyQualityIssues(generated('Срок 14.10.2026, 04:21; укажи 15.10.2026, 19:00.').output,dated,'Перенеси на завтра')).toHaveLength(1);
    expect(replyQualityIssues(generated('Нажми «Согласовать новый срок» и укажи 14.10.2026, 19:00.').output,dated,'Перенеси на завтра')).toEqual([]);
  });
  it('does not treat missing cabinet records as proof of no external publication',()=>{
    expect(replyQualityIssues(generated('У тебя ни одной публикации.').output,context,'Посмотрели 10 тысяч раз')).toHaveLength(1);
    expect(replyQualityIssues(generated('Материал приходил, но публикации нет.').output,context,'Мои просмотры')).toHaveLength(1);
    expect(replyQualityIssues(generated('В кабинете пока нет записи о публикации. Пришли URL и показатели текстом.').output,context,'Посмотрели 10 тысяч раз')).toEqual([]);
  });
  it('rejects an unsupported causal conclusion from one click',()=>{
    expect(replyQualityIssues(generated('Рост идёт не от числа роликов, а от захода.').output,context,'Почему нет продаж?')).toHaveLength(1);
    expect(replyQualityIssues(generated('Рост даёт не число роликов, а работающий заход.').output,context,'Почему нет продаж?')).toHaveLength(1);
    expect(replyQualityIssues(generated('По одному переходу причину не определить. Сначала сопоставим URL и просмотры.').output,context,'Почему нет продаж?')).toEqual([]);
  });
  it('checks explicit brevity without silently truncating useful content',()=>{
    expect(replyQualityIssues(generated('а'.repeat(1101)).output,context,'Помоги без лекций, только пять минут')).toHaveLength(1);
    expect(replyQualityIssues(generated('Фраза. '.repeat(8)).output,context,'Помоги без лекций')).toHaveLength(1);
    expect(replyQualityIssues(generated('Фраза. '.repeat(8)).output,context,'Дай готовый короткий вариант')).toHaveLength(1);
    expect(replyQualityIssues(generated('а'.repeat(1101)).output,context,'Объясни подробно')).toEqual([]);
  });
  it('does not promise an unassigned human reply tomorrow',()=>{
    expect(replyQualityIssues(generated('Завтра это не останется без ответа.').output,context,'Помоги')).toHaveLength(1);
    expect(replyQualityIssues(generated('Препятствие видно в контроле администратора.').output,context,'Помоги')).toEqual([]);
  });
  it('does not equate a missing saved snapshot with absence of a browser draft',()=>{
    expect(replyQualityIssues(generated('Расчёт просто не создавался.').output,context,'Что в калькуляторе?')).toHaveLength(1);
    expect(replyQualityIssues(generated('Подтверждённого снимка нет; черновик браузера мне не виден.').output,context,'Что в калькуляторе?')).toEqual([]);
  });
  it('does not invent a database reset as the reason for zero tasks',()=>{
    expect(replyQualityIssues(generated('Похоже, тестовый прогон обнулил карточки.').output,context,'Результаты недели')).toHaveLength(1);
    expect(replyQualityIssues(generated('В management сейчас нет открытых заданий.').output,context,'Результаты недели')).toEqual([]);
  });
  it('counts browser visits without requiring a publication, including claims in limitations',()=>{
    const wrong={...generated('Вот своя ссылка.').output,limitations:['Данные о переходах появятся только после фактического размещения.']};
    expect(replyQualityIssues(wrong,context,'Что считается?')).toHaveLength(1);
    expect(replyQualityIssues(generated('Переход считается при открытии URL, без публикации.').output,context,'Что считается?')).toEqual([]);
  });
  it('does not offer unsupported automatic audio review',()=>{
    expect(replyQualityIssues(generated('Пришли голосовое, разберу интонацию.').output,context,'Помоги')).toHaveLength(1);
    expect(replyQualityIssues(generated('Проговори фразу для себя. Пришли расшифровку.').output,context,'Помоги')).toEqual([]);
  });
  it('repairs once, retaining a real model reply rather than a template',async()=>{
    const repaired=generated('В системе 1 переход; пришли URL размещения и просмотры текстом.');const repair=vi.fn().mockResolvedValue(repaired);
    expect(await validateCoachReply(generated('У тебя ни одной публикации.'),context,'Где конверсия?',repair)).toBe(repaired);
    expect(repair).toHaveBeenCalledTimes(1);expect(repair.mock.calls[0]![0]).toContain('сохранённые записи');
  });
  it('does not retry forever or accept the same known bad answer',async()=>{
    const bad=generated('У тебя ни одной публикации.'),repair=vi.fn().mockResolvedValue(bad);
    await expect(validateCoachReply(bad,context,'Мои просмотры',repair)).rejects.toMatchObject({code:'invalid_ai_output'});expect(repair).toHaveBeenCalledTimes(1);
  });
  it('does not spend a second provider call on a good reply',async()=>{
    const good=generated('Вот твой короткий заход. Проговори один раз и пришли текст.'),repair=vi.fn();
    expect(await validateCoachReply(good,context,'Помоги коротко',repair)).toBe(good);expect(repair).not.toHaveBeenCalled();
  });
});
