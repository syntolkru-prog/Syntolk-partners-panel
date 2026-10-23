// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../api.js';
import { CoachDay } from './CoachDay.js';

vi.mock('../../api.js', () => ({ api: vi.fn(), currentTenantSlug: () => null }));
let client: QueryClient;
afterEach(() => { cleanup(); client?.clear(); vi.clearAllMocks(); localStorage.clear(); });

function show({ plan = true, day = '2026-10-21', today = '2026-10-21', completed = false, appearance = 'workspace' as 'workspace'|'workday' } = {}) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api).mockImplementation(async path => path === '/coach/me' ? { programs: [{ id: 'program' }] } : {
    plan: plan ? { data: { startDate: '2026-10-21', days: 7, scenarioId: 'articles', scenarioName: 'Статьи' } } : null,
    today,
    tasks: plan ? [{ status: completed ? 'completed' : 'planned', data: { scheduledDay: day, title: 'Статья · Дзен' } }] : [],
  });
  render(<MemoryRouter><QueryClientProvider client={client}><CoachDay partnerId="partner" appearance={appearance} /></QueryClientProvider></MemoryRouter>);
}

describe('homepage task workspace', () => {
  it('shows actual daily completion in the reference-layout progress and task list', async () => {
    show({appearance:'workday',completed:true});
    await screen.findByRole('heading',{name:'Результаты работы на сегодня'});
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('1');
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByRole('link',{name:'Статья · Дзен, задача 1'}).classList.contains('is-completed')).toBe(true);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('does not claim future work is completed today in the reference layout', async () => {
    show({appearance:'workday',day:'2026-10-22'});
    await screen.findByRole('heading',{name:'Ближайшие задачи · 22 октября'});
    expect(screen.getByText('На сегодня задач нет.')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('link',{name:'Статья · Дзен, задача 1'}).getAttribute('href')).toContain('day=2026-10-22');
  });
  it('keeps dated tasks, the actual progress and all calendar shortcuts', async () => {
    show();
    await screen.findByRole('heading', { name: 'Задачи на сегодня' });
    expect(screen.getByText('Сценарий «Статьи»')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('1');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getByRole('link', { name: 'Статья · Дзен, задача 1' }).getAttribute('href')).toBe('/plan?programId=program&scenarioId=articles&day=2026-10-21');
    expect(screen.getByRole('link', { name: 'Работа на месяц' }).getAttribute('href')).toBe('/plan?programId=program&scenarioId=articles&period=month');
    expect(screen.getByRole('link', { name: 'Мои результаты' }).getAttribute('href')).toBe('/results?programId=program&scenarioId=articles');
    expect(screen.getByRole('link', { name: 'Изменить сценарий' }).getAttribute('href')).toBe('/calculator?programId=program&scenarioId=articles');
    for (const [name, value] of [['Большие квадраты', 'large'], ['Маленькие квадраты', 'small'], ['Список', 'row']]) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true');
      expect(document.querySelector(`.ph-task-list--${value}`)).toBeTruthy();
      expect(localStorage.getItem('syntolk-home-task-view:partner')).toBe(value);
    }
    expect(vi.mocked(api).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });

  it('shows completion without silently modifying a task', async () => {
    show({ completed: true });
    await screen.findByText('Всё на сегодня выполнено');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    expect(screen.getByRole('link', { name: 'Статья · Дзен, задача 1' }).classList.contains('is-completed')).toBe(true);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(vi.mocked(api).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });

  it('dates upcoming work on a free day without claiming it is due today', async () => {
    show({ day: '2026-10-22' });
    await screen.findByRole('heading', { name: 'Ближайшие задачи · 22 октября' });
    expect(screen.getByText('На сегодня задач нет.')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('link', { name: 'Статья · Дзен, задача 1' }).getAttribute('href')).toContain('day=2026-10-22');
  });

  it('offers a publication link without forcing a new partner through the calculator', async () => {
    show({ plan: false });
    await screen.findByRole('heading', { name: 'С чего начнём?' });
    expect(screen.getByRole('link', { name: 'Создать ссылку на публикацию' }).getAttribute('href')).toBe('/links?section=create&view=publications&create=publication');
    expect(screen.getByRole('link', { name: 'Создать сценарий' }).getAttribute('href')).toBe('/calculator?programId=program');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('retains the continuation route for an expired scenario', async () => {
    show({ today: '2026-10-28' });
    await screen.findByRole('heading', { name: 'Сценарий завершён' });
    expect(screen.getByRole('link', { name: 'Продолжить сценарий' }).getAttribute('href')).toBe('/calculator?programId=program&scenarioId=articles');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
