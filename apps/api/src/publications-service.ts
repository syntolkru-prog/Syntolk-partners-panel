import type {Knex} from 'knex';
import {createPartnerLink,LinkError,listPartnerLinks} from './links-service.js';
import {createMaterial,materialSource,recordMaterialPublication} from './materials-service.js';
import {assertPartner,assertProgram} from './coach/policy.js';
import {safePublicationUrl} from './coach/schemas.js';
import {trackingSourceParams} from '@openpartner/db';

export interface NewPublication {
  requestId:string;programId:string;title:string;formatId:string;
  platform:{id:string;name:string};scenarioId?:string|null;linkId?:string;
  channelName?:string;publicationUrl?:string;published?:boolean;
}

/** Standalone publications use exactly the same material/source attribution as calendar work.
 * A savepoint is intentional: the request middleware can commit handled 4xx responses.
 */
export async function createPublication(db:Knex,tenantId:string,partnerId:string,input:NewPublication) {
  const publicationUrl=input.publicationUrl?safePublicationUrl(input.publicationUrl):null;
  return db.transaction(async trx=>{
    await trx('Partner').where({tenantId,id:partnerId}).forUpdate().first();
    await assertPartner(trx,tenantId,partnerId);
    await assertProgram(trx,tenantId,partnerId,input.programId);
    const existing=await trx('PartnerMaterial').where({id:input.requestId}).first();
    if(existing){
      if(existing.tenantId!==tenantId||existing.partnerId!==partnerId||existing.programId!==input.programId||
        existing.title!==input.title||existing.formatId!==input.formatId||existing.scenarioId!==(input.scenarioId??null))
        throw new LinkError('request_conflict',409,'Этот запрос уже использован для другой публикации.');
      const source=await trx('PartnerLinkSource').where({tenantId,partnerId,materialId:existing.id,platformId:input.platform.id}).first();
      if(!source||input.linkId&&source.linkId!==input.linkId)throw new LinkError('request_conflict',409,'Этот запрос уже использован для другого размещения.');
      const link=await trx('Link').where({tenantId,partnerId,id:source.linkId}).first();
      return {material:existing,source,params:trackingSourceParams(source),linkKey:link.linkKey};
    }
    // Create/validate the material before allocating a new base link. Never require a calculator scenario.
    const material=await createMaterial(trx,tenantId,partnerId,{id:input.requestId,programId:input.programId,
      title:input.title,formatId:input.formatId,scenarioId:input.scenarioId??null,platforms:[input.platform]});
    const {links}=await listPartnerLinks(trx,tenantId,partnerId,input.programId);
    const active=links.filter(link=>!link.archived);
    let link=input.linkId?active.find(link=>link.id===input.linkId):undefined;
    if(input.linkId&&!link)throw new LinkError('link_not_found',404,'Выберите действующую ссылку этой программы.');
    if(!link){
      const used=new Set((await trx('PartnerLinkSource').where({tenantId,partnerId,programId:input.programId}).distinct('linkId')).map(row=>row.linkId));
      link=active.find(item=>!used.has(item.id))??active[0];
    }
    if(!link)link={...await createPartnerLink(trx,tenantId,partnerId,false,{
      programId:input.programId,linkKey:`partner-${input.requestId}`,label:'Партнёрская ссылка',
    }),archived:false};
    const result=await materialSource(trx,tenantId,partnerId,link.id,material,input.platform);
    const [source]=await trx('PartnerLinkSource').where({tenantId,partnerId,id:result.source.id}).update({
      channelName:input.channelName||null,publicationUrl,publishedAt:input.published?new Date():null,
    }).returning('*');
    const prepared=source.publishedAt?await recordMaterialPublication(trx,tenantId,partnerId,material.id,new Date(source.publishedAt)):material;
    return {material:prepared,source,params:result.params,linkKey:link.linkKey};
  });
}
