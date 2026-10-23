const KEY_STORAGE = 'op:apiKey';
const LOCAL_KEY_STORAGE = 'op:localApiKey';

export function isLocalDevelopment(): boolean {
  return import.meta.env.DEV && location.port === '5673'
    && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}

export function getApiKey(): string | null {
  // Each tab can inspect a different account without replacing the bearer
  // credential of an already-open admin/partner cabinet. sessionStorage
  // survives reloads. An empty value records an explicitly signed-out tab.
  // Only the two local development origins remember a login across tab closes.
  const key = sessionStorage.getItem(KEY_STORAGE);
  if (key !== null) return key || null;
  const local = isLocalDevelopment();
  const remembered = local ? localStorage.getItem(LOCAL_KEY_STORAGE) : null;
  const legacyKey = remembered ?? localStorage.getItem(KEY_STORAGE);
  sessionStorage.setItem(KEY_STORAGE, legacyKey ?? '');
  if (local && legacyKey) localStorage.setItem(LOCAL_KEY_STORAGE, legacyKey);
  localStorage.removeItem(KEY_STORAGE);
  return legacyKey || null;
}

export function setApiKey(key: string): void {
  sessionStorage.setItem(KEY_STORAGE, key);
  if (isLocalDevelopment()) localStorage.setItem(LOCAL_KEY_STORAGE, key);
  localStorage.removeItem(KEY_STORAGE);
}

export function clearApiKey(): void {
  const current = sessionStorage.getItem(KEY_STORAGE);
  if (isLocalDevelopment() && localStorage.getItem(LOCAL_KEY_STORAGE) === current) localStorage.removeItem(LOCAL_KEY_STORAGE);
  sessionStorage.setItem(KEY_STORAGE, '');
  localStorage.removeItem(KEY_STORAGE);
}

/**
 * Pull the tenant slug from the current URL path so multi-tenant mode
 * scopes API calls automatically. In single-tenant mode the SPA never
 * mounts under /t/<slug>/ so this returns null and api() calls hit /api/*
 * unchanged.
 */
export function currentTenantSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/^\/t\/([a-z0-9-]+)(?:\/|$)/);
  return m ? m[1]! : null;
}

async function apiResponse(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
): Promise<Response> {
  const key = getApiKey();
  const headers = new Headers(init.headers);
  if (key && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${key}`);
  // Blob/File bodies carry their own content-type and pass through as-is
  // (used by upload endpoints). Everything else gets JSON treatment.
  const isBinaryBody = init.body instanceof Blob;
  if (init.body !== undefined && !isBinaryBody && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (isBinaryBody && !headers.has('content-type')) {
    headers.set('content-type', (init.body as Blob).type || 'application/octet-stream');
  }
  const slug = currentTenantSlug();
  const tenantPrefix = slug ? `/t/${slug}` : '';
  const res = await fetch(`/api${tenantPrefix}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    body: init.body === undefined
      ? undefined
      : isBinaryBody
        ? (init.body as Blob)
        : typeof init.body === 'string'
          ? init.body
          : JSON.stringify(init.body),
  });
  if (res.status === 401) {
    // A rejected candidate at login or a late response from a previous
    // account must not sign out the current account.
    if (key && headers.get('Authorization') === `Bearer ${key}` && getApiKey() === key) clearApiKey();
    throw new ApiError(res.status, 'unauthorized');
  }
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = await res.json();
    } catch {
      /* ignore */
    }
    // Pull the most meaningful string out of the body when one's
    // present. Server convention is `{ error, detail }` where `detail`
    // is the verbose human-readable cause (e.g. upstream Network's
    // 4xx body when proxied). Without this every API failure renders
    // as a bare "500" or "400" — useless when triaging.
    throw new ApiError(res.status, friendlyMessage(res, detail), detail);
  }
  return res;
}

export async function api<T = unknown>(path: string, init: Omit<RequestInit, 'body'> & { body?: unknown } = {}): Promise<T> {
  return (await apiResponse(path, init)).json() as Promise<T>;
}

export async function apiBlob(path: string): Promise<Blob> {
  return (await apiResponse(path)).blob();
}

function friendlyMessage(res: Response, detail: unknown): string {
  const fallback = res.statusText ? `${res.status} ${res.statusText}` : `${res.status}`;
  if (!detail || typeof detail !== 'object') return fallback;
  const d = detail as Record<string, unknown>;
  // Prefer the verbose explanation; fall back to the short error code.
  if (typeof d.detail === 'string' && d.detail.length > 0) {
    return typeof d.error === 'string' ? `${d.error}: ${d.detail}` : d.detail;
  }
  if (typeof d.error === 'string' && d.error.length > 0) return d.error;
  return fallback;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

export interface Principal {
  role: 'admin' | 'partner';
  source?: string;
  partnerId?: string;
  partner?: { id: string; name: string; email: string };
  admin?: { id: string; name: string; email: string };
}
