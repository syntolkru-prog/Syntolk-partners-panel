// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../api.js';
import type { AnalyticsReport } from './PartnerAnalytics.js';
import { ResultsChart } from './ResultsChart.js';
import { ResultsExplorer } from './ResultsExplorer.js';
import { ResultsDatePicker, calendarDay } from './ResultsDatePicker.js';

vi.mock('../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
let client:QueryClient;
afterEach(()=>{cleanup();client?.clear();vi.restoreAllMocks();vi.clearAllMocks();vi.unstubAllGlobals();});
const counts={clicks:10,registrations:2,payingCustomers:1,paymentCount:2,firstPaymentCount:1,repeatPaymentCount:1};
const amountsMinor={observedPayments:100000,refunds:0,netPayments:100000,netAccrued:20000};
const point={date:'2026-10-11',since:'2026-10-10T21:00:00.000Z',until:'2026-10-11T21:00:00.000Z',clicks:3,registrations:1,payingCustomers:1,payments:1,customerPaymentsMinor:50000,earningsMinor:10000};
const report:AnalyticsReport={groupBy:'platform',balances:{total:0,available:0,pending:0,paid:0},timezone:'Europe/Moscow',period:{since:'2026-10-10T21:00:00.000Z',until:'2026-10-17T21:00:00.000Z'},counts,amountsMinor,conversions:{clickToRegistration:.2,registrationToPayment:.5,clickToPayment:.1},rows:[{id:'material',name:'Статья о Syntolk',archived:false,counts,amountsMinor}],options:{scenarios:[{id:'a',name:'Статьи'}],platforms:[{id:'youtube',name:'YouTube'},{id:'vk',name:'ВКонтакте'}],formats:[{id:'article',name:'Статьи'}]},series:{bucket:'day',points:[point],groups:[{id:'youtube',name:'YouTube',points:[point]}]}};
const query='programId=p&period=7d&seriesBy=platform&includeSeries=true&scenarioIds=a&platformIds=youtube&platformIds=vk&formatIds=article';
function showExplorer(extra:Partial<React.ComponentProps<typeof ResultsExplorer>>={}){
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><ResultsExplorer partnerId="partner" metric="clicks" query={query} report={report} context="Статьи · Площадки: 2" onClose={vi.fn()} {...extra}/></QueryClientProvider>);
}
const requests=()=>vi.mocked(api).mock.calls.map(([path])=>new URL(path,'http://local').searchParams);

