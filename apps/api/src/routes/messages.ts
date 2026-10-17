import express, { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { monotonicFactory } from 'ulid';
import type { PartnerMessageRow } from '@openpartner/db';
import { requireAuth, requireAdmin } from '../auth.js';
import { tenantOf } from '../tenancy.js';

const nextId = monotonicFactory();
const idSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const sendSchema = z.object({ text: z.string().trim().max(8000).default(''), attachmentIds: z.array(idSchema).max(5).default([]), requestId: z.string().min(8).max(100) }).strict()
  .refine(body => body.text.length > 0 || body.attachmentIds.length > 0)
  .refine(body => new Set(body.attachmentIds).size === body.attachmentIds.length);
const attachmentColumns = ['id', 'messageId', 'name', 'contentType', 'size'];
const maxFileBytes = 10 * 1024 * 1024;

function imageType(data: Buffer): string {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString())) return 'image/gif';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

function csrf(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.header('authorization')) return next();
  const origins = [process.env.PORTAL_URL, ...(process.env.CORS_EXTRA_ORIGINS ?? '').split(','), ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5673', 'http://127.0.0.1:5673'])];
  if (!req.header('origin') || !origins.some(origin => origin?.trim().replace(/\/$/, '') === req.header('origin'))) {
    return void res.status(403).json({ error: 'csrf_rejected', detail: 'Недопустимый источник запроса.' });
  }
  next();
}

async function conversation(req: Request, res: Response, next: NextFunction) {
  const { db, tenantId } = tenantOf(req);
  const partnerId = req.principal?.role === 'partner' ? req.principal.partnerId : req.params.partnerId;
  const partner = partnerId ? await db('Partner').where({ tenantId, id: partnerId }).first() : null;
  if (!partner) return void res.status(404).json({ error: 'not_found', detail: 'Партнёр не найден.' });
  if (req.principal?.role === 'partner' && (partner.revokedAt || !partner.activatedAt)) {
    return void res.status(403).json({ error: 'partner_inactive', detail: 'Доступ партнёра не активирован или отозван.' });
  }
  res.locals.partner = { id: partner.id, name: partner.name, email: partner.email };
  next();
}

const sendLimit = rateLimit({
  windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: req => `${req.tenantId}:${req.principal?.role}:${req.principal?.role === 'partner' ? req.principal.partnerId : 'admin'}`,
  message: { error: 'rate_limited', detail: 'Слишком много сообщений. Попробуйте через минуту.' },
});

const thread = Router({ mergeParams: true });
thread.use(conversation);
thread.post('/attachments', sendLimit, express.raw({ type: 'application/octet-stream', limit: maxFileBytes }), async (req, res) => {
  const { db, tenantId } = tenantOf(req), partnerId = res.locals.partner.id as string;
  const name = z.string().trim().min(1).max(255).regex(/^[^\\/]+$/).refine(value => [...value].every(char => (char.codePointAt(0) ?? 0) >= 32 && char.codePointAt(0) !== 127)).parse(req.query.name);
  const data: unknown = req.body;
  if (!Buffer.isBuffer(data) || data.length === 0) return void res.status(422).json({ error: 'empty_file', detail: 'Файл пуст.' });
  const [attachment] = await db('PartnerMessageAttachment').insert({ id: nextId(), tenantId, partnerId, uploaderRole: req.principal!.role, name, contentType: imageType(data), size: data.length, data: data.toString('base64') }).returning(attachmentColumns);
  res.status(201).json({ attachment });
});
thread.get('/attachments/:id', async (req, res) => {
  const { db, tenantId } = tenantOf(req), partnerId = res.locals.partner.id as string;
  const attachment = await db('PartnerMessageAttachment').where({ tenantId, partnerId, id: req.params.id }).first();
  if (!attachment || (!attachment.messageId && attachment.uploaderRole !== req.principal!.role)) return void res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', attachment.contentType);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/'/g, '%27')}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(attachment.data, 'base64'));
});
thread.delete('/attachments/:id', async (req, res) => {
  const { db, tenantId } = tenantOf(req), partnerId = res.locals.partner.id as string;
  const removed = await db('PartnerMessageAttachment').where({ tenantId, partnerId, id: req.params.id, uploaderRole: req.principal!.role }).whereNull('messageId').del();
  res.status(removed ? 200 : 404).json({ ok: Boolean(removed) });
});
thread.get('/', async (req, res) => {
  const { db, tenantId } = tenantOf(req), partnerId = res.locals.partner.id as string;
  const before = idSchema.optional().parse(req.query.before);
  const rows = await db<PartnerMessageRow>('PartnerMessage').where({ tenantId, partnerId })
    .modify(q => { if (before) q.where('id', '<', before); }).orderBy('id', 'desc').limit(51);
  const messages: PartnerMessageRow[] = rows.slice(0, 50);
  const attachments = messages.length ? await db('PartnerMessageAttachment').where({ tenantId, partnerId }).whereIn('messageId', messages.map(message => message.id)).select(attachmentColumns).orderBy('id') : [];
  res.json({ partner: res.locals.partner, messages: messages.reverse().map(message => ({ ...message, attachments: attachments.filter(attachment => attachment.messageId === message.id) })), nextCursor: rows.length > 50 ? rows[49]!.id : null });
});
thread.post('/', sendLimit, async (req, res) => {
  const { db, tenantId } = tenantOf(req), partnerId = res.locals.partner.id as string;
  const body = sendSchema.parse(req.body), senderRole = req.principal!.role;
  // Serializing sends also makes a retry after a lost response safe.
  await db('Partner').where({ tenantId, id: partnerId }).forUpdate().first();
  const previous = await db('PartnerMessage').where({ tenantId, partnerId, senderRole, clientMessageId: body.requestId }).first();
  if (previous) {
    const attachments = await db('PartnerMessageAttachment').where({ tenantId, partnerId, messageId: previous.id }).select(attachmentColumns);
    if (previous.body !== body.text || attachments.map(a => a.id).sort().join(',') !== [...body.attachmentIds].sort().join(',')) return void res.status(409).json({ error: 'idempotency_conflict', detail: 'Идентификатор сообщения уже использован.' });
    return void res.json({ message: { ...previous, attachments }, replayed: true });
  }
  const attachments = body.attachmentIds.length ? await db('PartnerMessageAttachment').where({ tenantId, partnerId, uploaderRole: senderRole }).whereNull('messageId').whereIn('id', body.attachmentIds).forUpdate().select(attachmentColumns) : [];
  if (attachments.length !== body.attachmentIds.length) return void res.status(403).json({ error: 'invalid_attachment', detail: 'Вложение недоступно.' });
  const [message] = await db('PartnerMessage').insert({ id: nextId(), tenantId, partnerId, senderRole, clientMessageId: body.requestId, body: body.text }).returning('*');
  if (attachments.length) await db('PartnerMessageAttachment').where({ tenantId, partnerId }).whereIn('id', body.attachmentIds).update({ messageId: message.id });
  res.status(201).json({ message: { ...message, attachments } });
});
thread.post('/read', async (req, res) => {
  const { db, tenantId } = tenantOf(req), partnerId = res.locals.partner.id as string;
  const { messageId } = z.object({ messageId: idSchema }).strict().parse(req.body);
  if (!await db('PartnerMessage').where({ tenantId, partnerId, id: messageId }).first()) {
    return void res.status(404).json({ error: 'not_found', detail: 'Сообщение не найдено.' });
  }
  await db('PartnerMessage').where({ tenantId, partnerId, senderRole: req.principal!.role === 'admin' ? 'partner' : 'admin' })
    .whereNull('readAt').where('id', '<=', messageId).update({ readAt: new Date() });
  res.json({ ok: true });
});

