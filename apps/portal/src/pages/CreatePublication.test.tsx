// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {api,ApiError} from '../api.js';
import {CreatePublication} from './CreatePublication.js';
import {PartnerQuickActions} from './PartnerQuickActions.js';
vi.mock('../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null,ApiError:class extends Error{constructor(public status:number,message:string){super(message);}}}));
const created={material:{id:'new-material'},source:{id:'source',publishedAt:null},linkKey:'base',params:{utm_content:'source',utm_source:'vk',utm_medium:'post',utm_campaign:'__none__'}};
let client:QueryClient;
const completed=vi.fn(),closed=vi.fn();
function show(){client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><MemoryRouter><CreatePublication partnerId="partner" programId="program" onClose={closed} onCreated={completed}/></MemoryRouter></QueryClientProvider>);}
const posts=()=>vi.mocked(api).mock.calls.filter(([,options])=>options?.method==='POST');
async function fill(){await screen.findByRole('option',{name:'ВКонтакте'});fireEvent.change(screen.getByLabelText('Название материала'),{target:{value:'Мой пост'}});fireEvent.change(screen.getByRole('combobox',{name:'Площадка новой публикации'}),{target:{value:'vk'}});}
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();vi.mocked(api).mockImplementation(async(path,options)=>{
  if(path.includes('/material-catalog?'))return {formats:[{id:'post',name:'Пост'},{id:'short',name:'Короткое видео'}],platforms:[{id:'vk',name:'ВКонтакте'}],scenarios:[{id:'own',name:'Сохранённый сценарий'}]};
  if(path.includes('/links?'))return {links:[]};
  if(path.endsWith('/publications')&&options?.method==='POST')return created;
  throw new Error(path);
});});
afterEach(()=>{cleanup();client?.clear();});
describe('standalone publication creator',()=>{
  it('does not create records on open and never requests calculator onboarding',async()=>{
    show();await screen.findByRole('option',{name:'ВКонтакте'});expect(posts()).toHaveLength(0);
    expect(vi.mocked(api).mock.calls.every(([path])=>!path.includes('/coach/'))).toBe(true);
    expect((screen.getByRole('button',{name:'Создать отслеживаемую ссылку'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('creates one standalone tracked material and exposes a copyable URL',async()=>{
    localStorage.setItem('syntolk-partner-selection:default:partner',JSON.stringify({programId:'program',scenarioId:'some-active-scenario'}));
    show();await fill();fireEvent.click(screen.getByRole('button',{name:'Создать отслеживаемую ссылку'}));
    await screen.findByRole('heading',{name:'Ссылка готова'});expect(posts()).toHaveLength(1);
    expect(posts()[0]![1]?.body).toMatchObject({title:'Мой пост',programId:'program',formatId:'post',scenarioId:null,published:false,platform:{id:'vk',name:'ВКонтакте'}});
    expect((screen.getByLabelText('Готовая ссылка публикации') as HTMLInputElement).value).toContain('utm_content=source');expect(completed).toHaveBeenCalledWith(created);
    fireEvent.click(screen.getByRole('button',{name:'Перейти к отчёту'}));expect(closed).toHaveBeenCalledTimes(1);
  });
  it('only binds a scenario and publication status when explicitly selected',async()=>{
    show();await fill();fireEvent.change(screen.getByRole('combobox',{name:'Сценарий новой публикации'}),{target:{value:'own'}});
    fireEvent.click(screen.getByRole('checkbox',{name:'Материал уже опубликован'}));
    fireEvent.click(screen.getByRole('button',{name:'Создать отслеживаемую ссылку'}));await screen.findByRole('heading',{name:'Ссылка готова'});
    expect(posts()[0]![1]?.body).toMatchObject({scenarioId:'own',published:true});
  });
  it('supports a new platform without requiring any calculator scenario',async()=>{
    show();await fill();fireEvent.change(screen.getByRole('combobox',{name:'Площадка новой публикации'}),{target:{value:'__custom__'}});
    fireEvent.change(screen.getByLabelText('Название площадки'),{target:{value:'Мой форум'}});
    fireEvent.click(screen.getByRole('button',{name:'Создать отслеживаемую ссылку'}));await screen.findByRole('heading',{name:'Ссылка готова'});
    expect(posts()[0]![1]?.body).toMatchObject({platform:{id:expect.stringMatching(/^custom-/),name:'Мой форум'},scenarioId:null});
  });
  it('blocks a double submit and retries an ambiguous failure with the same request id',async()=>{
    const original=vi.mocked(api).getMockImplementation()!;let attempts=0;
    vi.mocked(api).mockImplementation(async(path,options)=>{if(options?.method==='POST'&&++attempts===1)throw new Error('Соединение прервано');return original(path,options);});
    show();await fill();fireEvent.click(screen.getByRole('button',{name:'Создать отслеживаемую ссылку'}));await screen.findByText('Соединение прервано');
    fireEvent.click(screen.getByRole('button',{name:'Создать отслеживаемую ссылку'}));await screen.findByRole('heading',{name:'Ссылка готова'});
    expect(posts()).toHaveLength(2);expect(posts()[0]![1]?.body).toEqual(posts()[1]![1]?.body);
  });
  it('allows field correction after a rejected request',async()=>{
    const original=vi.mocked(api).getMockImplementation()!;let attempts=0;
    vi.mocked(api).mockImplementation(async(path,options)=>{if(options?.method==='POST'&&++attempts===1)throw new ApiError(422,'Проверьте название');return original(path,options);});
    show();await fill();fireEvent.click(screen.getByRole('button',{name:'Создать отслеживаемую ссылку'}));await screen.findByText('Проверьте название');
    fireEvent.change(screen.getByLabelText('Название материала'),{target:{value:'Исправленный пост'}});
    fireEvent.click(screen.getByRole('button',{name:'Создать отслеживаемую ссылку'}));await screen.findByRole('heading',{name:'Ссылка готова'});
    expect(posts()[1]![1]?.body).toMatchObject({title:'Исправленный пост'});
  });
  it('links the three home actions to independent creation flows',()=>{
    render(<MemoryRouter><PartnerQuickActions/></MemoryRouter>);
    expect(screen.getByRole('link',{name:/Создать сценарий работ/}).getAttribute('href')).toBe('/calculator?scenarioId=new');
    expect(screen.getByRole('link',{name:/Создать партнёрскую ссылку/}).getAttribute('href')).toBe('/links?section=create&view=links&create=partner');
    expect(screen.getByRole('link',{name:/Создать ссылку на публикацию/}).getAttribute('href')).toBe('/links?section=create&view=publications&create=publication');
  });
});
