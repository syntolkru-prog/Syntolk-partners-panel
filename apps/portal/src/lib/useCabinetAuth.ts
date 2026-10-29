import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, AUTH_CHANGE_STORAGE, AUTH_RECHECK_EVENT, getApiKey, type Principal } from '../api.js';
import { applyCabinetDataRevision } from './cabinet-data-revision.js';

function identity(principal: Principal | null): string {
  return principal ? JSON.stringify([principal.role, principal.source, principal.partnerId, principal.admin?.id]) : '';
}

export function useCabinetAuth() {
  const cache = useQueryClient();
  const [auth, setAuth] = useState<{ loading: boolean; principal: Principal | null; generation: number }>({
    loading: true, principal: null, generation: 0,
  });

  useEffect(() => {
    let disposed = false, running = false, requested = 0, established = false;
    let current: Principal | null = null;
    let credential: string | null = null;
    const privateQueries = { predicate: (query: { queryKey: readonly unknown[] }) =>
      !['install-status', 'host-tenant-probe'].includes(String(query.queryKey[0])) };

    async function check() {
      requested += 1;
      if (running) return;
      running = true;
      let checked = 0;
      try {
        do {
          checked = requested;
          const candidateCredential = getApiKey();
          let principal: Principal | null;
          try {
            principal = await api<Principal>('/auth/whoami');
          } catch (error) {
            if (disposed) return;
            // A temporary network/server error must not replace a known identity.
            if (established && !(error instanceof ApiError && error.status === 401)) continue;
            principal = null;
          }
          if (disposed) return;
          // Ignore an old check if the account changed while it was in flight.
          if (checked !== requested || candidateCredential !== getApiKey()) {
            if (checked === requested) requested += 1;
            continue;
          }
          const changed = established && (identity(current) !== identity(principal) || credential !== candidateCredential);
          if (changed) {
            await cache.cancelQueries(privateQueries);
            if (disposed) return;
            if (checked !== requested || candidateCredential !== getApiKey()) {
              if (checked === requested) requested += 1;
              continue;
            }
            cache.removeQueries(privateQueries);
          }
          if (principal) applyCabinetDataRevision(principal.dataRevision);
          current = principal;
          credential = candidateCredential;
          established = true;
          setAuth(previous => ({ loading: false, principal, generation: previous.generation + Number(changed) }));
        } while (!disposed && checked !== requested);
      } finally {
        running = false;
      }
    }

    const recheck = () => { void check(); };
    const visible = () => { if (document.visibilityState === 'visible') recheck(); };
    const storage = (event: StorageEvent) => { if (event.key === AUTH_CHANGE_STORAGE) recheck(); };
    window.addEventListener('focus', recheck);
    window.addEventListener(AUTH_RECHECK_EVENT, recheck);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    recheck();
    return () => {
      disposed = true;
      window.removeEventListener('focus', recheck);
      window.removeEventListener(AUTH_RECHECK_EVENT, recheck);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [cache]);

  return auth;
}
