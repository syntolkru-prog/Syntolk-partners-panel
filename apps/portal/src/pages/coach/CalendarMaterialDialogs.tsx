import {useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useSearchParams} from 'react-router-dom';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Upload,X,Paperclip,Check,ArrowUpRight,Clock,Copy,Download,Trash2} from 'lucide-react';
import {api,apiBlob,currentTenantSlug} from '../../api.js';
import {Button,ErrorBanner,Input,Textarea} from '../../ui.js';
import {VisualSelect} from '../../components/tremor/VisualControls.js';
import {MaterialEditor,materialError} from '../MaterialEditor.js';
import {DateInput} from '../DateInput.js';
import {useUnsavedChanges} from '../../lib/useUnsavedChanges.js';
import {dateLabel,fileAccept,fileType,uploadId,type CalendarMaterial,type CalendarPlatform} from './work-calendar-model.js';
import './work-calendar.css';

export interface Catalog {formats:CalendarPlatform[];platforms:CalendarPlatform[];scenarios:Array<{id:string;name:string;programId:string}>}
interface Attachment {id:string;name:string;contentType:string;size:number}
interface Detail {material:CalendarMaterial&{programId:string;content:string;preparedAt:string|null};files:Attachment[];placements:Array<{publishedAt:string|null}>}
const sizeLabel=(size:number)=>size<1048576?`${Math.ceil(size/1024)} КБ`:`${(size/1048576).toFixed(1)} МБ`;
const materialPath=(partnerId:string,id:string)=>`/partners/${partnerId}/materials/${id}`;
async function uploadFile(partnerId:string,id:string,file:File,requestId:string){
  if(file.size>100*1024*1024||!file.size)throw new Error('Размер файла: от 1 байта до 100 МБ.');
  return api(`${materialPath(partnerId,id)}/files`,{method:'POST',headers:{'Content-Type':fileType(file),'X-File-Name':encodeURIComponent(file.name),'X-Upload-Id':requestId},body:file});
}

export function CalendarDialog({title,drawer=false,close,actions,children}:{title:string;drawer?:boolean;close:()=>void;actions?:ReactNode;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();},[]);
  useEffect(()=>{const bodyOverflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=bodyOverflow;};},[]);
  const closeButton=<button type="button" aria-label="Закрыть" title="Закрыть" onClick={close}><X size={19}/></button>;
  return createPortal(<dialog ref={ref} className={`wc-dialog${drawer?' wc-dialog--drawer':''}`} aria-label={title} onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget){const box=e.currentTarget.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)close();}}}><header><h2>{title}</h2><div className="wc-dialog-header-actions">{actions}{closeButton}</div></header><div className="wc-dialog-content">{children}</div></dialog>,document.body);
}

