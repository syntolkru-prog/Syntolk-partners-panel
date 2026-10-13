import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { ulid } from 'ulid';
import { createApp } from '../../app.js';
import { db, appDb } from '../../db.js';
import { generateApiKey } from '../../auth.js';
import { COACH_TABLES, DEFAULT_TENANT_ID } from '@openpartner/db';
import { assertIsolatedCoachDatabase } from '../test-guard.js';
import { behaviorSchema, defaultBehavior, defaultDirectives, effectiveBehavior } from '../behavior.js';
import { buildCoachContext } from '../context.js';
import { localReviewTime, scheduleDailyReviews } from '../daily-reviews.js';
import { generateCoachOutput } from '../provider.js';
import { profileSchema, type CoachProfile } from '../schemas.js';
import { processCoachJob } from '../worker.js';

assertIsolatedCoachDatabase(process.env.DATABASE_URL!, process.env.COACH_WORKING_DB);

const app = createApp({ enableLogger: false });
const tenantId = DEFAULT_TENANT_ID;
const admin = process.env.ADMIN_API_KEY!;
const auth = (token: string) => `Bearer ${token}`;

const profile = profileSchema.parse({
  goalMinor: 3000000,
  goalMetric: 'monthly_net_accrual',
  targetDate: '2027-01-01',
  weeklyMinutes: 120,
  sessionMinutes: 30,
  daysPerWeek: 3,
  timezone: 'Europe/Moscow',
  channels: [{ platform: 'telegram', label: 'Тестовый канал', formats: ['post'], audience: 'Юристы', views: null }],
  experience: 'tried',
  productUnderstanding: 'Помощник по документам',
  preferences: 'Без камеры',
  mode: 'on_request',
  quietStart: 21,
  quietEnd: 9,
  proactiveConsent: false,
});

let partnerId: string;
let otherId: string;
let programId: string;
let key: string;
let otherKey: string;

const get = (path: string, token = key) => request(app).get(path).set('Authorization', auth(token));
const patch = (path: string, body: object, token = admin) => request(app).patch(path).set('Authorization', auth(token)).send(body);

async function insertLink(ownerId: string, linkKey: string, campaign = programId) {
  const [row] = await db('Link').insert({
    id: ulid(), tenantId, partnerId: ownerId, programId: campaign, linkKey,
    label: linkKey, channel: 'telegram', destinationUrl: null,
  }).returning('*');
  return row;
}

async function saveProfile(ownerId = partnerId, value: CoachProfile = profile, version = 1) {
  await db('CoachProfile').insert({ id: ulid(), tenantId, partnerId: ownerId, status: 'complete', version, data: JSON.stringify(value) });
}

async function setDirectives(ownerId: string, directives: object, version = 0) {
  await db('Config').insert({ tenantId, key: `coach_partner_directives:${ownerId}`, value: JSON.stringify({ directives, version }) });
}

async function createDailyFixture(value: Partial<CoachProfile> = {}) {
  const dailyProfile = profileSchema.parse({ ...profile, mode: 'active', proactiveConsent: true, quietStart: 0, quietEnd: 0, ...value });
  await saveProfile(partnerId, dailyProfile);
  await setDirectives(partnerId, { ...defaultDirectives, dailyReviewEnabled: true, dailyReviewHour: 10 });
  return dailyProfile;
}

beforeAll(async () => { await db.raw('select 1'); });

