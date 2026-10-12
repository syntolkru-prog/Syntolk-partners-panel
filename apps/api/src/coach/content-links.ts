import type { Knex } from 'knex';
import { CoachError } from './schemas.js';

/** Parse only; never fetch untrusted URLs or disclose another owner. */
export async function assertOwnContentLinks(db: Knex, tenantId: string, partnerId: string, text: string) {
  const urls = (text.match(/https?:\/\/[^\s<>"']+/gi) ?? []).slice(0, 100);
  const keys: string[] = [], clickIds: string[] = [];
  for (const raw of urls) {
    try {
      const url = new URL(raw.replace(/[),.;!?]+$/, ''));
      const match = url.pathname.match(/^\/r\/(?:[^/]+\/)?([^/]+)\/?$/);
      if (match) keys.push(decodeURIComponent(match[1]!));
      const cref = url.searchParams.get('cref');
      if (cref) clickIds.push(cref);
    } catch { /* Incomplete drafts are not executable URLs. */ }
  }
  const foreignLink = keys.length && await db('Link').where({tenantId}).whereIn('linkKey', keys).whereNot({partnerId}).first('id');
  const foreignClick = clickIds.length && await db('Click').where({tenantId}).whereIn('id', clickIds).whereNot({partnerId}).first('id');
  if (foreignLink || foreignClick) throw new CoachError('foreign_referral_link', 422, 'В тексте есть реферальная ссылка, которая не принадлежит вам. Замените её собственной ссылкой из задания и отправьте материал снова.');
}
