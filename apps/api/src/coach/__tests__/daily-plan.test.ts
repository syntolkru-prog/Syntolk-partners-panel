import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ulid } from 'ulid';
import { DEFAULT_TENANT_ID as tenantId } from '@openpartner/db';
import { createApp } from '../../app.js';
import { db, appDb } from '../../db.js';
import { generateApiKey } from '../../auth.js';
import { assertIsolatedCoachDatabase } from '../test-guard.js';
import { profileSchema } from '../schemas.js';
import { dailyPlan, localDay, todayWindow } from '../daily-plan.js';

assertIsolatedCoachDatabase(process.env.DATABASE_URL!, process.env.COACH_WORKING_DB);
const app = createApp({ enableLogger: false });
let partnerId: string, otherId: string, programId: string, key: string, taskIds: string[];
const get = (path: string) => request(app).get(path).set('Authorization', `Bearer ${key}`);
const put = (body: object) => request(app).put('/coach/me/today').set('Authorization', `Bearer ${key}`).send(body);
const input = (extra: object = {}) => ({ programId, day: localDay(new Date(), 'Europe/Moscow'), version: 0, targetMinutes: 60, taskIds, ...extra });
const profile = profileSchema.parse({ goalMinor: 3000000, goalMetric: 'monthly_net_accrual', targetDate: '2027-01-01', weeklyMinutes: 120, sessionMinutes: 30, daysPerWeek: 3, timezone: 'Europe/Moscow', channels: [], experience: 'new', productUnderstanding: 'Документы', preferences: 'Посты', mode: 'on_request', quietStart: 21, quietEnd: 9, proactiveConsent: false });

beforeEach(async () => {
  partnerId = ulid(); otherId = ulid(); programId = ulid(); taskIds = [ulid(), ulid(), ulid()];
  await db('Config').insert({ tenantId, key: 'coach_settings', value: JSON.stringify({ enabled: true, provider: 'template', dailyRuns: 20, takeover: [] }) }).onConflict(['tenantId', 'key']).merge({ value: JSON.stringify({ enabled: true, provider: 'template', dailyRuns: 20, takeover: [] }) });
  await db('Partner').insert([partnerId, otherId].map(id => ({ id, tenantId, name: 'Тест дневного плана', email: `${id}@example.test`, activatedAt: new Date() })));
  await db('Program').insert({ id: programId, tenantId, name: 'Дневной план', destinationUrl: 'https://syntolk.ru/', commissionRule: JSON.stringify({ type: 'percent', value: 20 }) });
  await db('PartnerProgram').insert({ id: ulid(), tenantId, partnerId, programId, source: 'admin' });
  const credential = generateApiKey(); key = credential.plaintext;
  await db('ApiKey').insert({ id: ulid(), tenantId, partnerId, prefix: credential.prefix, keyHash: credential.hash });
  await db('CoachProfile').insert({ id: ulid(), tenantId, partnerId, status: 'complete', version: 1, data: JSON.stringify(profile) });
  const planId = ulid();
  await db('CoachPlan').insert({ id: planId, tenantId, partnerId, programId, status: 'active', weekStart: '2026-10-13', data: JSON.stringify({ profileVersion: 1 }) });
  await db('CoachTask').insert(taskIds.map((id, i) => ({ id, tenantId, partnerId, programId, planId, status: 'planned', minutes: 20, dueAt: new Date(Date.now() + (i + 1) * 86400000), data: JSON.stringify({ title: `Задание ${i + 1}`, steps: [] }) })));
});
afterAll(async () => { await db.destroy(); await appDb.destroy(); });

