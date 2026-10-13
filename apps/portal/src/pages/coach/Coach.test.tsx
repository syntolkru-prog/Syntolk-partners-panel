// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {CoachPage} from './Coach.js';
import {api} from '../../api.js';
import {MemoryRouter} from 'react-router-dom';
vi.mock('../../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
let client:QueryClient;
beforeEach(()=>{client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});vi.mocked(api).mockImplementation(async(path,options)=>{if(!options?.method||options.method==='GET'){const name=path==='/coach/me'?'me':path.split('/').at(-1);return client.getQueryData(['coach',null,'p','/coach/me',name])??{};}return {};});});
afterEach(()=>{cleanup();client.clear();vi.clearAllMocks();});
function partner(enabled=true,runRows:unknown[]=[],complete=false){const key=['coach',null,'p','/coach/me'];client.setQueryData([...key,'me'],{enabled,profile:complete?{status:'complete',version:1,data:{goalMinor:3000000,weeklyMinutes:120,channels:[]}}:null,label:'Демонстрационный режим — ответы по шаблонам',provider:'template',configured:true,takeover:false,programs:[{id:'program',name:'Syntolk 20%'}]});for(const [name,value] of Object.entries({plans:{plans:[]},tasks:{tasks:[],routerOrigin:'http://localhost:5673'},messages:{messages:[]},reviews:{reviews:[]},notifications:{notifications:[]},runs:{runs:runRows}}))client.setQueryData([...key,name],value);render(<MemoryRouter><QueryClientProvider client={client}><CoachPage principal={{role:'partner',partnerId:'p'}}/></QueryClientProvider></MemoryRouter>);}
describe('partner coach UI',()=>{
  it('clearly labels the demo and offers onboarding',()=>{partner();expect(screen.getByText('Демонстрационный режим — ответы по шаблонам')).toBeTruthy();expect(screen.getByRole('button',{name:'Пройти знакомство'})).toBeTruthy();});
  it('does not render enabled actions when module is off',()=>{partner(false);expect(screen.getByText(/ИИ-куратор отключён/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Подготовить новый план'})).toBeNull();});
  it('disables accepting stale drafts and replacing unfinished work before a server error',async()=>{
    partner(true,[],true);
    const key=['coach',null,'p','/coach/me'];
    client.setQueryData([...key,'plans'],{plans:[{id:'old',programId:'program',status:'draft',version:1,data:{profileVersion:0,plannedMinutes:20,tasks:[],message:'Устаревший'}},{id:'current',programId:'program',status:'draft',version:1,data:{profileVersion:1,plannedMinutes:20,tasks:[],message:'Актуальный'}}]});
    await waitFor(()=>expect(screen.getAllByRole('button',{name:'Принять этот план'})).toHaveLength(2));
    expect((screen.getAllByRole('button',{name:'Принять этот план'})[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByRole('button',{name:'Принять этот план'})[1] as HTMLButtonElement).disabled).toBe(false);
    client.setQueryData([...key,'tasks'],{tasks:[{id:'task',programId:'program',status:'in_progress',data:{title:'Текущая работа',steps:[]},placement:null}],policy:{preventPlanReplacement:true}});
    await waitFor(()=>expect(screen.getAllByRole('button',{name:'Принять этот план'}).every(button=>(button as HTMLButtonElement).disabled)).toBe(true));
    expect(screen.getByText(/Анкета изменилась после подготовки/)).toBeTruthy();
  });
  it('does not present an old failed run as the latest result after successful retry',()=>{
    partner(true,[{id:'new',status:'completed',data:{}},{id:'old',status:'failed',data:{error:{message:'Старая ошибка плана'}}}]);
    expect(screen.queryByText('Старая ошибка плана')).toBeNull();
  });
  it('keeps the message draft when sending fails',async()=>{partner(true,[],true);fireEvent.click(screen.getByRole('button',{name:/^Чат$/}));const box=screen.getByPlaceholderText('Помоги с идеей поста или сценарием кружочка');fireEvent.change(box,{target:{value:'Мой несохранённый текст'}});vi.mocked(api).mockRejectedValue(new Error('Тестовая ошибка отправки'));fireEvent.click(screen.getByRole('button',{name:/^Отправить$/}));await waitFor(()=>expect(screen.getByText('Тестовая ошибка отправки')).toBeTruthy());expect((box as HTMLTextAreaElement).value).toBe('Мой несохранённый текст');});
  it('saves onboarding without a partner AI consent gate and keeps notifications separate',async()=>{
    partner();fireEvent.click(screen.getByRole('button',{name:'Пройти знакомство'}));expect(screen.queryByText(/ИИ-провайдеру/)).toBeNull();expect(screen.getByText('Личные уведомления и режим сопровождения')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Подтвердить знакомство'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/coach/me/profile',expect.objectContaining({method:'PATCH',body:expect.objectContaining({complete:true,version:0,profile:expect.objectContaining({proactiveConsent:false,aiConsent:false,sessionMinutes:30})})})));
  });
  it('keeps an edited profile draft and its applied version when the background me query refreshes',async()=>{
    partner(true,[],true);fireEvent.click(screen.getByRole('button',{name:'Знакомство и настройки'}));
    const goal=screen.getByLabelText('Желаемый доход в месяц, ₽') as HTMLInputElement;
    fireEvent.change(goal,{target:{value:'40000'}});
    const key=['coach',null,'p','/coach/me'];
    client.setQueryData([...key,'me'],{enabled:true,profile:{status:'complete',version:2,data:{goalMinor:9900000,weeklyMinutes:120,channels:[]}},label:'Демонстрационный режим — ответы по шаблонам',provider:'template',configured:true,takeover:false,programs:[{id:'program',name:'Syntolk 20%'}]});
    await waitFor(()=>expect(goal.value).toBe('40000'));
    fireEvent.click(screen.getByRole('button',{name:'Подтвердить знакомство'}));
    await waitFor(()=>expect(api).toHaveBeenLastCalledWith('/coach/me/profile',expect.objectContaining({method:'PATCH',body:expect.objectContaining({version:1})})));
  });
  it('sends only the strict settings contract, not internal takeover list',async()=>{
    const overview={settings:{enabled:false,provider:'template',dailyRuns:20,takeover:['p']},provider:{label:'Демонстрационный',configured:true},partners:[],runs:[],reviews:[],audit:[]};
    client.setQueryData(['coach-admin',null],overview);vi.mocked(api).mockImplementation(async path=>path==='/admin/coach/overview'?overview:{ok:true} as never);
    render(<QueryClientProvider client={client}><CoachPage principal={{role:'admin'}}/></QueryClientProvider>);fireEvent.click(screen.getByRole('button',{name:'Включить локальный модуль'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/admin/coach/settings',{method:'PATCH',body:{enabled:true,provider:'template',dailyRuns:20}}));
  });
  it('resolves a profile version conflict without losing the edited fields',async()=>{
    partner(true,[],true);fireEvent.click(screen.getByRole('button',{name:'Знакомство и настройки'}));
    const goal=screen.getByLabelText('Желаемый доход в месяц, ₽') as HTMLInputElement;
    fireEvent.change(goal,{target:{value:'40000'}});
    const key=['coach',null,'p','/coach/me','me'];
    const fresh={...client.getQueryData(key) as object,profile:{status:'complete',version:2,data:{goalMinor:9900000,weeklyMinutes:120,channels:[]}}};
    let first=true;
    vi.mocked(api).mockImplementation(async(path,options)=>{
      if(path==='/coach/me/profile'&&first){first=false;throw Object.assign(new Error('Анкета изменилась'),{status:409});}
      if(path==='/coach/me')return fresh;
      if(path==='/coach/me/profile')return {profile:{...fresh.profile,version:3,data:(options?.body as {profile:object}).profile}};
      return client.getQueryData(['coach',null,'p','/coach/me',path.split('/').pop()])??{};
    });
    fireEvent.click(screen.getByRole('button',{name:'Подтвердить знакомство'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Обновить версию анкеты'})).toBeTruthy());
    fireEvent.click(screen.getByRole('button',{name:'Обновить версию анкеты'}));
    await waitFor(()=>expect(screen.getByText(/Версия анкеты обновлена/)).toBeTruthy());
    expect(goal.value).toBe('40000');
    fireEvent.click(screen.getByRole('button',{name:'Подтвердить знакомство'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/coach/me/profile',expect.objectContaining({body:expect.objectContaining({version:2,profile:expect.objectContaining({goalMinor:4000000})})})));
  });
});
