// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {api} from '../api.js';
import {usePartnerSelection,applyPartnerScope} from '../lib/partner-selection.js';
import {useUnsavedChanges} from '../lib/useUnsavedChanges.js';
import {MaterialEditor} from './MaterialEditor.js';
import {CoachDay} from './coach/CoachDay.js';
vi.mock('../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
let client:QueryClient|undefined;
afterEach(()=>{cleanup();client?.clear();localStorage.clear();vi.restoreAllMocks();vi.clearAllMocks();});
function Address(){const l=useLocation();return <output aria-label="Адрес">{l.pathname}{l.search}</output>;}
function Selection({dirty=false}:{dirty?:boolean}){
 const s=usePartnerSelection('partner',[{id:'program'},{id:'other'}]);
 useUnsavedChanges(dirty);
 return <><button onClick={()=>s.selectScenario('b')}>Один сценарий</button><button onClick={()=>s.selectScenarios(['a','b'])}>Два сценария</button><button onClick={()=>s.selectProgram('other')}>Другая программа</button><Address/></>;
}
const initial='/links?programId=program&scenarioId=a&period=custom&from=2026-10-01&to=2026-10-10&platformIds=vk&formatIds=short&compare=true&compareFrom=2026-09-01&compareTo=2026-09-05&materialId=material&sourceId=source';
const params=()=>new URL('https://example.test'+screen.getByLabelText('Адрес').textContent).searchParams;
describe('VTest shared navigation and material regressions',()=>{
 it.each(['Один сценарий','Два сценария'])('keeps period, comparison, platform and format when selecting %s',name=>{
  render(<MemoryRouter initialEntries={[initial]}><Selection/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name}));
  expect(params().get('platformIds')).toBe('vk');expect(params().get('formatIds')).toBe('short');
  expect(params().get('from')).toBe('2026-10-01');expect(params().get('compareTo')).toBe('2026-09-05');
  expect(params().has('materialId')).toBe(false);expect(params().has('sourceId')).toBe(false);
  expect(name==='Два сценария'?params().getAll('scenarioIds'):params().getAll('scenarioId')).toEqual(name==='Два сценария'?['a','b']:['b']);
 });
 it('clears incompatible source filters only when switching the program',()=>{
  render(<MemoryRouter initialEntries={[initial]}><Selection/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name:'Другая программа'}));
  expect(params().get('programId')).toBe('other');expect(params().get('scenarioId')).toBe('all');
  expect(params().has('platformIds')).toBe(false);expect(params().has('formatIds')).toBe(false);
  expect(params().get('period')).toBe('custom');
 });
 it('does not change the URL or saved scope when navigation from a dirty form is cancelled',()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  render(<MemoryRouter initialEntries={[initial]}><Selection dirty/></MemoryRouter>);
  const before=localStorage.getItem('syntolk-partner-selection:default:partner');
  fireEvent.click(screen.getByRole('button',{name:'Один сценарий'}));
  expect(confirm).toHaveBeenCalledOnce();expect(params().get('scenarioId')).toBe('a');
  expect(localStorage.getItem('syntolk-partner-selection:default:partner')).toBe(before);
 });
 it('applies multiple scenario filters without sending a reserved all identifier',()=>{
  expect(applyPartnerScope(new URLSearchParams('period=all&scenarioId=all'),{programId:'program',scenarioIds:['a','b']}).toString()).toBe('period=all&programId=program&scenarioIds=a&scenarioIds=b');
 });
 function material(links:unknown[]=[]){
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  vi.mocked(api).mockImplementation(async p=>p.includes('material-catalog')?{platforms:[{id:'vk',name:'ВКонтакте'}],formats:[]}:p.includes('/links?')?{links}:{material:{id:'material',programId:'program',scenarioId:'a',revision:1,title:'Мой материал',formatId:'post',platforms:[{id:'vk',name:'ВКонтакте'}]},placements:[]});
  render(<MemoryRouter initialEntries={['/plan?programId=program&scenarioId=a&materialId=material&materialTab=publish']}><QueryClientProvider client={client}><MaterialEditor partnerId="partner" materialId="material"/></QueryClientProvider></MemoryRouter>);
 }
 it('opens the existing link creation form and carries the exact material return context',async()=>{
  material();const link=await screen.findByRole('link',{name:'Создать партнёрскую ссылку →'});
  const url=new URL(link.getAttribute('href')!,'https://example.test');
  expect(url.pathname).toBe('/links');expect(url.searchParams.get('section')).toBe('create');expect(url.searchParams.get('create')).toBe('partner');
  expect(url.searchParams.get('returnTo')).toBe('/plan?programId=program&scenarioId=a&materialId=material&materialTab=publish');
 });
 it('limits the placement Results link to the material, scenario and platform',async()=>{
  material();const link=await screen.findByRole('link',{name:'Результаты'});
  const url=new URL(link.getAttribute('href')!,'https://example.test');
  expect(url.pathname).toBe('/results');expect(Object.fromEntries(url.searchParams)).toMatchObject({programId:'program',scenarioId:'a',materialId:'material',platformId:'vk',groupBy:'source'});
 });
 async function daily(scheduledDay='2026-10-29'){
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  vi.mocked(api).mockImplementation(async p=>p==='/coach/me'?{programs:[{id:'program'}]}:p.includes('/work-calendar?')?{today:'2026-10-29',plans:[],materials:[{id:'manual',title:'Ручной материал',scenarioId:null,scheduledDay,revision:4,ready:false}]}:{ok:true});
  render(<MemoryRouter><QueryClientProvider client={client}><CoachDay partnerId="partner" appearance="workday"/></QueryClientProvider></MemoryRouter>);
  return screen.findByRole('link',{name:'Ручной материал, задача 1'});
 }
 it('shows manual calendar materials on the homepage even without a calculator plan',async()=>{
  const link=await daily();const url=new URL(link.getAttribute('href')!,'https://example.test');
  expect(url.searchParams.get('materialId')).toBe('manual');expect(url.searchParams.get('scenarioId')).toBe('all');
  expect(screen.queryByText('С чего начнём?')).toBeNull();
 });
 it('uses the existing versioned material action when marking a manual task ready',async()=>{
  await daily();fireEvent.click(screen.getByRole('checkbox',{name:'Отметить выполненной: Ручной материал'}));
  await vi.waitFor(()=>expect(api).toHaveBeenCalledWith('/partners/partner/materials/manual/workspace',{method:'PATCH',body:{revision:4,ready:true}}));
  expect(vi.mocked(api).mock.calls.some(([p])=>p.includes('/calculator-plan/tasks/'))).toBe(false);
 });
 it('keeps an unfinished past material visible instead of claiming every task is complete',async()=>{
  const link=await daily('2026-10-27');expect(link.getAttribute('href')).toContain('day=2026-10-27');
  expect(screen.queryByText('Все задачи сценария отмечены выполненными.')).toBeNull();
 });
});
