import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, currentTenantSlug } from '../../api.js';
import { Button, Card, ErrorBanner, Input } from '../../ui.js';

interface Connection {
  version: string; hasKey: boolean; keySource: 'ui'|'env'|'none'; model: string; secureStorage: boolean;
  verification: {ok:boolean;at:string;detail:string;model:string}|null;
  modelSelection: ModelSelection;
}
interface Model {id:string;name:string;contextLength:number;inputPerMillion:number|null;outputPerMillion:number|null}
type ModelSelection = 'catalog'|'manual';
interface Props {enabled:boolean;provider:string;dailyRuns:number;onChanged:()=>void|Promise<void>}
type Notice = string|{kind:'verified'};
const price=(n:number|null)=>n===null?'нет данных':new Intl.NumberFormat('ru-RU',{style:'currency',currency:'USD',maximumFractionDigits:4}).format(n);

function conflictError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && (error as {status?:unknown}).status === 409;
}

function consentStorageKey(scope: string|null): string {
  return `syntolk-openrouter-paid-test:${scope??'default'}`;
}

function readConsent(scope: string|null): boolean {
  try { return sessionStorage.getItem(consentStorageKey(scope)) === '1'; } catch { return false; }
}

function saveNotice(next:Connection,enabled:boolean,provider:string): string {
  if(next.verification?.ok) return enabled&&provider==='openrouter'?'Настройки сохранены. ИИ остаётся включённым, подключение проверено.':'Настройки сохранены. Подключение остаётся проверенным, повторная проверка не требуется.';
  return 'Настройки сохранены. Теперь можно проверить подключение.';
}

type ScopedProps=Props & {scope:string|null};

export function OpenRouterSettings(props:Props) {
  const scope=currentTenantSlug();
  return <OpenRouterSettingsForm key={scope??'default'} scope={scope} {...props}/>;
}

