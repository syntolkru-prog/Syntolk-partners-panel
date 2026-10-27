import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { monotonicFactory, ulid } from 'ulid';
import { DEFAULT_TENANT_ID as tenantId } from '@openpartner/db';
import { createApp } from '../app.js';
import { db, appDb } from '../db.js';
import { generateApiKey } from '../auth.js';
import { createSession } from '../auth-sessions.js';
import { assertIsolatedCoachDatabase } from '../coach/test-guard.js';
import { exportAll, importBundle } from '../export.js';

assertIsolatedCoachDatabase(process.env.DATABASE_URL!, process.env.COACH_WORKING_DB);
const app = createApp({ enableLogger: false });
const admin = process.env.ADMIN_API_KEY!;
let partnerId: string, otherId: string, key: string, otherKey: string;
const get = (path: string, token = key) => request(app).get(path).set('Authorization', `Bearer ${token}`);
const post = (path: string, body: object, token = key) => request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
const send = (text: string, token = key, path = '/messages', requestId = ulid()) => post(path, { text, requestId }, token);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDXsAAAAASUVORK5CYII=', 'base64');
const upload = (name = 'рисунок.png', data = png, token = key, path = '/messages') => request(app).post(`${path}/attachments`).query({ name }).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').send(data);

beforeEach(async () => {
  // Global unread/inbox assertions need a clean mailbox in this isolated DB.
  await db('PartnerMessageAttachment').where({ tenantId }).del();
  await db('PartnerMessage').where({ tenantId }).del();
  partnerId = ulid(); otherId = ulid();
  const first = generateApiKey(), second = generateApiKey(); key = first.plaintext; otherKey = second.plaintext;
  await db('Partner').insert([partnerId, otherId].map(id => ({ id, tenantId, name: `Партнёр ${id}`, email: `${id}@example.test`, activatedAt: new Date() })));
  await db('ApiKey').insert([{ id: ulid(), tenantId, partnerId, prefix: first.prefix, keyHash: first.hash }, { id: ulid(), tenantId, partnerId: otherId, prefix: second.prefix, keyHash: second.hash }]);
  await db('Config').insert({ tenantId, key: 'coach_settings', value: JSON.stringify({ enabled: false }) }).onConflict(['tenantId', 'key']).merge({ value: JSON.stringify({ enabled: false }) });
});
afterAll(async () => { await db.destroy(); await appDb.destroy(); });

