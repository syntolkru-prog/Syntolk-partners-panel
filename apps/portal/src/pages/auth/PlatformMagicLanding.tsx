import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { theme } from '../../theme.js';
import { AuthFrame } from './Shared.js';

/**
 * Multi-tenant magic-link landing for platform-identity tokens (the
 * tokens issued by the unified /signin). Verify creates a
 * PlatformSession; we then push the user to /workspaces, which decides
 * whether to show the picker or auto-enter their single workspace.
 */
export function PlatformMagicLandingPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [state, setState] = useState<'verifying' | 'ok' | 'failed'>('verifying');
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setState('failed');
      setDetail('В URL нет токена.');
      return;
    }
    fetch('/api/auth/platform-verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? `${r.status}`);
        }
        setState('ok');
        setTimeout(() => nav('/workspaces', { replace: true }), 300);
      })
      .catch((err) => {
        setState('failed');
        setDetail(err instanceof Error ? err.message : 'Ссылка недействительна или истекла.');
      });
  }, [nav, params]);

  return (
    <AuthFrame title="Выполняем вход" subtitle="Одну секунду…">
      {state === 'verifying' && <div style={{ color: theme.textMuted, fontSize: 14 }}>Проверяем ссылку…</div>}
      {state === 'ok' && <div style={{ color: theme.success, fontSize: 14 }}>Вход выполнен. Выбираем рабочее пространство…</div>}
      {state === 'failed' && (
        <div style={{ color: theme.danger, fontSize: 14 }}>
          {detail ?? 'Не удалось выполнить проверку.'}
          <div style={{ color: theme.textDim, fontSize: 13, marginTop: 10 }}>
            Запросите новую ссылку на <a href="/signin" style={{ color: theme.accent }}>странице входа</a>.
          </div>
        </div>
      )}
    </AuthFrame>
  );
}