beforeEach(async () => {
  for (const table of [...COACH_TABLES].reverse()) await db(table).where({ tenantId }).del();
  await db('Config').where({ tenantId, key: 'coach_behavior' }).del();
  await db('Config').where({ tenantId }).where('key', 'like', 'coach_partner_directives:%').del();

  const settings = { enabled: true, provider: 'template', dailyRuns: 20, takeover: [] };
  await db('Config').insert({ tenantId, key: 'coach_settings', value: JSON.stringify(settings) })
    .onConflict(['tenantId', 'key']).merge({ value: JSON.stringify(settings) });

  partnerId = ulid();
  otherId = ulid();
  programId = ulid();
  await db('Partner').insert([
    { id: partnerId, tenantId, name: 'Иван Партнёр', email: `${partnerId}@example.test`, activatedAt: new Date() },
    { id: otherId, tenantId, name: 'Другой партнёр', email: `${otherId}@example.test`, activatedAt: new Date() },
  ]);
  await db('Program').insert({
    id: programId, tenantId, name: 'Syntolk 20%', destinationUrl: 'https://syntolk.ru/',
    commissionRule: JSON.stringify({ type: 'percent', value: 20, recurring: true }), attributionWindowDays: 30,
  });
  await db('PartnerProgram').insert({ id: ulid(), tenantId, partnerId, programId, source: 'admin' });

  for (const ownerId of [partnerId, otherId]) {
    const generated = generateApiKey();
    await db('ApiKey').insert({ id: ulid(), tenantId, partnerId: ownerId, prefix: generated.prefix, keyHash: generated.hash, label: 'personalization test' });
    if (ownerId === partnerId) key = generated.plaintext;
    else otherKey = generated.plaintext;
  }
});

afterAll(async () => { await db.destroy(); await appDb.destroy(); });

describe('admin behavior and partner directives', () => {
  it('returns the default behavior, saves every personalization field, and rejects a stale version', async () => {
    const initial = await get('/admin/coach/behavior', admin);
    expect(initial.status, initial.text).toBe(200);
    expect(initial.body).toEqual({ behavior: defaultBehavior, version: 0 });

    const behavior = behaviorSchema.parse({
      name: 'Синти для партнёров', tone: 'energetic', address: 'vy', replyLength: 'detailed',
      systemPrompt: 'Глобальная инструкция владельца Syntolk.', greeting: 'Здравствуйте!', mascotEnabled: false,
    });
    const saved = await patch('/admin/coach/behavior', { version: 0, behavior });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body).toEqual({ behavior, version: 1 });

    const reloaded = await get('/admin/coach/behavior', admin);
    expect(reloaded.body).toEqual({ behavior, version: 1 });
    const conflict = await patch('/admin/coach/behavior', { version: 0, behavior });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('version_conflict');
  });

  it('keeps directives isolated per partner and exposes scheduler state', async () => {
    const first = { ...defaultDirectives, prompt: 'Ивану — больше примеров для Telegram.', strengths: 'Сильный разбор кейсов.', focus: 'Первые регистрации.', dailyReviewEnabled: true, dailyReviewHour: 11 };
    const saved = await patch(`/admin/coach/partners/${partnerId}/directives`, { version: 0, directives: first });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.directives).toEqual(first);
    expect(saved.body.version).toBe(1);

    const own = await get(`/admin/coach/partners/${partnerId}/directives`, admin);
    const other = await get(`/admin/coach/partners/${otherId}/directives`, admin);
    expect(own.body.directives).toEqual(first);
    expect(own.body.version).toBe(1);
    expect(typeof own.body.schedulerEnabled).toBe('boolean');
    expect(other.body.directives).toEqual(defaultDirectives);
    expect(other.body.version).toBe(0);
    expect(other.body.directives).not.toEqual(first);

    const stale = await patch(`/admin/coach/partners/${partnerId}/directives`, { version: 0, directives: first });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('version_conflict');
  });

  it('does not let a partner call admin personalization APIs', async () => {
    for (const path of ['/admin/coach/behavior', `/admin/coach/partners/${partnerId}/directives`, `/admin/coach/partners/${partnerId}/context?programId=${programId}`]) {
      expect((await get(path, key)).status).toBe(403);
      expect((await get(path, otherKey)).status).toBe(403);
    }
  });

  it('returns only the public assistant profile to the partner cabinet', async () => {
    const behavior = { ...defaultBehavior, name: 'Синти-Иван', systemPrompt: 'СЕКРЕТНАЯ ГЛОБАЛЬНАЯ ИНСТРУКЦИЯ' };
    await patch('/admin/coach/behavior', { version: 0, behavior });
    await setDirectives(partnerId, { ...defaultDirectives, prompt: 'СЕКРЕТНАЯ ПЕРСОНАЛЬНАЯ ИНСТРУКЦИЯ' }, 0);

    const response = await get('/coach/me');
    expect(response.status, response.text).toBe(200);
    expect(response.body.assistant).toEqual({ name: behavior.name, greeting: behavior.greeting, mascotEnabled: behavior.mascotEnabled });
    expect(response.body.assistant).not.toHaveProperty('systemPrompt');
    expect(response.body.assistant).not.toHaveProperty('directives');
    expect(JSON.stringify(response.body.assistant)).not.toContain('СЕКРЕТНАЯ');
  });
});