describe('human partner messages', () => {
  it('sends an image without text and delivers the identical private file to the admin', async () => {
    const uploaded = await upload(); expect(uploaded.status, uploaded.text).toBe(201);
    const attachment = uploaded.body.attachment;
    expect(attachment).toMatchObject({ name: 'рисунок.png', contentType: 'image/png', size: png.length });
    expect(attachment.data).toBeUndefined();
    expect((await get(`/admin/messages/${partnerId}/attachments/${attachment.id}`, admin)).status).toBe(404);
    const requestId = ulid(), payload = { requestId, attachmentIds: [attachment.id] };
    const sent = await post('/messages', payload); expect(sent.status, sent.text).toBe(201);
    expect(sent.body.message.body).toBe(''); expect(sent.body.message.attachments).toHaveLength(1);
    const history = await get(`/admin/messages/${partnerId}`, admin);
    expect(history.body.messages[0].attachments[0].id).toBe(attachment.id);
    const download = await get(`/admin/messages/${partnerId}/attachments/${attachment.id}`, admin);
    expect(download.status, download.text).toBe(200); expect(download.body).toEqual(png);
    expect(download.headers['content-disposition']).toContain(encodeURIComponent('рисунок.png'));
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect((await post('/messages', payload)).body.message.id).toBe(sent.body.message.id);
    expect((await post('/messages', { requestId: ulid(), attachmentIds: [attachment.id] })).status).toBe(403);
    expect((await request(app).delete(`/messages/attachments/${attachment.id}`).set('Authorization', `Bearer ${key}`)).status).toBe(404);
  });
  it('supports files from either side and blocks foreign attachments and active content previews', async () => {
    const attachment = (await upload('заметка.txt', Buffer.from('Текст файла'))).body.attachment;
    expect(attachment.contentType).toBe('application/octet-stream');
    expect((await get(`/messages/attachments/${attachment.id}`, otherKey)).status).toBe(404);
    expect((await post('/messages', { requestId: ulid(), attachmentIds: [attachment.id] }, otherKey)).status).toBe(403);
    expect((await request(app).get(`/messages/attachments/${attachment.id}`)).status).toBe(401);
    const malicious = await upload('image.png', Buffer.from('<svg onload="alert(1)"></svg>'));
    expect(malicious.body.attachment.contentType).toBe('application/octet-stream');
    const fromAdmin = await upload('ответ.pdf', Buffer.from('%PDF-1.4\nexample'), admin, `/admin/messages/${partnerId}`);
    const response = await post(`/admin/messages/${partnerId}`, { requestId: ulid(), text: 'Ответ с файлом', attachmentIds: [fromAdmin.body.attachment.id] }, admin);
    expect(response.status, response.text).toBe(201);
    expect((await get('/messages')).body.messages[0].attachments[0].name).toBe('ответ.pdf');
    expect((await get(`/messages/attachments/${fromAdmin.body.attachment.id}`)).body).toEqual(Buffer.from('%PDF-1.4\nexample'));
    expect((await request(app).delete(`/messages/attachments/${attachment.id}`).set('Authorization', `Bearer ${key}`)).status).toBe(200);
    expect((await get(`/messages/attachments/${attachment.id}`)).status).toBe(404);
  });
  it('rejects empty files, unsafe filenames, oversize uploads and too many attachments', async () => {
    expect((await upload('empty.txt', Buffer.alloc(0))).status).toBe(422);
    expect((await upload('../image.png')).status).toBe(422);
    expect((await upload('large.bin', Buffer.alloc(10 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await post('/messages', { requestId: ulid(), attachmentIds: Array.from({ length: 6 }, () => ulid()) })).status).toBe(422);
  });
  it('delivers a partner message and admin reply without a scenario, program or AI', async () => {
    const sent = await send('Здравствуйте, нужна помощь');
    expect(sent.status, sent.text).toBe(201); expect(sent.body.message.senderRole).toBe('partner');
    expect((await get('/messages/unread')).body.unread).toBe(0);
    const inbox = await get('/admin/messages', admin);
    expect(inbox.status, inbox.text).toBe(200);
    const row = inbox.body.conversations.find((c: { partnerId: string }) => c.partnerId === partnerId);
    expect(row).toMatchObject({ name: `Партнёр ${partnerId}`, email: `${partnerId}@example.test`, body: 'Здравствуйте, нужна помощь', unread: 1 });
    const path = `/admin/messages/${partnerId}`;
    expect((await get(path, admin)).body.messages[0].body).toBe('Здравствуйте, нужна помощь');
    expect((await post(`${path}/read`, { messageId: sent.body.message.id }, admin)).status).toBe(200);
    const reply = await send('Здравствуйте! Чем помочь?', admin, path);
    expect(reply.status, reply.text).toBe(201); expect(reply.body.message.senderRole).toBe('admin');
    expect((await get('/messages/unread')).body.unread).toBe(1);
    const history = (await get('/messages')).body;
    expect(history.partner.id).toBe(partnerId); expect(history.messages.map((m: { senderRole: string }) => m.senderRole)).toEqual(['partner', 'admin']);
    expect(history.messages[0].readAt).toBeTruthy();
    await post('/messages/read', { messageId: reply.body.message.id });
    expect((await get('/messages/unread')).body.unread).toBe(0);
    expect((await get(path, admin)).body.messages[1].readAt).toBeTruthy();
    expect(await db('CoachRun').where({ tenantId, partnerId })).toHaveLength(0);
    expect(await db('CoachMessage').where({ tenantId, partnerId })).toHaveLength(0);
  });
  it('lets an admin find any partner and start a conversation before they have written first', async () => {
    const directory = await get(`/admin/messages/partners?search=${partnerId}`, admin);
    expect(directory.status, directory.text).toBe(200);
    expect(directory.body.partners).toEqual([expect.objectContaining({
      partnerId, name: `Партнёр ${partnerId}`, email: `${partnerId}@example.test`,
      hasConversation: false, lastMessageId: null, unread: 0,
    })]);
    const allPartners = await get('/admin/messages/partners', admin);
    expect(allPartners.status, allPartners.text).toBe(200);
    expect(allPartners.body.partners).toEqual(expect.arrayContaining([expect.objectContaining({ partnerId, hasConversation: false })]));
    const emptyThread = await get(`/admin/messages/${partnerId}`, admin);
    expect(emptyThread.status, emptyThread.text).toBe(200);
    expect(emptyThread.body).toMatchObject({ partner: { id: partnerId }, messages: [], nextCursor: null });
    const sent = await send('Здравствуйте, пишу по вашей партнёрской программе', admin, `/admin/messages/${partnerId}`);
    expect(sent.status, sent.text).toBe(201);
    expect((await get('/admin/messages', admin)).body.conversations).toEqual([
      expect.objectContaining({ partnerId, body: 'Здравствуйте, пишу по вашей партнёрской программе', senderRole: 'admin' }),
    ]);
  });
  it('searches partners only inside the current tenant and validates directory search', async () => {
    const foreignTenant = ulid(), foreignPartner = ulid();
    await db('Tenant').insert({ id: foreignTenant, slug: `msg-${foreignTenant.toLowerCase()}`, displayName: 'Другой кабинет', status: 'active', approvalStatus: 'approved' });
    await db('Partner').insert({ id: foreignPartner, tenantId: foreignTenant, name: 'Искомый партнёр', email: `${foreignPartner}@example.test`, activatedAt: new Date() });
    const result = await get('/admin/messages/partners?search=Искомый', admin);
    expect(result.status, result.text).toBe(200);
    expect(result.body.partners).toHaveLength(0);
    expect((await get(`/admin/messages/partners?search=${'x'.repeat(121)}`, admin)).status).toBe(400);
    expect((await get('/admin/messages/partners', key)).status).toBe(403);
  });
  it('isolates other partners, admin endpoints and forged sender fields', async () => {
    const sent = await send('Чужая переписка', otherKey);
    expect((await get('/messages')).body.messages).toHaveLength(0);
    expect((await get('/admin/messages')).status).toBe(403);
    expect((await get(`/admin/messages/${otherId}`)).status).toBe(403);
    expect((await send('Подделка', key, `/admin/messages/${otherId}`)).status).toBe(403);
    expect((await post('/messages/read', { messageId: sent.body.message.id })).status).toBe(404);
    expect((await post('/messages', { text: 'Подделка', requestId: ulid(), senderRole: 'admin', partnerId: otherId })).status).toBe(422);
    expect((await request(app).get('/messages')).status).toBe(401);
    expect((await get(`/admin/messages/${ulid()}`, admin)).status).toBe(404);
    await db('Partner').where({ id: partnerId }).update({ revokedAt: new Date() });
    expect((await send('После блокировки')).status).toBe(403);
  });
  it('deduplicates simultaneous retries and rejects a reused ID with different text', async () => {
    const requestId = ulid();
    const replies = await Promise.all([send('Один вопрос', key, '/messages', requestId), send('Один вопрос', key, '/messages', requestId)]);
    expect(replies.map(r => r.status).sort()).toEqual([200, 201]);
    expect(replies[0].body.message.id).toBe(replies[1].body.message.id);
    expect(await db('PartnerMessage').where({ tenantId, partnerId })).toHaveLength(1);
    expect((await send('Другой вопрос', key, '/messages', requestId)).status).toBe(409);
    expect((await send('Ответ', admin, `/admin/messages/${partnerId}`, requestId)).status).toBe(201);
  });
  it('keeps newer replies unread when acknowledging an older message', async () => {
    const first = await send('Первый ответ', admin, `/admin/messages/${partnerId}`);
    const second = await send('Второй ответ', admin, `/admin/messages/${partnerId}`);
    expect((await post('/messages/read', { messageId: first.body.message.id })).status).toBe(200);
    expect((await get('/messages/unread')).body.unread).toBe(1);
    expect((await get('/messages')).body.messages.find((m: { id: string }) => m.id === second.body.message.id).readAt).toBeNull();
  });
  it('keeps unread counts isolated for multiple partners in both directions', async () => {
    const partnerMessage = await send('Сообщение первому партнёру');
    const otherMessage = await send('Сообщение второму партнёру', otherKey);
    expect(partnerMessage.status).toBe(201);
    expect(otherMessage.status).toBe(201);
    expect((await get('/messages/unread', admin)).body.unread).toBe(2);
    const adminInbox = await get('/admin/messages', admin);
    expect(adminInbox.body.conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ partnerId, unread: 1 }),
      expect.objectContaining({ partnerId: otherId, unread: 1 }),
    ]));

    await post(`/admin/messages/${partnerId}/read`, { messageId: partnerMessage.body.message.id }, admin);
    expect((await get('/messages/unread', admin)).body.unread).toBe(1);
    expect((await get('/admin/messages', admin)).body.conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ partnerId, unread: 0 }),
      expect.objectContaining({ partnerId: otherId, unread: 1 }),
    ]));

    const replyToFirst = await send('Ответ первому партнёру', admin, `/admin/messages/${partnerId}`);
    const replyToSecond = await send('Ответ второму партнёру', admin, `/admin/messages/${otherId}`);
    expect(replyToFirst.status).toBe(201);
    expect(replyToSecond.status).toBe(201);
    expect((await get('/messages/unread')).body.unread).toBe(1);
    expect((await get('/messages', otherKey)).body.messages.at(-1).readAt).toBeNull();

    await post('/messages/read', { messageId: replyToFirst.body.message.id });
    expect((await get('/messages/unread')).body.unread).toBe(0);
    expect((await get('/messages', otherKey)).body.messages.at(-1).readAt).toBeNull();
  });
  it('paginates history without losing messages and validates text', async () => {
    const next = monotonicFactory();
    await db('PartnerMessage').insert(Array.from({ length: 55 }, (_, i) => ({ id: next(), tenantId, partnerId, senderRole: 'partner', clientMessageId: ulid(), body: `Сообщение ${i}` })));
    const first = (await get('/messages')).body;
    expect(first.messages).toHaveLength(50); expect(first.messages[0].body).toBe('Сообщение 5'); expect(first.messages.at(-1).body).toBe('Сообщение 54');
    const second = (await get(`/messages?before=${first.nextCursor}`)).body;
    expect(second.messages).toHaveLength(5); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.messages, ...second.messages].map(m => m.id)).size).toBe(55);
    expect((await send('   ')).status).toBe(422); expect((await send('x'.repeat(8001))).status).toBe(422);
    expect((await get('/messages?before=invalid')).status).toBe(422);
  });
  it('enforces tenant isolation in the API, foreign key and RLS policy', async () => {
    const foreignTenant = ulid(), foreignPartner = ulid();
    await db('Tenant').insert({ id: foreignTenant, slug: `msg-${foreignTenant.toLowerCase()}`, displayName: 'Другой кабинет', status: 'active', approvalStatus: 'approved' });
    await db('Partner').insert({ id: foreignPartner, tenantId: foreignTenant, name: 'Другой партнёр', email: `${foreignPartner}@example.test`, activatedAt: new Date() });
    await db('PartnerMessage').insert({ id: ulid(), tenantId: foreignTenant, partnerId: foreignPartner, senderRole: 'partner', clientMessageId: ulid(), body: 'Из другого кабинета' });
    expect((await get(`/admin/messages/${foreignPartner}`, admin)).status).toBe(404);
    expect((await get('/admin/messages', admin)).body.conversations.some((c: { partnerId: string }) => c.partnerId === foreignPartner)).toBe(false);
    await expect(db('PartnerMessage').insert({ id: ulid(), tenantId, partnerId: foreignPartner, senderRole: 'partner', clientMessageId: ulid(), body: 'Чужой владелец' })).rejects.toMatchObject({ code: '23503' });
    // A transaction-only, non-login role tests RLS even on local installations
    // that use the database owner and have no openpartner_app role installed.
    const rollback = new Error('Rollback the temporary RLS role');
    await expect(db.transaction(async trx => {
      const role = `messages_test_${ulid().toLowerCase()}`;
      await trx.raw('create role ?? nologin nosuperuser nobypassrls', [role]);
      await trx.raw('grant usage on schema public to ??', [role]);
      await trx.raw('grant select on "PartnerMessage" to ??', [role]);
      await trx.raw('set local role ??', [role]);
      await trx.raw('set local row_security = on');
      await trx.raw("select set_config('app.tenant_id', ?, true)", [tenantId]);
      expect(await trx('PartnerMessage').where({ partnerId: foreignPartner })).toHaveLength(0);
      throw rollback;
    })).rejects.toBe(rollback);
  });
  it('rejects cookie writes without a trusted origin and accepts the portal origin', async () => {
    const session = await createSession(db, { tenantId, principalKind: 'partner', principalId: partnerId });
    const write = () => request(app).post('/messages').set('Cookie', `op_session=${session.plaintext}`).send({ text: 'Из кабинета', requestId: ulid() });
    expect((await write()).status).toBe(403);
    expect((await write().set('Origin', 'https://other.example.test')).status).toBe(403);
    expect((await write().set('Origin', 'http://127.0.0.1:5673')).status).toBe(201);
  });
  it('includes correspondence in portable exports and restores it idempotently', async () => {
    const attachment = (await upload()).body.attachment;
    const sent = await post('/messages', { requestId: ulid(), text: 'Сохранить историю', attachmentIds: [attachment.id] });
    const tables = await exportAll(db, tenantId);
    const messages = tables.PartnerMessage as Array<{ id: string; partnerId: string; body: string }>;
    expect(messages.find(m => m.id === sent.body.message.id)?.body).toBe('Сохранить историю');
    const files = tables.PartnerMessageAttachment as Array<{ id: string; data: string }>;
    const exportedFile = files.find(file => file.id === attachment.id)!;
    expect(Buffer.from(exportedFile.data, 'base64')).toEqual(png);
    await db('PartnerMessageAttachment').where({ id: attachment.id }).del();
    await importBundle(db, tenantId, { PartnerMessage: messages.filter(m => m.partnerId === partnerId), PartnerMessageAttachment: [exportedFile] });
    expect(await db('PartnerMessage').where({ tenantId, partnerId })).toHaveLength(1);
    expect((await get(`/messages/attachments/${attachment.id}`)).body).toEqual(png);
  });
});