describe('daily work selection and results', () => {
  it('saves and reopens the selected day without starting AI or changing task deadlines', async () => {
    const before = await db('CoachTask').where({ partnerId }).orderBy('id');
    const empty = await get(`/coach/me/today?programId=${programId}`);
    expect(empty.status).toBe(200); expect(empty.body.saved).toBe(false); expect(empty.body.suggestedTaskIds).toHaveLength(1);
    expect((await put(input())).status).toBe(200);
    const saved = await get(`/coach/me/today?programId=${programId}`);
    expect(saved.body.taskIds).toEqual(taskIds); expect(saved.body.progress).toMatchObject({ total: 3, submitted: 0, confirmed: 0, stars: 0, plannedMinutes: 60 });
    expect(await db('CoachTask').where({ partnerId }).orderBy('id')).toEqual(before);
    expect(Number((await db('CoachRun').where({ partnerId }).count({ n: '*' }).first())!.n)).toBe(0);
  });
  it('does not include a different partner task or an ungranted program', async () => {
    const foreignPlan = ulid(), foreignTask = ulid();
    await db('CoachPlan').insert({ id: foreignPlan, tenantId, partnerId: otherId, programId, status: 'active', weekStart: '2026-10-13', data: '{}' });
    await db('CoachTask').insert({ id: foreignTask, tenantId, partnerId: otherId, programId, planId: foreignPlan, status: 'planned', minutes: 20, data: '{}' });
    expect((await put(input({ taskIds: [foreignTask] }))).status).toBe(403);
    expect((await get(`/coach/me/today?programId=${ulid()}`)).status).toBe(403);
  });
  it('rejects duplicate tasks, an empty day and exceeding the selected time', async () => {
    expect((await put(input({ taskIds: [taskIds[0], taskIds[0]] }))).body.error).toBe('duplicate_tasks');
    expect((await put(input({ taskIds: [] }))).status).toBe(422);
    expect((await put(input({ targetMinutes: 20 }))).body.error).toBe('daily_time_exceeded');
  });
  it('rejects stale versions and a previous calendar day', async () => {
    expect((await put(input())).status).toBe(200);
    expect((await put(input())).body.error).toBe('version_conflict');
    expect((await put(input({ day: '2000-01-01' }))).body.error).toBe('day_changed');
  });
  it('awards stars from actual submission states and keeps manager confirmation separate', async () => {
    await put(input());
    await db('CoachTask').where({ id: taskIds[0] }).update({ status: 'needs_human' });
    const pending = await get(`/coach/me/today?programId=${programId}`);
    expect(pending.body.progress).toMatchObject({ submitted: 1, confirmed: 0, stars: 1 });
    await db('CoachTask').where({ id: taskIds[0] }).update({ status: 'completed' });
    const completed = await get(`/coach/me/today?programId=${programId}`);
    expect(completed.body.progress).toMatchObject({ submitted: 1, confirmed: 1, stars: 1 });
    await db('CoachTask').where({ id: taskIds[0] }).update({ status: 'changes_requested' });
    expect((await get(`/coach/me/today?programId=${programId}`)).body.progress.stars).toBe(0);
  });
  it('does not allow removing submitted results or adding already-completed work to earn stars', async () => {
    await put(input());
    await db('CoachTask').where({ id: taskIds[0] }).update({ status: 'submitted' });
    expect((await put(input({ version: 1, taskIds: taskIds.slice(1) }))).body.error).toBe('submitted_task_locked');
    const future = await dailyPlan(db, tenantId, partnerId, programId, 'Europe/Moscow', 30, new Date(Date.now() + 86400000));
    expect(future.saved).toBe(false); expect(future.progress.stars).toBe(0); expect(future.candidates.some(t => t.id === taskIds[0])).toBe(false);
  });
  it('provides administrator access to the same day through the selected partner scope', async () => {
    await put(input());
    const response = await request(app).get(`/admin/coach/partners/${partnerId}/today?programId=${programId}`).set('Authorization', `Bearer ${process.env.ADMIN_API_KEY}`);
    expect(response.status).toBe(200); expect(response.body.taskIds).toEqual(taskIds);
  });
  it('counts today from local midnight rather than the last 24 hours', async () => {
    const window = todayWindow('Europe/Moscow'), linkId = ulid();
    await db('Link').insert({ id: linkId, tenantId, partnerId, programId, linkKey: ulid().toLowerCase() });
    await db('Click').insert([new Date(window.since.getTime() - 1000), new Date(window.since.getTime() + 1000)].map(ts => ({ id: ulid(), tenantId, partnerId, programId, linkId, landingUrl: 'https://syntolk.ru/', ts })));
    const response = await get(`/coach/me/results?programId=${programId}&period=today`);
    expect(response.status).toBe(200); expect(response.body.counts.clicks).toBe(1); expect(response.body.period.since).toBe(window.since.toISOString()); expect(response.body.timezone).toBe('Europe/Moscow');
    expect((await get(`/coach/me/results?programId=${programId}`)).body.counts.clicks).toBe(2);
  });
});

describe('partner calendar boundaries', () => {
  it('resolves Moscow midnight across the UTC date boundary', () => {
    const window = todayWindow('Europe/Moscow', new Date('2026-10-13T21:30:00Z'));
    expect(window.day).toBe('2026-10-14'); expect(window.since.toISOString()).toBe('2026-10-13T21:00:00.000Z');
  });
  it('resolves midnight on a short and a long daylight-saving day', () => {
    expect(todayWindow('America/New_York', new Date('2026-03-08T20:00:00Z')).since.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(todayWindow('America/New_York', new Date('2026-11-01T20:00:00Z')).since.toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });
});
