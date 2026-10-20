import type {AnalyticsReport,MetricRow} from './PartnerAnalytics.js';
import {trackingShareUrl} from '../lib/share-links.js';

export interface PublicationSource {
  id:string;programId:string;linkId:string;linkKey:string|null;materialId:string|null;materialTitle:string|null;
  scenarioId:string|null;scenarioName:string|null;platformId:string;platformName:string;formatId:string;formatName:string;
  publicationUrl:string|null;channelName:string|null;publishedAt:string|null;createdAt:string;materialArchivedAt?:string|null;params:Record<string,string>;
}
export interface LinkStatistics {programId:string;current?:AnalyticsReport;previous?:AnalyticsReport;comparing:boolean}
export const publicationMetrics=[['clicks','Переходы'],['registrations','Регистрации'],['payments','Оплаты'],['earnings','Заработок']] as const;
export type PublicationMetric=typeof publicationMetrics[number][0];
export function publicationValue(row:MetricRow|undefined,metric:PublicationMetric){
  return !row?0:metric==='payments'?row.counts.paymentCount:metric==='earnings'?row.amountsMinor.netAccrued:row.counts[metric];
}
export const measuredPublication=(row:MetricRow|undefined)=>!!row&&(row.counts.clicks>0||row.counts.registrations>0||row.counts.paymentCount>0||Object.values(row.amountsMinor).some(value=>value!==0));
export function publicationRow(source:PublicationSource,measured?:MetricRow):MetricRow {
  return {id:source.id,name:source.materialTitle||'Материал не указан',createdAt:source.createdAt,archived:!!source.materialArchivedAt,
    counts:measured?.counts??{clicks:0,registrations:0,payingCustomers:0,paymentCount:0,firstPaymentCount:0,repeatPaymentCount:0},
    amountsMinor:measured?.amountsMinor??{observedPayments:0,refunds:0,netPayments:0,netAccrued:0},conversions:measured?.conversions,
    placement:{materialTitle:source.materialTitle,formatName:source.formatName,platformName:source.platformName,channelName:source.channelName,publicationUrl:source.publicationUrl,publishedAt:source.publishedAt,linkKey:source.linkKey,trackingParams:source.params}};
}
export function publicationSummary(sources:PublicationSource[],prepared=false){
  const published=sources.filter(source=>prepared?!source.publishedAt:!!source.publishedAt),formats=new Map<string,{id:string;name:string;placements:number;materials:Set<string>}>();
  for(const source of published){const row=formats.get(source.formatId)??{id:source.formatId,name:source.formatName,placements:0,materials:new Set<string>()};row.placements++;if(source.materialId)row.materials.add(source.materialId);formats.set(source.formatId,row);}
  return {published:published.length,materials:new Set(published.flatMap(source=>source.materialId?[source.materialId]:[])).size,platforms:new Set(published.map(source=>source.platformId)).size,formats:[...formats.values()].sort((a,b)=>b.placements-a.placements||a.name.localeCompare(b.name,'ru'))};
}
const csvCell=(value:string|number)=>`"${String(typeof value==='string'&&/^[=+\-@\t\r]/.test(value)?`'${value}`:value).replace(/"/g,'""')}"`;
export function publicationsCsv(sources:PublicationSource[],current:AnalyticsReport,previous?:AnalyticsReport){
  const now=new Map(current.rows.map(row=>[row.id,row])),before=new Map(previous?.rows.map(row=>[row.id,row])??[]);
  const header=['Материал','Площадка','Формат','Дата публикации','Публикация','Партнёрская ссылка','Переходы','Регистрации','Оплаты',`Заработок, ${current.currency??'RUB'}`];
  if(previous)header.push('Переходы: сравнение','Регистрации: сравнение','Оплаты: сравнение','Заработок: сравнение');
  const values=sources.map(source=>[source.materialTitle??'',source.platformName,source.formatName,source.publishedAt??'',source.publicationUrl??'',source.linkKey?trackingShareUrl(source.linkKey,source.params):'',...publicationMetrics.map(([metric])=>publicationValue(now.get(source.id),metric)/(metric==='earnings'?100:1)),...(previous?publicationMetrics.map(([metric])=>publicationValue(before.get(source.id),metric)/(metric==='earnings'?100:1)):[])]);
  return '\uFEFF'+[['Начало периода',current.period?.since??''],['Конец периода (не включён)',current.period?.until??''],...(previous?[['Начало сравнения',previous.period?.since??''],['Конец сравнения (не включён)',previous.period?.until??'']]:[]),header,...values].map(line=>line.map(csvCell).join(';')).join('\r\n');
}
