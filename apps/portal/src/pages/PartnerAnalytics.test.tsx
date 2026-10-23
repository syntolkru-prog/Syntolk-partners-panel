// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { PartnerAnalyticsPanel } from './PartnerAnalytics.js';
import { ResultsChart } from './ResultsChart.js';
import { MaterialEditor } from './MaterialEditor.js';
import { Dashboard } from './Dashboard.js';

vi.mock('../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
let client:QueryClient;
afterEach(()=>{cleanup();client?.clear();localStorage.clear();vi.restoreAllMocks();vi.clearAllMocks();});
const counts={clicks:10,registrations:2,payingCustomers:1,paymentCount:1,firstPaymentCount:1,repeatPaymentCount:0};
const amountsMinor={observedPayments:100000,refunds:0,netPayments:100000,netAccrued:20000};
const result={counts,amountsMinor,conversions:{clickToRegistration:0.2,registrationToPayment:0.5,clickToPayment:0.1},rows:[{id:'youtube',name:'YouTube',archived:false,counts,amountsMinor}],options:{scenarios:[{id:'a',name:'Рилсы'},{id:'b',name:'Посты',archived:true}],platforms:[{id:'youtube',name:'YouTube'}],formats:[{id:'short',name:'Короткие видео'}]},balances:{total:1000,available:1000,pending:0,paid:0}};
const dashboard={periodEarnings:200,currency:'RUB',clicks:10,registrations:2,payingClients:1,conversionRate:0.1,attributedRevenue:1000,commissionByStatus:{},balances:result.balances};
const funnel={stages:{clicks:10,identities:3,signups:2,paid:1},rates:{stitchRate:0.3,signupRate:2/3,paidRate:0.5,overall:0.1}};
const principal={role:'partner' as const,partnerId:'partner',partner:{id:'partner',name:'Локальный партнёр Syntolk',email:'local@example.test'}};
function Location(){const location=useLocation();return <output aria-label="Адрес">{location.pathname}{location.search}</output>;}
function show(element:React.ReactNode,path='/results'){
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}>{element}<Location/></QueryClientProvider></MemoryRouter>);
}
async function pickFilter(ariaLabel:string,menuLabel:string,names:string[],allLabel:string) {
  fireEvent.click(screen.getByLabelText(ariaLabel));
  const menu=screen.getByRole('dialog',{name:menuLabel});
  fireEvent.click(within(menu).getByRole('button',{name:allLabel}));
  for(const name of names)fireEvent.click(within(menu).getByRole('checkbox',{name}));
  fireEvent.click(within(menu).getByRole('button',{name:'Применить'}));
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:menuLabel})).toBeNull());
}
function mockReport(){vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:result);}
function pickPeriod(name:string){fireEvent.click(screen.getByRole('button',{name:'Период аналитики'}));fireEvent.click(screen.getByRole('menuitemradio',{name}));}

