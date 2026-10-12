import type { Knex } from 'knex';
import { z } from 'zod';
import { ulid } from 'ulid';
import { TABLES, type LinkRow, type ProgramRow } from '@openpartner/db';
import { campaignAcceptsNewActivity, campaignStatus } from './campaign-lifecycle.js';
export const createLinkSchema = z.object({ linkKey: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/), programId: z.string().min(1), destinationUrl: z.string().url().optional(), label: z.string().trim().max(120).optional(), channel: z.string().trim().max(40).optional() });
export class LinkError extends Error { constructor(public code: string, public status: number, message: string) { super(message); } }
/** Portal and coach share lifecycle, ownership and program-grant validation. */
export async function createPartnerLink(db: Knex, tenantId: string, partnerId: string, isAdmin: boolean, body: z.infer<typeof createLinkSchema>): Promise<LinkRow> {
  const partner = await db(TABLES.Partner).where({ id: partnerId, tenantId }).first();
  if (!partner) throw new LinkError('partner_not_found', 404, 'Партнёр не найден.');
  if (partner.revokedAt) throw new LinkError('partner_revoked', 403, 'Доступ партнёра отозван.');
  const campaign = await db<ProgramRow>(TABLES.Program).where({ id: body.programId, tenantId }).first();
  if (!campaign) throw new LinkError('campaign_not_found', 404, 'Программа не найдена.');
  if (!campaignAcceptsNewActivity(campaign)) throw new LinkError('campaign_not_active', 409, `Программа сейчас не активна (${campaignStatus(campaign)}).`);
  if (!isAdmin && !await db(TABLES.PartnerProgram).where({ tenantId, partnerId, programId: body.programId }).first()) throw new LinkError('campaign_not_granted', 403, 'Нет доступа к этой программе.');
  let destinationUrl: string | null = null;
  if (body.destinationUrl) {
    const u = new URL(body.destinationUrl);
    const allowed = ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && campaign.deepLinkAllowedDomains?.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).some(host => u.hostname.toLowerCase() === host || u.hostname.toLowerCase().endsWith(`.${host}`));
    if (!allowed) throw new LinkError('destination_override_not_allowed', 400, 'Адрес назначения не разрешён программой.');
    destinationUrl = body.destinationUrl;
  }
  try {
    const [link] = await db<LinkRow>(TABLES.Link).insert({ id: ulid(), tenantId, partnerId, programId: body.programId, linkKey: body.linkKey, destinationUrl, label: body.label || null, channel: body.channel || null }).returning('*');
    return link!;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new LinkError('linkKey_taken', 409, 'Этот ключ ссылки уже занят.');
    throw error;
  }
}
