// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { AdminAnalytics } from './AdminAnalytics.js';

vi.mock('../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
let client:QueryClient;
afterEach(()=>{cleanup();client?.clear();localStorage.clear();vi.clearAllMocks();});
const counts={clicks:130,identities:22,registrations:22,payingCustomers:8,paymentCount:14,firstPaymentCount:8,repeatPaymentCount:6};
const amountsMinor={observedPayments:6686000,refunds:50000,netPayments:6636000,netAccrued:1327200};
const balances={total:13272,accrued:6972,available:2000,pending:300,paid:4000,debt:150};
const partner={id:'partner-a',name:'Локальный партнёр Syntolk',email:'partner@example.test',status:'active',archived:false,counts:{...counts,clicks:4},amountsMinor,balances};
const pagination={page:1,pageSize:20,total:21,totalPages:2};
const point={date:'2026-10-01',since:'2026-09-30T21:00:00.000Z',until:'2026-10-01T21:00:00.000Z',...counts,payments:14,customerPaymentsMinor:6686000,earningsMinor:1327200};
const report={currency:'RUB',counts,amountsMinor,balances,groupBy:'partner',rows:[partner],conversions:{clickToRegistration:.2,registrationToPayment:.5,clickToPayment:.1},
  timezone:'Europe/Moscow',period:{since:'2026-09-18T21:00:00.000Z',until:'2026-10-18T21:00:00.000Z'},series:{bucket:'day',points:[point]},
  options:{scenarios:[{id:'scenario-a',name:'Статьи'}],platforms:[{id:'vk',name:'ВКонтакте'},{id:'dzen',name:'Дзен'}],formats:[{id:'article',name:'Статья'}]},
  summary:{partners:5,activePartners:1},partnerTable:{rows:[partner],pagination},
  dataQuality:{signupTracking:'not_verified_end_to_end',paymentTracking:'not_verified_end_to_end',views:'unavailable',ctr:'unavailable'},
  diagnostics:{flaggedClicks:2,legacyFinancialEventsWithoutExternalId:1,refundAdjustments:{count:1,amountMinor:-10000},outstandingDebtMinor:15000}};
function Location(){const location=useLocation();return <output aria-label="Адрес">{location.pathname}{location.search}</output>;}
function show(path='/admin/analytics'){
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><AdminAnalytics/><Location/></QueryClientProvider></MemoryRouter>);
}
function mockReport(){vi.mocked(api).mockImplementation(async path=>{
  if(path==='/programs')return {programs:[{id:'program-a',name:'Syntolk'}]};
  if(path.startsWith('/admin/analytics/partners?'))return {items:[partner],pagination};
  if(path.startsWith('/admin/analytics/details?'))return {history:{items:[],nextCursor:null},traffic:{referrers:[],devices:[]}};
  if(path.startsWith('/partners/'))return {...report,groupBy:'platform',rows:[{...partner,id:'vk',name:'ВКонтакте'}]};
  const query=new URL(path,'http://local').searchParams;
  return {...report,currency:query.get('currency')??'RUB',partnerTable:{rows:[partner],pagination:{...pagination,page:Number(query.get('page')??1)}}};
});}
const requests=()=>vi.mocked(api).mock.calls.filter(([path])=>path.startsWith('/admin/analytics?')).map(([path])=>new URL(path,'http://local').searchParams);

