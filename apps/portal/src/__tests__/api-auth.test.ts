// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, clearApiKey, getApiKey, setApiKey } from '../api.js';

function tabStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('sessionStorage', tabStorage());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('independent cabinet credentials', () => {
  it('keeps the admin credential when another tab signs in and signs out as partner', async () => {
    const adminTab = tabStorage();
    const partnerTab = tabStorage();
    vi.stubGlobal('sessionStorage', adminTab);
    setApiKey('admin-key');
    vi.stubGlobal('sessionStorage', partnerTab);
    setApiKey('partner-key');
    expect(getApiKey()).toBe('partner-key');
    clearApiKey();
    expect(getApiKey()).toBeNull();
    vi.stubGlobal('sessionStorage', adminTab);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ role: 'admin' })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await api('/auth/whoami')).toEqual({ role: 'admin' });
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('Authorization')).toBe('Bearer admin-key');
  });

  it('migrates the previous shared credential once and ignores later changes from old tabs', () => {
    localStorage.setItem('op:apiKey', 'old-admin-key');
    expect(getApiKey()).toBe('old-admin-key');
    expect(localStorage.getItem('op:apiKey')).toBeNull();
    localStorage.setItem('op:apiKey', 'partner-from-old-tab');
    expect(getApiKey()).toBe('old-admin-key');
    clearApiKey();
    localStorage.setItem('op:apiKey', 'another-old-key');
    expect(getApiKey()).toBeNull();
  });

  it('preserves a valid account when a different candidate key is rejected at login', async () => {
    setApiKey('valid-admin-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('/auth/whoami', { headers: { Authorization: 'Bearer invalid-candidate' } })).rejects.toMatchObject({ status: 401 });
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('Authorization')).toBe('Bearer invalid-candidate');
    expect(getApiKey()).toBe('valid-admin-key');
  });

  it('does not clear a new account when a previous account request returns a late 401', async () => {
    setApiKey('previous-key');
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { resolveResponse = resolve; })));
    const request = api('/auth/whoami');
    setApiKey('new-key');
    resolveResponse(new Response('{}', { status: 401 }));
    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(getApiKey()).toBe('new-key');
  });

  it('clears a revoked credential in its own tab', async () => {
    setApiKey('revoked-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(api('/auth/whoami')).rejects.toMatchObject({ status: 401 });
    expect(getApiKey()).toBeNull();
  });
});

describe('remembered local development login', () => {
  beforeEach(() => vi.stubGlobal('location', new URL('http://localhost:5673/')));

  it('restores the local account after closing and reopening its tab', () => {
    setApiKey('local-admin');
    expect(localStorage.getItem('op:localApiKey')).toBe('local-admin');
    vi.stubGlobal('sessionStorage', tabStorage());
    expect(getApiKey()).toBe('local-admin');
  });

  it('keeps an explicit signout signed out after reopening', () => {
    setApiKey('local-admin');
    clearApiKey();
    vi.stubGlobal('sessionStorage', tabStorage());
    expect(getApiKey()).toBeNull();
    expect(localStorage.getItem('op:localApiKey')).toBeNull();
  });

  it('does not make production or another port remember a login', () => {
    vi.stubGlobal('location', new URL('https://partners.example.test/'));
    setApiKey('production-account');
    expect(localStorage.getItem('op:localApiKey')).toBeNull();
    vi.stubGlobal('location', new URL('http://localhost:5674/'));
    setApiKey('other-local-app');
    expect(localStorage.getItem('op:localApiKey')).toBeNull();
    vi.stubGlobal('location', new URL('http://localhost:5673/'));
    vi.stubEnv('DEV', false);
    setApiKey('production-on-loopback');
    expect(localStorage.getItem('op:localApiKey')).toBeNull();
  });

  it('preserves an independent tab and its new remembered login on signout', () => {
    const admin = tabStorage(), other = tabStorage();
    vi.stubGlobal('sessionStorage', admin); setApiKey('admin');
    vi.stubGlobal('sessionStorage', other); setApiKey('partner');
    vi.stubGlobal('sessionStorage', admin); clearApiKey();
    vi.stubGlobal('sessionStorage', other);
    expect(getApiKey()).toBe('partner');
    expect(localStorage.getItem('op:localApiKey')).toBe('partner');
  });

  it('forgets a revoked local account rather than repeatedly restoring it', async () => {
    setApiKey('revoked-local');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(api('/auth/whoami')).rejects.toMatchObject({ status: 401 });
    vi.stubGlobal('sessionStorage', tabStorage());
    expect(getApiKey()).toBeNull();
  });
});
