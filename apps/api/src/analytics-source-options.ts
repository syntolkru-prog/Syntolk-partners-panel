import type { Knex } from 'knex';
import { calculateCoachForecast } from './coach/forecast-adapter.js';

interface Option {id:string;name:string}
export interface AnalyticsSourceOptions {platforms:Option[];formats:Option[]}

/** Catalog choices belong to an owner/program, not to an activity date range.
 * Project unique definitions in SQL: never ship scenario records to the admin.
 */
export async function analyticsSourceOptions(db:Knex,tenantId:string,partnerIds?:string[],programId?:string):Promise<AnalyticsSourceOptions> {
  const scoped=(table:string)=>db(table).where({tenantId}).modify(query=>{
    if(partnerIds)query.whereIn('partnerId',partnerIds);
    if(programId)query.where({programId});
  });
  const array=(expression:string)=>`CASE WHEN jsonb_typeof(${expression}) = 'array' THEN ${expression} ELSE '[]'::jsonb END`;
  const snapshots=scoped('CoachForecastSnapshot').whereIn('status',['confirmed','archived']).select('data').as('snapshot');
  const saved=db.from(snapshots).crossJoin(db.raw(`LATERAL (
    SELECT 'format' AS dimension, value FROM jsonb_array_elements(${array("snapshot.data->'formats'")} || ${array("snapshot.data#>'{settings,customFormats}'")})
    UNION ALL
    SELECT 'platform' AS dimension, value FROM jsonb_array_elements(${array("snapshot.data->'channels'")} || ${array("snapshot.data#>'{settings,customChannels}'")})
  ) AS choice`)).distinct(db.raw("choice.dimension, choice.value->>'id' AS id, choice.value->>'name' AS name"));
  const [model,sources,definitions,materials]=await Promise.all([
    calculateCoachForecast({}),
    scoped('PartnerLinkSource').distinct('platformId','platformName','formatId','formatName'),
    saved,
    scoped('PartnerMaterial').distinct('formatId','formatName','platforms'),
  ]);
  const platforms=new Map<string,Option>(),formats=new Map<string,Option>();
  const add=(target:Map<string,Option>,id:unknown,name:unknown)=>{
    if(typeof id!=='string'||typeof name!=='string'||!id.trim()||!name.trim()||target.has(id))return;
    target.set(id,{id,name});
  };
  for(const item of model.channels)add(platforms,item.id,item.name);
  for(const item of model.formats)add(formats,item.id,item.name);
  for(const source of sources){add(platforms,source.platformId,source.platformName);add(formats,source.formatId,source.formatName);}
  for(const item of definitions)add(item.dimension==='platform'?platforms:formats,item.id,item.name);
  for(const material of materials){
    add(formats,material.formatId,material.formatName);
    for(const platform of Array.isArray(material.platforms)?material.platforms:[])if(platform)add(platforms,platform.id,platform.name);
  }
  const sorted=(items:Map<string,Option>)=>[...items.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true})||a.id.localeCompare(b.id));
  return {platforms:sorted(platforms),formats:sorted(formats)};
}
