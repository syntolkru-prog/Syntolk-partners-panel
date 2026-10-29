// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../api.js';
import { AdminPartners } from './AdminPartners.js';

vi.mock('../api.js', () => ({ api: vi.fn() }));
let client: QueryClient;
afterEach(() => { cleanup(); client?.clear(); vi.clearAllMocks(); });
function show() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><AdminPartners /></QueryClientProvider>);
}
describe('partner list failures', () => {
  it('shows the access error without claiming partners do not exist', async () => {
    vi.mocked(api).mockRejectedValue(new Error('Нет доступа к этому разделу для текущего аккаунта.'));
    show();
    await screen.findByText('Нет доступа к этому разделу для текущего аккаунта.');
    expect(screen.queryByText('Партнёров пока нет')).toBeNull();
  });
  it('shows an empty state only for a successful empty response', async () => {
    vi.mocked(api).mockResolvedValue({ partners: [] });
    show();
    await screen.findByText('Партнёров пока нет');
  });
});
