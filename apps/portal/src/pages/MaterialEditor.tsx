import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, currentTenantSlug } from '../api.js';
import { Button, ErrorBanner } from '../ui.js';
import { useTenantBase } from '../tenant-base.js';
import { trackingShareUrl } from '../lib/share-links.js';
import { invalidateAnalytics } from './results-scope.js';
import './materials.css';

interface Platform {id:string;name:string;formats?:string[]}
interface Material {id:string;title:string;programId:string;scenarioId:string|null;formatId:string;formatName:string;platforms:Platform[]}
interface Placement {id:string;linkKey:string;platformId:string;platformName:string;channelName:string|null;publicationUrl:string|null;publishedAt:string|null;params:Record<string,string>}
interface BaseLink {id:string;linkKey:string;label:string|null;archived?:boolean}
const requestId=()=>crypto.randomUUID().replaceAll('-','');
export function materialError(error:unknown){const detail=(error as {detail?:{detail?:unknown}}|null)?.detail?.detail;return typeof detail==='string'?new Error(detail):error;}
function useCatalog(partnerId:string){return useQuery({queryKey:['material-catalog',currentTenantSlug(),partnerId],queryFn:()=>api<{formats:Platform[];platforms:Platform[]}>(`/partners/${partnerId}/material-catalog`),staleTime:300000});}

export function MaterialEditor({partnerId,materialId}:{partnerId:string;materialId:string}) {
  const cache=useQueryClient(),base=useTenantBase(),tenant=currentTenantSlug();
  const materialKey=['partner-material',tenant,partnerId,materialId];
  const query=useQuery({queryKey:materialKey,queryFn:()=>api<{material:Material;placements:Placement[]}>(`/partners/${partnerId}/materials/${materialId}`)});
  const material=query.data?.material,placements=query.data?.placements??[];
  const links=useQuery({queryKey:['links',partnerId,tenant,material?.programId],queryFn:()=>api<{links:BaseLink[]}>(`/partners/${partnerId}/links?programId=${encodeURIComponent(material!.programId)}`),enabled:!!material});
  const catalog=useCatalog(partnerId);
  const [title,setTitle]=useState(''),[chosen,setChosen]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[copied,setCopied]=useState(''),[fallback,setFallback]=useState(''),[adding,setAdding]=useState(false),[platformName,setPlatformName]=useState('');
  const sending=useRef(false),additionalId=useRef(requestId());
  const preferenceKey=`syntolk-partner-base-link:${tenant??'default'}:${partnerId}:${material?.programId}`;
  useEffect(()=>{if(material)setTitle(material.title);},[material?.title]);
  useEffect(()=>{try{setChosen(localStorage.getItem(preferenceKey)??'');}catch{/* Optional preference. */}},[preferenceKey]);
  const available=(links.data?.links??[]).filter(l=>!l.archived),link=available.find(l=>l.id===chosen)??available[0];
  const refresh=async()=>{await Promise.all([cache.invalidateQueries({queryKey:materialKey}),invalidateAnalytics(cache),cache.invalidateQueries({queryKey:['coach',tenant,partnerId]}),cache.invalidateQueries({queryKey:['link-sources',partnerId]})]);};
  const run=async(action:()=>Promise<void>)=>{if(sending.current)return;sending.current=true;setBusy(true);setError(null);try{await action();}catch(e){setError(e);}finally{sending.current=false;setBusy(false);}};
  const ensure=async(platform:Platform,source?:Placement):Promise<Placement>=>{
    if(source)return source;
    if(!material||!link)throw new Error('Создайте партнёрскую ссылку.');
    const response=await api<{source:Omit<Placement,'linkKey'|'params'>;params:Record<string,string>}>(`/partners/${partnerId}/links/${link.id}/sources`,{method:'POST',body:{scenarioId:material.scenarioId??'__none__',formatId:material.formatId,platformId:platform.id,materialId}});
    return {...response.source,linkKey:link.linkKey,params:response.params};
  };
  const copy=(platform:Platform,source?:Placement)=>run(async()=>{const placement=await ensure(platform,source),url=trackingShareUrl(placement.linkKey,placement.params);setCopied('');setFallback('');try{await navigator.clipboard.writeText(url);setCopied(placement.id);}catch{setFallback(url);}await refresh();});
  const savePublication=(platform:Platform,source:Placement|undefined,body:{publicationUrl?:string;channelName?:string;published?:boolean})=>run(async()=>{const placement=await ensure(platform,source);await api(`/partners/${partnerId}/link-sources/${placement.id}`,{method:'PATCH',body});await refresh();});
  const addPlacement=()=>run(async()=>{
    if(!material||!link||!platformName.trim())return;
    const known=catalog.data?.platforms.find(p=>p.name===platformName.trim()),platform={id:known?.id??`custom-${additionalId.current}`,name:platformName.trim()};
    await api(`/partners/${partnerId}/materials/${materialId}/placements`,{method:'POST',body:{linkId:link.id,platform,requestId:additionalId.current}});
    additionalId.current=requestId();setAdding(false);setPlatformName('');await refresh();
  });
  if(query.isLoading)return <p className="coach-muted">Загружаем материал…</p>;
  if(!material)return <ErrorBanner error={materialError(query.error)}/>;
  const rows=[...placements.map(source=>({key:source.id,platform:{id:source.platformId,name:source.platformName},source})),...material.platforms.filter(p=>!placements.some(s=>s.platformId===p.id)).map(platform=>({key:platform.id,platform,source:undefined}))];
  return <div className="material-editor">
    <ErrorBanner error={materialError(error??links.error)}/>
    <form className="material-name" onSubmit={e=>{e.preventDefault();void run(async()=>{await api(`/partners/${partnerId}/materials/${materialId}`,{method:'PATCH',body:{title}});await refresh();});}}><label className="coach-field"><span>Название материала</span><input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>{title!==material.title&&<Button type="submit" disabled={busy||!title.trim()}>Сохранить</Button>}</form>
    {available.length>1&&<label className="coach-field"><span>Основная ссылка для новых размещений</span><select value={link?.id??''} onChange={e=>{setChosen(e.target.value);try{localStorage.setItem(preferenceKey,e.target.value);}catch{/* Optional preference. */}}}>{available.map(l=><option key={l.id} value={l.id}>{l.label||l.linkKey}</option>)}</select></label>}
    {!links.isLoading&&!link&&<Link className="coach-summary-link" to={`${base}/links?view=links&programId=${encodeURIComponent(material.programId)}`}>Создать партнёрскую ссылку →</Link>}
    {rows.map(({key,platform,source})=><PlacementRow key={key} platform={platform} source={source} busy={busy} canCopy={!!source||!!link} copied={source?.id===copied} onCopy={()=>{void copy(platform,source);}} onSave={body=>{void savePublication(platform,source,body);}} resultsHref={`${base}/results?programId=${encodeURIComponent(material.programId)}&scenarioId=${encodeURIComponent(material.scenarioId??'__none__')}&materialId=${encodeURIComponent(materialId)}&groupBy=material`}/>)}
    {!rows.length&&<p className="coach-muted">Добавьте площадку, на которой разместите материал.</p>}
    {fallback&&<label className="coach-field"><span>Скопируйте ссылку</span><input readOnly value={fallback} onFocus={e=>e.target.select()}/></label>}
    {adding?<form className="material-add-placement" onSubmit={e=>{e.preventDefault();void addPlacement();}}><label className="coach-field"><span>Площадка</span><input autoFocus required maxLength={120} list={`platforms-${materialId}`} value={platformName} onChange={e=>setPlatformName(e.target.value)} placeholder="Выберите или укажите свою"/><datalist id={`platforms-${materialId}`}>{catalog.data?.platforms.filter(p=>p.formats?.includes(material.formatId)).map(p=><option key={p.id} value={p.name}/>)}</datalist></label><div className="coach-actions"><Button type="submit" disabled={busy||!link||!platformName.trim()}>Добавить</Button><Button type="button" variant="ghost" onClick={()=>setAdding(false)}>Отмена</Button></div></form>:<Button variant="ghost" disabled={!link||busy} onClick={()=>setAdding(true)}>+ Добавить размещение</Button>}
  </div>;
}

