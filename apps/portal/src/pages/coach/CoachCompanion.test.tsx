// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CoachCompanion } from './CoachCompanion.js';

const tenantState = vi.hoisted(() => ({ slug: 'tenant-a' as string | null }));
vi.mock('../../api.js', () => ({ api: vi.fn(), currentTenantSlug: () => tenantState.slug }));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  tenantState.slug = 'tenant-a';
  vi.clearAllMocks();
});

function seed(client: QueryClient, partnerId: string, prefix = '/coach/me') {
  const root = ['coach', tenantState.slug, partnerId, prefix] as const;
  client.setQueryData([...root, 'me'], {
    enabled: true,
    takeover: false,
    configured: true,
    profile: { status: 'complete', data: {} },
    programs: [{ id: 'program-1', name: 'Syntolk' }],
    assistant: { name: 'Синти', mascotEnabled: true },
  });
  client.setQueryData([...root, 'welcome'], { enabled: true, paused: false, needsOnboarding: false, takeover: false, message: 'Приветствие.' });
  client.setQueryData([...root, 'messages'], { messages: [] });
  client.setQueryData([...root, 'runs'], { runs: [] });
}

function setup(partnerId = 'partner-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  seed(client, partnerId);
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CoachCompanion partnerId={partnerId} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { client, ...view };
}

describe('CoachCompanion', () => {
  it('does not render when the assistant or mascot is disabled', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['coach', tenantState.slug, 'partner-1', '/coach/me', 'me'], {
      enabled: true,
      assistant: { name: 'Синти', mascotEnabled: false },
    });
    render(<QueryClientProvider client={client}><CoachCompanion partnerId="partner-1" /></QueryClientProvider>);
    expect(screen.queryByRole('button', { name: 'Открыть помощника' })).toBeNull();
  });

  it('closes and clears the open panel when the partner changes', async () => {
    const view = setup();
    seed(view.client, 'partner-2');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Помоги с идеей поста или сценарием кружочка'), { target: { value: 'Черновик Ивана' } });

    view.rerender(
      <MemoryRouter>
        <QueryClientProvider client={view.client}>
          <CoachCompanion partnerId="partner-2" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат' }));
    expect((screen.getByPlaceholderText('Помоги с идеей поста или сценарием кружочка') as HTMLTextAreaElement).value).toBe('');
  });

  it('scopes invitation dismissal to the tenant as well as the partner', async () => {
    const view = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть приглашение' }));
    expect(screen.queryByRole('status', { name: 'Приглашение к помощнику' })).toBeNull();

    tenantState.slug = 'tenant-b';
    seed(view.client, 'partner-1');
    view.rerender(
      <MemoryRouter>
        <QueryClientProvider client={view.client}>
          <CoachCompanion partnerId="partner-1" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('status', { name: 'Приглашение к помощнику' })).toBeTruthy());
  });
});
