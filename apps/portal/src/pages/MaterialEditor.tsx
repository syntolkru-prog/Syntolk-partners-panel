import {VisualSelect} from '../components/tremor/VisualControls.js';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link,useLocation } from 'react-router-dom';
import { api, currentTenantSlug } from '../api.js';
import { Button, ErrorBanner } from '../ui.js';
import { useTenantBase } from '../tenant-base.js';
import { trackingShareUrl } from '../lib/share-links.js';
import { invalidateAnalytics } from './results-scope.js';
import {publicationPlatformUrl} from '../lib/publication-platform.js';
import {useUnsavedChanges} from '../lib/useUnsavedChanges.js';
import './materials.css';

interface Platform {id:string;name:string;formats?:string[];url?:string}
interface Material {id:string;title:string;revision:number;programId:string;scenarioId:string|null;formatId:string;formatName:string;platforms:Platform[];content?:string}
interface Placement {id:string;linkKey:string;platformId:string;platformName:string;channelName:string|null;publicationUrl:string|null;publishedAt:string|null;params:Record<string,string>}
interface BaseLink {id:string;linkKey:string;label:string|null;archived?:boolean}
interface PublicationUpdate {publicationUrl?:string;channelName?:string;published?:boolean;expected?:{publicationUrl?:string;channelName?:string;published?:boolean}}
const requestId=()=>crypto.randomUUID().replaceAll('-','');
export function materialError(error:unknown){const detail=(error as {detail?:{detail?:unknown}}|null)?.detail?.detail;return typeof detail==='string'?new Error(detail):error;}
function useCatalog(partnerId:string,material:Material|undefined){return useQuery({queryKey:['material-catalog',currentTenantSlug(),partnerId,material?.programId,material?.scenarioId??'__none__'],enabled:!!material,queryFn:()=>api<{formats:Platform[];platforms:Platform[];content?:string}>(`/partners/${partnerId}/material-catalog?${new URLSearchParams({programId:material!.programId,scenarioId:material!.scenarioId??'__none__'})}`),refetchInterval:30000,refetchOnWindowFocus:true});}

