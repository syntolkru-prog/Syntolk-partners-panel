// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {api} from '../api.js';
import {LinksPage} from './Links.js';
import {publicationSummary,publicationRow,publicationsCsv,type PublicationSource} from './publications-model.js';
import type {AnalyticsReport} from './PartnerAnalytics.js';
vi.mock('../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
vi.mock('./MaterialEditor.js',()=>({MaterialEditor:({materialId}:{materialId:string})=><div>Редактор {materialId}</div>}));
vi.mock('./ResultsDetails.js',()=>({dateLabel:(value:string)=>value.slice(0,10),ResultsDrawer:({row,onClose}:{row:{name:string};onClose:()=>void})=><div role="dialog" aria-label="Статистика публикации">{row.name}<button onClick={onClose}>Закрыть статистику</button></div>}));
const source=(id:string,patch:Partial<PublicationSource>={}):PublicationSource=>({id,programId:'p',linkId:'base',linkKey:'partner',materialId:'m1',materialTitle:'Видео о сервисе',scenarioId:'scenario',scenarioName:'Мой план',platformId:'youtube',platformName:'YouTube',formatId:'long',formatName:'Длинное видео',publicationUrl:'https://youtube.com/watch?v='+id,channelName:'Мой канал',publishedAt:'2026-10-02T12:00:00Z',createdAt:'2026-09-01T10:00:00Z',params:{source:id},...patch});
const inventory=[source('one'),source('two',{platformId:'vk',platformName:'ВКонтакте'}),source('three',{materialId:'m2',materialTitle:'Короткое видео о сервисе',platformId:'ytshorts',platformName:'YouTube Shorts',formatId:'short',formatName:'Короткое видео',publishedAt:'2026-09-01T12:00:00Z'}),source('draft',{materialId:'m3',materialTitle:'Неопубликованный материал',publishedAt:null,publicationUrl:null})];
const metric=(id:string,clicks:number)=>publicationRow(inventory.find(item=>item.id===id)!,{id,name:id,archived:false,counts:{clicks,registrations:clicks?1:0,payingCustomers:clicks?1:0,paymentCount:clicks?2:0,firstPaymentCount:clicks?1:0,repeatPaymentCount:clicks?1:0},amountsMinor:{observedPayments:100000,netPayments:100000,refunds:0,netAccrued:20000}});
const report=(rows=[metric('one',10),metric('three',5)]):AnalyticsReport=>({currency:'RUB',counts:{clicks:15,registrations:2,payingCustomers:2,paymentCount:4,firstPaymentCount:2,repeatPaymentCount:2},amountsMinor:{observedPayments:200000,netPayments:200000,refunds:0,netAccrued:40000},conversions:{clickToRegistration:2/15,registrationToPayment:1,clickToPayment:2/15},rows,groupBy:'source',options:{scenarios:[],platforms:[],formats:[]},timezone:'Europe/Moscow',period:{since:'2026-09-20T21:00:00Z',until:'2026-10-20T12:00:00Z'}});
let client:QueryClient;
function show(url='/links'){
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><LinksPage principal={{role:'partner',partnerId:'partner'}}/></MemoryRouter></QueryClientProvider>);
}
beforeEach(()=>{
  localStorage.clear();vi.mocked(api).mockImplementation(async path=>{
    if(path.includes('/material-catalog?'))return {formats:[{id:'post',name:'Пост'}],platforms:[{id:'vk',name:'ВКонтакте'}],scenarios:[]};
    if(path==='/me/programs')return {programs:[{id:'p',name:'Syntolk',destinationUrl:'https://syntolk.ru'}]};
    if(path.includes('/link-sources?'))return {sources:inventory};
    if(path.includes('/analytics?'))return path.includes('from=2025-04-01')?report([]):report();
    if(path.includes('/links?'))return {links:[{id:'base',linkKey:'partner',programId:'p',createdAt:'2026-09-01',label:'Закреплённая ссылка',channel:'telegram',destinationUrl:null}],archivedCount:0};
    throw new Error(path);
  });
});
afterEach(()=>{cleanup();client?.clear();vi.clearAllMocks();});
describe('publication inventory and canonical statistics',()=>{
  it('opens analytics by default and keeps creation separate from reporting',async()=>{
    show();await screen.findByRole('button',{name:'Короткое видео о сервисе'});
    expect(screen.getByRole('tab',{name:'Аналитика'}).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab',{name:'Создание'}).getAttribute('aria-selected')).toBe('false');
    expect(screen.queryByRole('region',{name:'Создание ссылки на публикацию'})).toBeNull();
    expect(screen.getByRole('button',{name:'Сравнить периоды публикаций'})).toBeTruthy();
    const totals=screen.getByLabelText('Сводная аналитика за период');
    expect(within(totals).getByText('15')).toBeTruthy();expect(within(totals).getByText('4')).toBeTruthy();
    expect(screen.getByRole('button',{name:'CSV'})).toBeTruthy();
  });
  it('preserves analytics filters and comparison when switching between creation and analytics',async()=>{
    show('/links?period=30d&compare=true&compareFrom=2025-04-01&compareTo=2025-04-30&formatId=short');
    await screen.findByRole('button',{name:'Короткое видео о сервисе'});
    fireEvent.click(screen.getByRole('tab',{name:'Создание'}));
    await screen.findByRole('region',{name:'Создание ссылки на публикацию'});
    expect(screen.queryByRole('button',{name:'Сравнить периоды публикаций'})).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('tab',{name:'Аналитика'}));
    await screen.findByRole('button',{name:'Короткое видео о сервисе'});
    expect((screen.getByLabelText('Формат публикаций') as HTMLSelectElement).value).toBe('short');
    expect(screen.getByText(/Сравниваем/).textContent).toContain('2025-04-01');
    expect(screen.getByRole('button',{name:'Сбросить сравнение'})).toBeTruthy();
  });
  it('allows creation independently of invalid report dates and switches link types without creating records',async()=>{
    show('/links?section=create&period=custom&from=2026-10-20&to=2026-10-01');
    await screen.findByRole('region',{name:'Создание ссылки на публикацию'});
    expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('/analytics?'))).toBe(false);
    expect(screen.queryByText('Укажите корректные даты результатов.')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:/^Партнёрская ссылка/}));
    await screen.findByRole('region',{name:'Создание партнёрской ссылки'});
    expect(screen.queryByRole('region',{name:'Создание ссылки на публикацию'})).toBeNull();
    expect(vi.mocked(api).mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
  });
  it('opens the standalone creator from the home deep link without creating records',async()=>{
    show('/links?view=publications&create=publication');
    await screen.findByRole('region',{name:'Создание ссылки на публикацию'});
    await within(screen.getByRole('combobox',{name:'Площадка новой публикации'})).findByRole('option',{name:'ВКонтакте'});
    expect(screen.getByLabelText('Название материала')).toBeTruthy();
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method||options.method==='GET')).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Закрыть создание публикации'}));
    expect(screen.queryByRole('region',{name:'Создание ссылки на публикацию'})).toBeNull();
    expect(screen.getByRole('heading',{name:'Публикации и ссылки'})).toBeTruthy();
  });
  it('opens the permanent link form from the home deep link',async()=>{
    show('/links?view=links&create=partner');
    await screen.findByPlaceholderText('partner-ada');
    expect(screen.getByRole('button',{name:'Создать ссылку'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Отмена'}));
    expect(screen.queryByPlaceholderText('partner-ada')).toBeNull();
  });
  it('shows a newly prepared standalone link in the report rather than hiding it behind published-only filters',async()=>{
    const original=vi.mocked(api).getMockImplementation()!;let saved=false;
    const added=source('new-source',{materialId:'new-material',materialTitle:'Новая самостоятельная публикация',publishedAt:null,publicationUrl:null,scenarioId:null,scenarioName:null,platformId:'vk',platformName:'ВКонтакте'});
    vi.mocked(api).mockImplementation(async(path,options)=>{
      if(path.endsWith('/publications')&&options?.method==='POST'){saved=true;return {material:{id:'new-material'},source:added,params:added.params,linkKey:'partner'};}
      if(path.includes('/link-sources?')&&saved)return {sources:[added,...inventory]};
      return original(path,options);
    });
    show('/links?view=publications&create=publication');
    await within(await screen.findByRole('combobox',{name:'Площадка новой публикации'})).findByRole('option',{name:'ВКонтакте'});
    fireEvent.change(screen.getByLabelText('Название материала'),{target:{value:added.materialTitle}});
    fireEvent.change(screen.getByRole('combobox',{name:'Площадка новой публикации'}),{target:{value:'vk'}});
    fireEvent.click(screen.getByRole('button',{name:'Создать отслеживаемую ссылку'}));
    await screen.findByRole('heading',{name:'Ссылка готова'});
    expect(screen.queryByLabelText('Статус публикаций')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Перейти к отчёту'}));
    await screen.findByLabelText('Статус публикаций');
    expect((screen.getByRole('combobox',{name:'Статус публикаций'}) as HTMLSelectElement).value).toBe('draft');
    await screen.findByRole('button',{name:added.materialTitle!});
    expect(vi.mocked(api).mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(1);
  });
  it('creates a general partner link without forcing a first-time user to invent a technical key',async()=>{
    const original=vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async(path,options)=>options?.method==='POST'?{id:'new-link'}:original(path,options));
    show('/links?view=links&create=partner');
    await screen.findByPlaceholderText('partner-ada');
    await waitFor(()=>expect((screen.getByRole('button',{name:'Создать ссылку'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'Создать ссылку'}));
    await waitFor(()=>expect(screen.queryByPlaceholderText('partner-ada')).toBeNull());
    const body=vi.mocked(api).mock.calls.find(([,options])=>options?.method==='POST')?.[1]?.body;
    expect(body).toMatchObject({programId:'p',linkKey:expect.stringMatching(/^partner-[a-f0-9]{16}$/)});
  });
  it('counts one material only once across platforms and does not count prepared links as published',()=>{
    const summary=publicationSummary(inventory);expect(summary.published).toBe(3);expect(summary.materials).toBe(2);expect(summary.platforms).toBe(3);
    expect(summary.formats.find(row=>row.id==='long')?.placements).toBe(2);expect(summary.formats.find(row=>row.id==='long')?.materials.size).toBe(1);
    expect(publicationSummary(inventory,true).published).toBe(1);
  });
  it('shows published content, custom platforms and exact per-placement metrics by default',async()=>{
    show();await screen.findByRole('button',{name:'Короткое видео о сервисе'});await waitFor(()=>expect((screen.getAllByRole('button',{name:'Статистика: Видео о сервисе'})[0] as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('heading',{name:'Публикации и ссылки'})).toBeTruthy();expect(screen.queryByText('Неопубликованный материал')).toBeNull();
    expect(screen.getByText('Результаты за период')).toBeTruthy();expect(screen.getByRole('button',{name:'Результаты за период'})).toBeTruthy();
    expect(screen.getByRole('combobox',{name:'Когда опубликовано'})).toBeTruthy();
    const summaries=screen.getByLabelText('Количество публикаций');expect(within(summaries).getAllByText('3')).toHaveLength(2);expect(within(summaries).getByText('2')).toBeTruthy();
    const row=screen.getAllByRole('button',{name:'Видео о сервисе'})[0]!.closest('tr')!;expect(within(row).getByText('10')).toBeTruthy();
  });
  it('filters by platform, format, search and publication status without inventing publications',async()=>{
    show();await screen.findByRole('button',{name:'Короткое видео о сервисе'});
    fireEvent.change(screen.getByLabelText('Площадка публикаций'),{target:{value:'ytshorts'}});expect(screen.queryByRole('button',{name:'Видео о сервисе'})).toBeNull();expect(screen.getByRole('button',{name:'Короткое видео о сервисе'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Сбросить отбор'}));fireEvent.change(screen.getByLabelText('Статус публикаций'),{target:{value:'draft'}});expect(screen.getByRole('button',{name:'Неопубликованный материал'})).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Поиск публикаций'),{target:{value:'нет такого'}});expect(screen.getByText('По выбранному отбору публикаций нет')).toBeTruthy();
  });
  it('keeps old publications with current results until publication-date filtering is explicitly enabled',async()=>{
    show();await screen.findByRole('button',{name:'Короткое видео о сервисе'});await waitFor(()=>expect(screen.getAllByText('5').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('Когда опубликовано'),{target:{value:'period'}});expect(screen.queryByRole('button',{name:'Короткое видео о сервисе'})).toBeNull();expect(screen.getAllByRole('button',{name:'Видео о сервисе'})).toHaveLength(2);
  });
  it('opens both publication and tracking URLs with the source parameters, and reuses material editing and statistics',async()=>{
    show();await screen.findByRole('button',{name:'Короткое видео о сервисе'});fireEvent.click(screen.getAllByRole('button',{name:'Видео о сервисе'})[0]!);
    expect(screen.getByText(/source=one/)).toBeTruthy();expect(screen.getByRole('link',{name:'https://youtube.com/watch?v=one'}).getAttribute('href')).toBe('https://youtube.com/watch?v=one');
    fireEvent.click(screen.getByRole('button',{name:'Материал и его размещения'}));expect(screen.getByText('Редактор m1')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button',{name:'Статистика: Видео о сервисе'})[0]!);expect(screen.getByRole('dialog',{name:'Статистика публикации'})).toBeTruthy();
  });
  it('compares independent dates per row and shows zero for an empty historical period, not current values',async()=>{
    show('/links?period=30d&compare=true&compareFrom=2025-04-01&compareTo=2025-04-30');await screen.findByRole('button',{name:'Короткое видео о сервисе'});
    await waitFor(()=>expect(screen.getAllByText(/было 0/).length).toBeGreaterThan(0));
    expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('period=custom')&&path.includes('from=2025-04-01')&&path.includes('to=2025-04-30'))).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Сбросить сравнение'}));await waitFor(()=>expect(screen.queryByText(/В каждой строке/)).toBeNull());
  });
  it('retains the original permanent-link creation flow and adds its own link statistics',async()=>{
    show('/links?view=links');await screen.findByText('Закреплённая ссылка');expect(screen.getAllByRole('button',{name:'Создать ссылку'})).toHaveLength(1);
    fireEvent.click(screen.getByRole('button',{name:'Создать ссылку'}));expect(screen.getByPlaceholderText('partner-ada')).toBeTruthy();
    expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('groupBy=link'))).toBe(true);expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('/link-sources?'))).toBe(false);
  });
  it('paginates a large inventory and resets to the first page when the selection changes',async()=>{
    const original=vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async(path,...args)=>path.includes('/link-sources?')?{sources:Array.from({length:26},(_,index)=>source(`publication-${index}`,{materialTitle:`Материал ${index}`,materialId:`m-${index}`}))}:original(path,...args));
    show();await screen.findByText('26 размещений · страница 1 из 2');
    fireEvent.click(screen.getByRole('button',{name:'Следующая страница публикаций'}));
    expect(screen.getByText('26 размещений · страница 2 из 2')).toBeTruthy();expect(screen.getAllByRole('button',{name:/^Материал \d+$/})).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Поиск публикаций'),{target:{value:'Материал 0'}});
    expect(screen.getByText('1 размещений · страница 1 из 1')).toBeTruthy();expect(screen.getByRole('button',{name:'Материал 0'})).toBeTruthy();
  });
  it('does not mistake a failed inventory request for an empty publication history',async()=>{
    const original=vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async(path,...args)=>{if(path.includes('/link-sources?'))throw new Error('Временно недоступно');return original(path,...args);});
    show();await screen.findByText('Не удалось загрузить список публикаций. Повторите обновление.');
    expect(screen.queryByText('Размещения пока не созданы')).toBeNull();
  });
  it('does not request statistics for an invalid custom date range',async()=>{
    show('/links?period=custom&from=2026-10-20&to=2026-10-01');await screen.findByText('Выберите начало и конец периода результатов.');
    expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('/analytics?'))).toBe(false);
  });
  it('creates permanent links in the currently selected program instead of silently choosing the first program',async()=>{
    const original=vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async(path,...args)=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk',destinationUrl:'https://syntolk.ru'},{id:'second',name:'Другая программа',destinationUrl:'https://syntolk.ru/second'}]}:original(path,...args));
    show('/links?view=links&programId=second');await screen.findByText('Закреплённая ссылка');
    fireEvent.click(screen.getByRole('button',{name:'Создать ссылку'}));
    expect((screen.getByRole('combobox',{name:'Программа партнёрской ссылки'}) as HTMLSelectElement).value).toBe('second');
  });
  it('exports both periods, publication and tracking URLs and protects CSV formula cells',()=>{
    const csv=publicationsCsv([source('one',{materialTitle:'=HYPERLINK("x")'})],report(),report([]));
    expect(csv).toContain('Дата публикации');expect(csv).toContain('https://youtube.com/watch?v=one');expect(csv).toContain('source=one');expect(csv).toContain("'=HYPERLINK");expect(csv).toContain('Переходы: сравнение');
  });
});
