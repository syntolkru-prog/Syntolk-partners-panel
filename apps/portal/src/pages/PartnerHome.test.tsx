// @vitest-environment jsdom
import { afterEach,beforeAll,describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../api.js';
import { PartnerHome } from './PartnerHome.js';
import { money } from '../ui.js';

vi.mock('../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
vi.mock('../lib/useBrand.js',()=>({useBrand:()=>({programTermsUrl:'https://example.test/terms'})}));
vi.mock('./coach/CoachDay.js',()=>({CoachDay:({appearance}:{appearance:string})=><section aria-label="План из калькулятора" data-appearance={appearance}>Задачи на сегодня</section>}));
vi.mock('../components/tremor/raw/components/AreaChart/AreaChart.js',()=>({AreaChart:({data}:{data:unknown})=><div data-testid="area" data-points={JSON.stringify(data)}/>,ChartTooltip:()=>null}));
vi.mock('../components/tremor/raw/components/BarChart/BarChart.js',()=>({BarChart:({data}:{data:unknown})=><div data-testid="bars" data-points={JSON.stringify(data)}/>}));
vi.mock('../components/tremor/raw/components/DonutChart/DonutChart.js',()=>({DonutChart:()=> <div data-testid="donut"/>}));
const balances={total:103259,accrued:0,available:0,pending:0,paid:103259};
const report=(clicks=119)=>({currency:'RUB',counts:{clicks,registrations:21,payingCustomers:9},amountsMinor:{observedPayments:9703500,netAccrued:1940700},conversions:{registrationToPayment:.375},balances,timezone:'Europe/Moscow',series:{bucket:'day',points:[{date:'2026-10-20',clicks,registrations:21,payingCustomers:9,customerPaymentsMinor:9703500,earningsMinor:1940700}]}});
const textMoney=(value:number)=>money(value,'RUB').replace(/\s/g,' ');
let client:QueryClient;
beforeAll(()=>{Object.defineProperty(HTMLDialogElement.prototype,'showModal',{value:function(this:HTMLDialogElement){this.setAttribute('open','');},configurable:true});});
afterEach(()=>{cleanup();client?.clear();vi.clearAllMocks();});
function show({termsAccepted=true,path='/',sources=[{name:'vk.com',count:80},{name:'Источник не передан',count:39}]}={}) {
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  vi.mocked(api).mockImplementation(async url=>{
    const registrations=[{id:'registration-1',userId:'actual-user-id',registeredAt:'2026-10-20T12:00:00Z',source:'vk.com',paidMinor:1293000,currency:'RUB'}];
    if(url.includes('/analytics/registrations?'))return {registrations,total:1,nextCursor:null,timezone:'Europe/Moscow'};
    if(url.includes('/analytics/details?'))return {traffic:{referrers:sources},registrations,registrationsTotal:1};
    if(url.includes('/analytics?'))return report(new URLSearchParams(url.split('?')[1]).get('period')==='7d'?17:119);
    return {termsAcceptedAt:termsAccepted?'2026-10-01':null};
  });
  render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><PartnerHome partnerId="partner" name="Локальный партнёр Syntolk"/></QueryClientProvider></MemoryRouter>);
}
function pick(label:string,value:string) {fireEvent.mouseDown(within(screen.getByRole('tablist',{name:label})).getByRole('tab',{name:value}),{button:0,ctrlKey:false});}
const waitClicks=()=>within(screen.getByRole('article',{name:'Переходы'})).findByText('119');
describe('partner workday homepage',()=>{
  it('matches the supplied sections without the rejected quick-action strip',async()=>{
    show();await waitClicks();
    expect(screen.getByRole('heading',{level:1}).textContent).toContain('Ваш рабочий день');
    expect(screen.getByLabelText('План из калькулятора').getAttribute('data-appearance')).toBe('workday');
    for(const name of ['Ваши результаты','Источники трафика','Финансы за всё время','Последние регистрации'])expect(screen.getByRole('region',{name})).toBeTruthy();
    expect(screen.queryByRole('navigation',{name:'Быстрый старт партнёра'})).toBeNull();
  });
  it('uses actual cohort conversion, not paying customers divided by unrelated registrations',async()=>{
    show();await screen.findByText('37,5%');expect(screen.queryByText('42,9%')).toBeNull();
    expect(screen.getByRole('button',{name:'Регистрация → оплата · когорта из выбранного периода'})).toBeTruthy();
  });
  it('keeps lifetime finance separate from date-scoped revenue and commission',async()=>{
    show();await waitClicks();
    const finance=screen.getByRole('region',{name:'Финансы за всё время'});
    expect(within(finance).getAllByText(textMoney(103259))).toHaveLength(2);
    expect(within(screen.getByRole('region',{name:'Выручка за период'})).getByText(textMoney(97035))).toBeTruthy();
    expect(screen.getByTestId('area').getAttribute('data-points')).toContain('9703500');
    expect(screen.getByTestId('area').getAttribute('data-points')).not.toContain('1940700');
  });
  it('synchronizes both period controls, the chart, details and navigation',async()=>{
    show();await waitClicks();pick('Период выручки','7 дней');await screen.findByText('17');
    expect(within(screen.getByRole('tablist',{name:'Период статистики'})).getByRole('tab',{name:'7 дней'}).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('link',{name:'Выручка'}).getAttribute('href')).toContain('period=7d');
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([url])=>url.includes('/analytics/details?period=7d'))).toBe(true));
    expect(within(screen.getByRole('region',{name:'Финансы за всё время'})).getAllByText(textMoney(103259))).toHaveLength(2);
  });
  it('does not compare all-time to an invented previous period',async()=>{
    show();await waitClicks();pick('Период статистики','Весь период');
    await waitFor(()=>expect(screen.getByRole('link',{name:'Выручка'}).getAttribute('href')).toContain('period=all'));
    expect(screen.queryByText('vs. предыдущие 30 дней')).toBeNull();
  });
  it('uses both chosen dates for all queries and compares the preceding equally long range',async()=>{
    show({path:'/t/syntolk/'});await waitClicks();
    fireEvent.click(screen.getByRole('button',{name:'Выбрать даты статистики'}));
    fireEvent.change(screen.getByLabelText('Период статистики: начало'),{target:{value:'2026-09-10'}});
    fireEvent.change(screen.getByLabelText('Период статистики: конец'),{target:{value:'2026-09-20'}});
    fireEvent.click(screen.getByRole('button',{name:'Применить'}));
    await waitFor(()=>expect(screen.getByRole('link',{name:'Выручка'}).getAttribute('href')).toBe('/t/syntolk/results?period=custom&currency=RUB&from=2026-09-10&to=2026-09-20'));
    expect(vi.mocked(api).mock.calls.some(([url])=>url.includes('/analytics?period=custom&from=2026-08-30&to=2026-09-09'))).toBe(true);
    expect(screen.getByRole('link',{name:'История выплат'}).getAttribute('href')).toBe('/t/syntolk/payouts');
  });
  it('renders actual identifiers, source, registration date and payment without fake emails',async()=>{
    show();await screen.findByText('actual-user-id');
    const table=screen.getByRole('region',{name:'Последние регистрации'});
    expect(within(table).getByText('20.10.2026, 15:00')).toBeTruthy();
    expect(within(table).getByText(textMoney(12930))).toBeTruthy();
    expect(within(table).getByText('Есть оплата')).toBeTruthy();
    expect(within(table).getByRole('columnheader',{name:'ID пользователя'})).toBeTruthy();
    expect(within(table).queryByText(/@/)).toBeNull();
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method||options.method==='GET')).toBe(true);
  });
  it('opens actual registration rows from both the KPI and the all-registrations button',async()=>{
    show();await waitClicks();fireEvent.click(screen.getByRole('button',{name:'Подробнее: Регистрации'}));
    const dialog=await screen.findByRole('dialog',{name:'Регистрации за период'});await within(dialog).findByText('actual-user-id');
    expect(vi.mocked(api).mock.calls.some(([url])=>url.includes('/analytics/registrations?period=30d'))).toBe(true);
    expect(within(dialog).getByText('Показано 1 из 1')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button',{name:'Закрыть регистрации'}));
    fireEvent.click(screen.getByRole('button',{name:/Все регистрации/}));expect(await screen.findByRole('dialog',{name:'Регистрации за период'})).toBeTruthy();
  });
  it('keeps every referrer in the scrollable list even when the donut groups small sources',async()=>{
    show({sources:Array.from({length:12},(_,i)=>({name:`source-${i}.test`,count:i+1}))});await waitClicks();
    const list=screen.getByRole('region',{name:'Список источников переходов'});
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);expect(within(list).getByText('source-0.test')).toBeTruthy();expect(list.tabIndex).toBe(0);
  });
  it('shows tracked publications from canonical source rows without adding them to parent totals',async()=>{
    show();await waitClicks();const original=vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async(url,o)=>{if(url.includes('groupBy=source'))return {...report(100),rows:[{id:'post-source',name:'Пост',counts:{clicks:40},placement:{materialTitle:'Обзор',platformName:'ВКонтакте',publicationUrl:'https://vk.com/wall-1_2'}},{id:'__none__',name:'Без метки публикации',counts:{clicks:60}}]};return original(url,o);});
    await client.invalidateQueries({queryKey:['partner-analytics']});const traffic=screen.getByRole('region',{name:'Источники трафика'});await within(traffic).findByRole('link',{name:'Обзор'});
    expect(within(traffic).getByLabelText('100 переходов')).toBeTruthy();expect(within(traffic).queryByLabelText('140 переходов')).toBeNull();
    expect(within(traffic).getByRole('link',{name:'Обзор'}).getAttribute('href')).toContain('sourceId=post-source');expect(within(traffic).getByRole('link',{name:'Открыть публикацию: Обзор'}).getAttribute('href')).toBe('https://vk.com/wall-1_2');
    fireEvent.click(within(traffic).getByRole('button',{name:'Сайты'}));expect(within(traffic).getByText('vk.com')).toBeTruthy();
  });
  it('preserves terms acceptance',async()=>{
    show({termsAccepted:false});await screen.findByRole('button',{name:'Принять условия'});
    expect(screen.getByRole('link',{name:'Открыть условия'}).getAttribute('href')).toBe('https://example.test/terms');
    fireEvent.click(screen.getByRole('button',{name:'Принять условия'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/partners/partner/terms',{method:'POST',body:{accepted:true,version:'syntolk-v1'}}));
  });
  it('sends one acceptance while saving and removes the prompt after confirmation',async()=>{
    show({termsAccepted:false});const button=await screen.findByRole('button',{name:'Принять условия'});
    const original=vi.mocked(api).getMockImplementation()!;let finish!:()=>void,accepted=false;
    vi.mocked(api).mockImplementation(async(url,options)=>{
      if(url.endsWith('/terms')){await new Promise<void>(resolve=>{finish=resolve;});accepted=true;return {partner:{termsAcceptedAt:'2026-10-24'}};}
      if(url==='/partners/partner'&&accepted)return {termsAcceptedAt:'2026-10-24'};
      return original(url,options);
    });
    fireEvent.click(button);fireEvent.click(button);
    const saving=await screen.findByRole('button',{name:'Сохраняем…'});expect((saving as HTMLButtonElement).disabled).toBe(true);
    expect(vi.mocked(api).mock.calls.filter(([url])=>url.endsWith('/terms'))).toHaveLength(1);
    finish();await waitFor(()=>expect(screen.queryByText('Подтвердите условия партнёрской программы')).toBeNull());
  });
  it('keeps the prompt and allows retry after a failed acceptance',async()=>{
    show({termsAccepted:false});await screen.findByRole('button',{name:'Принять условия'});
    const original=vi.mocked(api).getMockImplementation()!;let attempts=0;
    vi.mocked(api).mockImplementation(async(url,options)=>{if(url.endsWith('/terms')){attempts++;throw new Error('Не удалось сохранить условия');}return original(url,options);});
    fireEvent.click(screen.getByRole('button',{name:'Принять условия'}));await screen.findByText('Не удалось сохранить условия');
    const retry=screen.getByRole('button',{name:'Принять условия'});expect((retry as HTMLButtonElement).disabled).toBe(false);fireEvent.click(retry);await waitFor(()=>expect(attempts).toBe(2));
  });
  it('uses the confirmed acceptance even if the following profile refresh fails',async()=>{
    show({termsAccepted:false});await screen.findByRole('button',{name:'Принять условия'});const original=vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async(url,options)=>{if(url.endsWith('/terms'))return {partner:{termsAcceptedAt:'2026-10-24'}};if(url==='/partners/partner')throw new Error('Не удалось обновить профиль');return original(url,options);});
    fireEvent.click(screen.getByRole('button',{name:'Принять условия'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'Принять условия'})).toBeNull());
    expect(client.getQueryData(['partner-profile','partner'])).toMatchObject({termsAcceptedAt:'2026-10-24'});
  });
  it('does not show invented zeroes during loading',()=>{
    client=new QueryClient({defaultOptions:{queries:{retry:false}}});vi.mocked(api).mockImplementation(()=>new Promise(()=>{}));
    render(<MemoryRouter><QueryClientProvider client={client}><PartnerHome partnerId="partner" name="Партнёр"/></QueryClientProvider></MemoryRouter>);
    expect(screen.getByRole('region',{name:'Ваши результаты'}).getAttribute('aria-busy')).toBe('true');expect(screen.queryByText('0')).toBeNull();
  });
});