export function MaterialEditor({partnerId,materialId,publicationMode=false,archivedSource,adminContext=false}:{partnerId:string;materialId:string;publicationMode?:boolean;archivedSource?:Placement;adminContext?:boolean}) {
  const cache=useQueryClient(),base=useTenantBase(),tenant=currentTenantSlug(),location=useLocation();
  const materialKey=['partner-material',tenant,partnerId,materialId];
  const query=useQuery({queryKey:materialKey,enabled:!archivedSource,queryFn:()=>api<{material:Material;placements:Placement[]}>(`/partners/${partnerId}/materials/${materialId}`),refetchInterval:30000,refetchOnWindowFocus:true});
  const material=archivedSource?undefined:query.data?.material,placements=archivedSource?[]:query.data?.placements??[];
  const links=useQuery({queryKey:['links',partnerId,tenant,material?.programId],queryFn:()=>api<{links:BaseLink[]}>(`/partners/${partnerId}/links?programId=${encodeURIComponent(material!.programId)}`),enabled:!!material});
  const catalog=useCatalog(partnerId,material);
  const [title,setTitle]=useState(''),[chosen,setChosen]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[copied,setCopied]=useState(''),[fallback,setFallback]=useState(''),[adding,setAdding]=useState(false),[platformName,setPlatformName]=useState('');
  const sending=useRef(false),additionalId=useRef(requestId());
  const titleBase=useRef<{title:string;revision:number}|null>(null);
  useUnsavedChanges(!!material&&!publicationMode&&title!==(titleBase.current?.title??material.title),busy);
  const preferenceKey=`syntolk-partner-base-link:${tenant??'default'}:${partnerId}:${material?.programId}`;
  useEffect(()=>{if(material&&(!titleBase.current||title===titleBase.current.title||title===material.title)){setTitle(material.title);titleBase.current={title:material.title,revision:material.revision};}},[material?.title,material?.revision]);
  useEffect(()=>{try{setChosen(localStorage.getItem(preferenceKey)??'');}catch{/* Optional preference. */}},[preferenceKey]);
  const available=(links.data?.links??[]).filter(l=>!l.archived),link=available.find(l=>l.id===chosen)??available[0];
  const refresh=async()=>{await Promise.all([cache.invalidateQueries({queryKey:materialKey}),invalidateAnalytics(cache),cache.invalidateQueries({queryKey:['coach',tenant,partnerId]}),cache.invalidateQueries({queryKey:['work-calendar',tenant,partnerId]}),cache.invalidateQueries({queryKey:['link-sources',partnerId]})]);};
  const run=async(action:()=>Promise<void>)=>{if(sending.current)return;sending.current=true;setBusy(true);setError(null);try{await action();}catch(e){setError(e);if((e as {status?:number}).status===409)await refresh();}finally{sending.current=false;setBusy(false);}};
  const ensure=async(platform:Platform,source?:Placement):Promise<Placement>=>{
    if(source)return source;
    if(!material||!link)throw new Error('Создайте партнёрскую ссылку.');
    const response=await api<{source:Omit<Placement,'linkKey'|'params'>;params:Record<string,string>}>(`/partners/${partnerId}/links/${link.id}/sources`,{method:'POST',body:{scenarioId:material.scenarioId??'__none__',formatId:material.formatId,platformId:platform.id,materialId}});
    return {...response.source,linkKey:link.linkKey,params:response.params};
  };
  const copy=(platform:Platform,source?:Placement)=>run(async()=>{const placement=await ensure(platform,source),url=trackingShareUrl(placement.linkKey,placement.params);setCopied('');setFallback('');try{await navigator.clipboard.writeText(publicationMode&&material?.content?`${material.content}\n\n${url}`:url);setCopied(placement.id);}catch{setFallback(url);}await refresh();});
  const savePublication=(platform:Platform,source:Placement|undefined,body:PublicationUpdate)=>run(async()=>{const placement=await ensure(platform,source);await api(`/partners/${partnerId}/link-sources/${placement.id}`,{method:'PATCH',body});await refresh();});
  const addPlacement=()=>run(async()=>{
    if(!material||!link||!platformName.trim())return;
    const known=catalog.data?.platforms.find(p=>p.name===platformName.trim()),platform={id:known?.id??`custom-${additionalId.current}`,name:platformName.trim()};
    await api(`/partners/${partnerId}/materials/${materialId}/placements`,{method:'POST',body:{linkId:link.id,platform,requestId:additionalId.current}});
    additionalId.current=requestId();setAdding(false);setPlatformName('');await refresh();
  });
  if(archivedSource){
    const platform={id:archivedSource.platformId,name:archivedSource.platformName};
    return <div className="material-editor"><ErrorBanner error={materialError(error)}/><PlacementRow platform={platform} source={archivedSource} busy={busy} canCopy={!!archivedSource.linkKey} copied={copied===archivedSource.id} onCopy={()=>{void copy(platform,archivedSource);}} onSave={body=>{void savePublication(platform,archivedSource,body);}}/>{fallback&&<label className="coach-field"><span>Скопируйте ссылку</span><input readOnly value={fallback} onFocus={e=>e.target.select()}/></label>}</div>;
  }
  if(query.isLoading)return <p className="coach-muted">Загружаем материал…</p>;
  if(!material)return <ErrorBanner error={materialError(query.error)}/>;
  const platformWithUrl=(platform:Platform)=>({...platform,url:platform.url||catalog.data?.platforms?.find(item=>item.id===platform.id)?.url});
  const rows=[...placements.map(source=>({key:source.id,platform:platformWithUrl({id:source.platformId,name:source.platformName,url:material.platforms.find(item=>item.id===source.platformId)?.url}),source})),...material.platforms.filter(p=>!placements.some(s=>s.platformId===p.id)).map(platform=>({key:platform.id,platform:platformWithUrl(platform),source:undefined}))];
  return <div className="material-editor">
    <ErrorBanner error={materialError(error??links.error)}/>
    {!publicationMode&&<form className="material-name" onSubmit={e=>{e.preventDefault();void run(async()=>{await api(`/partners/${partnerId}/materials/${materialId}/workspace`,{method:'PATCH',body:{title,revision:titleBase.current?.revision??material.revision}});await refresh();});}}><label className="coach-field"><span>Название материала</span><input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>{title!==material.title&&<><Button type="submit" disabled={busy||!title.trim()}>Сохранить</Button><Button variant="ghost" disabled={busy} onClick={()=>{setTitle(material.title);titleBase.current={title:material.title,revision:material.revision};setError(null);}}>Отменить изменения</Button></>}</form>}
    {available.length>1&&<label className="coach-field"><span>Основная ссылка для новых размещений</span><VisualSelect value={link?.id??''} onChange={e=>{setChosen(e.target.value);try{localStorage.setItem(preferenceKey,e.target.value);}catch{/* Optional preference. */}}}>{available.map(l=><option key={l.id} value={l.id}>{l.label||l.linkKey}</option>)}</VisualSelect></label>}
    {!links.isLoading&&!link&&<Link className="coach-summary-link" to={`${base}/links?${new URLSearchParams({section:'create',view:'links',create:'partner',partnerId,programId:material.programId,scenarioId:material.scenarioId??'__none__',returnTo:location.pathname+location.search})}`}>Создать партнёрскую ссылку →</Link>}
    {rows.map(({key,platform,source})=><PlacementRow key={key} platform={platform} source={source} busy={busy} canCopy={!!source||!!link} copied={source?.id===copied} copyLabel={publicationMode?'Копировать текст и ссылку':undefined} onCopy={()=>{void copy(platform,source);}} onSave={body=>{void savePublication(platform,source,body);}} resultsHref={`${base}/${adminContext?'admin/analytics':'results'}?${new URLSearchParams({...(adminContext?{selectedPartner:partnerId}:{}),programId:material.programId,scenarioId:material.scenarioId??'__none__',materialId,platformId:platform.id,groupBy:'source',...(source?{sourceId:source.id}:{})})}`}/>)}
    {!rows.length&&<p className="coach-muted">Добавьте площадку, на которой разместите материал.</p>}
    {fallback&&<label className="coach-field"><span>Скопируйте ссылку</span><input readOnly value={fallback} onFocus={e=>e.target.select()}/></label>}
    {adding?<form className="material-add-placement" onSubmit={e=>{e.preventDefault();void addPlacement();}}><label className="coach-field"><span>Площадка</span><input autoFocus required maxLength={120} list={`platforms-${materialId}`} value={platformName} onChange={e=>setPlatformName(e.target.value)} placeholder="Выберите или укажите свою"/><datalist id={`platforms-${materialId}`}>{catalog.data?.platforms?.filter(p=>p.formats?.includes(material.formatId)).map(p=><option key={p.id} value={p.name}/>)}</datalist></label><div className="coach-actions"><Button type="submit" disabled={busy||!link||!platformName.trim()}>Добавить</Button><Button type="button" variant="ghost" onClick={()=>setAdding(false)}>Отмена</Button></div></form>:<Button variant="ghost" disabled={!link||busy} onClick={()=>setAdding(true)}>+ Добавить размещение</Button>}
  </div>;
}

