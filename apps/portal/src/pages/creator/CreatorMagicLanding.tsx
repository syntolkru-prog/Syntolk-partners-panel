import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { theme } from '../../theme.js';
import { AuthFrame } from '../auth/Shared.js';
import { creatorApi } from './creator-api.js';

export function CreatorMagicLandingPage() {
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
    creatorApi<{ ok: boolean }>('/creators/verify', { method: 'POST', body: { token } })
      .then(() => {
        setState('ok');
        setTimeout(() => nav('/creator', { replace: true }), 400);
      })
      .catch((err) => {
        setState('failed');
        setDetail(err?.message ?? 'Ссылка недействительна или истекла.');
      });
  }, [nav, params]);

  return (
    <AuthFrame title="Выполняем вход" subtitle="Одну секунду…">
      {state === 'verifying' && <div style={{ color: theme.textMuted, fontSize: 14 }}>Проверяем ссылку…</div>}
      {state === 'ok' && <div style={{ color: theme.success, fontSize: 14 }}>Вход выполнен. Перенаправляем…</div>}
      {state === 'failed' && (
        <div style={{ color: theme.danger, fontSize: 14 }}>
          {detail ?? 'Не удалось выполнить проверку.'}
          <div style={{ color: theme.textDim, fontSize: 13, marginTop: 10 }}>
            Запросите новую ссылку на <a href="/creator/login" style={{ color: theme.accent }}>странице входа</a>.
          </div>
        </div>
      )}
    </AuthFrame>
  );
}
