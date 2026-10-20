// @vitest-environment jsdom
import {useState} from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {api} from '../api.js';
import {CalculatorCurrentValues,type CurrentValuesFilter} from './CalculatorCurrentValues.js';
vi.mock('../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
let client:QueryClient,root:HTMLElement;
let sent:Array<{active:boolean;report?:{counts:{clicks:number};amountsMinor:{netAccrued:number}};chartReport?:unknown;selectedPoint?:{date:string;from:string;to:string}|null;refreshState:string;storageKey:string;error:string;filter:CurrentValuesFilter}>;
const report={currency:'RUB',counts:{clicks:133,registrations:22,payingCustomers:9,paymentCount:15,firstPaymentCount:9,repeatPaymentCount:6},amountsMinor:{observedPayments:9703500,netAccrued:1940700},conversions:{clickToRegistration:.2,registrationToPayment:.4},content:{preparedMaterials:8,publishedMaterials:5,publishedPlacements:12},series:{bucket:'day',points:[{date:'2026-10-01',clicks:133,registrations:22,payments:15,earningsMinor:1940700}]}};
const initial:CurrentValuesFilter={period:'30d',from:'',to:'',allContent:true};
function Harness({scenarioId='a',active=true,filter=initial}:{scenarioId?:string;active?:boolean;filter?:CurrentValuesFilter}){
  const [selected,setSelected]=useState(filter);
  return <CalculatorCurrentValues partnerId="partner" programId="program" scenarioId={scenarioId} scenarioName={scenarioId} active={active} filter={selected} onFilter={setSelected} root={root}/>;
}
function show(props:Parameters<typeof Harness>[0]={}){
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});root=document.createElement('div');root.innerHTML='<label><select id="pf-horizon"></select></label>';document.body.append(root);sent=[];
  root.addEventListener('syntolk-calculator-current-values',event=>sent.push((event as CustomEvent).detail));
  return render(<QueryClientProvider client={client}><Harness {...props}/></QueryClientProvider>);
}
const change=(detail:Partial<CurrentValuesFilter>)=>act(()=>{root.dispatchEvent(new CustomEvent('syntolk-calculator-fact-filter',{detail}));});
const refresh=()=>act(()=>{root.dispatchEvent(new CustomEvent('syntolk-calculator-refresh'));});
const inspect=(date:string|null)=>act(()=>{root.dispatchEvent(new CustomEvent('syntolk-calculator-fact-point',{detail:date}));});
afterEach(()=>{cleanup();root?.remove();client?.clear();vi.useRealTimers();vi.clearAllMocks();});
describe('headless calculator factual data bridge',()=>{
  it('does not fetch until the factual mode is opened and creates no second calculator interface',()=>{
    show({active:false});expect(api).not.toHaveBeenCalled();expect(sent.at(-1)?.active).toBe(false);
    expect(screen.queryByText('Материалы за период')).toBeNull();expect(screen.queryByRole('button',{name:'Пересчитать'})).toBeNull();
  });
  it('loads all own content by default and passes exact canonical facts to the existing calculator',async()=>{
    vi.mocked(api).mockResolvedValue(report);show();await waitFor(()=>expect(sent.at(-1)?.report).toEqual(report));
    expect(api).toHaveBeenCalledWith('/partners/partner/analytics/current?programId=program&period=30d');
  });
  it('explicitly reloads the same dates and scenario without resetting filters or manual-view storage',async()=>{
    vi.mocked(api).mockResolvedValue(report);show({filter:{period:'custom',from:'2025-04-01',to:'2025-04-30',allContent:false}});
    await waitFor(()=>expect(sent.at(-1)?.report).toEqual(report));const before=sent.at(-1)!;
    vi.mocked(api).mockResolvedValue({...report,counts:{...report.counts,clicks:134}});refresh();
    await waitFor(()=>expect(sent.at(-1)?.report?.counts.clicks).toBe(134));
    expect(api).toHaveBeenCalledTimes(2);expect(api).toHaveBeenLastCalledWith('/partners/partner/analytics/current?programId=program&period=custom&scenarioId=a&from=2025-04-01&to=2025-04-30');
    expect(sent.at(-1)?.filter).toEqual(before.filter);expect(sent.at(-1)?.storageKey).toBe(before.storageKey);expect(sent.at(-1)?.active).toBe(true);
    expect(vi.mocked(api).mock.calls.every(([,options])=>options===undefined)).toBe(true);
  });
  it('can reload factual data from plan mode without activating factual mode',async()=>{
    vi.mocked(api).mockResolvedValue(report);show({active:false});refresh();
    await waitFor(()=>expect(sent.at(-1)?.report).toEqual(report));expect(sent.at(-1)?.active).toBe(false);expect(api).toHaveBeenCalledTimes(1);
  });
  it('loads a clicked day without changing the chart range, rejects unknown dates and restores the aggregate',async()=>{
    vi.mocked(api).mockResolvedValue(report);show();await waitFor(()=>expect(sent.at(-1)?.report).toEqual(report));const originalKey=sent.at(-1)!.storageKey;
    inspect('2025-04-01');expect(api).toHaveBeenCalledTimes(1);
    const detail={...report,counts:{...report.counts,clicks:4}};vi.mocked(api).mockResolvedValue(detail);inspect('2026-10-01');
    await waitFor(()=>expect(sent.at(-1)?.report?.counts.clicks).toBe(4));expect(api).toHaveBeenLastCalledWith('/partners/partner/analytics/current?programId=program&period=custom&from=2026-10-01&to=2026-10-01');
    expect(sent.at(-1)?.chartReport).toEqual(report);expect(sent.at(-1)?.filter).toEqual(initial);expect(sent.at(-1)?.selectedPoint?.date).toBe('2026-10-01');expect(sent.at(-1)?.storageKey).not.toBe(originalKey);
    inspect(null);expect(sent.at(-1)?.report).toEqual(report);expect(sent.at(-1)?.storageKey).toBe(originalKey);expect(api).toHaveBeenCalledTimes(2);
  });
  it.each(['week','month'])('uses exact clipped %s bucket boundaries and the same scenario',async bucket=>{
    const aggregate={...report,timezone:'Europe/Moscow',series:{bucket,points:[{...report.series.points[0],date:'2026-09-28',since:'2026-09-30T21:00:00.000Z',until:'2026-10-02T21:00:00.000Z'}]}};
    vi.mocked(api).mockResolvedValue(aggregate);show({filter:{...initial,allContent:false}});await waitFor(()=>expect(sent.at(-1)?.report).toEqual(aggregate));
    vi.mocked(api).mockResolvedValue({...report,counts:{...report.counts,clicks:0}});inspect('2026-09-28');
    await waitFor(()=>expect(sent.at(-1)?.report?.counts.clicks).toBe(0));
    expect(api).toHaveBeenLastCalledWith('/partners/partner/analytics/current?programId=program&period=custom&from=2026-10-01&to=2026-10-02&scenarioId=a');
    expect(sent.at(-1)?.selectedPoint).toEqual({date:'2026-09-28',from:'2026-10-01',to:'2026-10-02'});
    change({allContent:true});expect(sent.at(-1)?.selectedPoint).toBeNull();
  });
  it('refreshes a selected day and its full chart, exposing progress without resetting selection',async()=>{
    vi.mocked(api).mockResolvedValue(report);show();await waitFor(()=>expect(sent.at(-1)?.report).toEqual(report));inspect('2026-10-01');
    await waitFor(()=>expect(api).toHaveBeenCalledTimes(2));
    let complete!:(value:unknown)=>void;const pending=new Promise(resolve=>{complete=resolve;});vi.mocked(api).mockReturnValue(pending);
    refresh();expect(sent.at(-1)?.refreshState).toBe('loading');refresh();expect(api).toHaveBeenCalledTimes(4);
    await act(async()=>{complete(report);await pending;});await waitFor(()=>expect(sent.at(-1)?.refreshState).toBe('success'));
    expect(sent.at(-1)?.selectedPoint?.date).toBe('2026-10-01');expect(sent.at(-1)?.filter).toEqual(initial);
  });
  it('reports refresh failures and allows retry without changing the selected scope',async()=>{
    vi.mocked(api).mockResolvedValue(report);show();await waitFor(()=>expect(sent.at(-1)?.report).toEqual(report));
    vi.mocked(api).mockRejectedValue(new Error('offline'));refresh();await waitFor(()=>expect(sent.at(-1)?.refreshState).toBe('error'));
    expect(sent.at(-1)?.error).toContain('Не удалось');expect(sent.at(-1)?.filter).toEqual(initial);
    vi.mocked(api).mockResolvedValue(report);refresh();await waitFor(()=>expect(sent.at(-1)?.refreshState).toBe('success'));expect(sent.at(-1)?.error).toBe('');
  });
  it('filters the selected scenario only on explicit selection, never fabricating a fallback for an empty scenario',async()=>{
    vi.mocked(api).mockResolvedValue(report);show();await waitFor(()=>expect(sent.at(-1)?.report).toEqual(report));
    vi.mocked(api).mockResolvedValue({...report,counts:{...report.counts,clicks:0}});change({allContent:false});
    await waitFor(()=>expect(api).toHaveBeenLastCalledWith('/partners/partner/analytics/current?programId=program&period=30d&scenarioId=a'));
    await waitFor(()=>expect(sent.at(-1)?.report?.counts.clicks).toBe(0));
  });
  it('applies native custom dates and preserves them on scenario changes, without borrowing the previous data',async()=>{
    vi.mocked(api).mockResolvedValue(report);const view=show({filter:{...initial,allContent:false}});
    change({period:'custom'});expect(screen.getByRole('dialog',{name:'Свои даты факта'})).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Начало периода факта'),{target:{value:'2025-04-01'}});
    fireEvent.input(screen.getByLabelText('Конец периода факта'),{target:{value:'2025-04-30'}});
    fireEvent.click(screen.getByRole('button',{name:'Применить'}));
    await waitFor(()=>expect(api).toHaveBeenLastCalledWith('/partners/partner/analytics/current?programId=program&period=custom&scenarioId=a&from=2025-04-01&to=2025-04-30'));
    vi.mocked(api).mockResolvedValue({...report,counts:{...report.counts,clicks:0}});
    view.rerender(<QueryClientProvider client={client}><Harness scenarioId="b"/></QueryClientProvider>);
    await waitFor(()=>expect(sent.at(-1)?.report?.counts.clicks).toBe(0));
    expect(api).toHaveBeenLastCalledWith('/partners/partner/analytics/current?programId=program&period=custom&scenarioId=b&from=2025-04-01&to=2025-04-30');
  });
  it('does not apply an invalid or cancelled range',async()=>{
    vi.mocked(api).mockResolvedValue(report);show();change({period:'custom'});
    fireEvent.input(screen.getByLabelText('Начало периода факта'),{target:{value:'2025-04-30'}});
    fireEvent.input(screen.getByLabelText('Конец периода факта'),{target:{value:'2025-04-01'}});
    expect((screen.getByRole('button',{name:'Применить'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Отмена'}));expect(sent.at(-1)?.filter.period).toBe('30d');
  });
  it('does not request incomplete or reversed dates and sends no stale report',()=>{
    show({filter:{...initial,period:'custom',from:'2025-04-30',to:'2025-04-01'}});
    refresh();
    expect(api).not.toHaveBeenCalled();expect(sent.at(-1)?.report).toBeUndefined();expect(sent.at(-1)?.error).toContain('Выберите начало');
  });
  it('refreshes automatically without saving a scenario or creating financial records, and replays data after script load',async()=>{
    vi.useFakeTimers();vi.mocked(api).mockResolvedValue(report);show();await act(async()=>{await vi.advanceTimersByTimeAsync(100);});
    expect(sent.at(-1)?.report?.counts.clicks).toBe(133);vi.mocked(api).mockResolvedValue({...report,counts:{...report.counts,clicks:134}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});expect(sent.at(-1)?.report?.counts.clicks).toBe(134);
    act(()=>{root.dispatchEvent(new CustomEvent('syntolk-calculator-ready'));});expect(sent.at(-1)?.report?.counts.clicks).toBe(134);
    expect(vi.mocked(api).mock.calls.every(([path,options])=>path.startsWith('/partners/partner/analytics/current?')&&options===undefined)).toBe(true);
  });
  it('isolates manual views by owner, scenario and factual date range',async()=>{
    vi.mocked(api).mockResolvedValue(report);const view=show({filter:{...initial,allContent:false}});const a=sent.at(-1)?.storageKey;
    view.rerender(<QueryClientProvider client={client}><Harness scenarioId="b"/></QueryClientProvider>);const b=sent.at(-1)?.storageKey;expect(a).not.toBe(b);
    change({allContent:true});expect(sent.at(-1)?.storageKey).not.toBe(b);change({period:'all'});expect(sent.at(-1)?.storageKey).toContain('all');
  });
});
