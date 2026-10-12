// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {CoachPage} from './Coach.js';
import {api} from '../../api.js';
vi.mock('../../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
let client:QueryClient;
beforeEach(()=>{client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});vi.mocked(api).mockResolvedValue({});});
afterEach(()=>{cleanup();client.clear();vi.clearAllMocks();});
function partner(enabled=true,runRows:unknown[]=[]){const key=['coach',null,'p','/coach/me'];client.setQueryData([...key,'me'],{enabled,profile:null,label:'Демонстрационный режим — ответы по шаблонам',provider:'template',configured:true,takeover:false,programs:[{id:'program',name:'Syntolk 20%'}]});for(const [name,value] of Object.entries({plans:{plans:[]},tasks:{tasks:[],routerOrigin:'http://localhost:5673'},messages:{messages:[]},reviews:{reviews:[]},notifications:{notifications:[]},runs:{runs:runRows}}))client.setQueryData([...key,name],value);render(<QueryClientProvider client={client}><CoachPage principal={{role:'partner',partnerId:'p'}}/></QueryClientProvider>);}
describe('partner coach UI',()=>{
  it('clearly labels the demo and offers onboarding',()=>{partner();expect(screen.getByText('Демонстрационный режим — ответы по шаблонам')).toBeTruthy();expect(screen.getByRole('button',{name:'Пройти знакомство'})).toBeTruthy();});
  it('does not render enabled actions when module is off',()=>{partner(false);expect(screen.getByText(/ИИ-куратор отключён/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Подготовить новый план'})).toBeNull();});
  it('does not present an old failed run as the latest result after successful retry',()=>{
    partner(true,[{id:'new',status:'completed',data:{}},{id:'old',status:'failed',data:{error:{message:'Старая ошибка плана'}}}]);
    expect(screen.queryByText('Старая ошибка плана')).toBeNull();
  });
  it('keeps the message draft when sending fails',async()=>{partner();fireEvent.click(screen.getByRole('button',{name:/^Чат$/}));const box=screen.getByPlaceholderText('Помоги с идеей поста или сценарием кружочка');fireEvent.change(box,{target:{value:'Мой несохранённый текст'}});vi.mocked(api).mockRejectedValue(new Error('Тестовая ошибка отправки'));fireEvent.click(screen.getByRole('button',{name:/^Отправить$/}));await waitFor(()=>expect(screen.getByText('Тестовая ошибка отправки')).toBeTruthy());expect((box as HTMLTextAreaElement).value).toBe('Мой несохранённый текст');});
  it('saves explicit onboarding with notifications and external AI consent off',async()=>{
    partner();fireEvent.click(screen.getByRole('button',{name:'Пройти знакомство'}));fireEvent.click(screen.getByRole('button',{name:'Подтвердить знакомство'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/coach/me/profile',expect.objectContaining({method:'PATCH',body:expect.objectContaining({complete:true,version:0,profile:expect.objectContaining({proactiveConsent:false,aiConsent:false,sessionMinutes:30})})})));
  });
  it('sends only the strict settings contract, not internal takeover list',async()=>{
    const overview={settings:{enabled:false,provider:'template',dailyRuns:20,takeover:['p']},provider:{label:'Демонстрационный',configured:true},partners:[],runs:[],reviews:[],audit:[]};
    client.setQueryData(['coach-admin',null],overview);vi.mocked(api).mockImplementation(async path=>path==='/admin/coach/overview'?overview:{ok:true} as never);
    render(<QueryClientProvider client={client}><CoachPage principal={{role:'admin'}}/></QueryClientProvider>);fireEvent.click(screen.getByRole('button',{name:'Включить локальный модуль'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/admin/coach/settings',{method:'PATCH',body:{enabled:true,provider:'template',dailyRuns:20}}));
  });
});
