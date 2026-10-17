import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { currentTenantSlug } from '../api.js';

interface Selection { programId: string; scenarioId: string }
const eventName = 'syntolk-partner-selection';
function read(key: string): Selection {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? { programId: '', scenarioId: '' }; }
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
  const requestedScenario = params.get('scenarioId');
  const scenarioId = requestedScenario ?? (stored.programId === programId ? stored.scenarioId : '');
  const remember = useCallback((value: Selection) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Selection still works in this tab. */ }
    setStored(value); window.dispatchEvent(new Event(eventName));
  },[key]);
  useEffect(() => {
    if (!programId || !requestedScenario || ['all', 'new', '__none__'].includes(requestedScenario)) return;
    const previous = read(key);
    if (previous.programId !== programId || previous.scenarioId !== requestedScenario) {
      const value = { programId, scenarioId: requestedScenario };
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Optional persistence. */ }
      setStored(value); window.dispatchEvent(new Event(eventName));
    }
  }, [key, programId, requestedScenario]);
  const selectScenario = (id: string) => {
    if (id && !['all', 'new', '__none__'].includes(id)) remember({ programId, scenarioId: id });
    setParams(previous => {
      const next = new URLSearchParams(previous); next.set('programId', programId); next.set('scenarioId', id || 'all');
      for (const field of ['platformId', 'formatId', 'materialId', 'groupBy', 'day', 'week', 'month']) next.delete(field);
      return next;
    });
  };
  const selectProgram = (id: string) => {
    remember({ programId: id, scenarioId: '' });
    setParams(previous => {
      const next = new URLSearchParams(previous); next.set('programId', id);
      for (const field of ['scenarioId', 'platformId', 'formatId', 'materialId', 'groupBy', 'day', 'week', 'month']) next.delete(field);
      return next;
    });
  };
  const rememberScenario = useCallback((id: string) => {
    if (id && !['all','new','__none__'].includes(id)) {
      const old=read(key);
      if(old.programId!==programId||old.scenarioId!==id)remember({programId,scenarioId:id});
    }
  },[key,programId,remember]);
  return { programId, scenarioId, selectScenario, selectProgram, rememberScenario };
}
