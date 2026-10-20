// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
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
const comparedCounts={clicks:31,identities:12,registrations:9,payingCustomers:3,paymentCount:5,firstPaymentCount:3,repeatPaymentCount:2};
const comparedAmounts={observedPayments:420000,refunds:10000,netPayments:410000,netAccrued:84000};
const datePeriod=(from:string,to:string)=>({since:from+'T00:00:00.000Z',until:new Date(Date.parse(to)+86400000).toISOString()});
const report={currency:'RUB',counts,amountsMinor,balances,groupBy:'partner',rows:[partner],conversions:{clickToRegistration:.2,registrationToPayment:.5,clickToPayment:.1},
  timezone:'Europe/Moscow',period:{since:'2026-09-18T21:00:00.000Z',until:'2026-10-18T21:00:00.000Z'},series:{bucket:'day',points:[point]},
  options:{scenarios:[{id:'scenario-a',name:'Статьи'}],platforms:[{id:'vk',name:'ВКонтакте'},{id:'dzen',name:'Дзен'}],formats:[{id:'article',name:'Статьи'},{id:'circle',name:'Кружочки'}]},
  summary:{partners:5,activePartners:1},partnerTable:{rows:[partner],pagination},
  dataQuality:{signupTracking:'not_verified_end_to_end',paymentTracking:'not_verified_end_to_end',views:'unavailable',ctr:'unavailable'},
  availableCurrencies:['RUB','USD'],selectedPartners:[{id:'partner-a',name:partner.name}],diagnostics:{flaggedClicks:2,legacyFinancialEventsWithoutExternalId:1,refundAdjustments:{count:1,amountMinor:-10000},outstandingDebtMinor:15000}};
function Location(){const location=useLocation(),navigate=useNavigate();return <><output aria-label="Адрес">{location.pathname}{location.search}</output><button onClick={()=>navigate('/admin/analytics?scenarioIds=unused&chartBy=scenario&groupBy=scenario&period=7d')}>Открыть старую ссылку</button></>;}
function show(path='/admin/analytics'){
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><AdminAnalytics/><Location/></QueryClientProvider></MemoryRouter>);
}
function mockReport(sourceOptions?:()=>typeof report.options){vi.mocked(api).mockImplementation(async path=>{
  if(path==='/programs')return {programs:[{id:'program-a',name:'Syntolk'}]};
  const q=new URL(path,'http://local').searchParams;
  if(path.startsWith('/admin/analytics/partners?')){
    const empty={...partner,id:'empty',name:'Пустой партнёр',counts:{...counts,clicks:0,identities:0,registrations:0,payingCustomers:0,paymentCount:0},amountsMinor:{observedPayments:0,refunds:0,netPayments:0,netAccrued:0}};
    return {items:q.get('activity')==='all'?[partner,empty]:[partner],pagination:{...pagination,page:Number(q.get('page')??1)},summary:report.summary};
  }
  if(path.startsWith('/admin/analytics/details?'))return {history:{items:[{id:'click-1',kind:'click',ts:point.since,amountMinor:null,partnerNames:[partner.name],linkKeys:['syntolk-demo']}],nextCursor:null},traffic:{referrers:[],devices:[]}};
  if(path.startsWith('/partners/'))return {...report,groupBy:'platform',rows:[{...partner,id:'vk',name:'ВКонтакте'}]};
  const period=q.get('period')==='custom'&&q.has('from')&&q.has('to')?datePeriod(q.get('from')!,q.get('to')!):report.period;
  const comparison=q.get('includeComparison')==='true'?{period:datePeriod(q.get('compareFrom')!,q.get('compareTo')!),counts:comparedCounts,amountsMinor:comparedAmounts}:undefined;
  return {...report,options:sourceOptions?.()??report.options,period,timezone:q.get('timezone')??report.timezone,currency:q.get('currency')??'RUB',...(q.get('from')==='2025-04-01'?{counts:comparedCounts,amountsMinor:comparedAmounts}:{}),comparison};
});}
const summaries=()=>vi.mocked(api).mock.calls.filter(([p])=>p.startsWith('/admin/analytics?')&&new URL(p,'http://local').searchParams.get('view')==='summary');
const tables=()=>vi.mocked(api).mock.calls.filter(([p])=>p.startsWith('/admin/analytics/partners?')).map(([p])=>new URL(p,'http://local').searchParams);

