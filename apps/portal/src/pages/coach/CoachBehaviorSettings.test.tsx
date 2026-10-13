// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CoachBehaviorSettings, CoachContextInspector } from './CoachBehaviorSettings.js';
import { api } from '../../api.js';
import { defaultManagement, defaultQuestions } from './CoachManagement.js';

vi.mock('../../api.js', async () => {
  const actual = await vi.importActual<typeof import('../../api.js')>('../../api.js');
  return { ...actual, api: vi.fn(), currentTenantSlug: () => null };
});

const globalSettings = {
  behavior: {
    name: 'Syntolk',
    tone: 'warm' as const,
    address: 'vy' as const,
    replyLength: 'balanced' as const,
    systemPrompt: 'Помогай по делу.',
    greeting: 'Здравствуйте!',
    mascotEnabled: true,
    management: defaultManagement,
    interviewQuestions: defaultQuestions,
  },
  version: 1,
};

const partnerSettings = {
  directives: {
    prompt: 'Учитывай канал партнёра.',
    strengths: 'Сильный блог.',
    focus: 'Рост регистраций.',
    dailyReviewEnabled: true,
    dailyReviewHour: 9,
  },
  version: 11,
  schedulerEnabled: true,
};

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  vi.mocked(api).mockReset();
});

afterEach(() => {
  cleanup();
  client.clear();
});

