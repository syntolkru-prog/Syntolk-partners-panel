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
afterEach(()=>{cleanup();client?.clear();vi.clearAllMocks();});
function Location(){const l=useLocation();return <output aria-label="Адрес">{l.pathname}{l.search}</output>;}
function show(plan=true,view:'today'|'calendar'|'results'='today',summary=true){
 client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 vi.mocked(api).mockImplementation(async path=>path==='/coach/me'?{programs:[{id:'program',name:'Syntolk'}],enabled:true}:path.includes('/results?')?{counts:{clicks:2,registrations:1,paymentCount:0},amountsMinor:{netAccrued:0}}:{plan:plan?{id:'p',version:1,data:{startDate:'2026-10-13',days:7,originals:1,placements:1,plannedMinutes:18,scenarioId:'reels',scenarioName:'Рилсы'}}:null,today:'2026-10-13',tasks:plan?[task]:[]});
 render(<MemoryRouter><QueryClientProvider client={client}>{view==='today'&&summary?<CoachDay partnerId="partner"/>:<CalculatorWork partnerId="partner" view={view}/>}<Location/></QueryClientProvider></MemoryRouter>);
}
describe('calculator calendar on the dashboard',()=>{
 it('starts from calculator rather than inventing a daily list',async()=>{show(false);await screen.findByText('Сначала создайте свой сценарий');fireEvent.click(screen.getByRole('link',{name:'Настроить сценарий в калькуляторе →'}));expect(screen.getByLabelText('Адрес').textContent).toBe('/calculator?programId=program');expect(screen.queryByText('Сколько минут есть сегодня?')).toBeNull();});
  it('shows the selected scenario name and its daily tasks without referral links',async()=>{show();await screen.findByText('Сегодня по сценарию «Рилсы»');await screen.findByText(task.data.title);expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.queryByText(task.link)).toBeNull();fireEvent.click(screen.getByRole('link',{name:'Работа на неделю'}));expect(screen.getByLabelText('Адрес').textContent).toBe('/plan?programId=program&scenarioId=reels');fireEvent.click(screen.getByRole('link',{name:'Мои результаты'}));expect(screen.getByLabelText('Адрес').textContent).toBe('/results?programId=program&scenarioId=reels');expect(vi.mocked(api).mock.calls.every(([,o])=>!o?.method||o.method==='GET')).toBe(true);});
 it('marks one step with optimistic version and preserves the rest of the plan',async()=>{show(true,'today',false);await screen.findByText(task.data.title);fireEvent.click(screen.getByRole('checkbox'));await waitFor(()=>expect(api).toHaveBeenCalledWith('/coach/me/calculator-plan/tasks/s/complete',{method:'POST',body:{version:1,completed:true}}));expect(api).not.toHaveBeenCalledWith(expect.stringContaining('/plans/generate'),expect.anything());});
 it('does not expose a curator chat shortcut from a work task',async()=>{show(true,'today',false);await screen.findByText(task.data.title);fireEvent.click(screen.getByText('Площадки и ссылки'));expect(screen.queryByRole('button',{name:'Помочь с этим материалом'})).toBeNull();expect(screen.queryByText('Чат с куратором')).toBeNull();expect(vi.mocked(api).mock.calls.every(([,o])=>!o?.method||o.method==='GET')).toBe(true);});
 it('filters real calendar days and renders actual daily results',async()=>{show(true,'results');await screen.findByText('Переходы сегодня: 2 · Регистрации: 1 · Оплаты: 0');expect(screen.queryByRole('checkbox')).toBeNull();});
 it('opens a dated task outside the current week and supports a month view',async()=>{
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  vi.mocked(api).mockImplementation(async path=>path==='/coach/me'?{programs:[{id:'program'}]}:{plan:{id:'p',version:1,data:{startDate:'2026-10-13',days:30,originals:1,placements:1}},today:'2026-10-13',tasks:[{...task,data:{...task.data,scheduledDay:'2026-10-28'}}]});
  render(<MemoryRouter initialEntries={['/plan?programId=program&day=2026-10-28']}><QueryClientProvider client={client}><CalculatorWork partnerId="partner"/><Location/></QueryClientProvider></MemoryRouter>);
  await screen.findByText(task.data.title);
  fireEvent.click(screen.getByRole('button',{name:'Месяц'}));
  await screen.findByLabelText('Месяц плана');expect(screen.getByText(task.data.title)).toBeTruthy();
  expect(screen.getByLabelText('День работы')).toBeTruthy();
 });
});
