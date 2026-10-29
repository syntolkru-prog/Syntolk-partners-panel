// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, AUTH_CHANGE_STORAGE, getApiKey, setApiKey, type Principal } from '../api.js';
import { useCabinetAuth } from './useCabinetAuth.js';

const admin: Principal = { role: 'admin', source: 'session', admin: { id: 'admin-1', name: 'Admin', email: 'admin@example.test' } };
const partner: Principal = { role: 'partner', partnerId: 'partner-1' };
let principal = admin;
let client: QueryClient;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function show() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['install-status'], { needsSetup: false });
  client.setQueryData(['private-partners'], ['previous account data']);
  return renderHook(useCabinetAuth, { wrapper: ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); principal = admin;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(principal)));
});
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); });

describe('cabinet session synchronization', () => {
  it('updates the role on focus and removes the previous account cache', async () => {
    const { result } = show();
    await waitFor(() => expect(result.current.principal?.role).toBe('admin'));
    principal = partner;
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.principal?.role).toBe('partner'));
    expect(result.current.generation).toBe(1);
    expect(client.getQueryData(['private-partners'])).toBeUndefined();
    expect(client.getQueryData(['install-status'])).toEqual({ needsSetup: false });
  });

  it('reacts only to session notifications belonging to this deployment', async () => {
    const { result } = show();
    await waitFor(() => expect(result.current.principal?.role).toBe('admin'));
    principal = partner;
    const before = vi.mocked(fetch).mock.calls.length;
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: '/other-app:op:session-change', newValue: 'changed' })));
    expect(vi.mocked(fetch).mock.calls).toHaveLength(before);
    expect(result.current.principal?.role).toBe('admin');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: AUTH_CHANGE_STORAGE, newValue: 'changed' })));
    await waitFor(() => expect(result.current.principal?.role).toBe('partner'));
  });

  it('preserves the current page and cache when the identity is unchanged', async () => {
    const { result } = show();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = vi.mocked(fetch).mock.calls.length;
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(before));
    expect(result.current.generation).toBe(0);
    expect(client.getQueryData(['private-partners'])).toEqual(['previous account data']);
  });

  it('rechecks an access refusal without retrying or bypassing the protected request', async () => {
    const { result } = show();
    await waitFor(() => expect(result.current.principal?.role).toBe('admin'));
    principal = partner;
    vi.mocked(fetch).mockImplementation(async url => String(url).endsWith('/partners')
      ? json({ error: 'forbidden' }, 403) : json(principal));
    await act(async () => {
      await expect(api('/partners')).rejects.toMatchObject({ status: 403, message: 'Нет доступа к этому разделу для текущего аккаунта.' });
    });
    await waitFor(() => expect(result.current.principal?.role).toBe('partner'));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/partners'))).toHaveLength(1);
    expect(client.getQueryData(['private-partners'])).toBeUndefined();
  });

  it('clears private data when the cookie session expires', async () => {
    const { result } = show();
    await waitFor(() => expect(result.current.principal?.role).toBe('admin'));
    vi.mocked(fetch).mockResolvedValue(json({ error: 'unauthorized' }, 401));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.principal).toBeNull());
    expect(client.getQueryData(['private-partners'])).toBeUndefined();
  });

  it('keeps a known identity on a temporary server failure', async () => {
    const { result } = show();
    await waitFor(() => expect(result.current.principal?.role).toBe('admin'));
    vi.mocked(fetch).mockResolvedValue(json({ error: 'temporary_failure' }, 500));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(result.current.principal?.role).toBe('admin');
    expect(client.getQueryData(['private-partners'])).toEqual(['previous account data']);
  });

  it('discards an older check when a different tab credential is selected in flight', async () => {
    setApiKey('old-key');
    const { result } = show();
    await waitFor(() => expect(result.current.principal?.role).toBe('admin'));
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => window.dispatchEvent(new Event('focus')));
    principal = partner;
    await act(async () => { setApiKey('new-key'); finish(json(admin)); });
    await waitFor(() => expect(result.current.principal?.role).toBe('partner'));
    expect(getApiKey()).toBe('new-key');
    expect(result.current.generation).toBe(1);
  });
});
