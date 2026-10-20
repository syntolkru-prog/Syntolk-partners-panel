import {useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Check,Copy,FilePlus2,X} from 'lucide-react';
import {api,ApiError,currentTenantSlug} from '../api.js';
import {trackingShareUrl} from '../lib/share-links.js';
import {invalidateAnalytics} from './results-scope.js';
import {ErrorBanner} from '../ui.js';

interface Choice {id:string;name:string}
interface CreatedPublication {material:{id:string};source:{id:string;publishedAt:string|null};linkKey:string;params:Record<string,string>}

export function CreatePublication({partnerId,programId,onClose,onCreated}:{
  partnerId:string;programId:string;onClose:()=>void;onCreated:(result:CreatedPublication)=>void;
}){
  const cache=useQueryClient(),tenant=currentTenantSlug();
  const [requestId]=useState(()=>crypto.randomUUID().replaceAll('-',''));
  const catalog=useQuery({queryKey:['material-catalog',tenant,partnerId,programId],queryFn:()=>api<{formats:Choice[];platforms:Choice[];scenarios?:Choice[]}>(`/partners/${partnerId}/material-catalog?programId=${encodeURIComponent(programId)}`),enabled:!!programId});
  const links=useQuery({queryKey:['links',partnerId,tenant,programId],queryFn:()=>api<{links:Array<{id:string;label:string|null;linkKey:string}>}>(`/partners/${partnerId}/links?programId=${encodeURIComponent(programId)}`),enabled:!!programId});
  const [title,setTitle]=useState(''),[formatId,setFormatId]=useState('post'),[platformId,setPlatformId]=useState(''),[customPlatform,setCustomPlatform]=useState('');
  const [scenarioId,setScenarioId]=useState(''),[linkId,setLinkId]=useState(''),[channelName,setChannelName]=useState(''),[publicationUrl,setPublicationUrl]=useState(''),[published,setPublished]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[result,setResult]=useState<CreatedPublication|null>(null),[copied,setCopied]=useState(false);
  const sending=useRef(false),submitted=useRef<string|null>(null);
  const platform=platformId==='__custom__'?{id:`custom-${requestId}`,name:customPlatform.trim()}:catalog.data?.platforms.find(p=>p.id===platformId);
  const valid=!!programId&&!!title.trim()&&!!platform?.name&&!!catalog.data?.formats.some(f=>f.id===formatId);
  const url=result?trackingShareUrl(result.linkKey,result.params):'';
  const submit=async()=>{
    if(sending.current||!valid||!platform)return;
    sending.current=true;setBusy(true);setError(null);
    const body={requestId,programId,title:title.trim(),formatId,platform,scenarioId:scenarioId||null,
      ...(linkId?{linkId}:{}),channelName:channelName.trim(),publicationUrl:publicationUrl.trim(),published};
    // A retry of an ambiguous network failure must reuse the same request and payload.
    const serialized=JSON.stringify(body);
    if(submitted.current&&submitted.current!==serialized){
      setError(new Error('Предыдущий запрос не подтверждён. Повторите его без изменения полей или закройте форму и проверьте список размещений.'));
      sending.current=false;setBusy(false);return;
    }
    submitted.current=serialized;
    try{
      const created=await api<CreatedPublication>(`/partners/${partnerId}/publications`,{method:'POST',body});
      setResult(created);
      onCreated(created);
      void Promise.all([invalidateAnalytics(cache),cache.invalidateQueries({queryKey:['link-sources',partnerId]}),
        cache.invalidateQueries({queryKey:['links',partnerId]}),cache.invalidateQueries({queryKey:['material-catalog']})]);
    }catch(e){if(e instanceof ApiError&&[400,403,404,422].includes(e.status))submitted.current=null;const detail=(e as {detail?:{detail?:unknown}})?.detail?.detail;setError(typeof detail==='string'?new Error(detail):e);}
    finally{sending.current=false;setBusy(false);}
  };
  return <section className="publication-create" aria-label="Создание ссылки на публикацию">
    <header className="publication-create__header"><div className="publication-create__heading"><span className="publication-create__icon"><FilePlus2 size={20}/></span><div><h2>{result?'Ссылка готова':'Ссылка на публикацию'}</h2><p>{result?'Используйте её в выбранном посте, ролике или статье.':'Создайте отслеживаемую ссылку без калькулятора. Результаты появятся в общей аналитике.'}</p></div></div><button type="button" className="results-icon-button" aria-label="Закрыть создание публикации" disabled={busy} onClick={onClose}><X size={17}/></button></header>
    <ErrorBanner error={error??catalog.error??links.error}/>
    {result?<div className="publication-create__success" role="status">
      <label>Ссылка для размещения<input aria-label="Готовая ссылка публикации" readOnly value={url} onFocus={event=>event.target.select()}/></label>
      <button className="results-button publication-create__primary" type="button" onClick={()=>{void navigator.clipboard.writeText(url).then(()=>{setCopied(true);setError(null);}).catch(()=>setError(new Error('Копирование недоступно. Выделите и скопируйте ссылку из поля.')));}}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'Скопировано':'Копировать ссылку'}</button>
      <p>{result.source.publishedAt?'Размещение отмечено опубликованным.':'Пока это подготовленная ссылка, а не опубликованный материал. После размещения отметьте публикацию в списке ниже.'} {scenarioId?'Результаты будут учтены и в выбранном сценарии.':'Результаты учитываются без привязки к сценарию; в калькуляторе доступны в режиме «Весь контент».'}</p>
      <button className="results-button" type="button" onClick={onClose}>Перейти к отчёту</button>
    </div>:<form onSubmit={event=>{event.preventDefault();void submit();}}>
      <fieldset disabled={busy||catalog.isPending||!!catalog.error||!programId}>
        <div className="publication-create__grid">
          <label className="publication-create__wide">Название материала<input autoFocus required maxLength={200} value={title} onChange={event=>setTitle(event.target.value)} placeholder="Например, обзор Syntolk на YouTube"/></label>
          <label>Тип контента<select aria-label="Тип контента публикации" value={formatId} onChange={event=>setFormatId(event.target.value)}>{catalog.data?.formats.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label>Площадка<select required aria-label="Площадка новой публикации" value={platformId} onChange={event=>setPlatformId(event.target.value)}><option value="">Выберите площадку</option>{catalog.data?.platforms.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}<option value="__custom__">Другая площадка…</option></select></label>
          {platformId==='__custom__'&&<label className="publication-create__wide">Название площадки<input required maxLength={120} value={customPlatform} onChange={event=>setCustomPlatform(event.target.value)} placeholder="Ваша площадка"/></label>}
        </div>
        <details className="publication-create__details"><summary>Дополнительно: сценарий, канал и адрес публикации</summary><div className="publication-create__grid">
          <label>Сценарий <select aria-label="Сценарий новой публикации" value={scenarioId} onChange={event=>setScenarioId(event.target.value)}><option value="">Без сценария</option>{catalog.data?.scenarios?.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>Канал / аккаунт<input maxLength={120} value={channelName} onChange={event=>setChannelName(event.target.value)} placeholder="Необязательно"/></label>
          <label className="publication-create__wide">Адрес опубликованного материала<input type="url" maxLength={2048} value={publicationUrl} onChange={event=>setPublicationUrl(event.target.value)} placeholder="https://… — можно добавить позже"/></label>
          {(links.data?.links.length??0)>0&&<label className="publication-create__wide">Основная партнёрская ссылка<select aria-label="Основная ссылка новой публикации" value={linkId} onChange={event=>setLinkId(event.target.value)}><option value="">Выбрать автоматически</option>{links.data?.links.map(l=><option key={l.id} value={l.id}>{l.label||l.linkKey}</option>)}</select></label>}
        </div></details>
        <label className="publication-create__published"><input type="checkbox" checked={published} onChange={event=>setPublished(event.target.checked)}/>Материал уже опубликован</label>
        <p className="publication-create__hint">Для каждой площадки — отдельная ссылка. Переходы, регистрации и оплаты попадут в статистику автоматически. {links.isSuccess&&!links.data.links.length?'Основная партнёрская ссылка будет создана вместе с публикацией.':'Существующие ссылки и их история сохранятся.'}</p>
        <div className="publication-create__actions"><button className="results-button publication-create__primary" type="submit" disabled={!valid||busy||links.isPending||!!links.error}>{busy?'Создаём…':'Создать отслеживаемую ссылку'}</button><button className="results-button" type="button" onClick={onClose}>Отмена</button></div>
      </fieldset>
    </form>}
  </section>;
}
