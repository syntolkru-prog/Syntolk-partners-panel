// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../api.js';
import { CoachChat } from './CoachChat.js';

vi.mock('../../api.js', () => ({ api: vi.fn(), currentTenantSlug: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseKey = ['coach', null, 'partner-1', '/coach/me'];

function setup({
  profileStatus = 'complete',
  runs = [],
  partnerId = 'partner-1',
  prefix = '/coach/me',
  strictMode = false,
}: { profileStatus?: string | undefined; runs?: unknown[]; partnerId?: string; prefix?: string; strictMode?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const key = ['coach', null, partnerId, prefix] as const;
  client.setQueryData([...key, 'me'], {
    enabled: true,
    takeover: false,
    configured: true,
    profile: profileStatus ? { status: profileStatus, data: {} } : null,
    programs: [{ id: 'program-1', name: 'Syntolk' }],
    assistant: {},
  });
  client.setQueryData([...key, 'welcome'], {
    enabled: true,
    paused: false,
    needsOnboarding: profileStatus !== 'complete',
    takeover: false,
    message: 'Персональное приветствие из welcome.',
  });
  client.setQueryData([...key, 'messages'], { messages: [] });
  client.setQueryData([...key, 'runs'], { runs });
  const content = (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CoachChat partnerId={partnerId} prefix={prefix} />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(strictMode ? <StrictMode>{content}</StrictMode> : content);
  return { client, ...view };
}

describe('CoachChat', () => {
  it('keeps exact composer labels and disables sending before onboarding is complete', () => {
    setup({ profileStatus: 'draft' });

    expect(screen.getByText('Персональное приветствие из welcome.')).toBeTruthy();
    expect((screen.getByPlaceholderText('Помоги с идеей поста или сценарием кружочка') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides the composer while the welcome endpoint reports a paused coach', async () => {
    const view = setup();
    view.client.setQueryData([...baseKey, 'welcome'], {
      enabled: true,
      paused: true,
      needsOnboarding: false,
      takeover: false,
      message: 'Сопровождение поставлено на паузу.',
    });

    await waitFor(() => expect(screen.getByText('Сопровождение приостановлено')).toBeTruthy());
    expect(screen.queryByPlaceholderText('Помоги с идеей поста или сценарием кружочка')).toBeNull();
  });

  it('renders a stable disabled state when the coach is switched off', async () => {
    const view = setup();
    view.client.setQueryData([...baseKey, 'me'], { enabled: false, profile: null, programs: [], assistant: {} });

    await waitFor(() => expect(screen.getByText('Помощник пока отключён. Доступ к остальным разделам кабинета не изменён.')).toBeTruthy());
    expect(screen.queryByPlaceholderText('Помоги с идеей поста или сценарием кружочка')).toBeNull();
  });

  it('renders structured run errors without passing an object to React', () => {
    setup({ runs: [{ id: 'run-1', kind: 'message', status: 'failed', data: { error: { code: 'upstream', message: 'Сервис временно недоступен.' } } }] });

    expect(screen.getByText('Сервис временно недоступен.')).toBeTruthy();
  });

  it('only displays an error for the latest relevant message run', () => {
    setup({ runs: [
      { id: 'run-new', kind: 'message', status: 'completed', data: {} },
      { id: 'run-old', kind: 'message', status: 'failed', data: { error: { message: 'Старая ошибка.' } } },
      { id: 'run-plan', kind: 'plan', status: 'failed', data: { error: { message: 'Ошибка старого плана.' } } },
    ] });

    expect(screen.queryByText('Старая ошибка.')).toBeNull();
    expect(screen.queryByText('Ошибка старого плана.')).toBeNull();
  });

  it('uses the optional assistant fallback without requiring assistant metadata', () => {
    setup();

    expect(screen.getByRole('heading', { name: 'Синти' })).toBeTruthy();
    expect(vi.mocked(api)).not.toHaveBeenCalled();
  });

  it('shows a retry for a failed message even after the component was reloaded', () => {
    setup({ runs: [{ id: 'run-1', kind: 'message', status: 'failed', data: { message: 'Сохранённый вопрос партнёра', error: { message: 'ИИ временно недоступен.' } } }] });

    expect(screen.getByText('ИИ временно недоступен.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('does not let a newer plan run hide the latest failed chat run', () => {
    setup({ runs: [
      { id: 'run-plan', kind: 'plan', status: 'queued', data: {} },
      { id: 'run-message', kind: 'message', status: 'failed', data: { message: 'Повторить этот вопрос', error: { message: 'Ошибка ответа.' } } },
    ] });

    expect(screen.getByText('Ошибка ответа.')).toBeTruthy();
    expect(screen.queryByLabelText('Помощник печатает')).toBeNull();
  });

  it('submits with Enter and keeps the request scoped to the current program', async () => {
    setup();
    vi.mocked(api).mockResolvedValue({} as never);
    const textarea = screen.getByPlaceholderText('Помоги с идеей поста или сценарием кружочка');
    fireEvent.change(textarea, { target: { value: 'Помоги с постом' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/coach/me/messages', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ programId: 'program-1', text: 'Помоги с постом' }),
    })));
  });

  it('clears a successful draft in React StrictMode after the double effect cycle', async () => {
    setup({ strictMode: true });
    vi.mocked(api).mockResolvedValue({ messages: [], runs: [] } as never);
    const textarea = screen.getByPlaceholderText('Помоги с идеей поста или сценарием кружочка') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Сообщение из StrictMode' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/coach/me/messages', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('clears draft and selected program when the tenant partner changes', async () => {
    const view = setup();
    const partnerTwoKey = ['coach', null, 'partner-2', '/coach/me'] as const;
    view.client.setQueryData([...partnerTwoKey, 'me'], {
      enabled: true,
      takeover: false,
      configured: true,
      profile: { status: 'complete', data: {} },
      programs: [{ id: 'program-2', name: 'Вторая программа' }, { id: 'program-3', name: 'Третья программа' }],
      assistant: {},
    });
    view.client.setQueryData([...partnerTwoKey, 'welcome'], { enabled: true, paused: false, needsOnboarding: false, takeover: false, message: 'Новое приветствие.' });
    view.client.setQueryData([...partnerTwoKey, 'messages'], { messages: [] });
    view.client.setQueryData([...partnerTwoKey, 'runs'], { runs: [] });

    fireEvent.change(screen.getByPlaceholderText('Помоги с идеей поста или сценарием кружочка'), { target: { value: 'Черновик Ивана' } });
    view.rerender(
      <MemoryRouter>
        <QueryClientProvider client={view.client}>
          <CoachChat partnerId="partner-2" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect((screen.getByPlaceholderText('Помоги с идеей поста или сценарием кружочка') as HTMLTextAreaElement).value).toBe(''));
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('program-2');
  });

  it('does not let an old in-flight request clear the next owner draft', async () => {
    const view = setup();
    seedNextPartner(view.client);
    let resolveRequest!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }) as never);
    const textarea = screen.getByPlaceholderText('Помоги с идеей поста или сценарием кружочка');
    fireEvent.change(textarea, { target: { value: 'Старый запрос' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    view.rerender(
      <MemoryRouter>
        <QueryClientProvider client={view.client}>
          <CoachChat partnerId="partner-2" />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect((screen.getByPlaceholderText('Помоги с идеей поста или сценарием кружочка') as HTMLTextAreaElement).value).toBe(''));
    fireEvent.change(screen.getByPlaceholderText('Помоги с идеей поста или сценарием кружочка'), { target: { value: 'Новый черновик' } });
    resolveRequest({});
    await waitFor(() => expect((screen.getByPlaceholderText('Помоги с идеей поста или сценарием кружочка') as HTMLTextAreaElement).value).toBe('Новый черновик'));
  });
});

function seedNextPartner(client: QueryClient) {
  const partnerTwoKey = ['coach', null, 'partner-2', '/coach/me'] as const;
  client.setQueryData([...partnerTwoKey, 'me'], {
    enabled: true,
    takeover: false,
    configured: true,
    profile: { status: 'complete', data: {} },
    programs: [{ id: 'program-2', name: 'Вторая программа' }],
    assistant: {},
  });
  client.setQueryData([...partnerTwoKey, 'welcome'], { enabled: true, paused: false, needsOnboarding: false, takeover: false, message: 'Новое приветствие.' });
  client.setQueryData([...partnerTwoKey, 'messages'], { messages: [] });
  client.setQueryData([...partnerTwoKey, 'runs'], { runs: [] });
}
