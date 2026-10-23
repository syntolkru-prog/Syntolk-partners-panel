// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from './Login.js';
import { api, setApiKey } from '../../api.js';

vi.mock('../../api.js', () => ({ api: vi.fn(), setApiKey: vi.fn(), isLocalDevelopment: () => false, ApiError: class extends Error {} }));
vi.mock('./Shared.js', () => ({ AuthFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, Logo: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('key login', () => {
  it('clears previous private data only after successful verification and before opening the new cabinet', async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    cache.setQueryData(['old-partner-private-data'], { name: 'Previous partner' });
    let verify!: (principal: { role: string }) => void;
    vi.mocked(api).mockImplementationOnce(() => new Promise(resolve => { verify = resolve; }));
    render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/login']}><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<div>Новый кабинет</div>} />
    </Routes></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Ключ администратора / партнёра' }));
    fireEvent.change(screen.getByPlaceholderText('op_...'), { target: { value: ' admin-candidate ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(setApiKey).not.toHaveBeenCalled();
    expect(cache.getQueryData(['old-partner-private-data'])).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/auth/whoami', { headers: { Authorization: 'Bearer admin-candidate' } });
    verify({ role: 'admin' });
    await waitFor(() => expect(screen.getByText('Новый кабинет')).toBeTruthy());
    expect(setApiKey).toHaveBeenCalledWith('admin-candidate');
    expect(cache.getQueryData(['old-partner-private-data'])).toBeUndefined();
    cache.clear();
  });
});
