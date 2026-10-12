import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, currentTenantSlug } from '../../api.js';
import { Button, Card, ErrorBanner, Input } from '../../ui.js';

interface Connection {
  version: string; hasKey: boolean; keySource: 'ui'|'env'|'none'; model: string; secureStorage: boolean;
  verification: {ok:boolean;at:string;detail:string;model:string}|null;
}
interface Model {id:string;name:string;contextLength:number;inputPerMillion:number|null;outputPerMillion:number|null}
interface Props {enabled:boolean;provider:string;dailyRuns:number;onChanged:()=>void}
const price=(n:number|null)=>n===null?'нет данных':new Intl.NumberFormat('ru-RU',{style:'currency',currency:'USD',maximumFractionDigits:4}).format(n);

export function OpenRouterSettings({enabled,provider,dailyRuns,onChanged}:Props) {
  const cache=useQueryClient(),scope=currentTenantSlug();
  const connection=useQuery({queryKey:['coach-openrouter',scope],queryFn:()=>api<Connection>('/admin/coach/openrouter')});
  const catalog=useQuery({queryKey:['coach-models',scope],queryFn:()=>api<{models:Model[]}>('/admin/coach/openrouter/models'),staleTime:300000,retry:false});
  const [apiKey,setApiKey]=useState(''),[model,setModel]=useState(''),[search,setSearch]=useState(''),[manual,setManual]=useState(false);
  const [busy,setBusy]=useState(''),[error,setError]=useState<Error|null>(null),[notice,setNotice]=useState(''),[acceptCost,setAcceptCost]=useState(false),[remove,setRemove]=useState(false);
  const savedModel=connection.data?.model;
  useEffect(()=>{if(savedModel!==undefined)setModel(savedModel);},[connection.data?.version,savedModel]);
  const saved=connection.data;
  const dirty=!!apiKey||model!==saved?.model;
  const selected=catalog.data?.models?.find(m=>m.id===model);
  const filtered=(catalog.data?.models??[]).filter(m=>`${m.name} ${m.id}`.toLowerCase().includes(search.toLowerCase()));
  const act=async(name:string,fn:()=>Promise<void>)=>{setBusy(name);setError(null);setNotice('');try{await fn();}catch(e){setError(e as Error);}finally{setBusy('');}};
  const update=(next:Connection)=>{cache.setQueryData(['coach-openrouter',scope],next);setModel(next.model);onChanged();};
  return <Card><section aria-label="Подключение OpenRouter">
    <div className="coach-row"><div><h2>Подключение ИИ через OpenRouter</h2><p className="coach-muted">Ключ и модель настраиваются здесь. Редактировать файлы сервера не нужно.</p></div><span className="coach-badge">{provider==='openrouter'&&enabled?'ИИ включён':'ИИ не включён'}</span></div>
    <ErrorBanner error={error??connection.error}/>
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
      <div className="coach-actions"><Button disabled={!!busy||!model.trim()||(!apiKey&&!saved.hasKey)||(!saved.secureStorage&&!!apiKey)} onClick={()=>{void act('save',async()=>{const next=await api<Connection>('/admin/coach/openrouter',{method:'PUT',body:{version:saved.version,model:model.trim(),...(apiKey.trim()?{apiKey:apiKey.trim()}:{})}});setApiKey('');setAcceptCost(false);update(next);setNotice('Настройки сохранены. Теперь проверьте подключение.');});}}>{busy==='save'?'Сохраняем…':'Сохранить ключ и модель'}</Button></div>
      <h3>3. Проверьте подключение</h3>
      <p className="coach-muted">Проверяем ключ и настоящий ответ выбранной модели на вымышленных данных. Данные партнёров не отправляются. Возможны до 4 коротких запросов, которые оплачиваются по тарифу OpenRouter.</p>
      <label><input type="checkbox" checked={acceptCost} disabled={!!busy} onChange={e=>setAcceptCost(e.target.checked)}/> Разрешаю тестовые запросы и возможное списание с баланса OpenRouter</label>
      {dirty&&<p className="coach-warning">Сначала сохраните изменения ключа или модели.</p>}
      <div className="coach-actions"><Button variant="secondary" disabled={!!busy||dirty||!saved.hasKey||!saved.model||saved.version==='env'||!acceptCost} onClick={()=>{void act('test',async()=>{const result=await api<{ok:boolean;detail:string}>('/admin/coach/openrouter/test',{method:'POST',body:{version:saved.version,acceptCost:true}});await connection.refetch();onChanged();if(!result.ok)throw new Error(result.detail);setNotice('Подключение проверено. Можно включить ИИ.');});}}>{busy==='test'?'Проверяем модель…':'Проверить подключение'}</Button></div>
      {saved.verification&&<div role="status" className={saved.verification.ok?'coach-connection-info':'coach-warning'}><strong>{saved.verification.ok?'Проверка пройдена':'Проверка не пройдена'}</strong><p className="coach-pre">{saved.verification.detail}</p><p className="coach-muted">{new Date(saved.verification.at).toLocaleString('ru-RU')} · {saved.verification.model}</p></div>}
      <h3>4. Включите ИИ-куратора</h3><p className="coach-muted">Партнёр должен подтвердить обработку данных ИИ в анкете знакомства. После этого куратор сможет отвечать в чате, помогать с публикациями и планами по его данным. Расходы оплачиваются с вашего аккаунта OpenRouter.</p>
      <div className="coach-actions"><Button disabled={!!busy||dirty||!saved.verification?.ok||!saved.hasKey||!saved.model||(enabled&&provider==='openrouter')} onClick={()=>{void act('enable',async()=>{await api('/admin/coach/settings',{method:'PATCH',body:{enabled:true,provider:'openrouter',dailyRuns}});onChanged();setNotice('ИИ-куратор включён. Партнёрам доступен диалог после подтверждения согласия.');});}}>{busy==='enable'?'Включаем…':'Включить ИИ OpenRouter'}</Button><Button variant="secondary" disabled={!!busy||provider!=='openrouter'} onClick={()=>{void act('demo',async()=>{await api('/admin/coach/settings',{method:'PATCH',body:{enabled,provider:'template',dailyRuns}});onChanged();setNotice('Включён демонстрационный режим. Новые диалоги не отправляются в OpenRouter.');});}}>Вернуть демонстрационный режим</Button></div>
      <p className="coach-muted">Введённый здесь ключ сохраняется на сервере в зашифрованном виде, не показывается партнёрам и не включается в экспорт данных. При замене ключа или модели ИИ возвращается в деморежим до новой проверки.</p>
      {saved.version!=='env'&&<><Button variant="secondary" disabled={!!busy} onClick={()=>setRemove(!remove)}>Удалить подключение</Button>{remove&&<div className="coach-connection-info"><p>Удалить сохранённое подключение и вернуть демонстрационный режим? История диалогов и задания останутся.</p><div className="coach-actions"><Button variant="secondary" disabled={!!busy} onClick={()=>setRemove(false)}>Отмена</Button><Button disabled={!!busy} onClick={()=>{void act('remove',async()=>{update(await api<Connection>('/admin/coach/openrouter',{method:'DELETE',body:{version:saved.version}}));setApiKey('');setRemove(false);setAcceptCost(false);setNotice('Подключение удалено. Включён демонстрационный режим.');});}}>Да, удалить подключение</Button></div></div>}</>}
    </>}
    {notice&&<p role="status" className="coach-badge">{notice}</p>}
  </section></Card>;
}