describe('partner scenario analytics UI',()=>{
  it('resets dates, comparison, all source filters and table controls while retaining the partner program',async()=>{
    mockReport();show(<PartnerAnalyticsPanel partnerId="partner"/>,'/results?programId=p&period=custom&from=2025-04-01&to=2025-04-03&compare=true&compareFrom=2026-10-01&compareTo=2026-10-07&scenarioIds=a&platformIds=youtube&formatIds=short&chartBy=format&groupBy=link&bucket=week&activity=all&sort=earnings&currency=USD&timezone=UTC');
    await screen.findByRole('article',{name:'Переходы'});
    fireEvent.change(screen.getByLabelText('Поиск результатов'),{target:{value:'something'}});
    fireEvent.click(screen.getByRole('button',{name:'Обновить'}));
    await screen.findByRole('cell',{name:'YouTube'});
    expect(screen.getByLabelText('Адрес').textContent).toBe('/results?programId=p');
    expect(screen.getByRole('button',{name:'Период аналитики'}).textContent).toContain('Последние 30 дней');
    expect(screen.queryByRole('button',{name:'Сбросить сравнение'})).toBeNull();
    expect(screen.getByLabelText('Сценарий аналитики').textContent).toBe('Все сценарии');
    expect(screen.getByLabelText('Разбивка аналитики')).toHaveProperty('value','platform');
    expect(screen.getByLabelText('Поиск результатов')).toHaveProperty('value','');
    expect(screen.getAllByRole('article')).toHaveLength(6);
    const queries=vi.mocked(api).mock.calls.filter(([path])=>path.includes('/analytics?'));
    const query=new URL(queries.at(-1)![0],'http://local').searchParams;
    expect(query.get('period')).toBe('30d');expect(query.get('currency')).toBe('RUB');expect(query.get('programId')).toBe('p');
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
    const calls=queries.length;fireEvent.click(screen.getByRole('button',{name:'Обновить'}));
    await waitFor(()=>expect(vi.mocked(api).mock.calls.filter(([path])=>path.includes('/analytics?')).length).toBeGreaterThan(calls));
  });
  it('keeps partner cards mounted but hides stale numbers during period loading',async()=>{
    mockReport();const immediate=vi.mocked(api).getMockImplementation()!;
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    vi.mocked(api).mockImplementation(async(path,options)=>{if(new URL(path,'http://local').searchParams.get('period')==='7d')await gate;return immediate(path,options);});
    show(<PartnerAnalyticsPanel partnerId="partner"/>);await screen.findByRole('article',{name:'Переходы'});
    const grid=document.querySelector('.results-chart-grid');pickPeriod('Последние 7 дней');
    await screen.findByText('Обновляем статистику…');
    expect(document.querySelector('.results-chart-grid')).toBe(grid);
    expect(document.querySelector('.results-report__content')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.results-report__content')?.hasAttribute('inert')).toBe(true);
    await act(async()=>{release();});await screen.findByRole('article',{name:'Переходы'});
    expect(document.querySelector('.results-chart-grid')).toBe(grid);
  });
  it('keeps detailed metrics collapsed and shows a clear empty state instead of an empty table',async()=>{
    const empty={...result,counts:{...counts,clicks:0,registrations:0,payingCustomers:0,paymentCount:0,firstPaymentCount:0},conversions:{clickToRegistration:null,registrationToPayment:null,clickToPayment:null},rows:[]};
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:empty);
    show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByText('За выбранный период нет действий.');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByLabelText('Найти материал')).toBeNull();
    const details=screen.getByText('Оплаты и конверсии').closest('details')!;
    expect(details.open).toBe(false);expect([...details.querySelectorAll('strong')].filter(element=>element.textContent==='—')).toHaveLength(3);
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByRole('button',{name:/Учесть публикацию|Добавить материал/})).toBeNull();
    expect((screen.getByLabelText('Активность таблицы') as HTMLSelectElement).value).toBe('results');
  });
  it('shows and hides empty results without changing totals or sending writes',async()=>{
    const emptyCounts={clicks:0,registrations:0,payingCustomers:0,paymentCount:0,firstPaymentCount:0,repeatPaymentCount:0};
    const emptyAmounts={observedPayments:0,refunds:0,netPayments:0,netAccrued:0};
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:path.includes('includeEmpty=true')?{...result,rows:[...result.rows,{id:'unused',name:'Дзен без переходов',counts:emptyCounts,amountsMinor:emptyAmounts}]}:result);
    show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('cell',{name:'YouTube'});
    expect(screen.queryByRole('cell',{name:'Дзен без переходов'})).toBeNull();
    fireEvent.change(screen.getByLabelText('Активность таблицы'),{target:{value:'all'}});
    await screen.findByRole('cell',{name:'Дзен без переходов'});
    expect(screen.getByLabelText('Адрес').textContent).toContain('activity=all');
    expect(screen.getAllByText('10')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Активность таблицы'),{target:{value:'results'}});
    await waitFor(()=>expect(screen.queryByRole('cell',{name:'Дзен без переходов'})).toBeNull());
    expect(screen.getByLabelText('Адрес').textContent).not.toContain('includeEmpty=');
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('starts with all results instead of a remembered calendar scenario and applies explicit choices',async()=>{
    localStorage.setItem('syntolk-partner-selection:default:partner',JSON.stringify({programId:'p',scenarioId:'a'}));
    mockReport();show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('heading',{name:'Эффективность площадок'});

    expect(vi.mocked(api).mock.calls.filter(([path])=>path.includes('/analytics?')).every(([path])=>!path.includes('scenarioId'))).toBe(true);
    expect(screen.getByLabelText('Сценарий аналитики').textContent).toBe('Все сценарии');
    fireEvent.click(screen.getByLabelText('Сценарий аналитики'));
    const menu=screen.getByRole('dialog',{name:'Сценарии'});
    fireEvent.click(within(menu).getByText('Архив',{exact:true}));
    fireEvent.click(within(menu).getByRole('checkbox',{name:'Посты'}));
    fireEvent.click(within(menu).getByRole('button',{name:'Применить'}));
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('/analytics?')&&path.includes('scenarioIds=b'))).toBe(true));
    expect(JSON.parse(localStorage.getItem('syntolk-partner-selection:default:partner')!).scenarioId).toBe('b');
    expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('calculator-plan'))).toBe(false);
  });
  it('keeps archived scenarios collapsed inside the menu until Archive is opened',async()=>{
    mockReport();show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('heading',{name:'Эффективность площадок'});

    fireEvent.click(screen.getByLabelText('Сценарий аналитики'));
    const menu=screen.getByRole('dialog',{name:'Сценарии'}),archive=menu.querySelector('details')!;
    expect(archive.open).toBe(false);
    expect(within(menu).getByRole('checkbox',{name:'Рилсы'})).toBeTruthy();
    const address=screen.getByLabelText('Адрес').textContent;
    fireEvent.click(within(menu).getByText('Архив',{exact:true}));
    expect(archive.open).toBe(true);expect(within(menu).getByRole('checkbox',{name:'Посты'})).toBeTruthy();
    expect(screen.getByLabelText('Адрес').textContent).toBe(address);
    fireEvent.keyDown(menu,{key:'Escape'});
    expect(screen.queryByRole('dialog',{name:'Сценарии'})).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Сценарий аналитики'));
    expect(screen.getByLabelText('Площадка аналитики')).toBeTruthy();
  });
  it('combines period, platform and format without clearing them when scenarios change',async()=>{
    mockReport();show(<PartnerAnalyticsPanel partnerId="partner"/>,'/results?programId=p&scenarioId=a');
    await screen.findByRole('heading',{name:'Эффективность площадок'});

    pickPeriod('Последние 7 дней');
    await pickFilter('Площадка аналитики','Площадки',['YouTube'],'Все площадки');
    await pickFilter('Формат аналитики','Форматы',['Короткие видео'],'Все форматы');
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('period=7d')&&path.includes('platformIds=youtube')&&path.includes('formatIds=short'))).toBe(true));
    await pickFilter('Сценарий аналитики','Сценарии',[],'Все сценарии');
    expect(screen.getByLabelText('Сценарий аналитики').textContent).toBe('Все сценарии');
    expect(screen.getByLabelText('Адрес').textContent).toContain('platformIds=youtube');
    expect(screen.getByLabelText('Адрес').textContent).toContain('formatIds=short');
  });
  it('shows all eight homepage statistics without hiding registrations or zero payout balances',async()=>{
    localStorage.setItem('syntolk-partner-selection:default:partner',JSON.stringify({programId:'p',scenarioId:'a'}));
    vi.mocked(api).mockImplementation(async path=>path.includes('/analytics/details?')?{traffic:{referrers:[]},registrations:[]}:path.includes('/analytics?')?result:path.includes('/dashboard?')?dashboard:path.includes('/funnel?')?funnel:path==='/coach/me'?{programs:[{id:'p'}]}:path.includes('/calculator-plan?')?{plan:null,tasks:[]}:path==='/partners/partner'?{termsAcceptedAt:'2026-10-14'}:{});
    show(<Dashboard principal={principal}/>,'/?programId=p&scenarioId=a&platformId=youtube&formatId=short&materialId=video&groupBy=material');
    await screen.findByText('Выручка');
    for(const label of ['Переходы','Регистрации','Платящие клиенты','Начислено','Доступно','Ожидает выплаты','Выплачено'])expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    for(const label of ['Начислено','Доступно','Ожидает выплаты','Выплачено'])expect(screen.getByText(label).closest('details')).toBeNull();
    expect(screen.queryByText('Общая статистика')).toBeNull();
    expect(screen.queryByLabelText('Сценарий аналитики')).toBeNull();
    expect(screen.queryByLabelText('Разбивка аналитики')).toBeNull();
    expect(screen.queryByRole('link',{name:'Подробные результаты →'})).toBeNull();
    expect(screen.queryByText('Как считаются показатели')).toBeNull();
    const period=screen.getByRole('tablist',{name:'Период статистики'});
    expect(period.closest('.wd-header')).toBeTruthy();
    const queries=()=>vi.mocked(api).mock.calls.filter(([path])=>path.includes('/analytics?')).map(([path])=>new URL(path,'http://local').searchParams);
    expect(queries().length).toBeGreaterThan(0);
    for(const query of queries()){
      for(const field of ['programId','scenarioId','platformId','formatId','materialId'])expect(query.has(field)).toBe(false);
    }
    fireEvent.mouseDown(within(period).getByRole('tab',{name:'7 дней'}),{button:0,ctrlKey:false});
    await waitFor(()=>expect(queries().some(query=>query.get('period')==='7d')).toBe(true));
    expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('/funnel?'))).toBe(false);
    for(const label of ['Воронка','Начисления'])expect(screen.queryByText(label)).toBeNull();
    expect(screen.getByText('Конверсия')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('syntolk-partner-selection:default:partner')!).scenarioId).toBe('a');
  });
  it('keeps daily tasks on the selected scenario while dashboard totals stay unchanged',async()=>{
    localStorage.setItem('syntolk-partner-selection:default:partner',JSON.stringify({programId:'p',scenarioId:'a'}));
    vi.mocked(api).mockImplementation(async path=>path.includes('/analytics/details?')?{traffic:{referrers:[]},registrations:[]}:path.includes('/analytics?')?result:path.includes('/dashboard?')?dashboard:path.includes('/funnel?')?funnel:path==='/partners/partner'?{termsAcceptedAt:'2026-10-14'}:path==='/coach/me'?{programs:[{id:'p',name:'Syntolk'}]}:path.includes('/calculator-plan?')?{
      plan:{data:{startDate:'2026-10-14',days:7,scenarioId:path.includes('scenarioId=b')?'b':'a',scenarioName:path.includes('scenarioId=b')?'Посты':'Рилсы'}},today:'2026-10-14',
      tasks:[{status:'planned',data:{scheduledDay:'2026-10-14',estimatedMinutes:20,title:path.includes('scenarioId=b')?'Подготовить пост':'Снять ролик'}}],
    }:{});
    show(<Dashboard principal={principal}/>,'/');
    await screen.findByRole('link',{name:'Снять ролик, задача 1'});
    expect(screen.getByRole('link',{name:'Снять ролик, задача 1'}).getAttribute('href')).toContain('scenarioId=a');
    await screen.findByText('Начислено');
    expect(screen.getByText('Снять ролик')).toBeTruthy();
    localStorage.setItem('syntolk-partner-selection:default:partner',JSON.stringify({programId:'p',scenarioId:'b'}));
    window.dispatchEvent(new Event('syntolk-partner-selection'));
    await screen.findByRole('link',{name:'Подготовить пост, задача 1'});
    expect(screen.getByRole('link',{name:'Подготовить пост, задача 1'}).getAttribute('href')).toContain('scenarioId=b');
    expect(screen.getByText('Подготовить пост')).toBeTruthy();
    expect(screen.queryByText('Снять ролик')).toBeNull();
    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link',{name:'Открыть задачи дня →'})).toBeNull();
    expect(vi.mocked(api).mock.calls.filter(([path])=>path.includes('/analytics?')).every(([path])=>!path.includes('scenarioId='))).toBe(true);
  });
  it('applies custom dates together and never requests a half-edited range',async()=>{
    mockReport();show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('heading',{name:'Эффективность площадок'});
    pickPeriod('Свои даты');
    const calendar=await screen.findByRole('dialog',{name:'Даты аналитики'});
    await waitFor(()=>expect(screen.queryByText('Обновляем статистику…')).toBeNull());
    const calls=vi.mocked(api).mock.calls.length;
    fireEvent.change(within(calendar).getByLabelText('Даты аналитики: начало'),{target:{value:'2026-10-01'}});
    fireEvent.change(within(calendar).getByLabelText('Даты аналитики: конец'),{target:{value:'2026-10-14'}});
    expect(vi.mocked(api).mock.calls).toHaveLength(calls);
    fireEvent.click(within(calendar).getByRole('button',{name:'Применить'}));
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('period=custom')&&path.includes('from=2026-10-01')&&path.includes('to=2026-10-14'))).toBe(true));
  });
});

