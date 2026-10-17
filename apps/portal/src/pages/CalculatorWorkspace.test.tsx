// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {useEffect} from 'react';
import {api} from '../api.js';
import {CalculatorWorkspace} from './CalculatorWorkspace.js';
vi.mock('../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
vi.mock('./Calculator.js',()=>({CalculatorPage:({connection,scope,intro,actions,planning,onCreateScenario}:{connection:React.ReactNode;scope:{key:string};intro:React.ReactNode;actions?:React.ReactNode;planning:React.ReactNode;onCreateScenario?:(root:HTMLElement)=>void})=>{
 useEffect(()=>{document.getElementById('partner-forecast')?.dispatchEvent(new CustomEvent('syntolk-calculator-change',{bubbles:true}));},[scope.key]);
 return <><h1>Калькулятор</h1>{actions}{intro}{planning}{onCreateScenario&&<button onClick={()=>onCreateScenario(document.getElementById('partner-forecast')!)}>Создать сценарий</button>}<div id="partner-forecast" data-current-settings={JSON.stringify({frequency:{short:2}})} data-storage-key={scope.key}/>{connection}</>;
}}));
let client:QueryClient;
afterEach(()=>{cleanup();client?.clear();vi.restoreAllMocks();vi.clearAllMocks();localStorage.clear();});
function Location(){const l=useLocation();return <output aria-label="Адрес">{l.pathname}{l.search}</output>;}
async function show(saved:unknown[]=[],named=true,previewError?:Error){
 client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 vi.mocked(api).mockImplementation(async(path,options)=>{
  if(path==='/coach/me')return {programs:[{id:'program',name:'Syntolk'}]};
  if(path.endsWith('/preview')){if(previewError)throw previewError;return {tasks:[],originals:2,placements:4,minutes:42,views:3000};}
  if(path.includes('forecast-snapshots'))return options?.method?{snapshot:{id:'snap',programId:'program',data:{scenarioId:'snap',scenarioName:'Новый сценарий'}}}:{snapshots:saved};
  return {plan:null};
 });
 render(<MemoryRouter><QueryClientProvider client={client}><CalculatorWorkspace principal={{role:'partner',partnerId:'partner'}}/><Location/></QueryClientProvider></MemoryRouter>);
 await screen.findByRole('button',{name:'Сохранить сценарий и составить план'});
  if(named&&!saved.length){fireEvent.click(screen.getByRole('button',{name:'Создать сценарий'}));await screen.findByRole('dialog');fireEvent.click(screen.getByRole('button',{name:'Создать и настроить'}));}
 await waitFor(()=>expect((screen.getByRole('button',{name:'Сохранить сценарий и составить план'}) as HTMLButtonElement).disabled).toBe(false));
}
describe('save calculator to a real partner calendar',()=>{
 it('asks for a name when saving an already configured scenario without resetting its content',async()=>{
  await show([],false);
  const root=document.getElementById('partner-forecast')!,before=root.dataset.currentSettings;
  const reset=vi.fn();root.addEventListener('syntolk-calculator-reset',reset);
  fireEvent.click(screen.getByRole('button',{name:'Сохранить сценарий и составить план'}));
  await screen.findByRole('dialog');
  fireEvent.change(screen.getByRole('textbox',{name:'Название сценария'}),{target:{value:'Мои ролики'}});
  fireEvent.click(screen.getByRole('button',{name:'Сохранить и составить план'}));
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/coach/me/forecast-snapshots',expect.objectContaining({body:expect.objectContaining({scenarioName:'Мои ролики',settings:{frequency:{short:2}}})})));
  expect(root.dataset.currentSettings).toBe(before);expect(reset).not.toHaveBeenCalled();
 });
 it('shows missing-platform validation only after save, before asking for a name',async()=>{
  const validation=Object.assign(new Error('calculator_unplaced: Не выбраны площадки для: Посты.'),{detail:{error:'calculator_unplaced',detail:'Не выбраны площадки для: Посты.'}});
  await show([],false,validation);
  await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>path.endsWith('/preview'))).toBe(true));
  expect(screen.queryByText('Не выбраны площадки для: Посты.')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Сохранить сценарий и составить план'}));
  await screen.findByText('Не выбраны площадки для: Посты.');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(vi.mocked(api).mock.calls.some(([path,options])=>options?.method&&path.endsWith('/forecast-snapshots'))).toBe(false);
 });
 it('validates current inputs before creating a snapshot and shows the error without a technical code',async()=>{
  await show();const original=vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async(path,options)=>{
   if(path.endsWith('/preview'))throw Object.assign(new Error('calculator_unplaced: Не выбраны площадки для: Посты.'),{detail:{error:'calculator_unplaced',detail:'Не выбраны площадки для: Посты.'}});
   return original(path,options);
  });
  fireEvent.click(screen.getByRole('button',{name:'Сохранить сценарий и составить план'}));
  await screen.findByText('Не выбраны площадки для: Посты.');
  expect(screen.queryByText(/calculator_unplaced:/)).toBeNull();
  expect(vi.mocked(api).mock.calls.some(([path,options])=>path.endsWith('/forecast-snapshots')&&options?.method)).toBe(false);
 });
 it('does not preview or save an empty new scenario as calendar work',async()=>{
  await show();await screen.findByRole('button',{name:'Сохранить сценарий и составить план'});
  const root=document.getElementById('partner-forecast')!;
  root.dataset.currentSettings=JSON.stringify({frequency:{post:0,short:0,circle:0}});
  fireEvent(root,new CustomEvent('syntolk-calculator-change',{bubbles:true}));
  await screen.findByText('Укажите количество материалов и выберите площадки — здесь появится план нового сценария.');
  const button=screen.getByRole('button',{name:'Сохранить сценарий и составить план'}) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  await screen.findByText('Укажите количество материалов и выберите площадки для нового сценария.');
  expect(vi.mocked(api).mock.calls.some(([path,options])=>options?.method&&path.endsWith('/forecast-snapshots'))).toBe(false);
  expect(vi.mocked(api).mock.calls.some(([path,options])=>options?.method&&path.endsWith('/calculator-plan'))).toBe(false);
  expect(vi.mocked(api).mock.calls.some(([path,options])=>path.endsWith('/preview')&&JSON.stringify(options?.body).includes('"post":0'))).toBe(false);
 });
  it('opens an in-page name dialog before starting a new scenario',async()=>{await show();fireEvent.click(screen.getByRole('button',{name:'Создать сценарий'}));expect(await screen.findByRole('dialog')).toBeTruthy();expect((screen.getByRole('textbox',{name:'Название сценария'}) as HTMLInputElement).value).toBe('Сценарий 1');fireEvent.click(screen.getByRole('button',{name:'Отмена'}));expect(screen.queryByRole('dialog')).toBeNull();});
  it('saves the current scenario and immediately creates work without requesting AI',async()=>{await show();const button=await screen.findByRole('button',{name:'Сохранить сценарий и составить план'});fireEvent.click(button);await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).toBe('/plan?programId=program&scenarioId=snap'));expect(api).toHaveBeenCalledWith('/coach/me/forecast-snapshots',expect.objectContaining({method:'POST',body:expect.objectContaining({programId:'program',confirmed:true,scenarioId:expect.any(String),scenarioName:'Сценарий 1',settings:{frequency:{short:2}}})}));expect(api).toHaveBeenCalledWith('/coach/me/calculator-plan',expect.objectContaining({method:'POST',body:expect.objectContaining({snapshotId:'snap',scenarioId:'snap',days:30,weekdays:[1,2,3,4,5]})}));expect(vi.mocked(api).mock.calls.some(([p])=>p.includes('generate')||p.endsWith('/messages'))).toBe(false);});
 it('uses the partner-selected period and then opens the calendar',async()=>{
  await show();fireEvent.change(screen.getByLabelText('Период календаря'),{target:{value:'14'}});
  await waitFor(()=>expect((screen.getByRole('button',{name:'Сохранить сценарий и составить план'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Сохранить сценарий и составить план'}));
  await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).toBe('/plan?programId=program&scenarioId=snap'));
  expect(api).toHaveBeenCalledWith('/coach/me/calculator-plan',expect.objectContaining({method:'POST',body:expect.objectContaining({snapshotId:'snap',scenarioId:'snap',days:14,weekdays:[1,2,3,4,5]})}));
 });
 it('keeps drafts scoped to partner, program and saved scenario',async()=>{await show();await screen.findByRole('button',{name:'Сохранить сценарий и составить план'});expect(document.getElementById('partner-forecast')?.dataset.storageKey).toMatch(/^syntolk-partner-forecast-v1:null:partner:program:new-/);});
 it('switches the calculator to the selected saved scenario',async()=>{
  await show([{id:'a',programId:'program',createdAt:'2026-10-13T00:00:00.000Z',data:{scenarioId:'a',scenarioName:'Сценарий один',settings:{frequency:{short:1}}}},{id:'b',programId:'program',createdAt:'2026-10-12T00:00:00.000Z',data:{scenarioId:'b',scenarioName:'Сценарий два',settings:{frequency:{short:2}}}}]);
  expect((await screen.findByLabelText('Сохранённый сценарий') as HTMLSelectElement).value).toBe('a');
  fireEvent.change(screen.getByLabelText('Сохранённый сценарий'),{target:{value:'b'}});
  await waitFor(()=>expect((screen.getByLabelText('Сохранённый сценарий') as HTMLSelectElement).value).toBe('b'));
  expect(document.getElementById('partner-forecast')?.dataset.storageKey).toContain(':b');
  expect(vi.mocked(api).mock.calls.some(([path])=>path.endsWith('calculator-plan?programId=program&scenarioId=b'))).toBe(true);
 });
 it('previews current calculator edits and saves a custom work period from the same inputs',async()=>{
  await show();await screen.findByRole('button',{name:'Сохранить сценарий и составить план'});
  fireEvent.change(screen.getByLabelText('Период календаря'),{target:{value:'custom'}});
  fireEvent.change(screen.getByLabelText('Количество дней плана'),{target:{value:'45'}});
  const root=document.getElementById('partner-forecast')!;
  root.dispatchEvent(new CustomEvent('syntolk-calculator-change',{bubbles:true}));
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/coach/me/calculator-plan/preview',expect.objectContaining({body:expect.objectContaining({days:45,settings:{frequency:{short:2}}})})));
  await screen.findByText('2 материалов');
  fireEvent.click(screen.getByRole('button',{name:'Сохранить сценарий и составить план'}));
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/coach/me/calculator-plan',expect.objectContaining({body:expect.objectContaining({days:45})})));
 });
 it('reuses the same calendar request after a lost response without saving another snapshot',async()=>{
  await show();await screen.findByRole('button',{name:'Сохранить сценарий и составить план'});
  let attempts=0;
  vi.mocked(api).mockImplementation(async(path,options)=>{
   if(path==='/coach/me')return {programs:[{id:'program',name:'Syntolk'}]};
   if(path.endsWith('/preview'))return {tasks:[],originals:2,placements:4,minutes:42,views:3000};
   if(path.includes('forecast-snapshots'))return options?.method?{snapshot:{id:'saved-once',data:{scenarioId:'saved-once',scenarioName:'Новый сценарий'}}}:{snapshots:[]};
   if(path==='/coach/me/calculator-plan'&&options?.method){if(++attempts===1)throw new Error('Ответ потерян');return {plan:{id:'same'}};}
   return {plan:null};
  });
  fireEvent.click(screen.getByRole('button',{name:'Сохранить сценарий и составить план'}));await screen.findByText('Ответ потерян');
  fireEvent.click(screen.getByRole('button',{name:'Сохранить сценарий и составить план'}));await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).toBe('/plan?programId=program&scenarioId=saved-once'));
  const writes=vi.mocked(api).mock.calls.filter(([p,o])=>p==='/coach/me/calculator-plan'&&o?.method);
  expect(writes).toHaveLength(2);expect(writes[0]![1]?.body).toEqual(writes[1]![1]?.body);
  expect(vi.mocked(api).mock.calls.filter(([p,o])=>p.includes('forecast-snapshots')&&o?.method)).toHaveLength(1);
 });
 it('does not leave the page or erase the calculator if saving fails',async()=>{await show();await screen.findByRole('button',{name:'Сохранить сценарий и составить план'});vi.mocked(api).mockRejectedValue(new Error('Не удалось сохранить'));fireEvent.click(screen.getByRole('button',{name:'Сохранить сценарий и составить план'}));await screen.findByText('Не удалось сохранить');expect(screen.getByLabelText('Адрес').textContent).toBe('/?scenarioId=new');expect(document.getElementById('partner-forecast')?.dataset.currentSettings).toBeTruthy();});
});