function OpenRouterSettingsForm({enabled,provider,dailyRuns,onChanged,scope}:ScopedProps) {
  const cache=useQueryClient();
  const connection=useQuery({queryKey:['coach-openrouter',scope],queryFn:()=>api<Connection>('/admin/coach/openrouter')});
  const catalog=useQuery({queryKey:['coach-models',scope],queryFn:()=>api<{models:Model[]}>('/admin/coach/openrouter/models'),staleTime:300000,retry:false});
  const [apiKey,setApiKey]=useState(''),[model,setModel]=useState(()=>connection.data?.model??''),[search,setSearch]=useState(''),[manual,setManual]=useState(()=>connection.data?.modelSelection==='manual');
  const [busy,setBusy]=useState(''),[error,setError]=useState<Error|null>(null),[notice,setNotice]=useState<Notice>(''),[acceptCost,setAcceptCost]=useState(()=>readConsent(scope)),[remove,setRemove]=useState(false),[conflict,setConflict]=useState(false);
  const [baseline,setBaseline]=useState<Connection|undefined>(()=>connection.data);
  const baselineRef=useRef<Connection|undefined>(connection.data);
  const saved=baseline;
  const openRouterEnabled=enabled&&provider==='openrouter';
  const dirty=!!saved&&(!!apiKey||model!==saved.model||manual!==(saved.modelSelection==='manual'));
  const activationHint=dirty?'Сначала сохраните изменения ключа или модели.':!saved?.hasKey?'Сначала сохраните API-ключ OpenRouter.':!saved.model?'Сначала выберите и сохраните модель.':!saved.verification?.ok?'Сначала успешно проверьте подключение.':null;
  const noticeText=typeof notice==='string'?notice:openRouterEnabled?'Подключение проверено. ИИ OpenRouter включён. Повторное включение не требуется.':'Подключение проверено. Нажмите «Включить ИИ OpenRouter».';
  const dirtyRef=useRef(false);
  dirtyRef.current=dirty;
  useEffect(()=>{try{if(acceptCost)sessionStorage.setItem(consentStorageKey(scope),'1');else sessionStorage.removeItem(consentStorageKey(scope));}catch{/* sessionStorage is optional. */}},[acceptCost,scope]);
  useEffect(()=>{
    const next=connection.data;
    if(!next)return;
    if(!baselineRef.current||!dirtyRef.current){
      baselineRef.current=next;
      setBaseline(next);
      setModel(next.model);
      setManual(next.modelSelection==='manual');
    }
  },[connection.data]);
  const selected=catalog.data?.models?.find(m=>m.id===model);
  const filtered=(catalog.data?.models??[]).filter(m=>`${m.name} ${m.id}`.toLowerCase().includes(search.toLowerCase()));
  const act=async(name:string,fn:()=>Promise<void>)=>{setBusy(name);setError(null);setConflict(false);setNotice('');try{await fn();}catch(e){if(conflictError(e)){setConflict(true);setError(new Error('Серверная версия настроек изменилась. Обновите данные и повторите сохранение — ваш черновик останется в форме.'));}else setError(e as Error);}finally{setBusy('');}};
  const update=(next:Connection)=>{cache.setQueryData(['coach-openrouter',scope],next);baselineRef.current=next;setBaseline(next);setModel(next.model);setManual(next.modelSelection==='manual');onChanged();};
  const refreshServer=()=>{setBusy('refresh');setError(null);void connection.refetch().then(result=>{if(result.error)throw result.error;if(!result.data)throw new Error('Не удалось загрузить серверную версию.');baselineRef.current=result.data;setBaseline(result.data);setConflict(false);setNotice('Серверная версия обновлена. Черновик сохранён.');}).catch(e=>setError(e as Error)).finally(()=>setBusy(''));};
  return <Card><section aria-label="Подключение OpenRouter">
    <div className="coach-row"><div><h2>Подключение ИИ через OpenRouter</h2><p className="coach-muted">Ключ и модель настраиваются здесь. Редактировать файлы сервера не нужно.</p></div><span className="coach-badge" aria-label={`Состояние ИИ: ${openRouterEnabled?'включён':'выключен'}`}>{openRouterEnabled?'ИИ-куратор включён':'ИИ-куратор выключен'}</span></div>
    <ErrorBanner error={error??connection.error}/>
    {conflict&&<div role="alert" className="coach-connection-info"><strong>Настройки изменились на сервере</strong><p className="coach-muted">Обновите серверную версию, чтобы увидеть актуальные данные. Поля, которые вы уже изменили, не будут затёрты.</p><Button variant="secondary" disabled={!!busy} onClick={refreshServer}>Обновить серверные данные</Button></div>}
    {connection.isLoading&&<p role="status">Загружаем настройки…</p>}
    {saved&&<>
      <p className="coach-muted">{saved.hasKey?`Ключ уже настроен ${saved.keySource==='env'?'на сервере':'в админке'} и скрыт. Для замены вставьте новый.`:'1. Вставьте API-ключ из своего аккаунта OpenRouter.'} <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">Открыть ключи OpenRouter</a></p>
      <label className="coach-field"><span>API-ключ OpenRouter</span><Input type="password" autoComplete="new-password" spellCheck={false} value={apiKey} placeholder={saved.hasKey?'Оставьте пустым, чтобы сохранить текущий ключ':'sk-or-v1-…'} disabled={!!busy} onChange={e=>setApiKey(e.target.value)}/></label>
      {!saved.secureStorage&&<p className="coach-warning">На сервере не настроено безопасное хранилище. Сохранение нового ключа пока недоступно.</p>}
      <div className="coach-row"><h3>2. Выберите модель</h3><Button variant="secondary" disabled={!!busy||catalog.isFetching} onClick={()=>{void catalog.refetch();}}>{catalog.isFetching?'Загружаем…':'Обновить модели'}</Button></div>
      <p className="coach-muted">Показаны текстовые модели с инструментами и структурированными ответами, без пакетных версий. Доступность с настройками конфиденциальности подтверждается проверкой подключения.</p>
      {catalog.error&&<p className="coach-warning">Каталог недоступен. Повторите загрузку или включите ввод ID вручную.</p>}
      <label><input type="checkbox" checked={manual} disabled={!!busy} onChange={e=>setManual(e.target.checked)}/> Указать ID модели вручную</label>
      {manual?<label className="coach-field"><span>ID модели OpenRouter</span><Input value={model} placeholder="провайдер/название-модели" disabled={!!busy} onChange={e=>setModel(e.target.value)}/></label>:<>
        <label className="coach-field"><span>Поиск модели</span><Input value={search} placeholder="Название или провайдер" disabled={!!busy} onChange={e=>setSearch(e.target.value)}/></label>
        <label className="coach-field"><span>Модель</span><select value={model} disabled={!!busy||catalog.isLoading} onChange={e=>setModel(e.target.value)}><option value="">Выберите модель</option>{model&&!filtered.some(m=>m.id===model)&&<option value={model}>{selected?.name??model} — текущий выбор</option>}{filtered.map(m=><option key={m.id} value={m.id}>{m.name} — {m.id}</option>)}</select></label>
        <p className="coach-muted">Найдено моделей: {filtered.length}. <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">Каталог OpenRouter</a></p>
      </>}
      {selected&&<div className="coach-connection-info"><strong>{selected.name}</strong><p className="coach-muted">{selected.id} · контекст: {selected.contextLength.toLocaleString('ru-RU')} токенов</p><p className="coach-muted">За 1 млн токенов: вход — {price(selected.inputPerMillion)}, выход — {price(selected.outputPerMillion)}. Цены из каталога, фактический расход зависит от запросов.</p></div>}
      <div className="coach-actions"><Button disabled={!!busy||(!dirty&&saved.version!=='env')||!model.trim()||(!apiKey.trim()&&!saved.hasKey)||(!saved.secureStorage&&!!apiKey.trim())} onClick={()=>{void act('save',async()=>{const next=await api<Connection>('/admin/coach/openrouter',{method:'PUT',body:{version:saved.version,model:model.trim(),modelSelection:manual?'manual':'catalog',...(apiKey.trim()?{apiKey:apiKey.trim()}:{})}});setApiKey('');update(next);setNotice(saveNotice(next,enabled,provider));});}}>{busy==='save'?'Сохраняем…':'Сохранить ключ и модель'}</Button></div>
      <h3>3. Проверьте подключение</h3>
      <p className="coach-muted">Проверяем ключ и настоящий ответ выбранной модели на вымышленных данных. Данные партнёров не отправляются. Возможны до 4 коротких запросов, которые оплачиваются по тарифу OpenRouter.</p>
      <label><input type="checkbox" checked={acceptCost} disabled={!!busy} onChange={e=>setAcceptCost(e.target.checked)}/> Разрешаю тестовые запросы и возможное списание с баланса OpenRouter</label>
      {dirty&&<p className="coach-warning">Сначала сохраните изменения ключа или модели.</p>}
      <div className="coach-actions"><Button variant="secondary" disabled={!!busy||dirty||!saved.hasKey||!saved.model||saved.version==='env'||!acceptCost} onClick={()=>{void act('test',async()=>{const result=await api<{ok:boolean;detail:string}>('/admin/coach/openrouter/test',{method:'POST',body:{version:saved.version,acceptCost:true}});const refreshed=await connection.refetch();if(refreshed.error)throw refreshed.error;await onChanged();if(!result.ok)throw new Error(result.detail);setNotice({kind:'verified'});});}}>{busy==='test'?'Проверяем модель…':'Проверить подключение'}</Button></div>
      {saved.verification&&<div role="status" className={saved.verification.ok?'coach-connection-info':'coach-warning'}><strong>{saved.verification.ok?'Проверка пройдена':'Проверка не пройдена'}</strong><p className="coach-pre">{saved.verification.detail}</p><p className="coach-muted">{new Date(saved.verification.at).toLocaleString('ru-RU')} · {saved.verification.model}</p></div>}
      <h3>{openRouterEnabled?'4. ИИ-куратор включён':'4. Включите ИИ-куратора'}</h3>
      {openRouterEnabled?<div role="status" className="coach-connection-info"><strong>ИИ OpenRouter включён</strong><p>Сохранённая модель: {saved.model}. Повторно включать ИИ не нужно.</p><p className="coach-muted">Для диалога откройте «Партнёры», выберите партнёра и перейдите в «Чат». Расходы оплачиваются с вашего аккаунта OpenRouter.</p></div>:<><p className="coach-muted">ИИ включает администратор для партнёров. После включения куратор сможет отвечать в чате, помогать с публикациями и планами по данным партнёра. Расходы оплачиваются с вашего аккаунта OpenRouter.</p>{activationHint&&<p className="coach-warning">{activationHint}</p>}</>}
      <div className="coach-actions">{!openRouterEnabled&&<Button disabled={!!busy||!!activationHint} onClick={()=>{void act('enable',async()=>{await api('/admin/coach/settings',{method:'PATCH',body:{enabled:true,provider:'openrouter',dailyRuns}});await onChanged();setNotice('ИИ-куратор включён. Партнёрам доступен диалог.');});}}>{busy==='enable'?'Включаем…':'Включить ИИ OpenRouter'}</Button>}<Button variant="secondary" disabled={!!busy||provider!=='openrouter'} onClick={()=>{void act('demo',async()=>{await api('/admin/coach/settings',{method:'PATCH',body:{enabled,provider:'template',dailyRuns}});await onChanged();setNotice('Включён демонстрационный режим. Новые диалоги не отправляются в OpenRouter.');});}}>Вернуть демонстрационный режим</Button></div>
      <p className="coach-muted">Введённый здесь ключ сохраняется на сервере в зашифрованном виде, не показывается партнёрам и не включается в экспорт данных. При замене ключа или модели ИИ возвращается в деморежим до новой проверки.</p>
      {saved.version!=='env'&&<><Button variant="secondary" disabled={!!busy} onClick={()=>setRemove(!remove)}>Удалить подключение</Button>{remove&&<div className="coach-connection-info"><p>Удалить сохранённое подключение и вернуть демонстрационный режим? История диалогов и задания останутся.</p><div className="coach-actions"><Button variant="secondary" disabled={!!busy} onClick={()=>setRemove(false)}>Отмена</Button><Button disabled={!!busy} onClick={()=>{void act('remove',async()=>{update(await api<Connection>('/admin/coach/openrouter',{method:'DELETE',body:{version:saved.version}}));setApiKey('');setRemove(false);setAcceptCost(false);setNotice('Подключение удалено. Включён демонстрационный режим.');});}}>Да, удалить подключение</Button></div></div>}</>}
    </>}
    {noticeText&&<p role="status" className="coach-badge">{noticeText}</p>}
  </section></Card>;
}