describe('admin context scoping and calculator evidence', () => {
  it('limits context to the granted program, own links, 24 messages, submitted text, and confirmed forecast', async () => {
    const ownLink = await insertLink(partnerId, `ivan-${ulid().toLowerCase()}`);
    const foreignLink = await insertLink(otherId, `other-${ulid().toLowerCase()}`);
    await saveProfile();

    const planId = ulid();
    await db('CoachPlan').insert({ id: planId, tenantId, partnerId, programId, status: 'active', weekStart: '2026-10-12', data: JSON.stringify({ message: 'Активный план', plannedMinutes: 30 }) });
    await db('CoachTask').insert({
      id: ulid(), tenantId, partnerId, programId, planId, status: 'submitted', version: 2, minutes: 30,
      dueAt: new Date(), data: JSON.stringify({ title: 'Опубликовать кейс', format: 'post', platform: 'telegram', submission: { text: 'Текст отправленного партнёром материала', publicationUrl: 'https://t.me/syntolk/1' } }),
    });

    const messages = Array.from({ length: 30 }, (_, index) => ({
      id: ulid(), tenantId, partnerId, programId, role: index % 2 ? 'assistant' : 'partner', status: 'sent',
      clientMessageId: `message-${index}-${ulid()}`, data: JSON.stringify({ body: `сообщение-${index}` }),
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
    }));
    await db('CoachMessage').insert(messages);
    await db('CoachMessage').insert({ id: ulid(), tenantId, partnerId: otherId, programId, role: 'partner', status: 'sent', data: JSON.stringify({ body: 'ЧУЖОЕ СООБЩЕНИЕ' }) });

    const beforeCalculator = await get(`/admin/coach/partners/${partnerId}/context?programId=${programId}`, admin);
    expect(beforeCalculator.status, beforeCalculator.text).toBe(200);
    expect(new Date(beforeCalculator.body.generatedAt).toString()).not.toBe('Invalid Date');
    expect(beforeCalculator.body.context.forecast).toBeNull();
    expect(beforeCalculator.body.capabilities.calculatorSnapshot).toBe(false);
    expect(beforeCalculator.body.context.links.map((link: { id: string }) => link.id)).toContain(ownLink.id);
    expect(beforeCalculator.body.context.links.map((link: { id: string }) => link.id)).not.toContain(foreignLink.id);
    expect(beforeCalculator.body.context.messages).toHaveLength(24);
    expect(beforeCalculator.body.context.messages.map((message: { body: string }) => message.body)).not.toContain('сообщение-0');
    expect(beforeCalculator.body.context.messages.map((message: { body: string }) => message.body)).not.toContain('ЧУЖОЕ СООБЩЕНИЕ');
    expect(beforeCalculator.body.context.currentTasks[0].submission.text).toContain('отправленного');
    expect(beforeCalculator.body.context.currentTasks[0].submission.publicationUrl).toBe('https://t.me/syntolk/1');
    expect(beforeCalculator.body.context.links[0].url).toContain(`/r/${ownLink.linkKey}`);

    const scenarios = ['conservative', 'base', 'optimistic'].map((scenario, scenarioIndex) => ({
      scenario,
      result: { months: Array.from({ length: 12 }, (_, month) => ({ reward: scenarioIndex * 100 + month + 1, cumulative: (scenarioIndex * 100 + month + 1) * (month + 1) })) },
    }));
    await db('CoachForecastSnapshot').insert({
      id: ulid(), tenantId, partnerId, programId, status: 'confirmed',
      data: JSON.stringify({ source: 'browser_confirmed', modelHash: 'test-model', verified: true, commission: 0.2, settings: { amount: 1000 }, scenarios }),
    });
    const afterCalculator = await get(`/admin/coach/partners/${partnerId}/context?programId=${programId}`, admin);
    expect(afterCalculator.body.context.forecast.source).toBe('confirmed_forecast_not_actual');
    expect(afterCalculator.body.context.forecast.scenarios).toHaveLength(3);
    expect(afterCalculator.body.capabilities.calculatorSnapshot).toBe(true);
    expect(JSON.stringify(afterCalculator.body.context.forecast)).not.toContain('unsaved');
  });

  it('requires a real grant and never substitutes another partner or program', async () => {
    const response = await get(`/admin/coach/partners/${otherId}/context?programId=${programId}`, admin);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('program_not_granted');
    const missingProgram = await get(`/admin/coach/partners/${partnerId}/context?programId=${ulid()}`, admin);
    expect(missingProgram.status).toBe(403);
    expect(missingProgram.body.error).toBe('program_not_granted');
  });

  it('builds the same scoped context directly as the admin inspector', async () => {
    const ownLink = await insertLink(partnerId, `direct-${ulid().toLowerCase()}`);
    const context = await buildCoachContext(db, tenantId, partnerId, programId);
    expect(context.program.name).toBe('Syntolk 20%');
    expect(context.links).toEqual(expect.arrayContaining([expect.objectContaining({ id: ownLink.id, url: expect.stringContaining(`/r/${ownLink.linkKey}`) })]));
    expect(context.links.every(link => link.url.includes(ownLink.linkKey))).toBe(true);
  });
});