export function MaterialDrawer({partnerId,id,allMaterials=[],close,refresh,open,adminContext=false}:{partnerId:string;id:string;allMaterials?:CalendarMaterial[];close:()=>void;refresh:()=>Promise<void>;open?:(id:string)=>void;adminContext?:boolean}){
  const [params,setParams]=useSearchParams();
  const tenant=currentTenantSlug(),cache=useQueryClient(),key=['partner-material',tenant,partnerId,id],path=materialPath(partnerId,id);
  const query=useQuery({queryKey:key,queryFn:()=>api<Detail>(path),refetchInterval:30000,refetchOnWindowFocus:true});
  const [content,setContent]=useState(''),[date,setDate]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[copied,setCopied]=useState(false),[pending,setPending]=useState<Array<{file:File;id:string;done:boolean}>>([]);
  const [title,setTitle]=useState(''),[time,setTime]=useState(''),[readyDraft,setReadyDraft]=useState(false),[target,setTarget]=useState(''),[saved,setSaved]=useState(false);
  const stage=params.get('materialTab')==='publish'?'publish':'material';
  const setStage=(value:'material'|'publish')=>setParams(previous=>{const next=new URLSearchParams(previous);if(value==='publish')next.set('materialTab',value);else next.delete('materialTab');return next;},{replace:true});
  const sending=useRef(false),extraServer=useRef<{title:string;time:string;ready:boolean}|null>(null);
  const dirtyRef=useRef(false),[remoteChanged,setRemoteChanged]=useState(false);
  const revision=useRef(0),lastServer=useRef<{content:string;date:string}|null>(null),material=query.data?.material;
  useEffect(()=>{if(material){if(revision.current&&material.revision!==revision.current&&dirtyRef.current){setRemoteChanged(true);return;}setRemoteChanged(false);const previous=lastServer.current,next={content:material.content??'',date:material.scheduledDay??''};setContent(value=>!previous||value===previous.content?next.content:value);setDate(value=>!previous||value===previous.date?next.date:value);lastServer.current=next;revision.current=material.revision;}},[material?.revision,material?.content,material?.scheduledDay]);
  useEffect(()=>{if(!material||revision.current&&material.revision!==revision.current&&dirtyRef.current)return;const previous=extraServer.current,next={title:material.title,time:material.scheduledTime??'',ready:material.ready};setTitle(v=>!previous||v===previous.title?next.title:v);setTime(v=>!previous||v===previous.time?next.time:v);setReadyDraft(v=>!previous||v===previous.ready?next.ready:v);extraServer.current=next;},[material?.revision,material?.ready]);
  const run=async(action:()=>Promise<void>)=>{if(sending.current)return;sending.current=true;setBusy(true);setError(null);setSaved(false);try{await action();}catch(e){setError(e);}finally{await Promise.all([cache.invalidateQueries({queryKey:key}),refresh()]);sending.current=false;setBusy(false);}};
  const patch=async(body:object)=>{const result=await api<{revision:number}>(path+'/workspace',{method:'PATCH',body:{revision:revision.current,...body}});revision.current=result.revision;};
  const download=(file:Attachment)=>run(async()=>{const blob=await apiBlob(`${path}/files/${file.id}`),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  const published=query.data?.placements.some(p=>p.publishedAt),ready=!!material?.ready;
  const slots=allMaterials.filter(m=>m.id!==id&&m.scheduledDay&&m.formatId===material?.formatId&&!m.ready&&!m.hasContent&&!m.fileCount&&!m.publishedPlacements);
  const dirty=!!material&&(content!==(lastServer.current?.content??material.content??'')||date!==(lastServer.current?.date??material.scheduledDay??'')||title!==(extraServer.current?.title??material.title)||time!==(extraServer.current?.time??material.scheduledTime??'')||readyDraft!==(extraServer.current?.ready??ready)||pending.some(p=>!p.done));
  dirtyRef.current=dirty;
  const allowNavigation=useUnsavedChanges(dirty,busy);
  const save=(publish=false)=>run(async()=>{if(remoteChanged)throw new Error('Материал изменён в другом кабинете. Обновите карточку перед сохранением.');for(const item of pending){if(!item.done){await uploadFile(partnerId,id,item.file,item.id);item.done=true;}}await patch({...(title!==material?.title?{title}:{}),...(content!==(material?.content??'')?{content}:{}),...(date!==(material?.scheduledDay??'')?{scheduledDay:date||null}:{}),...(time!==(material?.scheduledTime??'')?{scheduledTime:time||null}:{}),...(readyDraft!==ready?{ready:readyDraft||!!published}:{})});setPending([]);setSaved(true);if(publish){allowNavigation();setStage('publish');}});
  const reloadMaterial=()=>{
    if(!material||busy||dirty&&!window.confirm('Загрузить актуальный материал? Несохранённые изменения будут заменены.'))return;
    setContent(material.content??'');setDate(material.scheduledDay??'');setTitle(material.title);setTime(material.scheduledTime??'');setReadyDraft(material.ready);setPending([]);
    lastServer.current={content:material.content??'',date:material.scheduledDay??''};extraServer.current={title:material.title,time:material.scheduledTime??'',ready:material.ready};revision.current=material.revision;dirtyRef.current=false;setRemoteChanged(false);setError(null);
  };
  const assign=()=>run(async()=>{const slot=slots.find(m=>m.id===target);if(!slot)return;const result=await api<{materialId:string}>(path+'/assign',{method:'POST',body:{revision:revision.current,targetId:slot.id,targetRevision:slot.revision}});open?.(result.materialId);});
  const remove=()=>{if(!busy&&window.confirm(`Удалить материал «${material?.title}» из календаря и материалов? Ссылки и статистика сохранятся.`))void run(async()=>{await api(path,{method:'DELETE',body:{revision:revision.current}});allowNavigation();close();});};
  return <CalendarDialog title={material?.title??'Материал и публикации'} drawer close={()=>{if(!busy)close();}} actions={material&&<>{remoteChanged&&<Button variant="secondary" size="sm" disabled={busy} onClick={reloadMaterial}>Обновить карточку</Button>}<Button variant="danger" size="sm" disabled={busy} icon={<Trash2 size={14}/>} onClick={remove}>Удалить материал</Button></>}>
    <div className="wc-drawer-tabs" role="tablist" aria-label="Работа с материалом"><button role="tab" aria-selected={stage==='material'} onClick={()=>setStage('material')}>Материал</button><button role="tab" aria-selected={stage==='publish'} disabled={!material||busy} onClick={()=>{if(dirty)void save(true);else setStage('publish');}}>Публикация</button></div>
    <div className="wc-dialog-body"><ErrorBanner error={remoteChanged?new Error('Материал изменён в другом кабинете. Ваш черновик сохранён; обновите карточку перед сохранением.'):materialError(error??query.error)}/>{query.isLoading?<p>Загружаем материал…</p>:material?<>
    {stage==='material'?<>
      <label className="wc-field"><span>Название</span><Input aria-label="Название материала" maxLength={200} value={title} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label>
      <div className="wc-form-grid"><div className="wc-field"><span>День публикации</span><DateInput label="День публикации" value={date} onChange={setDate} disabled={busy}/></div><label className="wc-field"><span>Время</span><Input type="time" aria-label="Время публикации" value={time} disabled={busy} onChange={e=>setTime(e.target.value)}/></label></div>
      <label className="wc-field"><span>Текст материала</span><Textarea aria-label="Текст материала" rows={7} maxLength={100000} placeholder="Текст поста, описание или заметки к ролику" value={content} disabled={busy} onChange={e=>{setContent(e.target.value);setCopied(false);}}/></label>
    </>:<div className="wc-publication-text"><div className="wc-section-title"><h3>Текст материала</h3><Button size="sm" variant="secondary" icon={<Copy size={13}/>} disabled={!content} onClick={()=>{void navigator.clipboard.writeText(content).then(()=>setCopied(true)).catch(setError);}}>{copied?'Скопировано':'Копировать текст'}</Button></div>{content&&<p>{content}</p>}</div>}
    <section className="wc-drawer-section"><div className="wc-section-title"><h3>Файлы <span>{query.data!.files.length}/12</span></h3>{stage==='material'&&<label className="wc-upload-button"><Upload size={14}/> Добавить<input type="file" multiple accept={fileAccept} disabled={busy} onChange={e=>{const next=Array.from(e.target.files??[]);const total=query.data!.files.reduce((n,f)=>n+f.size,0)+pending.filter(p=>!p.done).reduce((n,p)=>n+p.file.size,0)+next.reduce((n,f)=>n+f.size,0);if(query.data!.files.length+pending.filter(p=>!p.done).length+next.length>12||total>250*1024*1024||next.some(f=>f.size>100*1024*1024||!f.size))setError(new Error('До 12 файлов и 250 МБ на материал, до 100 МБ на файл.'));else setPending(previous=>[...previous,...next.map(file=>({file,id:uploadId(),done:false}))]);e.target.value='';}}/></label>}</div>
      {query.data!.files.map(file=><div className="wc-file" key={file.id}><Paperclip size={14}/><span>{file.name}<small>{sizeLabel(file.size)}</small></span><button aria-label={`Скачать ${file.name}`} disabled={busy} onClick={()=>void download(file)}><Download size={16}/></button>{stage==='material'&&<button aria-label={`Удалить ${file.name}`} disabled={busy||!!published} onClick={()=>{if(window.confirm(`Удалить файл «${file.name}» без возможности восстановления?`))void run(async()=>{await api(`${path}/files/${file.id}`,{method:'DELETE'});});}}><Trash2 size={14}/></button>}</div>)}
      {!query.data!.files.length&&!pending.length&&<p className="wc-muted">Фото, видео, аудио, PDF и TXT. До 100 МБ на файл.</p>}
      {pending.filter(p=>!p.done).map(item=><div className="wc-file" key={item.id}><span>{item.file.name}</span><small>{sizeLabel(item.file.size)}</small><button aria-label={`Убрать ${item.file.name}`} disabled={busy} onClick={()=>setPending(previous=>previous.filter(p=>p.id!==item.id))}><X size={14}/></button></div>)}
    </section>
    {stage==='material'?<>
      <label className="wc-ready"><input type="checkbox" checked={readyDraft||!!published} disabled={busy||!!published} onChange={e=>setReadyDraft(e.target.checked)}/><span><strong>Материал готов</strong><small>Готовность к публикации</small></span>{(readyDraft||published)&&<Check size={17}/>}</label>
      {!material.scheduledDay&&slots.length>0&&<details className="wc-assign"><summary>Прикрепить к задаче из плана</summary><label className="wc-field"><span>Свободная задача</span><VisualSelect aria-label="Задача из плана" value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}><option value="">Выберите задачу</option>{slots.map(m=><option key={m.id} value={m.id}>{dateLabel(m.scheduledDay!)} · {m.title}</option>)}</VisualSelect></label><Button variant="secondary" size="sm" disabled={busy||!target||dirty} onClick={()=>void assign()}>Прикрепить к задаче</Button>{dirty&&<p className="wc-muted">Сначала сохраните изменения.</p>}</details>}
    </>:<section><MaterialEditor partnerId={partnerId} materialId={id} publicationMode adminContext={adminContext}/></section>}
    </>:null}</div>
    {material&&stage==='material'&&<footer className="wc-dialog-footer"><span className="wc-save-state" role="status">{busy?'Сохраняем…':dirty?'Есть изменения':saved?'Сохранено':''}</span><Button variant="secondary" disabled={busy||remoteChanged||!dirty||!title.trim()} onClick={()=>void save()}>Сохранить</Button><Button icon={<ArrowUpRight size={14}/>} disabled={busy||remoteChanged||!title.trim()} onClick={()=>{if(dirty)void save(true);else setStage('publish');}}>К публикации</Button></footer>}
  </CalendarDialog>;
}

interface UploadItem {id:string;file:File;uploadId:string;title:string;done:boolean;created:boolean;error?:string}
export function CreateMaterials({partnerId,programId,scenarioId,day,catalog:initialCatalog,batch,close,refresh,open}:{partnerId:string;programId:string;scenarioId:string;day:string;catalog:Catalog;batch:boolean;close:()=>void;refresh:()=>Promise<void>;open:(id:string)=>void}){
  const id=useRef(uploadId()),created=useRef(false),sending=useRef(false);
  const [title,setTitle]=useState(''),[format,setFormat]=useState(initialCatalog.formats.find(f=>f.id==='post')?.id??initialCatalog.formats[0]?.id??''),[scenario,setScenario]=useState(scenarioId),[date,setDate]=useState(day),[content,setContent]=useState(''),[platforms,setPlatforms]=useState<string[]>([]),[items,setItems]=useState<UploadItem[]>([]),[separate,setSeparate]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[started,setStarted]=useState(false);
  const catalogRequest=useQuery({queryKey:['material-catalog',currentTenantSlug(),partnerId,programId,scenario||'__none__'],queryFn:()=>api<Catalog>(`/partners/${partnerId}/material-catalog?${new URLSearchParams({programId,scenarioId:scenario||'__none__'})}`)});
  const catalog=catalogRequest.data??{...initialCatalog,formats:[],platforms:[]};
  useEffect(()=>{const choices=catalogRequest.data?.formats;if(choices&&!started)setFormat(previous=>choices.some(f=>f.id===previous)?previous:choices[0]?.id??'');},[catalogRequest.data,started]);
  const compatible=catalog.platforms.filter(p=>!p.formats||p.formats.includes(format));
  const individual=batch&&separate;
  const dirty=items.some(item=>!item.done)||!started&&!!(title||content||platforms.length);
  const allowNavigation=useUnsavedChanges(dirty,busy);
  const closeForm=()=>{if(busy||dirty&&!window.confirm('Закрыть без сохранения изменений?'))return;allowNavigation();close();};
  const body=(materialId:string,name:string)=>({id:materialId,programId,scenarioId:scenario||null,title:name.trim(),formatId:format,scheduledDay:date||null,content:individual?'':content,platforms:compatible.filter(p=>platforms.includes(p.id)).map(({id,name})=>({id,name}))});
  const save=async()=>{
    if(sending.current||!catalogRequest.data||!catalog.formats.some(f=>f.id===format))return;
    if(items.some(i=>!i.file.size||i.file.size>100*1024*1024)||!individual&&(items.length>12||items.reduce((n,i)=>n+i.file.size,0)>250*1024*1024)){setError(new Error('До 12 файлов и 250 МБ на материал, до 100 МБ на файл.'));return;}
    sending.current=true;setBusy(true);setError(null);
    try{
      if(individual){
        for(const item of items){if(item.done)continue;try{if(!item.created){await api(`/partners/${partnerId}/materials`,{method:'POST',body:body(item.id,item.title)});item.created=true;setStarted(true);}await uploadFile(partnerId,item.id,item.file,item.uploadId);item.done=true;delete item.error;}catch(e){item.error=materialError(e) instanceof Error?(materialError(e) as Error).message:'Ошибка загрузки';}setItems(previous=>[...previous]);}
        await refresh();if(items.every(item=>item.done)){allowNavigation();close();}
      }else{
        if(!created.current){await api(`/partners/${partnerId}/materials`,{method:'POST',body:body(id.current,title)});created.current=true;setStarted(true);}
        for(const item of items){if(!item.done){await uploadFile(partnerId,id.current,item.file,item.uploadId);item.done=true;setItems(previous=>[...previous]);}}
        await refresh();allowNavigation();open(id.current);
      }
    }catch(e){setError(e);await refresh();}finally{sending.current=false;setBusy(false);}
  };
  const choose=(files:File[])=>{const next=[...items,...files.map(file=>({id:uploadId(),file,uploadId:uploadId(),title:file.name.replace(/\.[^.]+$/,''),done:false,created:false}))];if(files.some(f=>!f.size||f.size>100*1024*1024)){setError(new Error('Размер файла: от 1 байта до 100 МБ.'));return;}setItems(next);if(!title&&files[0])setTitle(files[0].name.replace(/\.[^.]+$/,''));};
  return <CalendarDialog title={batch?'Загрузить материалы':'Добавить материал'} close={closeForm}><form onSubmit={e=>{e.preventDefault();void save();}}><div className="wc-dialog-body"><ErrorBanner error={materialError(error??catalogRequest.error)}/>
    {batch&&<label className="wc-option-toggle"><input type="checkbox" checked={separate} disabled={busy||started} onChange={e=>setSeparate(e.target.checked)}/>Отдельный материал для каждого файла</label>}
    {!individual&&<label className="wc-field"><span>Название материала</span><Input autoFocus required maxLength={200} value={title} disabled={busy||started} onChange={e=>setTitle(e.target.value)}/></label>}
    <div className="wc-form-grid"><label className="wc-field"><span>Тип контента</span><VisualSelect value={format} disabled={busy||started} onChange={e=>{setFormat(e.target.value);setPlatforms([]);}}>{catalog.formats.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</VisualSelect></label><div className="wc-field"><span>День публикации</span><DateInput label="День публикации" value={date} disabled={busy||started} onChange={setDate}/></div></div>
    <label className="wc-field"><span>Сценарий</span><VisualSelect value={scenario} disabled={busy||started} onChange={e=>{setScenario(e.target.value);setPlatforms([]);}}><option value="">Без сценария</option>{initialCatalog.scenarios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</VisualSelect></label>
    <fieldset className="wc-platforms" disabled={busy||started}><legend>Площадки</legend><div>{compatible.map(p=><label key={p.id}><input type="checkbox" checked={platforms.includes(p.id)} onChange={e=>setPlatforms(previous=>e.target.checked?[...previous,p.id]:previous.filter(id=>id!==p.id))}/>{p.name}</label>)}</div></fieldset>
    {!individual&&<label className="wc-field"><span>Текст материала</span><Textarea rows={4} maxLength={100000} value={content} disabled={busy||started} onChange={e=>setContent(e.target.value)}/></label>}
    <label className="wc-dropzone"><Upload size={23}/><strong>{individual?'Выбрать файлы для отдельных материалов':'Прикрепить файлы одного материала'}</strong><span>Фото, видео, аудио, PDF и TXT · до 100 МБ на файл</span><input type="file" multiple accept={fileAccept} disabled={busy||started} onChange={e=>{choose(Array.from(e.target.files??[]));e.target.value='';}}/></label>
    {items.map(item=><div className="wc-batch-item" key={item.id}><div>{individual?<Input aria-label={`Название ${item.file.name}`} required maxLength={200} value={item.title} disabled={busy||item.created} onChange={e=>{item.title=e.target.value;setItems(previous=>[...previous]);}}/>:<strong>{item.file.name}</strong>}<small>{sizeLabel(item.file.size)}{item.done?' · Загружено':''}</small>{item.error&&<span role="alert" className="wc-file-error">{item.error}</span>}</div>{item.done?<Check size={18}/>:!item.done&&!busy?<button type="button" aria-label={`Убрать ${item.file.name}`} onClick={()=>setItems(previous=>previous.filter(i=>i.id!==item.id))}><X size={16}/></button>:<Clock size={16}/>}</div>)}
    {batch&&<p className="wc-muted">{individual?`${items.filter(i=>i.done).length} из ${items.length} загружено. `:''}Без даты материалы останутся в запасе.</p>}
  </div><footer className="wc-dialog-footer"><Button variant="secondary" disabled={busy} onClick={closeForm}>Закрыть</Button><Button type="submit" disabled={busy||!catalogRequest.data||!catalog.formats.some(f=>f.id===format)||(individual?(!items.length||items.every(i=>i.done)||items.some(i=>!i.title.trim())):!title.trim())}>{busy?'Сохраняем…':started?'Повторить загрузку':'Сохранить'}</Button></footer></form></CalendarDialog>;
}
