import type { Knex } from 'knex';
import { CoachError } from './schemas.js';
import { campaignAcceptsNewActivity } from '../campaign-lifecycle.js';
import { publicRouterConnection } from './connections.js';
export type CoachProvider = 'template' | 'openai' | 'openrouter';
export interface CoachSettings { enabled: boolean; provider: CoachProvider; dailyRuns: number; takeover: string[]; }
export async function getSettings(db: Knex, tenantId: string): Promise<CoachSettings> {
  const row = await db('Config').where({ tenantId, key: 'coach_settings' }).first();
  const value = row?.value ?? {};
  return { enabled: process.env.COACH_ENABLED !== '0' && value.enabled === true, provider: ['openai','openrouter'].includes(value.provider) ? value.provider : 'template', dailyRuns: Math.max(1, Math.min(100, Number(value.dailyRuns) || 20)), takeover: Array.isArray(value.takeover) ? value.takeover : [] };
}
export async function providerState(settings: CoachSettings, db: Knex, tenantId: string) {
  const openRouter = settings.provider === 'openrouter';
  const connection = openRouter ? await publicRouterConnection(db, tenantId) : null;
  const model = openRouter ? connection?.model : process.env.COACH_MODEL_ID;
  const key = openRouter ? connection?.hasKey : process.env.OPENAI_API_KEY;
  const verified = !openRouter || connection?.version === 'env' || connection?.verification?.ok === true;
  return { provider: settings.provider, configured: settings.provider === 'template' || !!(key && model && verified), model: settings.provider === 'template' ? null : model ?? null, label: settings.provider === 'template' ? 'Демонстрационный режим — ответы по шаблонам' : `ИИ ${openRouter ? 'OpenRouter' : 'OpenAI'} — серверное подключение` };
}
export async function assertPartner(db: Knex, tenantId: string, partnerId: string) {
  const tenant = await db('Tenant').where({id:tenantId}).first();
  if(!tenant || tenant.status !== 'active' || tenant.pendingDeletionAt) throw new CoachError('tenant_inactive',403,'Организация не активна.');
  const partner = await db('Partner').where({ id: partnerId, tenantId }).first();
  if (!partner) throw new CoachError('not_found', 404, 'Партнёр не найден.');
  if (partner.revokedAt || !partner.activatedAt) throw new CoachError('partner_inactive', 403, 'Доступ партнёра не активирован или отозван.');
  return partner;
}
export async function assertProgram(db: Knex, tenantId: string, partnerId: string, programId: string, forNewActivity=true) {
  if (!await db('PartnerProgram').where({ tenantId, partnerId, programId }).first()) throw new CoachError('program_not_granted', 403, 'Партнёру не назначена эта программа.');
  const program = await db('Program').where({ tenantId, id: programId }).first();
  if (!program) throw new CoachError('not_found', 404, 'Программа не найдена.');
  if(forNewActivity&&!campaignAcceptsNewActivity(program)) throw new CoachError('program_not_active',409,'Программа не активна. История сохранена.');
  return program;
}