describe('daily review scheduling and worker delivery', () => {
  const afterReviewHour = new Date('2026-10-13T08:00:00.000Z'); // 11:00 in Europe/Moscow

  it.each(['on_request', 'gentle', 'active'] as const)('admin queues one daily review for %s without separate partner consent', async mode => {
    await createDailyFixture({ mode, proactiveConsent: false, aiConsent: false });
    expect(localReviewTime(afterReviewHour, profile.timezone)).toEqual({ day: '2026-10-13', hour: 11 });
    await scheduleDailyReviews(afterReviewHour);
    const runs = await db('CoachRun').where({ tenantId, partnerId, kind: 'daily' });
    expect(runs).toHaveLength(1);
    expect(runs[0].dedupeKey).toBe('daily:2026-10-13');
    expect(runs[0].programId).toBe(programId);
    expect((await db('CoachAuditEvent').where({ tenantId, partnerId, status: 'daily_review_queued' }))).toHaveLength(1);

    await scheduleDailyReviews(new Date('2026-10-13T12:00:00.000Z'));
    expect(await db('CoachRun').where({ tenantId, partnerId, kind: 'daily' })).toHaveLength(1);
  });

  it('does not queue before the local hour, during quiet time, when paused, or during manager takeover', async () => {
    await createDailyFixture({ mode: 'active', quietStart: 21, quietEnd: 9 });
    await db('Config').where({ tenantId, key: `coach_partner_directives:${partnerId}` }).update({ value: JSON.stringify({ directives: { ...defaultDirectives, dailyReviewEnabled: true, dailyReviewHour: 12 }, version: 1 }) });
    await scheduleDailyReviews(afterReviewHour);
    expect(await db('CoachRun').where({ partnerId, kind: 'daily' })).toHaveLength(0);

    await db('CoachProfile').where({ tenantId, partnerId }).update({ data: JSON.stringify({ ...profile, mode: 'active', proactiveConsent: false, quietStart: 21, quietEnd: 9 }) });
    await scheduleDailyReviews(new Date('2026-10-13T20:00:00.000Z'));
    expect(await db('CoachRun').where({ partnerId, kind: 'daily' })).toHaveLength(0);
    await db('CoachProfile').where({ tenantId, partnerId }).update({ data: JSON.stringify({ ...profile, mode: 'paused', proactiveConsent: false, quietStart: 0, quietEnd: 0 }) });
    await db('Config').where({ tenantId, key: `coach_partner_directives:${partnerId}` }).update({ value: JSON.stringify({ directives: { ...defaultDirectives, dailyReviewEnabled: true, dailyReviewHour: 0 }, version: 2 }) });
    await scheduleDailyReviews(afterReviewHour);
    expect(await db('CoachRun').where({ partnerId, kind: 'daily' })).toHaveLength(0);

    await db('CoachProfile').where({ tenantId, partnerId }).update({ data: JSON.stringify({ ...profile, mode: 'paused', proactiveConsent: true, quietStart: 0, quietEnd: 0 }) });
    await db('Config').where({ tenantId, key: 'coach_settings' }).update({ value: JSON.stringify({ enabled: true, provider: 'template', dailyRuns: 20, takeover: [partnerId] }) });
    await scheduleDailyReviews(new Date('2026-10-13T12:00:00.000Z'));
    expect(await db('CoachRun').where({ partnerId, kind: 'daily' })).toHaveLength(0);
  });

  it('respects the configured provider and daily budget', async () => {
    await createDailyFixture();
    await db('Config').where({ tenantId, key: 'coach_settings' }).update({ value: JSON.stringify({ enabled: true, provider: 'openrouter', dailyRuns: 20, takeover: [] }) });
    await scheduleDailyReviews(afterReviewHour);
    expect(await db('CoachRun').where({ partnerId, kind: 'daily' })).toHaveLength(0);

    await db('Config').where({ tenantId, key: 'coach_settings' }).update({ value: JSON.stringify({ enabled: true, provider: 'template', dailyRuns: 1, takeover: [] }) });
    await db('CoachRun').insert({ id: ulid(), tenantId, partnerId, programId, status: 'completed', kind: 'message', dedupeKey: `message:${ulid()}`, data: JSON.stringify({}) });
    await scheduleDailyReviews(new Date('2026-10-13T12:00:00.000Z'));
    expect(await db('CoachRun').where({ partnerId, kind: 'daily' })).toHaveLength(0);
  });
  it('requires admin daily enablement and respects global disable even with legacy consent true', async () => {
    await createDailyFixture({mode:'on_request',proactiveConsent:true,aiConsent:true,quietStart:0,quietEnd:0});
    await db('Config').where({tenantId,key:`coach_partner_directives:${partnerId}`}).update({value:JSON.stringify({directives:{...defaultDirectives,dailyReviewEnabled:false},version:2})});
    await scheduleDailyReviews(afterReviewHour);
    expect(await db('CoachRun').where({partnerId,kind:'daily'})).toHaveLength(0);
    await db('Config').where({tenantId,key:`coach_partner_directives:${partnerId}`}).update({value:JSON.stringify({directives:{...defaultDirectives,dailyReviewEnabled:true},version:3})});
    await db('Config').where({tenantId,key:'coach_settings'}).update({value:JSON.stringify({enabled:false,provider:'template',dailyRuns:20,takeover:[]})});
    await scheduleDailyReviews(afterReviewHour);
    expect(await db('CoachRun').where({partnerId,kind:'daily'})).toHaveLength(0);
  });

  it('processes a queued daily run with a template summary and chat notification', async () => {
    await createDailyFixture();
    const configuredAssistantName = 'Мария';
    await db('Config').insert({ tenantId, key: 'coach_behavior', value: JSON.stringify({ behavior: { ...defaultBehavior, name: configuredAssistantName }, version: 1 }) });
    await scheduleDailyReviews(afterReviewHour);
    const queued = await db('CoachRun').where({ tenantId, partnerId, kind: 'daily' }).first();
    expect(queued).toBeTruthy();
    expect(await processCoachJob()).toBe(true);

    const completed = await db('CoachRun').where({ id: queued!.id }).first();
    expect(completed.status).toBe('completed');
    expect(completed.data.output.message).toContain('За последние 7 дней');
    expect(completed.data.output.message).toContain('с чем поработать сегодня');
    const assistant = await db('CoachMessage').where({ tenantId, partnerId, role: 'assistant' }).first();
    expect(assistant.data.body).toContain('За последние 7 дней');
    const notification = await db('CoachNotification').where({ tenantId, partnerId, dedupeKey: `run:${queued!.id}` }).first();
    expect(notification.status).toBe('unread');
    expect(notification.data.title).toBe(`${configuredAssistantName}: шаг на сегодня`);

    const context = await buildCoachContext(db, tenantId, partnerId, programId, 7);
    expect(context.previousReview).toMatchObject({
      period: completed.data.metrics.period,
      counts: completed.data.metrics.counts,
      amountsMinor: completed.data.metrics.amountsMinor,
      comparison: 'rolling_windows_not_daily_delta',
    });
    expect(new Date(context.previousReview!.at).toString()).not.toBe('Invalid Date');
  });
});

