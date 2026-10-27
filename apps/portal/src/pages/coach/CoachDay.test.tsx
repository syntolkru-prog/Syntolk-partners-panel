// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { api } from '../../api.js';
import { CoachDay } from './CoachDay.js';
import { CalculatorWork } from './CalculatorWork.js';
vi.mock('../../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
const task={id:'s',status:'planned',version:1,link:'http://127.0.0.1:5673/r/short',data:{title:'Разместить: короткие видео · Telegram',scheduledDay:'2026-10-13',estimatedMinutes:3,kind:'publish',note:'Ссылка под материалом'}};
let client:QueryClient;
afterEach(()=>{cleanup();client?.clear();vi.clearAllMocks();localStorage.clear();});
function Location(){const l=useLocation();return <output aria-label="Адрес">{l.pathname}{l.search}</output>;}
function show(plan=true,view:'today'|'calendar'|'results'='today',summary=true){
 client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 vi.mocked(api).mockImplementation(async path=>path==='/coach/me'||path==='/me/programs'?{programs:[{id:'program',name:'Syntolk'}],enabled:true}:path.includes('/analytics?')?{counts:{clicks:2,registrations:1,paymentCount:0,payingCustomers:0,firstPaymentCount:0,repeatPaymentCount:0},amountsMinor:{netAccrued:0,observedPayments:0,refunds:0},conversions:{clickToRegistration:0.5,registrationToPayment:0,clickToPayment:0},options:{scenarios:[{id:'reels',name:'Рилсы'}],platforms:[],formats:[]},rows:[],balances:{total:0,available:0,pending:0,paid:0}}:{plan:plan?{id:'p',version:1,data:{startDate:'2026-10-13',days:7,originals:1,placements:1,plannedMinutes:18,scenarioId:'reels',scenarioName:'Рилсы'}}:null,today:'2026-10-13',tasks:plan?[task]:[]});
 render(<MemoryRouter><QueryClientProvider client={client}>{view==='today'&&summary?<CoachDay partnerId="partner"/>:<CalculatorWork partnerId="partner" view={view}/>}<Location/></QueryClientProvider></MemoryRouter>);
}
describe('calculator calendar on the dashboard',()=>{
 it('offers links without requiring a scenario and explains the optional calculator',async()=>{show(false);await screen.findByText('Ссылки и план публикаций');fireEvent.click(screen.getByRole('link',{name:'Открыть ссылки →'}));expect(screen.getByLabelText('Адрес').textContent).toBe('/links?programId=program');fireEvent.click(screen.getByRole('link',{name:'Рассчитать доход и составить план →'}));expect(screen.getByLabelText('Адрес').textContent).toBe('/calculator?programId=program');expect(screen.queryByText('Сколько минут есть сегодня?')).toBeNull();});
  it('shows the selected scenario name and its daily tasks without referral links',async()=>{show();await screen.findByText('Сегодня по сценарию «Рилсы»');await screen.findByText(task.data.title);expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.queryByText(task.link)).toBeNull();fireEvent.click(screen.getByRole('link',{name:'Работа на неделю'}));expect(screen.getByLabelText('Адрес').textContent).toBe('/plan?programId=program&scenarioId=reels');fireEvent.click(screen.getByRole('link',{name:'Мои результаты'}));expect(screen.getByLabelText('Адрес').textContent).toBe('/results?programId=program&scenarioId=reels');expect(vi.mocked(api).mock.calls.every(([,o])=>!o?.method||o.method==='GET')).toBe(true);});
 it('makes each daily task card open its calendar day',async()=>{show();const taskCard=await screen.findByRole('link',{name:/короткие видео · Telegram, задача 1/i});expect(taskCard.getAttribute('href')).toBe('/plan?programId=program&scenarioId=reels&day=2026-10-13');});
 it('keeps the task list visible on a free day and clearly dates the nearest planned work',async()=>{
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  vi.mocked(api).mockImplementation(async path=>path==='/coach/me'?{programs:[{id:'program'}]}:{plan:{data:{startDate:'2026-10-13',days:7,scenarioId:'reels',scenarioName:'Рилсы'}},today:'2026-10-13',tasks:[{...task,data:{...task.data,scheduledDay:'2026-10-14'}}]});
  render(<MemoryRouter><QueryClientProvider client={client}><CoachDay partnerId="partner"/></QueryClientProvider></MemoryRouter>);
  await screen.findByRole('heading',{name:'Задачи на 14 октября'});
  expect(screen.getByText(/На сегодня задач нет/)).toBeTruthy();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByRole('group',{name:'Вид задач на главной'}).closest('.coach-home-summary__header')).toBeTruthy();
  expect(screen.queryByRole('heading',{name:'Задачи на сегодня'})).toBeNull();
  expect(screen.getByRole('link',{name:/короткие видео · Telegram, задача 1/i}).getAttribute('href')).toContain('day=2026-10-14');
  expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method||options.method==='GET')).toBe(true);
 });
 it('keeps all task views usable in the compact header',async()=>{
  show();await screen.findByText(task.data.title);
  const view=screen.getByRole('group',{name:'Вид задач на главной'});
  expect(view.closest('.coach-home-summary__header')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Список'}));
  expect(document.querySelector('.coach-home-tasks--row')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Список'}).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button',{name:'Большие квадраты'}));
  expect(document.querySelector('.coach-home-tasks--large')).toBeTruthy();
  expect(localStorage.getItem('syntolk-home-task-view:partner')).toBe('large');
  expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('1');
  expect(screen.getByRole('link',{name:/короткие видео · Telegram, задача 1/i})).toBeTruthy();
 });
 it('marks one step with optimistic version and preserves the rest of the plan',async()=>{show(true,'today',false);await screen.findByText(task.data.title);fireEvent.click(screen.getByRole('checkbox'));await waitFor(()=>expect(api).toHaveBeenCalledWith('/coach/me/calculator-plan/tasks/s/complete',{method:'POST',body:{version:1,completed:true}}));expect(api).not.toHaveBeenCalledWith(expect.stringContaining('/plans/generate'),expect.anything());});
 it('does not expose a curator chat shortcut from a work task',async()=>{show(true,'today',false);await screen.findByText(task.data.title);fireEvent.click(screen.getByText('Публикации'));expect(screen.queryByRole('button',{name:'Помочь с этим материалом'})).toBeNull();expect(screen.queryByText('Чат с куратором')).toBeNull();expect(vi.mocked(api).mock.calls.every(([,o])=>!o?.method||o.method==='GET')).toBe(true);});
 it('loads factual results independently of the calendar task list',async()=>{
  show(true,'results');await screen.findByRole('heading',{name:'Эффективность площадок'});
  expect(screen.getAllByText('Переходы').length).toBeGreaterThan(0);expect(screen.getByText('2')).toBeTruthy();
  // The old checkbox became the shared activity selector; keep testing the
  // actual include-empty behaviour rather than a removed presentation.
  const activity=screen.getByRole('combobox',{name:'Активность таблицы'});
  fireEvent.change(activity,{target:{value:'all'}});
  await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>path.includes('/analytics?')&&path.includes('includeEmpty=true'))).toBe(true));
 });
 it('opens a dated task outside the current week and supports a month view',async()=>{
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  vi.mocked(api).mockImplementation(async path=>path==='/coach/me'?{programs:[{id:'program'}]}:path.includes('material-catalog')?{formats:[],platforms:[],scenarios:[]}:{plans:[],today:'2026-10-13',materials:[{id:'s',title:task.data.title,formatId:'short',formatName:'Короткое видео',scenarioId:null,scheduledDay:'2026-10-28',platforms:[],revision:1,ready:false,status:'draft',fileCount:0,totalPlacements:1,publishedPlacements:0}]});
  render(<MemoryRouter initialEntries={['/plan?programId=program&day=2026-10-28']}><QueryClientProvider client={client}><CalculatorWork partnerId="partner"/><Location/></QueryClientProvider></MemoryRouter>);
  await screen.findByText(task.data.title);
  fireEvent.click(document.querySelector('.wc-period-picker summary')!);fireEvent.change(screen.getByLabelText('Вид календаря'),{target:{value:'month'}});
  await screen.findByLabelText('Календарь месяца');expect(screen.getByText(task.data.title)).toBeTruthy();
  expect(screen.getByLabelText('Дата календаря')).toBeTruthy();
 });
});