function show(element: React.ReactNode) {
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

describe('CoachBehaviorSettings', () => {
  it('saves strict manager settings and custom interview questions through the real behavior contract',async()=>{
    client.setQueryData(['coach-behavior-settings',null,'global'],globalSettings);vi.mocked(api).mockResolvedValue({...globalSettings,version:2});show(<CoachBehaviorSettings/>);
    fireEvent.change(screen.getByLabelText('Требовательность куратора'),{target:{value:'strict'}});fireEvent.change(screen.getByLabelText('Первый срок задания, часов'),{target:{value:'48'}});
    fireEvent.change(screen.getByLabelText('Вопрос 1'),{target:{value:'Какой контент вы готовы выпускать каждую неделю?'}});fireEvent.click(screen.getByRole('button',{name:'Сохранить настройки'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/admin/coach/behavior',expect.objectContaining({method:'PATCH',body:expect.objectContaining({version:1,behavior:expect.objectContaining({management:expect.objectContaining({style:'strict',deadlineHours:48}),interviewQuestions:expect.arrayContaining([expect.objectContaining({id:'motivation',question:'Какой контент вы готовы выпускать каждую неделю?'})])})})})));
  });
  it('can enable individual manager rules and then return to inherited policy',async()=>{
    client.setQueryData(['coach-behavior-settings',null,'p'],partnerSettings);vi.mocked(api).mockResolvedValue({...partnerSettings,version:12});show(<CoachBehaviorSettings partnerId="p"/>);
    fireEvent.click(screen.getByLabelText('Индивидуальные правила контроля'));fireEvent.change(screen.getByLabelText('Требовательность куратора'),{target:{value:'strict'}});fireEvent.click(screen.getByRole('button',{name:'Сохранить настройки'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/admin/coach/partners/p/directives',expect.objectContaining({body:expect.objectContaining({directives:expect.objectContaining({management:expect.objectContaining({style:'strict'})})})})));
    await waitFor(()=>expect(screen.getByText('Настройки сохранены.')).toBeTruthy());fireEvent.click(screen.getByLabelText('Индивидуальные правила контроля'));fireEvent.click(screen.getByRole('button',{name:'Сохранить настройки'}));
    await waitFor(()=>expect(api).toHaveBeenCalledTimes(2));const body=vi.mocked(api).mock.calls[1]![1]!.body as {directives:Record<string,unknown>};expect(body.directives.management).toBeUndefined();
  });
  it('edits and saves global behavior with the version guard', async () => {
    client.setQueryData(['coach-behavior-settings', null, 'global'], globalSettings);
    const changed = vi.fn();
    vi.mocked(api).mockResolvedValue({ ...globalSettings, version: 2 });
    show(<CoachBehaviorSettings onChanged={changed} />);

    fireEvent.change(screen.getByLabelText('Имя помощника'), { target: { value: 'Анна' } });
    fireEvent.change(screen.getByLabelText('Тон общения'), { target: { value: 'energetic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }));

    await waitFor(() => expect(screen.getByText('Настройки сохранены.')).toBeTruthy());
    expect(api).toHaveBeenCalledWith('/admin/coach/behavior', {
      method: 'PATCH',
      body: { version: 1, behavior: { ...globalSettings.behavior, name: 'Анна', tone: 'energetic' } },
    });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('rebases a conflict version without silently overwriting the edited draft', async () => {
    client.setQueryData(['coach-behavior-settings', null, 'global'], globalSettings);
    const conflict = Object.assign(new Error('Настройки изменились'), { status: 409 });
    vi.mocked(api)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ ...globalSettings, version: 2 })
      .mockResolvedValueOnce({ ...globalSettings, version: 3 });
    show(<CoachBehaviorSettings />);

    fireEvent.change(screen.getByLabelText('Имя помощника'), { target: { value: 'Мой черновик' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    await waitFor(() => expect(screen.getByText('Настройки изменились в другом окне')).toBeTruthy());
    expect((screen.getByLabelText('Имя помощника') as HTMLInputElement).value).toBe('Мой черновик');
    fireEvent.click(screen.getByRole('button', { name: 'Обновить версию и сохранить черновик' }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText('Имя помощника') as HTMLInputElement).value).toBe('Мой черновик');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    await waitFor(() => expect(screen.getByText('Настройки сохранены.')).toBeTruthy());
    expect(api).toHaveBeenLastCalledWith('/admin/coach/behavior', {
      method: 'PATCH',
      body: { version: 2, behavior: { ...globalSettings.behavior, name: 'Мой черновик' } },
    });
  });

  it('uses individual directives endpoint and exposes daily review controls', async () => {
    client.setQueryData(['coach-behavior-settings', null, 'partner-1'], partnerSettings);
    const changed = vi.fn();
    vi.mocked(api).mockResolvedValue({ directives: { ...partnerSettings.directives, focus: 'Рост переходов.' }, version: 12 });
    show(<CoachBehaviorSettings partnerId="partner-1" onChanged={changed} />);

    expect(screen.getByRole('heading', { name: 'Индивидуальные указания' })).toBeTruthy();
    expect(screen.getByText('Планировщик включён')).toBeTruthy();
    expect(screen.getByText(/режим партнёра не «Пауза»/)).toBeTruthy();
    expect((screen.getByLabelText('Индивидуальный тон') as HTMLSelectElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Индивидуальный тон'), { target: { value: 'energetic' } });
    fireEvent.change(screen.getByLabelText('Главный фокус'), { target: { value: 'Рост переходов.' } });
    client.setQueryData(['coach-behavior-settings', null, 'partner-1'], {
      ...partnerSettings,
      version: 12,
      directives: { ...partnerSettings.directives, focus: 'Изменено в другом окне.' },
    });
    await waitFor(() => expect((screen.getByLabelText('Главный фокус') as HTMLTextAreaElement).value).toBe('Рост переходов.'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }));

    await waitFor(() => expect(screen.getByText('Настройки сохранены.')).toBeTruthy());
    expect(api).toHaveBeenCalledWith('/admin/coach/partners/partner-1/directives', {
      method: 'PATCH',
      body: { version: 11, directives: { ...partnerSettings.directives, focus: 'Рост переходов.', tone: 'energetic' } },
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Планировщик включён')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Индивидуальный тон'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(api).toHaveBeenLastCalledWith('/admin/coach/partners/partner-1/directives', {
      method: 'PATCH',
      body: { version: 12, directives: { ...partnerSettings.directives, focus: 'Рост переходов.' } },
    });
  });

  it('does not replace an unsaved draft during a background refetch', async () => {
    client.setQueryData(['coach-behavior-settings', null, 'global'], globalSettings);
    vi.mocked(api).mockResolvedValue({ ...globalSettings, version: 2 });
    show(<CoachBehaviorSettings />);

    fireEvent.change(screen.getByLabelText('Имя помощника'), { target: { value: 'Черновик' } });
    client.setQueryData(['coach-behavior-settings', null, 'global'], {
      ...globalSettings,
      version: 2,
      behavior: { ...globalSettings.behavior, name: 'Изменено в другом окне' },
    });

    await waitFor(() => expect((screen.getByLabelText('Имя помощника') as HTMLInputElement).value).toBe('Черновик'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(api).toHaveBeenLastCalledWith('/admin/coach/behavior', {
      method: 'PATCH',
      body: { version: 1, behavior: { ...globalSettings.behavior, name: 'Черновик' } },
    });
  });
});

describe('CoachContextInspector', () => {
  it('shows real links, counts, snapshot availability, timestamp and limits', async () => {
    vi.mocked(api).mockResolvedValue({
      generatedAt: '2026-10-13T10:00:00.000Z',
      context: {
        partner: { name: 'Иван Партнёр' },
        metrics: {
          counts: { clicks: 42, registrations: 7, payments: 3, payingCustomers: 2 },
          links: [{ linkKey: 'ivan-yutub', label: 'YouTube', clicks: 30, registrations: 5 }],
          period: { from: '2026-10-01', to: '2026-10-13' },
        },
        links: [{ linkKey: 'ivan-yutub', url: 'https://syntolk.ru/r/Ivan-yutub' }],
        currentTasks: [{ title: 'Заполнить профиль', submittedText: 'Мой текст' }],
        recentActivity: [],
        forecast: { total: 1000 },
        messages: [],
        program: { name: 'Syntolk Partners' },
      },
      capabilities: { profile: true, links: true, metrics: true, tasks: true, submittedText: true, calculatorSnapshot: false, externalVideo: false, browserScreen: false, financialActions: false },
      limits: ['Оплаты пока доступны только в деморежиме.'],
    });
    show(<CoachContextInspector partnerId="partner 1" programId="program/1" />);

    await waitFor(() => expect(screen.getByText('Иван Партнёр')).toBeTruthy());
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('ivan-yutub')).toBeTruthy();
    expect(screen.getByText('Прогноз доступен')).toBeTruthy();
    expect(screen.getByText(/13\.10\.2026, 13:00:00/)).toBeTruthy();
    expect(screen.getByText('Заполнить профиль')).toBeTruthy();
    expect(screen.getByText(/Мой текст/)).toBeTruthy();
    expect(screen.getByText('https://syntolk.ru/r/Ivan-yutub')).toBeTruthy();
    expect(screen.getByText('Анкета')).toBeTruthy();
    expect(screen.getByText('Управление выплатами')).toBeTruthy();
    expect(screen.queryByText('links')).toBeNull();
    expect(screen.getByText('Оплаты пока доступны только в деморежиме.')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/admin/coach/partners/partner%201/context?programId=program%2F1');
    fireEvent.click(screen.getByRole('button', { name: 'Обновить данные' }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  });
});