describe('expanded results graph',()=>{
  it('expands the card body but keeps an exact small-graph point as a direct drilldown',()=>{
    const expand=vi.fn(),inspect=vi.fn();
    render(<ResultsChart metric="clicks" onChange={vi.fn()} onExpand={expand} onInspect={inspect} series={report.series}/>);
    fireEvent.click(screen.getByRole('article',{name:'Переходы'}));expect(expand).toHaveBeenCalledWith('clicks');expand.mockClear();
    const plot=screen.getByRole('group',{name:/Переходы, по дням/});
    fireEvent.click(plot.querySelector('[data-chart-hit="0"]')!);
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({point}));expect(expand).not.toHaveBeenCalled();
  });
  it('opens an embedded day-and-platform breakdown with no second modal and returns to the same graph',async()=>{
    vi.mocked(api).mockResolvedValue(report);showExplorer();
    const dialog=screen.getByRole('dialog',{name:'Переходы'}),plot=within(dialog).getByRole('group',{name:/Переходы, по дням/});
    fireEvent.click(plot.querySelector('[data-series="youtube"] [data-chart-hit="0"]')!);
    const detail=await within(dialog).findByRole('region',{name:'Переходы'});
    await within(detail).findByRole('button',{name:'Статья о Syntolk'});
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const scope=requests().find(params=>params.get('groupBy')==='material')!;
    expect(scope.get('since')).toBe(point.since);expect(scope.get('until')).toBe(point.until);
    expect(scope.get('platformId')).toBe('youtube');expect(scope.has('platformIds')).toBe(false);
    expect(scope.getAll('scenarioIds')).toEqual(['a']);expect(scope.getAll('formatIds')).toEqual(['article']);
    fireEvent.keyDown(document,{key:'Escape'});
    expect(within(dialog).queryByRole('region',{name:'Переходы'})).toBeNull();
    expect(within(dialog).getByLabelText('Разбивка большого графика')).toHaveProperty('value','platform');
    expect(within(dialog).getByRole('group',{name:/Переходы, по дням/})).toBe(plot);
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('applies custom primary dates locally and cancels a later draft without making a request',async()=>{
    vi.mocked(api).mockResolvedValue(report);showExplorer();
    const before=window.location.href;
    fireEvent.click(screen.getByLabelText('Период большого графика',{exact:true}));
    let calendar=screen.getByRole('dialog',{name:'Период большого графика'});
    fireEvent.change(within(calendar).getByLabelText('Период большого графика: начало'),{target:{value:'2026-10-01'}});
    fireEvent.change(within(calendar).getByLabelText('Период большого графика: конец'),{target:{value:'2026-10-05'}});
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(within(calendar).getByRole('button',{name:'Применить'}));
    await waitFor(()=>expect(requests().some(params=>params.get('from')==='2026-10-01'&&params.get('to')==='2026-10-05'&&!params.has('since')&&params.getAll('platformIds').length===2)).toBe(true));
    expect(window.location.href).toBe(before);
    const calls=vi.mocked(api).mock.calls.length;
    fireEvent.click(screen.getByLabelText('Период большого графика',{exact:true}));calendar=screen.getByRole('dialog',{name:'Период большого графика'});
    fireEvent.change(within(calendar).getByLabelText('Период большого графика: конец'),{target:{value:'2026-10-08'}});
    fireEvent.keyDown(calendar,{key:'Escape'});
    expect(screen.queryByRole('dialog',{name:'Период большого графика'})).toBeNull();expect(screen.getByRole('dialog',{name:'Переходы'})).toBeTruthy();expect(vi.mocked(api).mock.calls).toHaveLength(calls);
  });
  it('compares independent dates and drills into the comparison point instead of the primary range',async()=>{
    const previousPoint={...point,date:'2026-09-02',since:'2026-09-01T21:00:00.000Z',until:'2026-09-02T21:00:00.000Z',clicks:2};
    const previous={...report,period:{since:'2026-08-31T21:00:00.000Z',until:'2026-09-05T21:00:00.000Z'},counts:{...counts,clicks:5},series:{...report.series!,points:[previousPoint],groups:[{id:'youtube',name:'YouTube',points:[previousPoint]}]}};
    vi.mocked(api).mockImplementation(async path=>new URL(path,'http://local').searchParams.get('from')==='2026-09-01'?previous:report);
    showExplorer();fireEvent.click(screen.getByLabelText('Период сравнения',{exact:true}));
    const calendar=screen.getByRole('dialog',{name:'Период сравнения'});
    fireEvent.change(within(calendar).getByLabelText('Период сравнения: начало'),{target:{value:'2026-09-01'}});
    fireEvent.change(within(calendar).getByLabelText('Период сравнения: конец'),{target:{value:'2026-09-05'}});
    fireEvent.click(within(calendar).getByRole('button',{name:'Применить'}));
    const panel=await screen.findByRole('region',{name:'Период сравнения'});
    await waitFor(()=>expect(panel.querySelector('.results-explorer__plot-heading strong')?.textContent).toBe('5'));
    expect(screen.getByText('+100% к периоду сравнения')).toBeTruthy();
    fireEvent.click(panel.querySelector('[data-series="youtube"] [data-chart-hit="0"]')!);
    await waitFor(()=>expect(requests().some(params=>params.get('groupBy')==='material'&&params.get('since')===previousPoint.since&&params.get('until')===previousPoint.until&&params.get('platformId')==='youtube')).toBe(true));
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
  });
  it('does not leave an endless comparison spinner or stale charts when loading fails',async()=>{
    vi.mocked(api).mockRejectedValue(new Error('Не удалось загрузить статистику'));
    showExplorer();fireEvent.click(screen.getByRole('button',{name:'Период сравнения'}));
    fireEvent.click(screen.getByRole('button',{name:'Предыдущий период'}));
    await screen.findByText('Не удалось загрузить статистику');
    expect(screen.queryByText('Обновляем график…')).toBeNull();
    expect(document.querySelector('.results-explorer__plots')?.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('button',{name:'Закрыть график'})).toBeTruthy();
  });
});

describe('results range calendar',()=>{
  it('orders reverse selection, supports leap days and respects partner timezone',()=>{
    const onChange=vi.fn();render(<ResultsDatePicker label="Даты" value={{from:'2024-02-01',to:'2024-02-29'}} onChange={onChange}/>);
    fireEvent.click(screen.getByLabelText('Даты',{exact:true}));
    const calendar=screen.getByRole('dialog',{name:'Даты'});
    fireEvent.click(calendar.querySelector('[data-day="2024-02-29"]')!);expect(within(calendar).getByRole('button',{name:'Применить'})).toHaveProperty('disabled',true);
    fireEvent.click(calendar.querySelector('[data-day="2024-02-20"]')!);fireEvent.click(within(calendar).getByRole('button',{name:'Применить'}));
    expect(onChange).toHaveBeenCalledWith({from:'2024-02-20',to:'2024-02-29'});
    expect(calendarDay('2026-10-01T21:00:00Z','Europe/Moscow')).toBe('2026-10-02');
    expect(calendarDay('2026-10-01T21:00:00Z','America/New_York')).toBe('2026-10-01');
  });
  it('renders one navigable month on a narrow phone',()=>{
    vi.stubGlobal('innerWidth',390);
    render(<ResultsDatePicker label="Даты" value={{from:'2024-02-01',to:'2024-02-29'}} onChange={vi.fn()}/>);
    fireEvent.click(screen.getByLabelText('Даты',{exact:true}));
    const calendar=screen.getByRole('dialog',{name:'Даты'});
    expect(calendar.querySelectorAll('.results-calendar__months>section')).toHaveLength(1);expect(calendar.querySelector('[data-day="2024-02-29"]')).toBeTruthy();
    fireEvent.click(within(calendar).getByRole('button',{name:'Предыдущий месяц'}));expect(calendar.querySelector('[data-day="2024-01-01"]')).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
