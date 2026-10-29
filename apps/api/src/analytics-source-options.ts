import type { Knex } from 'knex';
import { calculateCoachForecast } from './coach/forecast-adapter.js';

interface Option {id:string;name:string}
interface PlatformOption extends Option {formats?:string[];url?:string}
export interface AnalyticsSourceOptions {platforms:PlatformOption[];formats:Option[]}

/** Use the saved scenario catalog independently of the activity date range. */
export async function analyticsSourceOptions(db:Knex,tenantId:string,partnerIds?:string[],programId?:string,scenarioIds:string[]=[]):Promise<AnalyticsSourceOptions> {
  const scoped=(table:string)=>db(table).where({tenantId}).modify(query=>{
    if(partnerIds)query.whereIn('partnerId',partnerIds);
    if(programId)query.where({programId});
  });
  const selected=(query:Knex.QueryBuilder)=>query.modify(q=>{
    if(scenarioIds.length)q.where(function(){
      this.whereIn('scenarioId',scenarioIds.filter(id=>id!=='__none__'));
      if(scenarioIds.includes('__none__'))this.orWhereNull('scenarioId');
    });
  });
  const snapshots=scoped('CoachForecastSnapshot').whereIn('status',['confirmed','archived'])
    .select('data','status').select(db.raw("COALESCE(data->>'scenarioId',id) AS \"scenarioKey\""))
    .distinctOn('partnerId','programId','scenarioKey').orderBy('partnerId').orderBy('programId').orderBy('scenarioKey').orderBy('createdAt','desc').orderBy('id','desc')
    .modify(q=>{if(scenarioIds.length)q.whereRaw("COALESCE(data->>'scenarioId',id) = ANY(?::text[])",[scenarioIds.filter(id=>id!=='__none__')]);});
  const [definitions,sources,materials]=await Promise.all([
    snapshots,
    selected(scoped('PartnerLinkSource')).distinct('platformId','platformName','formatId','formatName'),
    selected(scoped('PartnerMaterial')).whereNull('archivedAt').distinct('formatId','formatName','platforms'),
  ]);
  const platforms=new Map<string,PlatformOption>(),formats=new Map<string,Option>();
  const add=(target:Map<string,Option>,id:unknown,name:unknown)=>{
    if(typeof id!=='string'||typeof name!=='string'||!id.trim()||!name.trim()||target.has(id))return;
    target.set(id,{id,name});
  };
  // A saved scenario is the authority for its current names and removed choices.
  // Read its latest revision, not the union of every previous configuration.
  for(const snapshot of definitions){
    if(!scenarioIds.length&&snapshot.status!=='confirmed')continue;
    const model=await calculateCoachForecast(snapshot.data?.settings??{});
    for(const item of model.formats)add(formats,item.id,item.name);
    for(const item of model.channels){
      const config=model.settings.channels[item.id];
      if(!config?.enabled||!config.formats?.length)continue;
      add(platforms,item.id,item.name);
      const option=platforms.get(item.id)!;
      if(item.url&&!option.url)option.url=item.url;
      option.formats=[...new Set([...(option.formats??[]),...config.formats.filter((id:string)=>item.formats.includes(id))])] as string[];
    }
  }
  if(!scenarioIds.length||scenarioIds.includes('__none__')){
    const model=await calculateCoachForecast({});
    for(const item of model.channels){add(platforms,item.id,item.name);const option=platforms.get(item.id)!;option.formats??=item.formats;if(item.url&&!option.url)option.url=item.url;}
    for(const item of model.formats)add(formats,item.id,item.name);
  }
  // Actual materials/links remain selectable even when their platform was added
  // outside the calculator or removed from a later version of its settings.
  for(const source of sources){
    add(platforms,source.platformId,source.platformName);add(formats,source.formatId,source.formatName);
    const option=platforms.get(source.platformId);if(option)option.formats=[...new Set([...(option.formats??[]),source.formatId])];
  }
  for(const material of materials){
    add(formats,material.formatId,material.formatName);
    for(const platform of Array.isArray(material.platforms)?material.platforms:[])if(platform){
      add(platforms,platform.id,platform.name);const option=platforms.get(platform.id);
      if(option){option.formats=[...new Set([...(option.formats??[]),material.formatId])];if(!option.url&&typeof platform.url==='string')option.url=platform.url;}
    }
  }
  const sorted=<T extends Option>(items:Map<string,T>)=>[...items.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true})||a.id.localeCompare(b.id));
  return {platforms:sorted(platforms),formats:sorted(formats)};
}