export const messagesRouter = Router();
messagesRouter.use(['/messages', '/admin/messages'], requireAuth, csrf, (req, res, next) => {
  if (!['partner', 'admin'].includes(req.principal!.role)) return void res.sendStatus(403);
  res.setHeader('Cache-Control', 'no-store');
  next();
});
messagesRouter.get('/messages/unread', async (req, res) => {
  const { db, tenantId } = tenantOf(req), principal = req.principal!;
  const row = await db('PartnerMessage').where({ tenantId, senderRole: principal.role === 'admin' ? 'partner' : 'admin' })
    .whereNull('readAt').modify(q => { if (principal.role === 'partner') q.where({ partnerId: principal.partnerId }); }).count({ count: '*' }).first();
  res.json({ unread: Number(row?.count ?? 0) });
});
messagesRouter.use('/messages', (req, res, next) => {
  if (req.principal!.role !== 'partner') return void res.sendStatus(403);
  next();
}, thread);
messagesRouter.use('/admin/messages', requireAdmin);
messagesRouter.get('/admin/messages', async (req, res) => {
  const { db, tenantId } = tenantOf(req), before = idSchema.optional().parse(req.query.before);
  const latest = db('PartnerMessage').where({ tenantId }).distinctOn('partnerId').select('partnerId', 'id', 'body', 'senderRole', 'createdAt').orderBy('partnerId').orderBy('id', 'desc').as('latest');
  const unread = db('PartnerMessage').where({ tenantId, senderRole: 'partner' }).whereNull('readAt').select('partnerId').count({ unread: '*' }).groupBy('partnerId').as('unread');
  const rows = await db('Partner as p').where('p.tenantId', tenantId).join(latest, 'latest.partnerId', 'p.id').leftJoin(unread, 'unread.partnerId', 'p.id')
    .select('p.id as partnerId', 'p.name', 'p.email', 'latest.id as lastMessageId', 'latest.body', 'latest.senderRole', 'latest.createdAt', db.raw('coalesce(unread.unread, 0)::int as unread'))
    .modify(q => { if (before) q.where('latest.id', '<', before); }).orderBy('latest.id', 'desc').limit(51);
  res.json({ conversations: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.lastMessageId : null });
});
messagesRouter.use('/admin/messages/:partnerId', thread);
messagesRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof z.ZodError) return void res.status(422).json({ error: 'invalid_body', detail: 'Проверьте сообщение или файл.' });
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') return void res.status(413).json({ error: 'file_too_large', detail: 'Максимум 10 МБ на файл.' });
  next(error);
});