describe('redesigned Results',()=>{
  it.each([
    ['platform','Площадки','YouTube','youtube','ВКонтакте','vk'],
    ['scenario','Сценарии','Рилсы','a','Посты','b'],
    ['format','Форматы','Короткие видео','short','Статьи','article'],
  ])('matches every metric card to the %s comparison and preserves scope when drilling down',async(by,title,name,id,emptyName,emptyId)=>{
    const period={since:'2026-10-01T21:00:00.000Z',until:'2026-10-08T12:00:00.000Z'};
    const row={...result.rows[0],id,name};
    const empty={...row,id:emptyId,name:emptyName,counts:{clicks:0,registrations:0,payingCustomers:0,paymentCount:0,firstPaymentCount:0,repeatPaymentCount:0},amountsMinor:{observedPayments:0,refunds:0,netPayments:0,netAccrued:0}};
    const material={...row,id:'material',name:'Статья о Syntolk'};
    const point={date:'2026-10-02',clicks:10,registrations:2,payingCustomers:1,payments:1,customerPaymentsMinor:100000,earningsMinor:20000};
    const series={bucket:'day',points:[point],groups:[{id,name,points:[point]},{id:emptyId,name:emptyName,points:[{...point,clicks:0,registrations:0,payingCustomers:0,payments:0,customerPaymentsMinor:0,earningsMinor:0}]}]};
    vi.mocked(api).mockImplementation(async path=>{
      if(path==='/me/programs')return {programs:[{id:'p',name:'Syntolk'}]};
      const query=new URL(path,'http://local').searchParams;
      return {...result,period,series,rows:query.has('since')?query.get('groupBy')===by?[row,empty]:[material]:result.rows};
    });
    show(<PartnerAnalyticsPanel partnerId="partner"/>,`/results?chartBy=${by}&period=7d&groupBy=link&scenarioIds=a&scenarioIds=b&platformIds=youtube&platformIds=vk&formatIds=short&formatIds=article`);
    for(const metric of ['Переходы','Регистрации','Платящие клиенты','Оплаты','Оплачено клиентами','Ваш заработок']){
      const card=await screen.findByRole('article',{name:metric}),value=card.querySelector('.results-metric-card__value')?.textContent;
      fireEvent.click(within(card).getByRole('button',{name:`Подробнее: ${metric}`}));
      const dialog=await screen.findByRole('dialog',{name:metric});
      await within(dialog).findByRole('button',{name});
      expect(within(dialog).getByRole('heading',{name:title})).toBeTruthy();
      expect(within(dialog).queryByRole('heading',{name:'Материалы'})).toBeNull();
      expect(within(dialog).getByRole('button',{name:emptyName})).toBeTruthy();
      expect(dialog.querySelector('.results-explorer__plot-heading strong')?.textContent).toBe(value);
      fireEvent.click(within(dialog).getByRole('button',{name:'Закрыть график'}));
      await waitFor(()=>expect(screen.queryByRole('dialog',{name:metric})).toBeNull());
    }
    fireEvent.click(screen.getByRole('button',{name:'Подробнее: Регистрации'}));
    const dialog=await screen.findByRole('dialog',{name:'Регистрации'});
    fireEvent.click(await within(dialog).findByRole('button',{name}));
    await within(dialog).findByRole('button',{name:material.name});
    expect(within(dialog).getByRole('heading',{name:'Материалы'})).toBeTruthy();
    const scoped=vi.mocked(api).mock.calls.map(([path])=>new URL(path,'http://local').searchParams).find(query=>query.get('groupBy')==='material'&&query.get(`${by}Id`)===id)!;
    expect(scoped).toBeTruthy();expect(scoped.getAll(`${by}Ids`)).toEqual([]);
    expect(scoped.get('since')).toBe(period.since);expect(scoped.get('until')).toBe(period.until);
    for(const dimension of ['scenario','platform','format'].filter(item=>item!==by))expect(scoped.getAll(`${dimension}Ids`)).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button',{name:'Закрыть подробности'}));
    await within(dialog).findByRole('heading',{name:title});
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('retains the previous-period value when a compared metric card opens',async()=>{
    const comparison={period:{since:'2026-09-01T21:00:00.000Z',until:'2026-09-30T21:00:00.000Z'},counts:{...counts,clicks:5},amountsMinor};
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:new URL(path,'http://local').searchParams.get('from')==='2026-09-02'?{...result,period:comparison.period,counts:comparison.counts}:{...result,period:{since:'2026-09-30T21:00:00.000Z',until:'2026-10-17T12:00:00.000Z'},comparison});
    show(<PartnerAnalyticsPanel partnerId="partner"/>,'/results?compare=true&compareFrom=2026-09-02&compareTo=2026-09-30');
    fireEvent.click(await screen.findByRole('button',{name:'Подробнее: Переходы'}));
    const dialog=await screen.findByRole('dialog',{name:'Переходы'});
    const previous=await within(dialog).findByRole('region',{name:'Период сравнения'});
    await waitFor(()=>expect(previous.querySelector('.results-explorer__plot-heading strong')?.textContent).toBe('5'));
    expect(vi.mocked(api).mock.calls.some(([path])=>{const query=new URL(path,'http://local').searchParams;return query.get('from')==='2026-09-02'&&query.get('to')==='2026-09-30';})).toBe(true);
  });
  it('opens a chart date with its exact bounds and retains every report filter through material and placement drilldown',async()=>{
    const point={date:'2026-10-01',since:'2026-09-30T21:00:00.000Z',until:'2026-10-01T21:00:00.000Z',clicks:2,registrations:1,payments:0,earningsMinor:0};
    const dayCounts={...counts,clicks:2,registrations:1,payingCustomers:0,paymentCount:0};
    const material={id:'material',name:'Как работает Syntolk',archived:false,counts:dayCounts,amountsMinor,platformNames:['YouTube'],material:{id:'material',programId:'p',formatName:'Статья',scheduledDay:null,scenarioName:'Рилсы',published:1,placements:1}};
    const placement={id:'placement',name:'YouTube · мой канал',archived:false,counts:dayCounts,amountsMinor};
    vi.mocked(api).mockImplementation(async path=>{
      if(path==='/me/programs')return {programs:[{id:'p',name:'Syntolk'}]};
      const query=new URL(path,'http://local').searchParams;
      if(query.has('since'))return {...result,counts:dayCounts,rows:query.get('groupBy')==='material'?[material]:[placement]};
      return {...result,period:{since:'2026-09-30T21:00:00.000Z',until:'2026-10-16T21:00:00.000Z'},series:{bucket:'day',points:[point]}};
    });
    show(<PartnerAnalyticsPanel partnerId="partner"/>,'/results?programId=p&scenarioIds=a&scenarioIds=b&platformIds=youtube&platformIds=vk&formatIds=short');
    const chart=await screen.findByRole('group',{name:/Переходы, по дням/});chart.focus();fireEvent.focus(chart);fireEvent.keyDown(chart,{key:'Enter'});
    const dialog=await screen.findByRole('dialog',{name:'Переходы'});
    const item=await within(dialog).findByRole('button',{name:material.name});
    expect(dialog.querySelector('.results-drill-total>strong')?.textContent).toBe('2');
    fireEvent.click(item);await within(dialog).findByRole('button',{name:placement.name});
    fireEvent.click(within(dialog).getByRole('button',{name:placement.name}));
    expect(within(dialog).getByRole('heading',{name:placement.name})).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button',{name:/Назад/}));
    expect(within(dialog).getByRole('heading',{name:material.name})).toBeTruthy();
    const details=vi.mocked(api).mock.calls.filter(([path])=>new URL(path,'http://local').searchParams.has('since'));
    expect(details.length).toBeGreaterThanOrEqual(2);
    for(const [path] of details){const query=new URL(path,'http://local').searchParams;expect(query.get('since')).toBe(point.since);expect(query.get('until')).toBe(point.until);expect(query.getAll('scenarioIds')).toEqual(['a','b']);expect(query.getAll('platformIds')).toEqual(['youtube','vk']);expect(query.getAll('formatIds')).toEqual(['short']);expect(query.get('programId')).toBe('p');}
    fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(chart);
    expect(screen.getByLabelText('Адрес').textContent).not.toContain('materialId=');
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('opens the clicked comparison series instead of the union of selected platforms',async()=>{
    const point={date:'2026-10-01',since:'2026-09-30T21:00:00.000Z',until:'2026-10-01T21:00:00.000Z',clicks:10,registrations:2,payments:1,earningsMinor:20000};
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:{...result,series:{bucket:'day',points:[point],groups:[{id:'youtube',name:'YouTube',points:[{...point,clicks:3}]},{id:'vk',name:'ВКонтакте',points:[{...point,clicks:7}]}]}});
    show(<PartnerAnalyticsPanel partnerId="partner"/>,'/results?chartBy=platform&platformIds=youtube&platformIds=vk&scenarioIds=a&formatIds=short');
    const chart=await screen.findByRole('group',{name:/Переходы, по дням/});fireEvent.focus(chart);
    const pointTarget=chart.querySelector('[data-series="youtube"] [data-chart-hit="0"]')!;
    fireEvent.pointerMove(pointTarget,{clientX:42});
    expect(screen.getByRole('status',{name:/Значение графика:/}).querySelector('strong')?.textContent).toBe('3');
    fireEvent.click(pointTarget);
    await screen.findByRole('dialog',{name:'Переходы'});
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>{const query=new URL(path,'http://local').searchParams;return query.get('groupBy')==='material'&&query.get('platformId')==='youtube'&&!query.has('platformIds')&&query.get('since')===point.since&&query.getAll('scenarioIds').join()==='a'&&query.getAll('formatIds').join()==='short';})).toBe(true));
  });
  it('explains a zero earnings drilldown without substituting customer payments',async()=>{
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:{...result,amountsMinor:{...amountsMinor,netAccrued:0},rows:[{...result.rows[0],amountsMinor:{...amountsMinor,netAccrued:0}}]});
    show(<PartnerAnalyticsPanel partnerId="partner"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Подробнее: Ваш заработок'}));
    const dialog=await screen.findByRole('dialog',{name:'Ваш заработок'});
    await within(dialog).findByText(/Оплаты клиентов учтены\. Начисленные комиссии с учётом возвратов — 0,00\s₽\./);
    expect(dialog.querySelector('.results-explorer__plot-heading strong')?.textContent).toContain('0,00');
    fireEvent.change(within(dialog).getByLabelText('Показатель большого графика'),{target:{value:'customerPaymentsMinor'}});
    expect(dialog.querySelector('.results-explorer__plot-heading strong')?.textContent).toMatch(/1.*000,00/);
    fireEvent.click(within(dialog).getByRole('button',{name:'Подробнее за период: Оплачено клиентами'}));
    expect(await within(dialog).findByRole('button',{name:'YouTube'})).toBeTruthy();
  });
  it('applies multiple platforms, formats and scenarios together without filtering out available choices',async()=>{
    const options={...result.options,scenarios:[{id:'a',name:'Рилсы'},{id:'b',name:'Посты'}],platforms:[{id:'youtube',name:'YouTube'},{id:'vk',name:'ВКонтакте'}],formats:[{id:'short',name:'Короткие видео'},{id:'article',name:'Статьи'}]};
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:{...result,options});
    show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('heading',{name:'Эффективность площадок'});

    await pickFilter('Площадка аналитики','Площадки',['YouTube','ВКонтакте'],'Все площадки');
    await pickFilter('Формат аналитики','Форматы',['Короткие видео','Статьи'],'Все форматы');
    await pickFilter('Сценарий аналитики','Сценарии',['Рилсы','Посты'],'Все сценарии');
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>{
      const query=new URL(path,'http://local').searchParams;
      return query.getAll('platformIds').length===2&&query.getAll('formatIds').length===2&&query.getAll('scenarioIds').length===2&&!query.has('seriesBy')&&query.get('groupBy')==='platform';
    })).toBe(true));
    expect(screen.getByLabelText('Площадка аналитики').textContent).toBe('Выбрано: 2');
    expect(screen.getByLabelText('Формат аналитики').textContent).toBe('Выбрано: 2');
    expect(screen.getByLabelText('Сценарий аналитики').textContent).toBe('Выбрано: 2');
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('cancels checkbox drafts without changing the report or closing its filters',async()=>{
    mockReport();show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('heading',{name:'Эффективность площадок'});

    fireEvent.click(screen.getByLabelText('Площадка аналитики'));
    const menu=screen.getByRole('dialog',{name:'Площадки'}),calls=vi.mocked(api).mock.calls.length;
    fireEvent.pointerDown(within(menu).getByRole('checkbox',{name:'YouTube'}));
    fireEvent.click(within(menu).getByRole('checkbox',{name:'YouTube'}));
    expect(screen.getByLabelText('Площадка аналитики')).toBeTruthy();
    fireEvent.click(within(menu).getByRole('button',{name:'Отмена'}));
    expect(screen.getByLabelText('Площадка аналитики').textContent).toBe('Все площадки');
    expect(vi.mocked(api).mock.calls).toHaveLength(calls);
  });
  it('shows every metric separately and keeps all cards open during platform comparison',async()=>{
    const point={date:'2026-10-16',clicks:10,registrations:2,payingCustomers:1,payments:1,customerPaymentsMinor:100000,earningsMinor:20000};
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:{...result,series:{bucket:'day',points:[point],groups:[{id:'youtube',name:'YouTube',points:[point]}]}});
    show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('heading',{name:'Эффективность площадок'});
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(screen.queryByRole('button',{name:'Регистрации'})).toBeNull();
    expect(screen.queryByLabelText('Показатели графиков')).toBeNull();
    fireEvent.change(screen.getByLabelText('Режим графика'),{target:{value:'platform'}});
    await screen.findByLabelText('Сравниваемые источники');
    await waitFor(()=>expect(screen.getAllByRole('article')).toHaveLength(6));
    expect(within(screen.getByRole('article',{name:'Оплачено клиентами'})).getByText(/1.*000,00/)).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Все показатели'})).toBeNull();
  });
  it('narrows platform details to that row instead of retaining the multi-selection union',async()=>{
    mockReport();show(<PartnerAnalyticsPanel partnerId="partner"/>,'/results?groupBy=platform&platformIds=youtube&platformIds=vk');
    fireEvent.click(await screen.findByRole('button',{name:'YouTube'}));
    fireEvent.click(screen.getByRole('tab',{name:'Действия'}));
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>{
      const query=new URL(path,'http://local').searchParams;
      return path.includes('/analytics/details?')&&query.get('platformId')==='youtube'&&!query.has('platformIds');
    })).toBe(true));
  });
  it('keeps source filters visible and dismisses their menus without discarding selections',async()=>{
    mockReport();show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('heading',{name:'Эффективность площадок'});
    expect(screen.queryByRole('button',{name:'Фильтры'})).toBeNull();
    await pickFilter('Площадка аналитики','Площадки',['YouTube'],'Все площадки');
    expect(screen.getByLabelText('Площадка аналитики').textContent).toBe('YouTube');
    fireEvent.click(screen.getByLabelText('Площадка аналитики'));
    fireEvent.keyDown(screen.getByRole('dialog',{name:'Площадки'}),{key:'Escape'});
    expect(screen.queryByRole('dialog',{name:'Площадки'})).toBeNull();
    expect(screen.getByLabelText('Площадка аналитики').textContent).toBe('YouTube');
  });
  it('preserves the report frame but hides stale figures while another period loads',async()=>{
    let resolveReport!:(value:typeof result)=>void;
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:path.includes('period=7d')?await new Promise<typeof result>(resolve=>{resolveReport=resolve;}):result);
    show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('heading',{name:'Эффективность площадок'});
    const chart=document.querySelector('.results-chart');
    pickPeriod('Последние 7 дней');
    await screen.findByText('Обновляем статистику…');
    expect(document.querySelector('.results-chart')).toBe(chart);
    expect(document.querySelector('.results-report__content')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.results-report__content')?.hasAttribute('inert')).toBe(true);
    expect(screen.queryByRole('table')).toBeNull();
    resolveReport({...result,counts:{...counts,clicks:4}});
    await screen.findByText('4');
    expect(document.querySelector('.results-report__content')?.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('table')).toBeTruthy();
  });
  it('requires two explicit ranges and handles a zero baseline without inventing percentages',async()=>{
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:{...result,...(path.includes('includeComparison=true')?{comparison:{period:{since:'2026-09-01T00:00:00Z',until:'2026-10-01T00:00:00Z'},counts:{...counts,clicks:5,payingCustomers:0},amountsMinor:{...amountsMinor,netAccrued:10000}}}:{})});
    show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('heading',{name:'Эффективность площадок'});
    fireEvent.click(screen.getByRole('button',{name:'Сравнить периоды'}));
    const calendar=screen.getByRole('dialog',{name:'Сравнить периоды'});
    expect(within(calendar).queryByRole('button',{name:'Предыдущий период'})).toBeNull();
    expect((within(calendar).getByRole('button',{name:'Применить'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(calendar).getByLabelText('Сравнить периоды: начало'),{target:{value:'2026-09-01'}});
    fireEvent.change(within(calendar).getByLabelText('Сравнить периоды: конец'),{target:{value:'2026-09-30'}});
    fireEvent.click(within(calendar).getByRole('button',{name:'Применить'}));
    await screen.findByText('В сравнении — 0');
    expect(screen.getAllByText(/↑ 100%/).length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
    pickPeriod('Всё время');
    await waitFor(()=>expect((screen.getByRole('button',{name:'Сравнить периоды'}) as HTMLButtonElement).disabled).toBe(false));
  });
  it('sends an explicitly selected comparison range to the report',async()=>{
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:{...result,...(path.includes('includeComparison=true')?{comparison:{period:{since:'2025-04-01T00:00:00Z',until:'2025-05-01T00:00:00Z'},counts:{...counts,clicks:0,registrations:0,payingCustomers:0,paymentCount:0},amountsMinor:{...amountsMinor,observedPayments:0,netAccrued:0}}}:{})});
    show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('heading',{name:'Эффективность площадок'});
    fireEvent.click(screen.getByRole('button',{name:'Сравнить периоды'}));
    const dialog=screen.getByRole('dialog',{name:'Сравнить периоды'});
    fireEvent.change(screen.getByLabelText('Сравнить периоды: начало'),{target:{value:'2025-04-01'}});
    fireEvent.change(screen.getByLabelText('Сравнить периоды: конец'),{target:{value:'2025-04-30'}});
    fireEvent.click(within(dialog).getByRole('button',{name:'Применить'}));
    await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).toContain('compareFrom=2025-04-01'));
    expect(screen.getByLabelText('Адрес').textContent).toContain('compareTo=2025-04-30');
    expect(screen.getByRole('button',{name:'Сравнить периоды'}).textContent).toContain('1 апр. 2025 г. — 30 апр. 2025 г.');
  });
  it('edits independent primary and comparison ranges and keeps their lengths different',async()=>{
    mockReport();show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('heading',{name:'Эффективность площадок'});
    fireEvent.click(screen.getByRole('button',{name:'Сравнить периоды'}));
    const dialog=screen.getByRole('dialog',{name:'Сравнить периоды'});
    fireEvent.change(screen.getByLabelText('Основной период: начало'),{target:{value:'2026-10-12'}});
    fireEvent.change(screen.getByLabelText('Основной период: конец'),{target:{value:'2026-10-18'}});
    fireEvent.change(screen.getByLabelText('Сравнить периоды: начало'),{target:{value:'2026-09-10'}});
    fireEvent.change(screen.getByLabelText('Сравнить периоды: конец'),{target:{value:'2026-09-12'}});
    fireEvent.click(within(dialog).getByRole('button',{name:'Применить'}));
    await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).toContain('period=custom'));
    const address=screen.getByLabelText('Адрес').textContent??'';
    expect(address).toContain('from=2026-10-12');expect(address).toContain('to=2026-10-18');
    expect(address).toContain('compareFrom=2026-09-10');expect(address).toContain('compareTo=2026-09-12');
  });
  it('sends the selected chart grouping to analytics',async()=>{
    mockReport();show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('heading',{name:'Эффективность площадок'});
    fireEvent.change(screen.getByLabelText('Шаг графика'),{target:{value:'week'}});
    await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).toContain('bucket=week'));
    expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('bucket=week'))).toBe(true);
  });
  it('shows recovery from negative earnings as an improvement',async()=>{
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:{...result,amountsMinor:{...amountsMinor,netAccrued:0},comparison:{period:{since:'2026-09-01T00:00:00Z',until:'2026-10-01T00:00:00Z'},counts,amountsMinor:{...amountsMinor,netAccrued:-10000}}});
    show(<PartnerAnalyticsPanel partnerId="partner"/>,'/results?compare=true&compareFrom=2026-09-01&compareTo=2026-09-30');
    expect(await screen.findByText(/↑ 100%/)).toBeTruthy();
  });
  it('keeps the table visible while details open in a dismissible, focus-restoring side panel',async()=>{
    mockReport();show(<PartnerAnalyticsPanel partnerId="partner"/>);
    const trigger=await screen.findByRole('button',{name:'YouTube'});trigger.focus();fireEvent.click(trigger);
    const drawer=await screen.findByRole('dialog',{name:'YouTube'});
    expect(document.body.style.overflow).toBe('hidden');
    expect(within(drawer).queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    const restoreFocus=vi.spyOn(trigger,'focus');
    fireEvent.keyDown(document,{key:'Escape'});
    expect(restoreFocus).toHaveBeenCalledWith({preventScroll:true});
    expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);expect(document.body.style.overflow).toBe('');
  });
  it('loads private-free history and audience only when requested, using the selected source scope',async()=>{
    const row={...result.rows[0],id:'source'};
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:path.includes('/analytics/details?')?{
      traffic:{referrers:[{name:'example.test',count:10}],devices:[{name:'Телефон',count:10}]},history:{items:[{id:'e:test',kind:'first_payment',ts:'2026-10-16T08:00:00Z',amountMinor:100000}],nextCursor:null},
    }:{...result,rows:[row]});
    show(<PartnerAnalyticsPanel partnerId="partner"/>,'/results?groupBy=source&platformId=youtube');
    fireEvent.click(await screen.findByRole('button',{name:'YouTube'}));
    expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('/analytics/details?'))).toBe(false);
    fireEvent.click(screen.getByRole('tab',{name:'Действия'}));
    await screen.findByText('Первая оплата');
    expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('/analytics/details?')&&path.includes('sourceId=source')&&path.includes('platformIds=youtube'))).toBe(true);
    fireEvent.click(screen.getByRole('tab',{name:'Аудитория'}));
    expect(await screen.findByText('example.test')).toBeTruthy();
    expect(screen.getByText('Телефон')).toBeTruthy();
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('shows first and repeat payment counts in the payment chart',()=>{
    show(<ResultsChart metric="payments" onChange={vi.fn()} paymentCounts={{first:1,repeat:3}} totals={{payments:4}} series={{bucket:'day',points:[{date:'2026-10-16',clicks:10,registrations:2,payments:4,firstPayments:1,repeatPayments:3,earningsMinor:20000}]}}/>);
    expect(screen.getByText('1 первых · 3 повторных')).toBeTruthy();
    expect(screen.getByRole('article',{name:'Оплаты'}).querySelector('.results-metric-card__value')?.textContent).toBe('4');
  });
  it('starts with platforms, all charts and visible source selection',async()=>{
    mockReport();show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('heading',{name:'Эффективность площадок'});
    expect(screen.getByRole('button',{name:'Период аналитики'}).textContent).toContain('Последние 30 дней');
    expect((screen.getByLabelText('Разбивка аналитики') as HTMLSelectElement).value).toBe('platform');
    expect(screen.getByLabelText('Разбивка аналитики').closest('[hidden]')).toBeNull();
    expect(screen.getByLabelText('Площадка аналитики').closest('[hidden]')).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(screen.queryByRole('button',{name:'Воронка'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Графики'})).toBeNull();
    expect(vi.mocked(api).mock.calls.every(([path])=>!path.includes('includeFunnel'))).toBe(true);
    expect((screen.getByLabelText('Сортировка результатов') as HTMLSelectElement).value).toBe('clicks');
    expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('groupBy=platform')&&path.includes('includeSeries=true'))).toBe(true);
    expect(screen.queryByRole('button',{name:/Добавить|Создать|Учесть|Редактировать/})).toBeNull();
  });
  it('keeps a late payment with zero clicks and filters only the list by activity or search',async()=>{
    const paid={...result.rows[0],id:'late',name:'Старая статья',counts:{...counts,clicks:0,registrations:0}};
    const unused={...paid,id:'empty',name:'Без действий',counts:{...counts,clicks:0,registrations:0,payingCustomers:0,paymentCount:0},amountsMinor:{observedPayments:0,refunds:0,netPayments:0,netAccrued:0}};
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:{...result,rows:path.includes('includeEmpty=true')?[...result.rows,paid,unused]:[...result.rows,paid]});
    show(<PartnerAnalyticsPanel partnerId="partner"/>);
    await screen.findByRole('button',{name:'Старая статья'});
    const totals=()=>document.querySelector('.results-chart-grid')!.textContent;
    const initial=totals();

    fireEvent.change(screen.getByLabelText('Активность таблицы'),{target:{value:'clicks'}});
    expect(screen.queryByRole('button',{name:'Старая статья'})).toBeNull();
    expect(totals()).toBe(initial);
    fireEvent.change(screen.getByLabelText('Активность таблицы'),{target:{value:'empty'}});
    await screen.findByRole('button',{name:'Без действий'});
    expect(screen.queryByRole('button',{name:'YouTube'})).toBeNull();
    expect(totals()).toBe(initial);
    fireEvent.change(screen.getByLabelText('Поиск результатов'),{target:{value:'неизвестное'}});
    expect(screen.getByText('Ничего не найдено.')).toBeTruthy();
    expect(totals()).toBe(initial);
  });
  it('distinguishes the publication address and tracking URL without making writes',async()=>{
    const row={...result.rows[0],id:'source',createdAt:'2026-10-01T12:00:00Z',placement:{materialTitle:'Статья о Syntolk',formatName:'Статья',platformName:'Дзен',channelName:'Мой канал',publicationUrl:'https://example.test/article',publishedAt:'2026-10-03T12:00:00Z',linkKey:'partner',trackingParams:{utm_content:'source'}}};
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:{...result,rows:[row]});
    show(<PartnerAnalyticsPanel partnerId="partner"/>,'/results?groupBy=source');
    fireEvent.click(await screen.findByRole('button',{name:'YouTube'}));
    expect(screen.getByRole('link',{name:/example.test\/article/}).getAttribute('href')).toBe('https://example.test/article');
    expect(screen.getByText(/\/r\/partner\?utm_content=source/)).toBeTruthy();
    expect(screen.getByText('Ссылка создана')).toBeTruthy();expect(screen.getByText('Дата публикации')).toBeTruthy();
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('does not request invalid custom dates or display invented zeros',async()=>{
    mockReport();show(<PartnerAnalyticsPanel partnerId="partner"/>,'/results?period=custom&from=2026-10-15&to=2026-10-01');
    await screen.findByText('Конец периода не может быть раньше начала.');
    expect(vi.mocked(api).mock.calls.every(([path])=>!path.includes('/analytics?'))).toBe(true);
    expect(document.querySelector('.results-chart-grid')).toBeNull();
  });
  it('keeps unique customer totals and explains payments without commission',async()=>{
    const points=['2026-10-15','2026-10-16'].map(date=>({date,clicks:5,registrations:1,payingCustomers:1,payments:2,customerPaymentsMinor:50000,earningsMinor:0}));
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:{...result,counts:{...counts,paymentCount:4,firstPaymentCount:1,repeatPaymentCount:3},amountsMinor:{...amountsMinor,netAccrued:0},series:{bucket:'day',points}});
    show(<PartnerAnalyticsPanel partnerId="partner"/>);
    const customers=await screen.findByRole('article',{name:'Платящие клиенты'});
    expect(customers.querySelector('.results-metric-card__value')?.textContent).toBe('1');
    expect(screen.getByRole('article',{name:'Оплаты'}).querySelector('.results-metric-card__value')?.textContent).toBe('4');
    expect(screen.getByText('Чистая сумма комиссий за период — 0')).toBeTruthy();
    expect(within(screen.getByRole('article',{name:'Оплачено клиентами'})).getByText(/1.*000,00/)).toBeTruthy();
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('keeps negative earnings visible below the zero baseline',()=>{
    show(<ResultsChart metric="earningsMinor" onChange={vi.fn()} series={{bucket:'day',points:[{date:'2026-10-01',clicks:0,registrations:0,payments:0,earningsMinor:10000},{date:'2026-10-02',clicks:0,registrations:0,payments:0,earningsMinor:-5000}]}}/>);
    const line=document.querySelector('.results-chart__line')!.getAttribute('d')!;
    const values=[...line.matchAll(/[ML][\d.]+,([\d.]+)/g)].map(match=>Number(match[1]));
    const baseline=Number(document.querySelector('.results-chart__grid.is-baseline')!.getAttribute('y1'));
    expect(values).toHaveLength(2);
    expect(values.every(value=>value>=10&&value<=112)).toBe(true);
    expect(values[0]).toBeLessThan(baseline);expect(values[1]).toBeGreaterThan(baseline);
    const chart=screen.getByRole('group',{name:/Ваш заработок/});
    fireEvent.focus(chart);fireEvent.keyDown(chart,{key:'End'});
    expect(screen.getByRole('status',{name:/Значение графика:/}).querySelector('strong')?.textContent).toContain('-50');
  });
  it('makes chart dates accessible by keyboard without a metric selector',()=>{
    const onChange=vi.fn();
    show(<ResultsChart metric="clicks" onChange={onChange} series={{bucket:'day',points:[{date:'2026-10-01',clicks:2,registrations:1,payments:0,earningsMinor:0},{date:'2026-10-02',clicks:8,registrations:1,payments:1,earningsMinor:20000}]}}/>);
    const chart=screen.getByRole('group',{name:/Переходы, по дням/});
    fireEvent.focus(chart);fireEvent.keyDown(chart,{key:'Home'});
    expect(screen.getByRole('status',{name:/Значение графика:/}).textContent).toContain('2');
    fireEvent.keyDown(chart,{key:'End'});expect(screen.getByRole('status',{name:/Значение графика:/}).textContent).toContain('8');
    expect(screen.queryByRole('button',{name:'Ваш заработок'})).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('keeps the inspected date visible when live statistics refresh',()=>{
    const points=[{date:'2026-10-01',clicks:2,registrations:0,payments:0,earningsMinor:0},{date:'2026-10-02',clicks:8,registrations:0,payments:0,earningsMinor:0}];
    const {rerender}=render(<ResultsChart metric="clicks" onChange={vi.fn()} series={{bucket:'day',points}}/>);
    const chart=screen.getByRole('group',{name:/Переходы, по дням/});fireEvent.focus(chart);fireEvent.keyDown(chart,{key:'Home'});
    rerender(<ResultsChart metric="clicks" onChange={vi.fn()} series={{bucket:'day',points:points.map(point=>({...point}))}}/>);
    expect(screen.getByRole('status',{name:/Значение графика:/}).querySelector('strong')?.textContent).toBe('2');
  });
  it('shows a passive value on hover, keeps bars stable and opens details only after clicking',()=>{
    const inspect=vi.fn(),points=[{date:'2026-10-01',clicks:2,registrations:0,payments:0,earningsMinor:0},{date:'2026-10-02',clicks:8,registrations:0,payments:0,earningsMinor:0}];
    render(<ResultsChart metric="clicks" onChange={vi.fn()} onInspect={inspect} series={{bucket:'day',points}}/>);
    const chart=screen.getByRole('group',{name:/Переходы, по дням/}),bar=chart.querySelector('[data-chart-hit="0"]')!;
    const before=chart.querySelector('svg')!.innerHTML;
    fireEvent.pointerMove(bar,{clientX:42});
    expect(inspect).not.toHaveBeenCalled();expect(chart.querySelector('button')).toBeNull();
    expect(screen.getByRole('status',{name:/Значение графика:/}).querySelector('strong')?.textContent).toBe('2');
    expect(chart.querySelector('svg')!.innerHTML).toBe(before);
    fireEvent.click(chart,{clientX:42});expect(inspect).not.toHaveBeenCalled();
    fireEvent.click(bar,{clientX:42});expect(inspect).toHaveBeenCalledWith(expect.objectContaining({metric:'clicks',point:points[0]}));
  });
});

describe('shared period comparison',()=>{
  it('opens the same two periods in a card and propagates edits back to the whole report',async()=>{
    const make=(from:string,to:string)=>{
      const clicks=from.startsWith('2025')?0:from.startsWith('2026-09')?3:7;
      return {...result,counts:{...counts,clicks},period:{since:`${from}T00:00:00.000Z`,until:new Date(Date.parse(to)+86400000).toISOString()},timezone:'UTC',series:{bucket:'day',points:[{date:from,clicks,registrations:2,payments:1,earningsMinor:20000}]}};
    };
    vi.mocked(api).mockImplementation(async path=>{
      if(path==='/me/programs')return {programs:[{id:'p',name:'Syntolk'}]};
      const q=new URL(path,'http://local').searchParams,report=make(q.get('from')??'2026-10-12',q.get('to')??'2026-10-18');
      return {...report,...(q.has('includeComparison')?{comparison:make(q.get('compareFrom')!,q.get('compareTo')!)}:{})};
    });
    show(<PartnerAnalyticsPanel partnerId="partner"/>,'/results?period=custom&from=2026-10-12&to=2026-10-18&compare=true&compareFrom=2026-09-10&compareTo=2026-09-12&platformIds=youtube&formatIds=short&scenarioIds=a');
    fireEvent.click(await screen.findByRole('button',{name:'Подробнее: Переходы'}));
    const dialog=await screen.findByRole('dialog',{name:'Переходы'});
    await waitFor(()=>expect(within(dialog).getByRole('region',{name:'Период сравнения'}).querySelector('strong')?.textContent).toBe('3'));
    fireEvent.click(within(dialog).getByRole('button',{name:'Период сравнения'}));
    const calendar=within(dialog).getByRole('dialog',{name:'Период сравнения'});
    for(const [label,value] of [['Основной период: начало','2026-09-10'],['Основной период: конец','2026-09-12'],['Период сравнения: начало','2025-04-01'],['Период сравнения: конец','2025-04-30']])fireEvent.change(within(calendar).getByLabelText(label!),{target:{value}});
    fireEvent.click(within(calendar).getByRole('button',{name:'Применить'}));
    await waitFor(()=>expect(within(dialog).getByRole('region',{name:'Период сравнения'}).querySelector('strong')?.textContent).toBe('0'));
    expect(within(dialog).getByRole('region',{name:'Основной период'}).querySelector('strong')?.textContent).toBe('3');
    const address=screen.getByLabelText('Адрес').textContent;
    expect(address).toContain('from=2026-09-10');expect(address).toContain('compareFrom=2025-04-01');
    expect(address).toContain('platformIds=youtube');expect(address).toContain('formatIds=short');expect(address).toContain('scenarioIds=a');
    fireEvent.click(within(dialog).getByRole('button',{name:'Закрыть график'}));
    await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Переходы'})).toBeNull());
    expect(screen.getByRole('article',{name:'Переходы'}).querySelector('.results-metric-card__value')?.textContent).toBe('3');
    expect(screen.getByRole('article',{name:'Переходы'}).querySelector('.results-metric-card__comparison b')?.textContent).toBe('0');
  });
});

describe('copy tracking from a calendar material',()=>{
  const material={id:'material',programId:'p',scenarioId:'a',title:'Мой ролик',formatId:'short',formatName:'Короткое видео',platforms:[{id:'youtube',name:'YouTube'},{id:'vk',name:'VK'}]};
  it('always tracks a specific material and reuses its placement on repeat copy',async()=>{
    const copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});
    const placements:any[]=[];
    vi.mocked(api).mockImplementation(async(path,options)=>{
      if(path.endsWith('/material-catalog'))return {formats:[],platforms:material.platforms};
      if(path.includes('/materials/'))return {material,placements};
      if(options?.method){const platformId=(options.body as {platformId:string}).platformId;const source={id:`source-${platformId}`,platformId,platformName:platformId==='youtube'?'YouTube':'VK',linkKey:'partner-key',params:{utm_campaign:'a',utm_source:platformId,utm_medium:'short',utm_content:`source-${platformId}`}};placements.push(source);return {source,params:source.params};}
      return {links:[{id:'base',linkKey:'partner-key',label:null}]};
    });
    show(<MaterialEditor partnerId="partner" materialId="material"/>,'/plan');
    const copyButtons=await screen.findAllByRole('button',{name:'Копировать ссылку'});
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
    fireEvent.click(copyButtons[0]!);
    await waitFor(()=>expect(copy).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith('/partners/partner/links/base/sources',{method:'POST',body:{scenarioId:'a',formatId:'short',platformId:'youtube',materialId:'material'}});
    expect(copy.mock.calls[0]![0]).toContain('/r/partner-key?');
    expect(screen.queryByLabelText('Отслеживать этот материал отдельно')).toBeNull();
    fireEvent.click(await screen.findByRole('button',{name:'Скопировано'}));
    await waitFor(()=>expect(copy).toHaveBeenCalledTimes(2));
    expect(copy.mock.calls[1]![0]).toBe(copy.mock.calls[0]![0]);
    expect(vi.mocked(api).mock.calls.filter(([path,options])=>path.endsWith('/sources')&&options?.method)).toHaveLength(1);
  });
  it('does not create a base link automatically',async()=>{
    vi.mocked(api).mockImplementation(async path=>path.endsWith('/material-catalog')?{formats:[],platforms:[]}:path.includes('/materials/')?{material,placements:[]}:{links:[]});show(<MaterialEditor partnerId="partner" materialId="material"/>,'/plan');
    const link=await screen.findByRole('link',{name:'Создать партнёрскую ссылку →'});
    expect(link.getAttribute('href')).toBe('/links?view=links&programId=p');
    expect(screen.queryByText('Текст, файлы и автопубликация')).toBeNull();
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('does not save an empty publication form or create a source by opening it',async()=>{
    vi.mocked(api).mockImplementation(async path=>path.endsWith('/material-catalog')?{formats:[],platforms:material.platforms}:path.includes('/materials/')?{material,placements:[]}:{links:[{id:'base',linkKey:'partner-key'}]});
    show(<MaterialEditor partnerId="partner" materialId="material"/>,'/plan');
    fireEvent.click((await screen.findAllByRole('button',{name:'Указать публикацию'}))[0]!);
    expect((screen.getByRole('button',{name:'Сохранить'}) as HTMLButtonElement).disabled).toBe(true);
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('expands only placement statistics, without any editing or publication controls',async()=>{
    const row={id:'material',name:material.title,counts:{...counts,clicks:0},amountsMinor,archived:false,material:{id:'material',programId:'p',formatName:'Короткое видео',scheduledDay:'2026-10-15',scenarioName:'Рилсы',published:0,placements:2}};
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:path.includes('groupBy=source')?{...result,rows:[{id:'source-youtube',name:'YouTube · мой канал',counts,amountsMinor}]}:{...result,rows:[row]});
    show(<PartnerAnalyticsPanel partnerId="partner"/>,'/results?groupBy=material');
    fireEvent.click(await screen.findByRole('button',{name:'Мой ролик'}));
    await screen.findByRole('button',{name:'YouTube · мой канал'});
    expect(screen.queryByLabelText('Название материала')).toBeNull();
    expect(screen.queryByRole('button',{name:/Добавить|Сохранить|Указать публикацию|Копировать ссылку|Учесть публикацию/})).toBeNull();
    expect(screen.queryByRole('checkbox',{name:/Опубликовано/})).toBeNull();
    expect(screen.queryByText('0 из 2 опубликовано',{exact:false})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Закрыть подробности'}));
    fireEvent.change(screen.getByLabelText('Активность таблицы'),{target:{value:'all'}});
    fireEvent.click(await screen.findByRole('button',{name:'Мой ролик'}));
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('groupBy=source')&&path.includes('includeEmpty=true')&&path.includes('materialId=material'))).toBe(true));
    expect(vi.mocked(api).mock.calls.every(([path,options])=>!options?.method&&!path.includes('/materials/')&&!path.includes('/material-catalog'))).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Закрыть подробности'}));
    fireEvent.change(screen.getByLabelText('Найти материал'),{target:{value:'не существует'}});
    expect(screen.queryByRole('button',{name:/Мой ролик/})).toBeNull();
    fireEvent.change(screen.getByLabelText('Разбивка аналитики'),{target:{value:'source'}});
    fireEvent.change(await screen.findByLabelText('Поиск результатов'),{target:{value:''}});
    await screen.findByRole('cell',{name:'YouTube · мой канал'});
    expect(screen.queryByText('Материал не найден.')).toBeNull();
  });
  it('does not open an editor for an empty material linked from the calendar',async()=>{
    vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk'}]}:{...result,rows:[]});
    show(<PartnerAnalyticsPanel partnerId="partner"/>,'/results?programId=p&materialId=material');
    await screen.findByText('За выбранный период нет действий.');
    expect(screen.queryByLabelText('Название материала')).toBeNull();
    expect(vi.mocked(api).mock.calls.every(([path,options])=>!options?.method&&!path.includes('/materials/'))).toBe(true);
  });
});
