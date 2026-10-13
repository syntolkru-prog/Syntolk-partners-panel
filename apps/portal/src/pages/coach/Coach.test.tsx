// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {CoachPage} from './Coach.js';
import {api} from '../../api.js';
vi.mock('../../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
let client:QueryClient;
afterEach(()=>{cleanup();client?.clear();vi.clearAllMocks();});
function Location(){const l=useLocation();return <output aria-label="Адрес">{l.pathname}{l.search}</output>;}
function show(route='/coach',role:'partner'|'admin'='partner'){
 client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 const overview={settings:{enabled:false,provider:'template',dailyRuns:20,takeover:['p']},provider:{label:'Демонстрационный',configured:true},partners:[],runs:[],reviews:[],audit:[]};
 vi.mocked(api).mockImplementation(async path=>path==='/admin/coach/overview'?overview:path==='/coach/me'?{enabled:true,programs:[{id:'program',name:'Syntolk'}],profile:null}:{plan:null,tasks:[]});
 render(<MemoryRouter initialEntries={[route]}><QueryClientProvider client={client}><CoachPage principal={{role,partnerId:'p'}}/><Location/></QueryClientProvider></MemoryRouter>);
}
describe('calculator-centered coach navigation',()=>{
 it('redirects the removed partner chat section to the work calendar',async()=>{show();await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).toBe('/plan'));expect(screen.queryByText('Чат с куратором')).toBeNull();expect(screen.queryByRole('button',{name:'Подготовить новый план'})).toBeNull();});
 it.each([['plan'],['results'],['today'],['forecast'],['profile']])('redirects legacy curator bookmarks to the work calendar',async(tab)=>{show('/coach?tab='+tab);await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).toBe('/plan'));expect(vi.mocked(api).mock.calls.every(([,o])=>!o?.method)).toBe(true);});
 it('preserves admin connection and behavior controls and the strict settings contract',async()=>{show('/admin/coach?tab=connection','admin');await screen.findByRole('button',{name:'Включить локальный модуль'});fireEvent.click(screen.getByRole('button',{name:'Включить локальный модуль'}));await waitFor(()=>expect(api).toHaveBeenCalledWith('/admin/coach/settings',{method:'PATCH',body:{enabled:true,provider:'template',dailyRuns:20}}));expect(screen.getByRole('button',{name:'Поведение и промпт'})).toBeTruthy();});
});