function PlacementRow({platform,source,busy,canCopy,copied,onCopy,onSave,resultsHref,copyLabel}:{platform:Platform;source?:Placement;busy:boolean;canCopy:boolean;copied:boolean;onCopy:()=>void;onSave:(body:PublicationUpdate)=>void;resultsHref?:string;copyLabel?:string}) {
  const [editing,setEditing]=useState(false),[url,setUrl]=useState(source?.publicationUrl??''),[channel,setChannel]=useState(source?.channelName??'');
  const [baseline,setBaseline]=useState({url:source?.publicationUrl??'',channel:source?.channelName??''}),[remoteChanged,setRemoteChanged]=useState(false);
  useEffect(()=>{
    const next={url:source?.publicationUrl??'',channel:source?.channelName??''};
    const cleanUrl=url===baseline.url||url===next.url,cleanChannel=channel===baseline.channel||channel===next.channel;
    setRemoteChanged(!cleanUrl&&next.url!==baseline.url||!cleanChannel&&next.channel!==baseline.channel);
    if(cleanUrl)setUrl(next.url);if(cleanChannel)setChannel(next.channel);
    setBaseline({url:cleanUrl?next.url:baseline.url,channel:cleanChannel?next.channel:baseline.channel});
  },[source?.publicationUrl,source?.channelName]);
  const changed=url.trim()!==baseline.url||channel.trim()!==baseline.channel;
  useUnsavedChanges(changed,busy);
  const platformUrl=publicationPlatformUrl(platform.id,platform.url);
  return <section className="material-placement">
    <div className="material-placement__header"><div><strong>{source?.channelName||platform.name}</strong><small>{source?.channelName?`${platform.name} · `:''}{source?.publishedAt?`Опубликовано ${new Date(source.publishedAt).toLocaleDateString('ru-RU')}`:'Запланировано'}</small></div><label className="material-published"><input type="checkbox" checked={!!source?.publishedAt} disabled={busy||!canCopy} aria-label={`Опубликовано: ${source?.channelName||platform.name}`} onChange={e=>onSave({published:e.target.checked,expected:{published:!!source?.publishedAt}})}/>Опубликовано</label></div>
    <div className="coach-actions"><Button variant="secondary" disabled={busy||!canCopy} onClick={onCopy}>{copied?'Скопировано':copyLabel??'Копировать ссылку'}</Button>{source?.publicationUrl?<a href={source.publicationUrl} target="_blank" rel="noopener noreferrer">Открыть публикацию ↗</a>:platformUrl&&<a href={platformUrl} target="_blank" rel="noopener noreferrer">Открыть площадку ↗</a>}<Button variant="ghost" onClick={()=>setEditing(!editing)}>{editing?'Скрыть':'Указать публикацию'}</Button>{resultsHref&&<Link to={resultsHref}>Результаты</Link>}</div>
    {remoteChanged&&<p role="status">Размещение изменено в другом кабинете. <Button variant="ghost" disabled={busy} onClick={()=>{if(changed&&!window.confirm('Заменить несохранённые поля актуальными данными?'))return;const next={url:source?.publicationUrl??'',channel:source?.channelName??''};setUrl(next.url);setChannel(next.channel);setBaseline(next);setRemoteChanged(false);}}>Обновить поля</Button></p>}
    {editing&&<form onSubmit={e=>{e.preventDefault();if(changed&&!remoteChanged)onSave({...(url.trim()!==baseline.url?{publicationUrl:url.trim()}:{}),...(channel.trim()!==baseline.channel?{channelName:channel.trim()}:{}),expected:{...(url.trim()!==baseline.url?{publicationUrl:baseline.url}:{}),...(channel.trim()!==baseline.channel?{channelName:baseline.channel}:{})}});}}><div className="coach-grid"><label className="coach-field"><span>Ссылка на публикацию</span><input type="url" maxLength={2048} placeholder="https://…" value={url} onChange={e=>setUrl(e.target.value)}/></label><label className="coach-field"><span>Канал / аккаунт</span><input maxLength={120} placeholder={platform.name} value={channel} onChange={e=>setChannel(e.target.value)}/></label></div><Button type="submit" disabled={busy||remoteChanged||!canCopy||!changed}>Сохранить</Button></form>}
  </section>;
}