function PlacementRow({platform,source,busy,canCopy,copied,onCopy,onSave,resultsHref}:{platform:Platform;source?:Placement;busy:boolean;canCopy:boolean;copied:boolean;onCopy:()=>void;onSave:(body:{publicationUrl?:string;channelName?:string;published?:boolean})=>void;resultsHref?:string}) {
  const [editing,setEditing]=useState(false),[url,setUrl]=useState(source?.publicationUrl??''),[channel,setChannel]=useState(source?.channelName??'');
  useEffect(()=>{setUrl(source?.publicationUrl??'');setChannel(source?.channelName??'');},[source?.publicationUrl,source?.channelName]);
  const changed=url.trim()!==(source?.publicationUrl??'')||channel.trim()!==(source?.channelName??'');
  return <section className="material-placement">
    <div className="material-placement__header"><div><strong>{source?.channelName||platform.name}</strong><small>{source?.channelName?`${platform.name} · `:''}{source?.publishedAt?`Опубликовано ${new Date(source.publishedAt).toLocaleDateString('ru-RU')}`:'Запланировано'}</small></div><label className="material-published"><input type="checkbox" checked={!!source?.publishedAt} disabled={busy||!canCopy} aria-label={`Опубликовано: ${source?.channelName||platform.name}`} onChange={e=>onSave({published:e.target.checked})}/>Опубликовано</label></div>
    <div className="coach-actions"><Button variant="secondary" disabled={busy||!canCopy} onClick={onCopy}>{copied?'Скопировано':'Копировать ссылку'}</Button>{source?.publicationUrl&&<a href={source.publicationUrl} target="_blank" rel="noopener noreferrer">Открыть публикацию ↗</a>}<Button variant="ghost" onClick={()=>setEditing(!editing)}>{editing?'Скрыть':'Указать публикацию'}</Button>{resultsHref&&<Link to={resultsHref}>Результаты</Link>}</div>
    {editing&&<form onSubmit={e=>{e.preventDefault();if(changed)onSave({publicationUrl:url.trim(),channelName:channel.trim()});}}><div className="coach-grid"><label className="coach-field"><span>Ссылка на публикацию</span><input type="url" maxLength={2048} placeholder="https://…" value={url} onChange={e=>setUrl(e.target.value)}/></label><label className="coach-field"><span>Канал / аккаунт</span><input maxLength={120} placeholder={platform.name} value={channel} onChange={e=>setChannel(e.target.value)}/></label></div><Button type="submit" disabled={busy||!canCopy||!changed}>Сохранить</Button></form>}
  </section>;
}
