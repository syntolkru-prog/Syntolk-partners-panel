// @vitest-environment jsdom
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {useEffect} from 'react';
import {api} from '../api.js';
import {CalculatorWorkspace} from './CalculatorWorkspace.js';
vi.mock('../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
vi.mock('./Calculator.js',()=>({CalculatorPage:({connection,scope,intro,scenarioPicker,scenarioCreation,actions,planning}:{connection:React.ReactNode;scope:{key:string};intro:React.ReactNode;scenarioPicker?:React.ReactNode;scenarioCreation?:React.ReactNode;actions?:React.ReactNode;planning:React.ReactNode})=>{
 useEffect(()=>{document.getElementById('partner-forecast')?.dispatchEvent(new CustomEvent('syntolk-calculator-change',{bubbles:true}));},[scope.key]);
 return <><h1>Калькулятор</h1>{actions}{intro}{scenarioPicker}{scenarioCreation}{planning}<div id="partner-forecast" data-current-settings={JSON.stringify({frequency:{short:2}})} data-storage-key={scope.key}/>{connection}</>;
}}));
let client:QueryClient;
beforeAll(()=>{Element.prototype.scrollIntoView=vi.fn();});
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
 await screen.findByRole('button',{name:/^Сохранить (сценарий|изменения)$/});
  if(named&&!saved.length){fireEvent.click(screen.getByRole('button',{name:/^(Создать|Новый) сценарий$/}));await screen.findByRole('form',{name:'Новый сценарий'});fireEvent.click(screen.getByRole('button',{name:'Начать настройку'}));}
 if(named||saved.length)await waitFor(()=>expect((screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}) as HTMLButtonElement).disabled).toBe(false));
}
describe('save calculator to a real partner calendar',()=>{
 it('activates planning only after submitting the inline name and does not write a snapshot',async()=>{
  await show([],false);
  const field=()=>screen.getByLabelText('Начало календаря') as HTMLInputElement;
  expect(field().matches(':disabled')).toBe(true);
  expect(screen.getByText('Не активен')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Создать сценарий'}));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.change(screen.getByLabelText('Название сценария'),{target:{value:'   '}});
  expect((screen.getByRole('button',{name:'Начать настройку'}) as HTMLButtonElement).disabled).toBe(true);
  expect(field().matches(':disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText('Название сценария'),{target:{value:'  Октябрь  '}});
  fireEvent.submit(screen.getByRole('form',{name:'Новый сценарий'}));
  await screen.findByText('Октябрь');
  expect(field().matches(':disabled')).toBe(false);
  expect(screen.getByText('Черновик')).toBeTruthy();
  expect(screen.queryByRole('form',{name:'Новый сценарий'})).toBeNull();
  expect((screen.getByLabelText('Сохранённый сценарий') as HTMLSelectElement).value).toBe('');
  expect(vi.mocked(api).mock.calls.some(([p,o])=>p.endsWith('/forecast-snapshots')&&o?.method)).toBe(false);
 });
 it('selects the server-confirmed scenario immediately, keeps it in My scenarios and clears saved status on edits',async()=>{
  await show();
  fireEvent.click(screen.getByRole('button',{name:'Сохранить сценарий'}));
  await screen.findByText('Сохранено');
  const select=screen.getByLabelText('Сохранённый сценарий') as HTMLSelectElement;
  expect(select.value).toBe('snap');
  expect(select.selectedOptions[0]!.text).toBe('Сценарий 1');
  expect(select.disabled).toBe(false);
  expect(screen.getByRole('button',{name:'Сохранить изменения'})).toBeTruthy();
  expect(screen.getByLabelText('Адрес').textContent).toBe('/?scenarioId=snap&programId=program');
  const stored=client.getQueryData<{snapshots:Array<{data:Record<string,unknown>}>}>(['coach',null,'partner','/coach/me','snapshots','program']);
  expect(stored!.snapshots[0]!.data).toMatchObject({scenarioId:'snap',scenarioName:'Сценарий 1',settings:{frequency:{short:2}}});
  fireEvent.change(screen.getByLabelText('Период календаря'),{target:{value:'14'}});
  expect(screen.queryByText('Сохранено')).toBeNull();
  expect(screen.getByText('Настройка')).toBeTruthy();
 });
 it('prevents duplicate writes on rapid save clicks',async()=>{
  await show();
  const save=screen.getByRole('button',{name:'Сохранить сценарий'});
  fireEvent.click(save);fireEvent.click(save);
  await screen.findByText('Сохранено');
  expect(vi.mocked(api).mock.calls.filter(([p,o])=>p.endsWith('/forecast-snapshots')&&o?.method==='POST')).toHaveLength(1);
  expect(vi.mocked(api).mock.calls.filter(([p,o])=>p.endsWith('/calculator-plan')&&o?.method==='POST')).toHaveLength(1);
 });
 it('starts a named draft without saving a snapshot or creating a calendar',async()=>{
  await show([],false);fireEvent.click(screen.getByRole('button',{name:/^(Создать|Новый) сценарий$/}));
  fireEvent.change(screen.getByLabelText('Название сценария'),{target:{value:'Мой новый план'}});
  fireEvent.click(screen.getByRole('button',{name:'Начать настройку'}));
  await screen.findByText('Мой новый план');
  expect(screen.getByRole('button',{name:'Сохранить сценарий'})).toBeTruthy();
  expect(vi.mocked(api).mock.calls.some(([path,options])=>options?.method&&(path.endsWith('/forecast-snapshots')||path.endsWith('/calculator-plan')))).toBe(false);
 });
 it('labels edits separately and requires confirmation before rebuilding an existing calendar',async()=>{
  await show([{id:'a',programId:'program',createdAt:'2026-10-13T00:00:00.000Z',data:{scenarioId:'a',scenarioName:'Сохранённый план',settings:{frequency:{short:1}}}}]);
  const original=vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async(path,options)=>{
    if(path.includes('/calculator-plan?'))return {plan:{id:'existing-plan',version:4}};
    if(path.endsWith('/forecast-snapshots')&&options?.method==='POST')return {snapshot:{id:'revision-2',data:{scenarioId:'a',scenarioName:'Сохранённый план'}}};
    return original(path,options);
  });
  await client.invalidateQueries({queryKey:['coach']});
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  const button=await screen.findByRole('button',{name:'Сохранить изменения'});fireEvent.click(button);
  await waitFor(()=>expect(confirm).toHaveBeenCalledOnce());
  expect(confirm.mock.calls[0]![0]).toContain('Незавершённые задачи будут заменены');
  expect(vi.mocked(api).mock.calls.some(([path,options])=>path.endsWith('/forecast-snapshots')&&options?.method==='POST')).toBe(false);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Сохранить изменения'}) as HTMLButtonElement).disabled).toBe(false));
  confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Сохранить изменения'}));
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/coach/me/calculator-plan',expect.objectContaining({method:'POST',body:expect.objectContaining({scenarioId:'a',replacePlanId:'existing-plan',replaceVersion:4})})));
 });
 it('does not inherit a saved scenario name when returning to a new draft',async()=>{
  await show([{id:'a',programId:'program',createdAt:'2026-10-13T00:00:00.000Z',data:{scenarioId:'a',scenarioName:'Сохранённый план',settings:{frequency:{short:1}}}}]);
  expect(screen.getByRole('button',{name:'Сохранить изменения'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/^(Создать|Новый) сценарий$/}));
  expect((screen.getByLabelText('Название сценария') as HTMLInputElement).value).toBe('Сценарий 2');
  fireEvent.click(screen.getByRole('button',{name:'Начать настройку'}));
  await screen.findByText('Сценарий 2');
  expect(screen.getByRole('button',{name:'Сохранить сценарий'})).toBeTruthy();
 });
 it('requests a fresh scenario only after naming, without persisting the reset over the previous scenario',async()=>{
  await show([{id:'a',programId:'program',createdAt:'2026-10-13T00:00:00.000Z',data:{scenarioId:'a',scenarioName:'Свой контент',settings:{customFormats:[{id:'own',name:'Свой формат'}],removedFormats:['post']}}}]);
  const root=document.getElementById('partner-forecast')!,reset=vi.fn();root.addEventListener('syntolk-calculator-reset',reset);
  fireEvent.click(screen.getByRole('button',{name:'Новый сценарий'}));expect(reset).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Начать настройку'}));
  expect(reset).toHaveBeenCalledOnce();expect((reset.mock.calls[0]![0] as CustomEvent).detail).toEqual({persist:false,fresh:true});
  expect(vi.mocked(api).mock.calls.some(([,options])=>options?.method==='DELETE')).toBe(false);
 });
 it('shows the saved-scenario selector even before the first scenario is saved',async()=>{
  await show([],false);
  expect((screen.getByLabelText('Сохранённый сценарий') as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByText('Нет сохранённых сценариев')).toBeTruthy();
  expect((screen.getByRole('button',{name:'Управление выбранным сценарием'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it('offers compact management for the selected scenario and never deletes without confirmation',async()=>{
  await show([{id:'a',programId:'program',createdAt:'2026-10-13T00:00:00.000Z',data:{scenarioId:'a',scenarioName:'Мой сценарий',settings:{frequency:{short:1}}}}]);
  vi.spyOn(window,'confirm').mockReturnValue(false);
  fireEvent.keyDown(screen.getByRole('button',{name:'Управление выбранным сценарием'}),{key:'ArrowDown'});
  await screen.findByRole('menuitem',{name:'Изменить параметры'});
  expect(screen.getByRole('menuitem',{name:'Открыть календарь'})).toBeTruthy();
  fireEvent.click(screen.getByRole('menuitem',{name:'Удалить сценарий'}));
  expect(window.confirm).toHaveBeenCalledOnce();
  expect(vi.mocked(api).mock.calls.some(([,options])=>options?.method==='DELETE')).toBe(false);
 });
 it('opens the selected scenario calendar from its menu',async()=>{
  await show([{id:'a',programId:'program',createdAt:'2026-10-13T00:00:00.000Z',data:{scenarioId:'a',scenarioName:'Мой сценарий',settings:{frequency:{short:1}}}}]);
  fireEvent.keyDown(screen.getByRole('button',{name:'Управление выбранным сценарием'}),{key:'ArrowDown'});
  fireEvent.click(await screen.findByRole('menuitem',{name:'Открыть календарь'}));
  expect(screen.getByLabelText('Адрес').textContent).toBe('/plan?programId=program&scenarioId=a');
 });
 it('focuses content editing without resetting the selected scenario or saving anything',async()=>{
  await show([{id:'a',programId:'program',createdAt:'2026-10-13T00:00:00.000Z',data:{scenarioId:'a',scenarioName:'Мой сценарий',settings:{frequency:{short:1}}}}]);
  const input=document.createElement('input');input.className='pf-format-frequency';document.getElementById('partner-forecast')!.append(input);
  fireEvent.keyDown(screen.getByRole('button',{name:'Управление выбранным сценарием'}),{key:'ArrowDown'});
  fireEvent.click(await screen.findByRole('menuitem',{name:'Изменить параметры'}));
  await waitFor(()=>expect(document.activeElement).toBe(input));
  expect((screen.getByLabelText('Сохранённый сценарий') as HTMLSelectElement).value).toBe('a');
  expect(vi.mocked(api).mock.calls.some(([path,options])=>path.includes('forecast-snapshots')&&options?.method)).toBe(false);
 });
 it('archives only the selected scenario after explicit confirmation',async()=>{
  await show([{id:'a',programId:'program',createdAt:'2026-10-13T00:00:00.000Z',data:{scenarioId:'a',scenarioName:'Мой сценарий',settings:{frequency:{short:1}}}}]);
  vi.spyOn(window,'confirm').mockReturnValue(true);
  fireEvent.keyDown(screen.getByRole('button',{name:'Управление выбранным сценарием'}),{key:'ArrowDown'});
  fireEvent.click(await screen.findByRole('menuitem',{name:'Удалить сценарий'}));
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/coach/me/forecast-snapshots/a?programId=program',{method:'DELETE'}));
  await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).toContain('scenarioId=new'));
 });
 it('groups create and save in scenario settings without duplicating either action',async()=>{
  await show([],false);
  const create=screen.getByRole('button',{name:/^(Создать|Новый) сценарий$/}),save=screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/});
  expect(create.closest('.calculator-scenario-actions')).toBe(save.closest('.calculator-scenario-actions'));
  expect(create.closest('.calculator-intro')).toBeTruthy();
  expect(screen.getAllByRole('button',{name:/^(Создать|Новый) сценарий$/})).toHaveLength(1);
  expect(save.closest('.calculator-planning')).toBeNull();
 });
 it('requires a named draft before saving and preserves already configured content when naming it',async()=>{
  await show([],false);
  const root=document.getElementById('partner-forecast')!,before=root.dataset.currentSettings;
  const reset=vi.fn();root.addEventListener('syntolk-calculator-reset',reset);
  expect((screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}));
  expect(screen.queryByRole('form',{name:'Новый сценарий'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/^(Создать|Новый) сценарий$/}));
  await screen.findByRole('form',{name:'Новый сценарий'});
  fireEvent.change(screen.getByRole('textbox',{name:'Название сценария'}),{target:{value:'Мои ролики'}});
  fireEvent.click(screen.getByRole('button',{name:'Начать настройку'}));
  await waitFor(()=>expect((screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}));
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/coach/me/forecast-snapshots',expect.objectContaining({body:expect.objectContaining({scenarioName:'Мои ролики',settings:{frequency:{short:2}}})})));
  expect(root.dataset.currentSettings).toBe(before);expect(reset).not.toHaveBeenCalled();
 });
 it('shows missing-platform validation only after save, before asking for a name',async()=>{
  const validation=Object.assign(new Error('calculator_unplaced: Не выбраны площадки для: Посты.'),{detail:{error:'calculator_unplaced',detail:'Не выбраны площадки для: Посты.'}});
  await show([],true,validation);
  await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>path.endsWith('/preview'))).toBe(true));
  expect(screen.queryByText('Не выбраны площадки для: Посты.')).toBeNull();
  expect(screen.queryByRole('form',{name:'Новый сценарий'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}));
  expect((await screen.findByText('Не выбраны площадки для: Посты.')).closest('.calculator-intro')).toBeTruthy();
  expect(screen.queryByRole('form',{name:'Новый сценарий'})).toBeNull();
  expect(vi.mocked(api).mock.calls.some(([path,options])=>options?.method&&path.endsWith('/forecast-snapshots'))).toBe(false);
 });
 it('validates current inputs before creating a snapshot and shows the error without a technical code',async()=>{
  await show();const original=vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async(path,options)=>{
   if(path.endsWith('/preview'))throw Object.assign(new Error('calculator_unplaced: Не выбраны площадки для: Посты.'),{detail:{error:'calculator_unplaced',detail:'Не выбраны площадки для: Посты.'}});
   return original(path,options);
  });
  fireEvent.click(screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}));
  await screen.findByText('Не выбраны площадки для: Посты.');
  expect(screen.queryByText(/calculator_unplaced:/)).toBeNull();
  expect(vi.mocked(api).mock.calls.some(([path,options])=>path.endsWith('/forecast-snapshots')&&options?.method)).toBe(false);
 });
 it('does not preview or save an empty new scenario as calendar work',async()=>{
  await show();await screen.findByRole('button',{name:/^Сохранить (сценарий|изменения)$/});
  const root=document.getElementById('partner-forecast')!;
  root.dataset.currentSettings=JSON.stringify({frequency:{post:0,short:0,circle:0}});
  fireEvent(root,new CustomEvent('syntolk-calculator-change',{bubbles:true}));
  await screen.findByText('Укажите количество материалов и выберите площадки — здесь появится план нового сценария.');
  const button=screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(screen.queryByRole('form',{name:'Новый сценарий'})).toBeNull();
  expect(vi.mocked(api).mock.calls.some(([path,options])=>options?.method&&path.endsWith('/forecast-snapshots'))).toBe(false);
  expect(vi.mocked(api).mock.calls.some(([path,options])=>options?.method&&path.endsWith('/calculator-plan'))).toBe(false);
  expect(vi.mocked(api).mock.calls.some(([path,options])=>path.endsWith('/preview')&&JSON.stringify(options?.body).includes('"post":0'))).toBe(false);
 });
  it('opens an inline name form before starting a new scenario',async()=>{await show();fireEvent.click(screen.getByRole('button',{name:/^(Создать|Новый) сценарий$/}));expect(await screen.findByRole('form',{name:'Новый сценарий'})).toBeTruthy();expect((screen.getByRole('textbox',{name:'Название сценария'}) as HTMLInputElement).value).toBe('Сценарий 1');fireEvent.click(screen.getByRole('button',{name:'Отмена'}));expect(screen.queryByRole('form',{name:'Новый сценарий'})).toBeNull();});
  it('saves the current scenario and adds it to My scenarios without leaving the calculator',async()=>{await show();const button=await screen.findByRole('button',{name:/^Сохранить (сценарий|изменения)$/});fireEvent.click(button);await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).toBe('/?scenarioId=snap&programId=program'));expect(api).toHaveBeenCalledWith('/coach/me/forecast-snapshots',expect.objectContaining({method:'POST',body:expect.objectContaining({programId:'program',confirmed:true,scenarioId:expect.any(String),scenarioName:'Сценарий 1',settings:{frequency:{short:2}}})}));expect(api).toHaveBeenCalledWith('/coach/me/calculator-plan',expect.objectContaining({method:'POST',body:expect.objectContaining({snapshotId:'snap',scenarioId:'snap',days:30,weekdays:[1,2,3,4,5]})}));expect(vi.mocked(api).mock.calls.some(([p])=>p.includes('generate')||p.endsWith('/messages'))).toBe(false);});
 it('uses the partner-selected period without forcing navigation to the calendar',async()=>{
  await show();fireEvent.change(screen.getByLabelText('Период календаря'),{target:{value:'14'}});
  await waitFor(()=>expect((screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}));
  await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).toBe('/?scenarioId=snap&programId=program'));
  expect(api).toHaveBeenCalledWith('/coach/me/calculator-plan',expect.objectContaining({method:'POST',body:expect.objectContaining({snapshotId:'snap',scenarioId:'snap',days:14,weekdays:[1,2,3,4,5]})}));
 });
 it('keeps drafts scoped to partner, program and saved scenario',async()=>{await show();await screen.findByRole('button',{name:/^Сохранить (сценарий|изменения)$/});expect(document.getElementById('partner-forecast')?.dataset.storageKey).toMatch(/^syntolk-partner-forecast-v1:null:partner:program:new-/);});
 it('switches the calculator to the selected saved scenario',async()=>{
  await show([{id:'a',programId:'program',createdAt:'2026-10-13T00:00:00.000Z',data:{scenarioId:'a',scenarioName:'Сценарий один',settings:{frequency:{short:1}}}},{id:'b',programId:'program',createdAt:'2026-10-12T00:00:00.000Z',data:{scenarioId:'b',scenarioName:'Сценарий два',settings:{frequency:{short:2}}}}]);
  expect((await screen.findByLabelText('Сохранённый сценарий') as HTMLSelectElement).value).toBe('a');
  fireEvent.change(screen.getByLabelText('Сохранённый сценарий'),{target:{value:'b'}});
  await waitFor(()=>expect((screen.getByLabelText('Сохранённый сценарий') as HTMLSelectElement).value).toBe('b'));
  expect(document.getElementById('partner-forecast')?.dataset.storageKey).toContain(':b');
  expect(vi.mocked(api).mock.calls.some(([path])=>path.endsWith('calculator-plan?programId=program&scenarioId=b'))).toBe(true);
 });
 it('previews current calculator edits and saves a custom work period from the same inputs',async()=>{
  await show();await screen.findByRole('button',{name:/^Сохранить (сценарий|изменения)$/});
  fireEvent.change(screen.getByLabelText('Период календаря'),{target:{value:'custom'}});
  fireEvent.change(screen.getByLabelText('Количество дней плана'),{target:{value:'45'}});
  const root=document.getElementById('partner-forecast')!;
  root.dispatchEvent(new CustomEvent('syntolk-calculator-change',{bubbles:true}));
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/coach/me/calculator-plan/preview',expect.objectContaining({body:expect.objectContaining({days:45,settings:{frequency:{short:2}}})})));
  await screen.findByText('2 материалов');
  fireEvent.click(screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}));
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/coach/me/calculator-plan',expect.objectContaining({body:expect.objectContaining({days:45})})));
 });
 it('reuses the same calendar request after a lost response without saving another snapshot',async()=>{
  await show();await screen.findByRole('button',{name:/^Сохранить (сценарий|изменения)$/});
  let attempts=0;
  vi.mocked(api).mockImplementation(async(path,options)=>{
   if(path==='/coach/me')return {programs:[{id:'program',name:'Syntolk'}]};
   if(path.endsWith('/preview'))return {tasks:[],originals:2,placements:4,minutes:42,views:3000};
   if(path.includes('forecast-snapshots'))return options?.method?{snapshot:{id:'saved-once',data:{scenarioId:'saved-once',scenarioName:'Новый сценарий'}}}:{snapshots:[]};
   if(path==='/coach/me/calculator-plan'&&options?.method){if(++attempts===1)throw new Error('Ответ потерян');return {plan:{id:'same'}};}
   return {plan:null};
  });
  fireEvent.click(screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}));await screen.findByText('Ответ потерян');
  fireEvent.click(screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}));await waitFor(()=>expect(screen.getByLabelText('Адрес').textContent).toBe('/?scenarioId=saved-once&programId=program'));
  const writes=vi.mocked(api).mock.calls.filter(([p,o])=>p==='/coach/me/calculator-plan'&&o?.method);
  expect(writes).toHaveLength(2);expect(writes[0]![1]?.body).toEqual(writes[1]![1]?.body);
  expect(vi.mocked(api).mock.calls.filter(([p,o])=>p.includes('forecast-snapshots')&&o?.method)).toHaveLength(1);
 });
 it('does not leave the page or erase the calculator if saving fails',async()=>{await show();await screen.findByRole('button',{name:/^Сохранить (сценарий|изменения)$/});vi.mocked(api).mockRejectedValue(new Error('Не удалось сохранить'));fireEvent.click(screen.getByRole('button',{name:/^Сохранить (сценарий|изменения)$/}));await screen.findByText('Не удалось сохранить');expect(screen.getByLabelText('Адрес').textContent).toBe('/?scenarioId=new');expect(document.getElementById('partner-forecast')?.dataset.currentSettings).toBeTruthy();});
});
