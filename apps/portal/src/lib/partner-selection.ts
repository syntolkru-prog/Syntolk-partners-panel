import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { currentTenantSlug } from '../api.js';

interface Selection { programId: string; scenarioId: string; scenarioIds?:string[] }
const eventName = 'syntolk-partner-selection';
function read(key: string): Selection {
  try {
    const value=JSON.parse(localStorage.getItem(key)??'null');
    if(!value||typeof value.programId!=='string'||typeof value.scenarioId!=='string')return {programId:'',scenarioId:''};
    return {programId:value.programId,scenarioId:value.scenarioId,scenarioIds:Array.isArray(value.scenarioIds)?value.scenarioIds.filter((id:unknown):id is string=>typeof id==='string'&&!!id&&!['all','new'].includes(id)):undefined};
  }
  catch { return { programId: '', scenarioId: '' }; }
}

/** One selection for calculator, work calendar, links and reports, scoped to this login. */
export function usePartnerSelection(partnerId: string, programs: Array<{ id: string }>) {
  const [params, setParams] = useSearchParams();
  const key = `syntolk-partner-selection:${currentTenantSlug() ?? 'default'}:${partnerId}`;
  const [stored, setStored] = useState(() => read(key));
  useEffect(() => {
    const update = () => setStored(read(key));
    update(); window.addEventListener('storage', update); window.addEventListener(eventName, update);
    return () => { window.removeEventListener('storage', update); window.removeEventListener(eventName, update); };
  }, [key]);
  const requestedProgram = params.get('programId');
  const programId = programs.find(p => p.id === requestedProgram)?.id ?? programs.find(p => p.id === stored.programId)?.id ?? programs[0]?.id ?? '';
  const requestedScenarios = [...new Set([...params.getAll('scenarioIds'),...params.getAll('scenarioId')].filter(id=>id&&!['all','new'].includes(id)))];
  const requestedScenario = requestedScenarios.length>1?'all':params.get('scenarioId') ?? (requestedScenarios.length === 1 ? requestedScenarios[0] : null);
  const scenarioId = requestedScenario ?? (stored.programId === programId ? stored.scenarioId : '');
  const scenarioIds=params.has('scenarioId')||params.has('scenarioIds')?requestedScenarios:stored.programId===programId?(stored.scenarioIds??(stored.scenarioId&&!['all','new'].includes(stored.scenarioId)?[stored.scenarioId]:[])):[];
  const scenarioSignature=scenarioIds.join('\u0000');
  const remember = useCallback((value: Selection) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Selection still works in this tab. */ }
    setStored(value); window.dispatchEvent(new Event(eventName));
  },[key]);
  useEffect(() => {
    if (!programId || !requestedScenario || requestedScenario === 'new') return;
    const previous = read(key);
    if (previous.programId !== programId || previous.scenarioId !== requestedScenario || JSON.stringify(previous.scenarioIds??[])!==JSON.stringify(scenarioIds)) {
      const value = { programId, scenarioId: requestedScenario,scenarioIds };
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Optional persistence. */ }
      setStored(value); window.dispatchEvent(new Event(eventName));
    }
  }, [key, programId, requestedScenario,scenarioSignature]);
  const selectScenario = (id: string) => {
    setParams(previous => {
      const next = new URLSearchParams(previous); next.set('programId', programId); next.set('scenarioId', id || 'all');
      for (const field of ['scenarioIds', 'materialId', 'materialTab', 'editSource', 'expandedSource', 'linkId', 'sourceId', 'day', 'week', 'month', 'page']) next.delete(field);
      return next;
    });
  };
  const selectProgram = (id: string) => {
    setParams(previous => {
      const next = new URLSearchParams(previous); next.set('programId', id);
      for (const field of ['scenarioId', 'scenarioIds', 'platformId', 'platformIds', 'formatId', 'formatIds', 'materialId', 'materialTab', 'editSource', 'expandedSource', 'linkId', 'sourceId', 'groupBy', 'day', 'week', 'month']) next.delete(field);
      next.set('scenarioId','all');return next;
    });
  };
  const rememberScenario = useCallback((id: string) => {
    if (id && id !== 'new') {
      const old=read(key);
      if(old.programId!==programId||old.scenarioId!==id)remember({programId,scenarioId:id});
    }
  },[key,programId,remember]);
  const selectScenarios=(ids:string[])=>{
    const values=[...new Set(ids.filter(id=>id&&!['all','new'].includes(id)))];
    setParams(previous=>{
      const next=new URLSearchParams(previous);next.set('programId',programId);
      for(const field of ['scenarioId','scenarioIds','materialId','materialTab','editSource','expandedSource','linkId','sourceId','page'])next.delete(field);
      if(!values.length)next.set('scenarioId','all');else if(values.length===1)next.set('scenarioId',values[0]!);else for(const id of values)next.append('scenarioIds',id);
      return next;
    });
  };
  return { programId, scenarioId,scenarioIds,selectScenarios, selectScenario, selectProgram, rememberScenario };
}

/** Apply the same saved program/scenario scope to every partner report. */
export function applyPartnerScope(query:URLSearchParams,selection:{programId:string;scenarioIds:string[]}) {
  if(selection.programId)query.set('programId',selection.programId);
  query.delete('scenarioId');query.delete('scenarioIds');
  for(const id of selection.scenarioIds)query.append('scenarioIds',id);
  return query;
}