describe('admin partner analytics',()=>{
  it('uses server totals, minor-unit amounts and lifetime cash balances without per-partner summary requests',async()=>{
    mockReport();show();await screen.findByRole('table');
    expect(screen.getByRole('article',{name:'Переходы'}).textContent).toContain('130');
    expect(screen.getByText(/Активных партнёров за период:/).textContent).toContain('1 из 5');
    const table=screen.getByRole('table');expect(within(table).getAllByRole('columnheader')).toHaveLength(13);
    expect(within(table).getByRole('cell',{name:/66\s860,00\s₽/})).toBeTruthy();
    expect(within(table).getByRole('cell',{name:/4\s000,00\s₽/})).toBeTruthy();
    const cash=screen.getByRole('region',{name:'Ручные выплаты за всё время'});
    expect(cash.textContent).toContain('Балансы не зависят от периода и источников');
    expect(within(cash).getByText('Ожидает подтверждения').parentElement?.textContent).toMatch(/6\s972,00\s₽/);
    expect(within(cash).getByRole('link',{name:'Перейти к ручным выплатам'}).getAttribute('href')).toBe('/payouts');
    expect(requests()[0]!.get('currency')).toBe('RUB');
    expect(vi.mocked(api).mock.calls.some(([path])=>path.startsWith('/partners/'))).toBe(false);
    fireEvent.click(screen.getByText(/Качество данных ·/));
    expect(screen.getByText('Просмотры публикаций и CTR недоступны.')).toBeTruthy();
    expect(screen.getByText(/Передача регистраций и оплат ещё не подтверждена/)).toBeTruthy();
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('sends table search, sort and page to the server without changing summary scope',async()=>{
    mockReport();show('/admin/analytics?programId=program-a&platformIds=vk');await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Найти партнёра в таблице'),{target:{value:'Syntolk'}});
    await waitFor(()=>expect(requests().some(query=>query.get('search')==='Syntolk')).toBe(true));
    fireEvent.change(screen.getByLabelText('Сортировка партнёров'),{target:{value:'clicks'}});
    await waitFor(()=>expect(requests().at(-1)?.get('sort')).toBe('clicks'));
    await waitFor(()=>expect(screen.getByLabelText('Следующая страница партнёров')).not.toHaveProperty('disabled',true));
    fireEvent.click(screen.getByLabelText('Следующая страница партнёров'));
    await waitFor(()=>expect(requests().at(-1)?.get('page')).toBe('2'));
    const query=requests().at(-1)!;expect(query.get('programId')).toBe('program-a');expect(query.getAll('platformIds')).toEqual(['vk']);
    expect(screen.getByRole('article',{name:'Переходы'}).textContent).toContain('130');
  });
  it('loads partner choices on demand and combines several checked partners',async()=>{
    mockReport();show('/admin/analytics?partnerIds=other-partner');await screen.findByRole('table');
    expect(vi.mocked(api).mock.calls.some(([path])=>path.startsWith('/admin/analytics/partners?'))).toBe(false);
    fireEvent.click(screen.getByText('Партнёры',{selector:'summary'}));
    const checkbox=await screen.findByRole('checkbox',{name:/Локальный партнёр Syntolk/});fireEvent.click(checkbox);
    await waitFor(()=>expect(requests().at(-1)?.getAll('partnerIds')).toEqual(['other-partner','partner-a']));
    fireEvent.change(screen.getByLabelText('Поиск партнёров на сервере'),{target:{value:'local'}});
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('/admin/analytics/partners?search=local'))).toBe(true));
    fireEvent.click(screen.getByRole('button',{name:'Готово'}));
    await waitFor(()=>expect(screen.queryByLabelText('Поиск партнёров на сервере')).toBeNull());
  });
  it('preserves period and source filters across shared partner drilldown and back',async()=>{
    mockReport();show('/admin/analytics?period=7d&currency=USD&platformIds=vk&tableSort=clicks&page=2');await screen.findByRole('table');
    fireEvent.click(screen.getByRole('link',{name:'Локальный партнёр Syntolk'}));
    await screen.findByRole('heading',{name:'Результаты'});
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>path.startsWith('/partners/partner-a/analytics?')&&path.includes('period=7d')&&path.includes('currency=USD')&&path.includes('platformIds=vk'))).toBe(true));
    expect(vi.mocked(api).mock.calls.some(([path])=>path==='/me/programs')).toBe(false);
    fireEvent.click(screen.getByRole('link',{name:'К аналитике партнёров'}));
    await screen.findByRole('heading',{name:'Аналитика партнёров'});
    const address=screen.getByLabelText('Адрес').textContent!;expect(address).toContain('tableSort=clicks');expect(address).toContain('page=2');expect(address).toContain('currency=USD');
  });
  it('does not request incomplete custom dates and applies a calendar range',async()=>{
    mockReport();show('/admin/analytics?period=custom');await screen.findByText('Выберите начало и конец периода в календаре.');expect(requests()).toHaveLength(0);
    fireEvent.click(screen.getByLabelText('Даты аналитики партнёров',{exact:true}));
    const calendar=screen.getByRole('dialog',{name:'Даты аналитики партнёров'});
    fireEvent.change(within(calendar).getByLabelText('Даты аналитики партнёров: начало'),{target:{value:'2020-10-01'}});
    fireEvent.change(within(calendar).getByLabelText('Даты аналитики партнёров: конец'),{target:{value:'2020-10-07'}});
    fireEvent.click(within(calendar).getByRole('button',{name:'Применить'}));
    await waitFor(()=>expect(requests().some(query=>query.get('from')==='2020-10-01'&&query.get('to')==='2020-10-07')).toBe(true));
  });
  it('uses admin endpoints and the selected currency for graph and action details',async()=>{
    mockReport();show('/admin/analytics?currency=USD&metrics=customerPaymentsMinor&partnerIds=partner-a');await screen.findByRole('table');
    const card=screen.getByRole('article',{name:'Оплачено клиентами'});expect(card.textContent).toContain('$');expect(card.textContent).not.toContain('₽');
    fireEvent.click(within(card).getByRole('button',{name:'Подробнее: Оплачено клиентами'}));
    const graph=screen.getByRole('dialog',{name:'Оплачено клиентами'});
    fireEvent.click(within(graph).getByRole('button',{name:'Подробнее за период: Оплачено клиентами'}));
    const detail=await within(graph).findByRole('region',{name:'Оплачено клиентами'});
    fireEvent.click(within(detail).getByRole('tab',{name:'Действия'}));
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>path.startsWith('/admin/analytics/details?')&&path.includes('currency=USD')&&path.includes('partnerIds=partner-a'))).toBe(true));
    expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('/partners/admin/'))).toBe(false);
    expect(detail.textContent).not.toContain('₽');
  });
  it('shows an explicit empty table and handles request failures without invented figures',async()=>{
    mockReport();vi.mocked(api).mockImplementation(async path=>path==='/programs'?{programs:[]}:{...report,partnerTable:{rows:[],pagination:{...pagination,total:0,totalPages:0}}});
    show();await screen.findByText('По выбранным фильтрам партнёров нет.');
    expect(screen.getByLabelText('Следующая страница партнёров')).toHaveProperty('disabled',true);
    vi.mocked(api).mockRejectedValue(new Error('Аналитика временно недоступна'));
    fireEvent.change(screen.getByLabelText('Валюта аналитики'),{target:{value:'EUR'}});
    await screen.findByText('Аналитика временно недоступна');expect(screen.queryByRole('article',{name:'Переходы'})).toBeNull();
  });
});
