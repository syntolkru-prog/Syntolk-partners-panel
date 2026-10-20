import type {Knex} from 'knex';
import {calculatorAnalyticsBreakdown,partnerAnalyticsOverview,type AnalyticsFilters} from './partner-analytics.js';

type Work={prepared:Set<string>;published:Set<string>;placements:Set<string>};
const work=():Work=>({prepared:new Set(),published:new Set(),placements:new Set()});
const counts=(value:Work)=>({preparedMaterials:value.prepared.size,publishedMaterials:value.published.size,publishedPlacements:value.placements.size});
const key=(value:string|null)=>value??'__none__';
const pair=(platform:string|null,format:string|null)=>JSON.stringify([platform,format]);

/** A read-only view of recorded work and the canonical Results report, never a forecast. */
export async function calculatorCurrentValues(db:Knex,tenantId:string,partnerId:string,filters:AnalyticsFilters){
  const now=new Date(),until=new Date(Math.min(filters.until?.getTime()??now.getTime(),now.getTime()));
  const since=filters.since!;
  const scope=<T extends Knex.QueryBuilder>(query:T,alias:string)=>{
    query.where({[`${alias}.tenantId`]:tenantId,[`${alias}.partnerId`]:partnerId,[`${alias}.programId`]:filters.programId});
    if(filters.scenarioId)filters.scenarioId==='__none__'?query.whereNull(`${alias}.scenarioId`):query.where(`${alias}.scenarioId`,filters.scenarioId);
    return query;
  };
  const [report,metrics,sources,completed]=await Promise.all([
    partnerAnalyticsOverview(db,tenantId,partnerId,{...filters,until,includeSeries:'true'},false),
    calculatorAnalyticsBreakdown(db,tenantId,partnerId,{...filters,until}),
    scope(db('PartnerLinkSource as p'),'p').select('p.id','p.materialId','p.platformId','p.platformName','p.formatId','p.formatName','p.publishedAt').orderBy('p.createdAt','desc'),
    scope(db('PartnerMaterial as m'),'m').join('CoachTask as t',function(){
      this.on(db.raw('COALESCE(t.data->>\'materialId\',t.id) = m.id')).andOn('t.tenantId','=','m.tenantId').andOn('t.partnerId','=','m.partnerId').andOn('t.programId','=','m.programId');
    }).where('t.status','completed').select('m.id','m.formatId','m.formatName','t.data','t.updatedAt'),
  ]);
  const total=work(),formats=new Map<string,Work>(),platforms=new Map<string,Work>(),pairs=new Map<string,Work>();
  const formatNames=new Map<string,string>(),platformNames=new Map<string,string>();
  const get=(map:Map<string,Work>,id:string)=>{if(!map.has(id))map.set(id,work());return map.get(id)!;};
  const prepared=new Map<string,{at:number;format:string}>();
  const record=(id:string,at:unknown,format:string)=>{
    const time=at instanceof Date?at.getTime():Date.parse(String(at));
    if(Number.isFinite(time)&&time<until.getTime()&&time<(prepared.get(id)?.at??Infinity))prepared.set(id,{at:time,format});
  };
  for(const source of sources){
    const format=key(source.formatId),platform=key(source.platformId);
    if(!formatNames.has(format))formatNames.set(format,source.formatName||'Формат не указан');
    if(!platformNames.has(platform))platformNames.set(platform,source.platformName||'Площадка не указана');
    if(!source.publishedAt)continue;
    const time=new Date(source.publishedAt).getTime();
    if(!Number.isFinite(time)||time>=until.getTime())continue;
    if(source.materialId)record(source.materialId,source.publishedAt,format);
    if(time<since.getTime())continue;
    for(const group of [total,get(formats,format),get(platforms,platform),get(pairs,pair(source.platformId,source.formatId))]){
      group.placements.add(source.id);if(source.materialId)group.published.add(source.materialId);
    }
  }
  for(const row of completed){
    const format=key(row.formatId);if(!formatNames.has(format))formatNames.set(format,row.formatName||'Формат не указан');
    record(String(row.id),row.data?.completion?.at??row.updatedAt,format);
  }
  for(const [id,item]of prepared)if(item.at>=since.getTime()){total.prepared.add(id);get(formats,item.format).prepared.add(id);}
  const empty={counts:{clicks:0,registrations:0,payingCustomers:0,paymentCount:0,firstPaymentCount:0,repeatPaymentCount:0},amountsMinor:{observedPayments:0,netAccrued:0},conversions:{clickToRegistration:null,registrationToPayment:null,clickToPayment:null,cohortRegistrations:0,cohortPaidRegistrations:0}};
  type Metric=typeof metrics.formats[number];
  const rows=(values:Metric[],groups:Map<string,Work>,names:Map<string,string>)=>{
    const byId=new Map(values.map(row=>[row.id,row]));
    return [...new Set([...byId.keys(),...groups.keys()])].map(id=>{
      const row=byId.get(id)??empty;
      return {...row,id,name:names.get(id)??'Источник не указан',content:counts(groups.get(id)??work()),clickShare:report.counts.clicks?row.counts.clicks/report.counts.clicks:null};
    }).sort((a,b)=>b.counts.clicks-a.counts.clicks||a.name.localeCompare(b.name,'ru'));
  };
  // PostgreSQL JSON text contains whitespace; use the same stable key as work rows.
  const pairMetrics=metrics.platformFormats.map(row=>{const [platform,format]=JSON.parse(row.id);return {...row,id:pair(platform,format)};});
  const formatRows=rows(metrics.formats,formats,formatNames),pairRows=rows(pairMetrics,pairs,new Map());
  const platformRows=rows(metrics.platforms,platforms,platformNames).map(row=>({...row,formats:pairRows.filter(item=>key(JSON.parse(item.id)[0])===row.id).map(item=>({...item,id:key(JSON.parse(item.id)[1]),name:formatNames.get(key(JSON.parse(item.id)[1]))??'Формат не указан'}))}));
  return {...report,content:counts(total),breakdown:{formats:formatRows,platforms:platformRows}};
}