describe('role-specific analytics and lean partner workflow',()=>{
  it('resets all report controls with Update, keeps navigation context and never writes statistics',async()=>{
    mockReport();show('/admin/analytics?period=custom&from=2025-04-01&to=2025-04-03&compare=true&compareFrom=2026-10-01&compareTo=2026-10-07&partnerIds=partner-a&platformIds=vk&formatIds=circle&programId=program-a&chartBy=format&metrics=clicks&activity=empty&showEmpty=true&search=old&page=2&pageSize=50&tableSort=name&tableDirection=asc&currency=USD&timezone=UTC');
    await screen.findByRole('article',{name:'Переходы'});
    fireEvent.click(screen.getByRole('button',{name:'Обновить'}));
    await waitFor(()=>expect(screen.getAllByRole('article')).toHaveLength(6));
    expect(screen.getByLabelText('Адрес').textContent).toBe('/admin/analytics');
    expect(screen.getByRole('button',{name:'Период аналитики'}).textContent).toContain('Последние 30 дней');
    expect(screen.queryByRole('button',{name:'Сбросить сравнение'})).toBeNull();
    expect(screen.getByLabelText('Найти партнёра в таблице')).toHaveProperty('value','');
    expect(screen.getByLabelText('Формат аналитики').textContent).toBe('Все типы контента');
    const query=new URL(summaries().at(-1)![0],'http://local').searchParams;
    expect(query.get('period')).toBe('30d');expect(query.get('currency')).toBe('RUB');
    expect(tables().at(-1)?.get('page')).toBe('1');expect(tables().at(-1)?.get('activity')).toBe('results');
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
    const calls=summaries().length;fireEvent.click(screen.getByRole('button',{name:'Обновить'}));
    await waitFor(()=>expect(summaries().length).toBeGreaterThan(calls));
  });
  it('retains card and table geometry during a period switch without exposing stale values or links',async()=>{
    mockReport();const immediate=vi.mocked(api).getMockImplementation()!;
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    vi.mocked(api).mockImplementation(async(path,options)=>{if(new URL(path,'http://local').searchParams.get('period')==='7d')await gate;return immediate(path,options);});
    show();await screen.findByRole('link',{name:partner.name});await screen.findByRole('article',{name:'Переходы'});
    const grid=document.querySelector('.results-chart-grid'),tbody=document.querySelector('.admin-analytics__table tbody');
    fireEvent.click(screen.getByRole('button',{name:'Период аналитики'}));fireEvent.click(screen.getByRole('menuitemradio',{name:'Последние 7 дней'}));
    await screen.findByText('Обновляем графики…');
    expect(document.querySelector('.results-chart-grid')).toBe(grid);expect(document.querySelector('.admin-analytics__table tbody')).toBe(tbody);
    expect(document.querySelector('.results-report__content')?.hasAttribute('inert')).toBe(true);
    expect(tbody?.getAttribute('aria-hidden')).toBe('true');expect(tbody?.hasAttribute('inert')).toBe(true);
    expect(screen.queryByRole('link',{name:partner.name})).toBeNull();
    await act(async()=>{release();});
    await screen.findByRole('article',{name:'Переходы'});await screen.findByRole('link',{name:partner.name});
    expect(document.querySelector('.results-chart-grid')).toBe(grid);
  });
  it('shows all metric cards before partner results with correct owner labels and seven useful columns',async()=>{
    mockReport();show();await screen.findByRole('link',{name:partner.name});
    expect((await screen.findByRole('article',{name:'Переходы'})).textContent).toContain('130');
    expect(screen.getByRole('article',{name:'Начислено партнёрам'})).toBeTruthy();
    expect(screen.queryByText('Ваш заработок')).toBeNull();
    expect(screen.queryByLabelText('Сценарий аналитики')).toBeNull();
    expect(screen.getByLabelText('Формат аналитики')).toBeTruthy();
    expect(screen.queryByText('Europe/Moscow')).toBeNull();
    expect(screen.queryByRole('region',{name:'Ручные выплаты за всё время'})).toBeNull();
    const table=screen.getByRole('table');expect(within(table).getAllByRole('columnheader')).toHaveLength(7);
    expect(screen.getAllByRole('article')).toHaveLength(6);
    for(const card of screen.getAllByRole('article'))expect(card.compareDocumentPosition(table)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(summaries()).toHaveLength(1);expect(tables()[0]!.get('activity')).toBe('results');
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('applies two arbitrary date ranges to every metric card while retaining the same source filters',async()=>{
    mockReport();show('/admin/analytics?period=custom&from=2026-10-01&to=2026-10-19&timezone=UTC&programId=program-a&partnerIds=partner-a&platformIds=vk');
    const compare=await screen.findByRole('button',{name:'Сравнить периоды'});
    await waitFor(()=>expect(compare).not.toHaveProperty('disabled',true));
    const tableCalls=tables().length;
    fireEvent.click(compare);
    const calendar=screen.getByRole('dialog',{name:'Сравнить периоды'});
    for(const [label,value] of [['Основной период: начало','2026-10-01'],['Основной период: конец','2026-10-19'],['Сравнить периоды: начало','2025-04-01'],['Сравнить периоды: конец','2025-04-30']])fireEvent.input(within(calendar).getByLabelText(label!),{target:{value}});
    fireEvent.click(within(calendar).getByRole('button',{name:'Применить'}));
    await waitFor(()=>expect(screen.getByRole('article',{name:'Переходы'}).querySelector('.results-metric-card__comparison b')?.textContent).toBe('31'));
    const query=new URL(summaries().at(-1)![0],'http://local').searchParams;
    for(const [key,value] of Object.entries({from:'2026-10-01',to:'2026-10-19',compareFrom:'2025-04-01',compareTo:'2025-04-30',includeComparison:'true',timezone:'UTC',programId:'program-a',partnerIds:'partner-a',platformIds:'vk'}))expect(query.get(key)).toBe(value);
    const expected=[['Переходы','130','31'],['Регистрации','22','9'],['Платящие клиенты','8','3'],['Оплаты','14','5'],['Оплачено клиентами','66860,00₽','4200,00₽'],['Начислено партнёрам','13272,00₽','840,00₽']];
    for(const [name,primary,secondary] of expected){
      const card=screen.getByRole('article',{name:name!});
      expect(card.querySelector('.results-metric-card__value')?.textContent?.replace(/\s/g,'')).toBe(primary);
      expect(card.querySelector('.results-metric-card__comparison b')?.textContent?.replace(/\s/g,'')).toBe(secondary);
      expect(card.querySelector('.results-change')?.textContent).not.toMatch(/Infinity|NaN/);
    }
    expect(tables()).toHaveLength(tableCalls);
    expect(tables().every(q=>!q.has('includeComparison')&&!q.has('compareFrom'))).toBe(true);
    expect(screen.getByLabelText('Адрес').textContent).toContain('compareTo=2025-04-30');
  });
  it('inherits comparison in a big chart and synchronizes edited dates and clearing to all overview cards',async()=>{
    mockReport();show('/admin/analytics?period=custom&from=2026-10-01&to=2026-10-19&timezone=UTC&compare=true&compareFrom=2025-04-01&compareTo=2025-04-30');
    fireEvent.click(await screen.findByRole('button',{name:'Подробнее: Оплаты'}));
    const graph=screen.getByRole('dialog',{name:'Оплаты'});
    await waitFor(()=>expect(within(graph).getByRole('region',{name:'Период сравнения'}).querySelector('.results-explorer__plot-heading strong')?.textContent).toBe('5'));
    fireEvent.click(within(graph).getByRole('button',{name:'Период сравнения'}));
    const calendar=within(graph).getByRole('dialog',{name:'Период сравнения'});
    for(const [label,value] of [['Основной период: начало','2026-09-10'],['Основной период: конец','2026-09-12'],['Период сравнения: начало','2026-10-12'],['Период сравнения: конец','2026-10-18']])fireEvent.input(within(calendar).getByLabelText(label!),{target:{value}});
    fireEvent.click(within(calendar).getByRole('button',{name:'Применить'}));
    await waitFor(()=>expect(summaries().some(([p])=>{const q=new URL(p,'http://local').searchParams;return q.get('from')==='2026-09-10'&&q.get('to')==='2026-09-12'&&q.get('compareFrom')==='2026-10-12'&&q.get('compareTo')==='2026-10-18';})).toBe(true));
    expect(screen.getByRole('dialog',{name:'Оплаты'})).toBeTruthy();
    fireEvent.click(within(graph).getByRole('button',{name:'Закрыть график'}));
    await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Оплаты'})).toBeNull());
    expect(screen.getAllByRole('article').every(card=>!!card.querySelector('.results-metric-card__comparison'))).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Сравнить периоды'}));
    fireEvent.click(within(screen.getByRole('dialog',{name:'Сравнить периоды'})).getByRole('button',{name:'Убрать сравнение'}));
    await waitFor(()=>expect(screen.getAllByRole('article').every(card=>!card.querySelector('.results-metric-card__comparison'))).toBe(true));
    expect(screen.getByLabelText('Адрес').textContent).not.toContain('compare');
    expect(screen.getByLabelText('Адрес').textContent).toContain('from=2026-09-10');
  });
  it.each(['today','7d','30d','all','custom'])('resets comparison directly while preserving %s and the selected filters',async period=>{
    mockReport();const main=new URLSearchParams({period,programId:'program-a',partnerIds:'partner-a',platformIds:'vk',formatIds:'circle',timezone:'UTC',page:'2'});
    if(period==='custom'){main.set('from','2026-10-01');main.set('to','2026-10-19');}
    const compared=new URLSearchParams(main);compared.set('compare','true');compared.set('compareFrom','2025-04-01');compared.set('compareTo','2025-04-30');
    show('/admin/analytics?'+compared);
    await waitFor(()=>expect(screen.getByRole('article',{name:'Переходы'}).querySelector('.results-metric-card__comparison')).toBeTruthy());
    fireEvent.click(screen.getByRole('button',{name:'Сбросить сравнение'}));
    await waitFor(()=>expect(screen.getAllByRole('article').every(card=>!card.querySelector('.results-metric-card__comparison'))).toBe(true));
    expect(screen.getByLabelText('Адрес').textContent).toBe('/admin/analytics?'+main);expect(screen.queryByRole('dialog')).toBeNull();
    expect(new URL(summaries().at(-1)![0],'http://local').searchParams.has('includeComparison')).toBe(false);
    expect(screen.queryByRole('button',{name:'Сбросить сравнение'})).toBeNull();
  });
  it('resets comparison inside the big chart without changing Today or closing the chart',async()=>{
    mockReport();show('/admin/analytics?period=today&platformIds=vk&compare=true&compareFrom=2025-04-01&compareTo=2025-04-30');
    fireEvent.click(await screen.findByRole('button',{name:'Подробнее: Оплаты'}));
    const graph=screen.getByRole('dialog',{name:'Оплаты'});
    fireEvent.click(within(graph).getByRole('button',{name:'Сбросить сравнение'}));
    await waitFor(()=>expect(within(graph).queryByRole('region',{name:'Период сравнения'})).toBeNull());
    expect(screen.getByLabelText('Адрес').textContent).toBe('/admin/analytics?period=today&platformIds=vk');
    expect(screen.getByRole('dialog',{name:'Оплаты'})).toBeTruthy();
  });
  it('pages, sorts and searches the table without rerunning charts or global totals',async()=>{
    mockReport();show('/admin/analytics?programId=program-a&platformIds=vk');await screen.findByRole('link',{name:partner.name});
    const calls=summaries().length;
    fireEvent.change(screen.getByLabelText('Найти партнёра в таблице'),{target:{value:'Syntolk'}});
    await waitFor(()=>expect(tables().at(-1)?.get('search')).toBe('Syntolk'));
    fireEvent.change(screen.getByLabelText('Сортировка партнёров'),{target:{value:'clicks'}});
    await waitFor(()=>expect(tables().at(-1)?.get('sort')).toBe('clicks'));
    await waitFor(()=>expect(screen.getByLabelText('Следующая страница партнёров')).not.toHaveProperty('disabled',true));
    fireEvent.click(screen.getByLabelText('Следующая страница партнёров'));
    await waitFor(()=>expect(tables().at(-1)?.get('page')).toBe('2'));
    expect(tables().at(-1)?.get('programId')).toBe('program-a');
    expect(tables().at(-1)?.getAll('platformIds')).toEqual(['vk']);
    expect(summaries()).toHaveLength(calls);
  });
  it('loads new source choices and retains content, platform and date comparison filters in charts and the partner table',async()=>{
    let options=report.options;mockReport(()=>options);
    show('/admin/analytics?period=custom&from=2026-10-01&to=2026-10-19&compare=true&compareFrom=2025-04-01&compareTo=2025-04-30&platformIds=vk&formatIds=circle');
    await screen.findByRole('article',{name:'Переходы'});
    expect(screen.getByLabelText('Формат аналитики').textContent).toContain('Кружочки');
    options={...options,formats:[...options.formats,{id:'format-podcast',name:'Авторский подкаст'}],platforms:[...options.platforms,{id:'custom-community',name:'Сообщество автора'}]};
    await client.invalidateQueries({queryKey:['admin-analytics']});
    await waitFor(()=>expect(client.isFetching()).toBe(0));
    fireEvent.click(screen.getByLabelText('Формат аналитики'));
    const content=screen.getByRole('dialog',{name:'Тип контента'});
    fireEvent.click(await within(content).findByRole('checkbox',{name:'Авторский подкаст'}));
    fireEvent.click(within(content).getByRole('button',{name:'Применить'}));
    await waitFor(()=>expect(new URL(summaries().at(-1)![0],'http://local').searchParams.getAll('formatIds')).toEqual(['circle','format-podcast']));
    fireEvent.click(screen.getByLabelText('Площадка аналитики'));
    const platforms=screen.getByRole('dialog',{name:'Площадки'});
    fireEvent.click(within(platforms).getByRole('checkbox',{name:'Сообщество автора'}));fireEvent.click(within(platforms).getByRole('button',{name:'Применить'}));
    await screen.findByRole('article',{name:'Переходы'});
    fireEvent.change(screen.getByLabelText('Режим графика'),{target:{value:'format'}});
    await waitFor(()=>expect(new URL(summaries().at(-1)![0],'http://local').searchParams.get('seriesBy')).toBe('format'));
    const query=new URL(summaries().at(-1)![0],'http://local').searchParams;
    expect(query.getAll('formatIds')).toEqual(['circle','format-podcast']);expect(query.getAll('platformIds')).toEqual(['vk','custom-community']);
    expect(query.get('compareFrom')).toBe('2025-04-01');expect(query.get('compareTo')).toBe('2025-04-30');
    expect(tables().at(-1)?.getAll('formatIds')).toEqual(['circle','format-podcast']);expect(tables().at(-1)?.getAll('platformIds')).toEqual(['vk','custom-community']);
    fireEvent.click(await screen.findByRole('button',{name:'Подробнее: Переходы'}));
    expect(within(screen.getByRole('dialog',{name:'Переходы'})).getByRole('option',{name:'По форматам'})).toBeTruthy();
  });
  it('cleans old scenario bookmarks on every navigation and never inherits their scope in partner details',async()=>{
    mockReport();show('/admin/analytics?scenarioId=draft-a&scenarioIds=draft-b&formatIds=post&chartBy=scenario&groupBy=scenario&period=custom&from=2026-10-01&to=2026-10-19&platformIds=vk');
    await screen.findByRole('link',{name:partner.name});
    await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).not.toMatch(/scenario/));
    expect(screen.getByLabelText('Адрес').textContent).toContain('formatIds=post');
    expect(screen.getByLabelText('Адрес').textContent).toContain('from=2026-10-01');
    for(const [path] of [...summaries(),...vi.mocked(api).mock.calls.filter(([p])=>p.startsWith('/admin/analytics/partners?'))]){
      expect(path).not.toMatch(/scenario/);
      expect(path).toContain('formatIds=post');
      expect(path).toContain('platformIds=vk');
    }
    fireEvent.click(screen.getByRole('button',{name:'Открыть старую ссылку'}));
    await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).toBe('/admin/analytics?period=7d'));
    fireEvent.click(await screen.findByRole('link',{name:partner.name}));
    await screen.findByRole('heading',{name:'Результаты партнёра'});
    expect(screen.getByLabelText('Сценарий аналитики').textContent).toContain('Все сценарии');
    expect(vi.mocked(api).mock.calls.filter(([p])=>p.startsWith('/partners/partner-a/analytics?')).every(([p])=>!p.includes('scenario'))).toBe(true);
    fireEvent.click(screen.getByRole('link',{name:'К аналитике партнёров'}));
    await screen.findByRole('heading',{name:'Аналитика партнёров'});
    expect(screen.queryByLabelText('Сценарий аналитики')).toBeNull();
  });
  it('keeps scenario filtering inside one partner without restoring it on return to the overview',async()=>{
    mockReport();show('/admin/analytics?selectedPartner=partner-a&scenarioIds=scenario-a&returnTo='+encodeURIComponent('period=7d&scenarioIds=unused&chartBy=scenario'));
    await screen.findByRole('heading',{name:'Результаты партнёра'});
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([p])=>p.startsWith('/partners/partner-a/analytics?')&&p.includes('scenarioIds=scenario-a'))).toBe(true));
    await waitFor(()=>expect(screen.getByLabelText('Сценарий аналитики').textContent).toContain('Статьи'));
    fireEvent.click(screen.getByRole('link',{name:'К аналитике партнёров'}));
    await screen.findByRole('heading',{name:'Аналитика партнёров'});
    expect(screen.getByLabelText('Адрес').textContent).toBe('/admin/analytics?period=7d');
  });
  it('selects partners by their actual activity rather than account status and shows the selected name',async()=>{
    mockReport();show();await screen.findByRole('link',{name:partner.name});
    fireEvent.click(screen.getByText('Партнёры',{selector:'summary'}));
    const checkbox=await screen.findByRole('checkbox',{name:/Локальный партнёр Syntolk/});
    expect(checkbox.parentElement?.textContent).toContain('Переходы: 4');
    expect(checkbox.parentElement?.textContent).not.toContain('Активен');
    fireEvent.click(checkbox);
    await waitFor(()=>expect(summaries().at(-1)?.[0]).toContain('partnerIds=partner-a'));
    fireEvent.change(screen.getByLabelText('Поиск партнёров'),{target:{value:'local'}});
    await waitFor(()=>expect(tables().some(q=>q.get('search')==='local')).toBe(true));
    fireEvent.click(screen.getByRole('button',{name:'Готово'}));
    await waitFor(()=>expect(screen.queryByLabelText('Поиск партнёров')).toBeNull());
    expect(screen.getByText('Партнёры',{selector:'summary'}).textContent).toContain(partner.name);
  });
  it('reveals empty partners explicitly without changing aggregate scope',async()=>{
    mockReport();show();await screen.findByRole('link',{name:partner.name});
    expect(screen.queryByRole('link',{name:'Пустой партнёр'})).toBeNull();
    const before=summaries().length;
    fireEvent.click(screen.getByRole('checkbox',{name:'Показать без результатов'}));
    await screen.findByRole('link',{name:'Пустой партнёр'});
    expect(tables().at(-1)?.get('activity')).toBe('all');expect(summaries()).toHaveLength(before);
  });
  it('preserves civil time, dates and selected sources when drilling into a partner and returning',async()=>{
    mockReport();show('/admin/analytics?period=7d&currency=USD&timezone=UTC&platformIds=vk&tableSort=clicks&page=2');await screen.findByRole('link',{name:partner.name});
    fireEvent.click(screen.getByRole('link',{name:partner.name}));
    await screen.findByRole('heading',{name:'Результаты партнёра'});
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([p])=>p.startsWith('/partners/partner-a/analytics?')&&p.includes('timezone=UTC')&&p.includes('period=7d')&&p.includes('currency=USD')&&p.includes('platformIds=vk'))).toBe(true));
    expect(screen.queryByText('Ваш заработок')).toBeNull();
    fireEvent.click(screen.getByRole('link',{name:'К аналитике партнёров'}));
    await screen.findByRole('heading',{name:'Аналитика партнёров'});
    expect(screen.getByLabelText('Адрес').textContent).toContain('page=2');
    expect(screen.getByLabelText('Адрес').textContent).toContain('timezone=UTC');
  });
  it('waits for custom dates before fetching summary and table',async()=>{
    mockReport();show('/admin/analytics?period=custom');await screen.findByText('Выберите начало и конец периода в календаре.');
    expect(summaries()).toHaveLength(0);expect(tables()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button',{name:'Период аналитики'}));
    fireEvent.click(screen.getByRole('menuitemradio',{name:'Свои даты'}));
    const calendar=screen.getByRole('dialog',{name:'Даты аналитики партнёров'});
    fireEvent.change(within(calendar).getByLabelText('Даты аналитики партнёров: начало'),{target:{value:'2020-10-01'}});
    fireEvent.change(within(calendar).getByLabelText('Даты аналитики партнёров: конец'),{target:{value:'2020-10-07'}});
    fireEvent.click(within(calendar).getByRole('button',{name:'Применить'}));
    await waitFor(()=>expect(summaries().some(([p])=>p.includes('from=2020-10-01')&&p.includes('to=2020-10-07'))).toBe(true));
  });
  it('compares partners rather than scenarios and identifies the owner and link in click history',async()=>{
    mockReport();show('/admin/analytics?currency=USD&metrics=customerPaymentsMinor&partnerIds=partner-a');await screen.findByRole('link',{name:partner.name});
    const mode=await screen.findByLabelText('Режим графика');
    expect(within(mode).getByRole('option',{name:'По партнёрам'})).toBeTruthy();
    expect(within(mode).getByRole('option',{name:'По форматам'})).toBeTruthy();
    expect(within(mode).queryByRole('option',{name:'По сценариям'})).toBeNull();
    const card=screen.getByRole('article',{name:'Оплачено клиентами'});
    expect(card.textContent).toContain('$');expect(card.textContent).not.toContain('₽');
    fireEvent.click(within(card).getByRole('button',{name:'Подробнее: Оплачено клиентами'}));
    const graph=screen.getByRole('dialog',{name:'Оплачено клиентами'});
    expect(within(graph).queryByRole('option',{name:'По сценариям'})).toBeNull();
    fireEvent.click(within(graph).getByRole('button',{name:'Подробнее за период: Оплачено клиентами'}));
    const detail=await within(graph).findByRole('region',{name:'Оплачено клиентами'});
    fireEvent.click(within(detail).getByRole('tab',{name:'Действия'}));
    await within(detail).findByText(/syntolk-demo/);
    expect(detail.textContent).toContain(partner.name);
    expect(vi.mocked(api).mock.calls.some(([p])=>p.includes('/partners/admin/'))).toBe(false);
  });
  it('does not load technical diagnostics until requested',async()=>{
    mockReport();show();await screen.findByRole('link',{name:partner.name});
    expect(vi.mocked(api).mock.calls.some(([p])=>p.includes('view=diagnostics'))).toBe(false);
    fireEvent.click(screen.getByText('Проверка учёта'));
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([p])=>p.includes('view=diagnostics'))).toBe(true));
    expect(await screen.findByText(/Передача регистраций и оплат ещё не подтверждена/)).toBeTruthy();
  });
});
