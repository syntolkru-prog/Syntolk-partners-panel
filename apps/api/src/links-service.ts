import type { Knex } from 'knex';
import { z } from 'zod';
import { ulid } from 'ulid';
import { TABLES, type LinkRow, type ProgramRow } from '@openpartner/db';
import { campaignAcceptsNewActivity, campaignStatus } from './campaign-lifecycle.js';
export const createLinkSchema = z.object({ linkKey: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/), programId: z.string().min(1), destinationUrl: z.string().url().optional(), label: z.string().trim().max(120).optional(), channel: z.string().trim().max(40).optional() });
export class LinkError extends Error { constructor(public code: string, public status: number, message: string) { super(message); } }
/** Technical links from superseded calculator calendars stay resolvable in history. */
export async function listPartnerLinks(db:Knex,tenantId:string,partnerId:string,programId?:string):Promise<{links:Array<LinkRow&{archived:boolean}>;archivedCount:number}> {
  const tasks=await db('CoachTask as t').join('CoachPlan as p','p.id','t.planId').where({'t.tenantId':tenantId,'t.partnerId':partnerId,'p.tenantId':tenantId,'p.partnerId':partnerId}).select('t.id','t.data','p.status as planStatus','p.data as planData');
  const placements=await db('CoachPlacement').where({tenantId,partnerId}).select('taskId','linkId');
  const generated=new Set<string>(),current=new Set<string>();
  for(const task of tasks){
    if(task.planData?.source!=='calculator_schedule_v1')continue;
    const ids=[...(Array.isArray(task.data.generatedLinks)?task.data.generatedLinks:[]).map((link:{linkId:string})=>link.linkId),...placements.filter(p=>p.taskId===task.id).map(p=>p.linkId)];
    for(const id of ids){generated.add(id);if(task.planStatus==='active')current.add(id);}
  }
  const rows:LinkRow[]=await db<LinkRow>(TABLES.Link).where({tenantId,partnerId}).modify(q=>{if(programId)q.where({programId});}).orderBy('createdAt','desc');
  const links=rows.map(link=>({...link,archived:generated.has(link.id)&&!current.has(link.id)}));
  return {links,archivedCount:links.filter(link=>link.archived).length};
}
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