describe('OpenRouter personalization adapter', () => {
  it('applies individual tone and address without changing global behavior', () => {
    const individual = effectiveBehavior(defaultBehavior, { ...defaultDirectives, tone: 'business', address: 'vy', replyLength: 'brief' });
    expect(individual).toMatchObject({ tone: 'business', address: 'vy', replyLength: 'brief', name: defaultBehavior.name });
    expect(defaultBehavior.address).toBe('ty');
    expect(effectiveBehavior(defaultBehavior, defaultDirectives)).toEqual(defaultBehavior);
  });
  it('sends global behavior, partner directives, tone and only authorized link tool data', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-openrouter-key');
    vi.stubEnv('OPENROUTER_MODEL_ID', 'test/model');
    const ownLinks = [{ id: 'own-link', key: 'ivan-telegram', url: 'http://127.0.0.1:5673/r/ivan-telegram' }];
    const context = {
      profile,
      partner: { name: 'Иван Партнёр' },
      metrics: { counts: { clicks: 4, registrations: 2, paymentCount: 1 }, amountsMinor: { netAccrued: 20000 } },
      knowledge: [], messages: [], program: { name: 'Syntolk 20%' }, links: ownLinks,
      behavior: { ...defaultBehavior, name: 'Синти', tone: 'energetic' as const, systemPrompt: 'ГЛОБАЛЬНАЯ ИНСТРУКЦИЯ Syntolk' },
      directives: { ...defaultDirectives, prompt: 'ПЕРСОНАЛЬНАЯ ИНСТРУКЦИЯ ИВАНА' },
    };
    const output = { message: 'Готовый ответ.', tasks: [], verdict: 'not_applicable', limitations: [] };
    const toolResponse = new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'links-call', type: 'function', function: { name: 'get_links', arguments: '{}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0 } }), { status: 200 });
    const finalResponse = new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }], usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0 } }), { status: 200 });
    const fake = vi.fn().mockResolvedValueOnce(toolResponse).mockResolvedValueOnce(finalResponse);
    vi.stubGlobal('fetch', fake);

    try {
      const result = await generateCoachOutput('openrouter', 'message', 'Какой следующий шаг?', context);
      expect(result.output).toEqual(output);
      expect(fake).toHaveBeenCalledTimes(2);
      const first = JSON.parse(fake.mock.calls[0]![1].body);
      const second = JSON.parse(fake.mock.calls[1]![1].body);
      expect(first.messages[0].content).toContain('ГЛОБАЛЬНАЯ ИНСТРУКЦИЯ Syntolk');
      expect(first.messages[0].content).toContain('ПЕРСОНАЛЬНАЯ ИНСТРУКЦИЯ ИВАНА');
      expect(first.messages[0].content).toContain('Энергичный');
      expect(first.messages[1].content).toContain('Иван Партнёр');
      expect(first.tools.map((tool: { function: { name: string } }) => tool.function.name)).toContain('get_links');
      const toolMessage = second.messages.find((message: { role: string }) => message.role === 'tool');
      expect(toolMessage.content).toBe(JSON.stringify(ownLinks));
      expect(toolMessage.content).not.toContain('foreign');
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('allows the six read-only tools used by the live model in one batch and accepts the next answer', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-openrouter-key');
    vi.stubEnv('OPENROUTER_MODEL_ID', 'test/model');
    const context = {
      profile,
      partner: { name: 'Иван Партнёр' },
      metrics: { counts: { clicks: 4, registrations: 2, paymentCount: 1 }, amountsMinor: { netAccrued: 20000 } },
      knowledge: [{ id: 'knowledge-1', title: 'Syntolk', body: 'Описание продукта' }],
      messages: [], program: { name: 'Syntolk 20%' },
      links: [{ id: 'own-link', key: 'ivan-telegram', url: 'http://127.0.0.1:5673/r/ivan-telegram' }],
      currentTasks: [{ id: 'task-1', title: 'Кейс', status: 'submitted' }],
      recentActivity: [{ action: 'run_completed', at: '2026-10-13T08:00:00.000Z' }],
      behavior: defaultBehavior,
      directives: defaultDirectives,
    };
    const names = ['get_profile', 'get_metrics', 'get_approved_knowledge', 'get_links', 'get_current_tasks', 'get_recent_activity'];
    const calls = names.map((name, index) => ({ id: `call-${index}`, type: 'function', function: { name, arguments: '{}' } }));
    const output = { message: 'Ответ после чтения контекста.', tasks: [], verdict: 'not_applicable', limitations: [] };
    const toolResponse = new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: calls } }], usage: { prompt_tokens: 12, completion_tokens: 6, cost: 0 } }), { status: 200 });
    const finalResponse = new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }], usage: { prompt_tokens: 12, completion_tokens: 6, cost: 0 } }), { status: 200 });
    const fake = vi.fn().mockResolvedValueOnce(toolResponse).mockResolvedValueOnce(finalResponse);
    vi.stubGlobal('fetch', fake);

    try {
      const result = await generateCoachOutput('openrouter', 'message', 'Разбери мой контекст.', context);
      expect(result.output).toEqual(output);
      expect(fake).toHaveBeenCalledTimes(2);
      const second = JSON.parse(fake.mock.calls[1]![1].body);
      expect(second.messages.filter((message: { role: string }) => message.role === 'tool')).toHaveLength(6);
      expect(second.messages.filter((message: { role: string }) => message.role === 'tool').map((message: { content: string }) => JSON.parse(message.content))).toEqual([
        Object.fromEntries(Object.entries(context.profile).filter(([key]) => key !== 'aiConsent')), context.metrics, context.knowledge, context.links, context.currentTasks, context.recentActivity,
      ]);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('rejects a read-only batch larger than eight tools', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-openrouter-key');
    vi.stubEnv('OPENROUTER_MODEL_ID', 'test/model');
    const context = { profile, metrics: {}, knowledge: [], messages: [], program: { name: 'Syntolk 20%' } };
    const calls = Array.from({ length: 9 }, (_, index) => ({ id: `too-many-${index}`, type: 'function', function: { name: 'get_metrics', arguments: '{}' } }));
    const fake = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: calls } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fake);

    try {
      await expect(generateCoachOutput('openrouter', 'message', 'Слишком большой пакет.', context)).rejects.toMatchObject({ code: 'tool_limit' });
      expect(fake).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
