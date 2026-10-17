import type { Knex } from 'knex';
import type { LinkRow, PartnerLinkSourceRow } from './types.js';

export function trackingSourceParams(source: PartnerLinkSourceRow): Record<string, string> {
  return { utm_campaign: source.scenarioId ?? '__none__', utm_source: source.platformId, utm_medium: source.formatId, utm_content: source.id };
}

/** Resolve only registered, matching context. Arbitrary UTMs remain ordinary UTMs. */
export async function trackingSourceForClick(db: Knex, link: LinkRow, utm: {
  campaign?: string | null; source?: string | null; medium?: string | null; content?: string | null;
}): Promise<string | null> {
  if (!utm.content || !utm.campaign || !utm.source || !utm.medium) return null;
  const source = await db<PartnerLinkSourceRow>('PartnerLinkSource').where({
    id: utm.content, tenantId: link.tenantId, partnerId: link.partnerId,
    programId: link.programId, linkId: link.id, scenarioId: utm.campaign === '__none__' ? null : utm.campaign,
    platformId: utm.source, formatId: utm.medium,
  }).first('id');
  return source?.id ?? null;
}
