import { useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, setApiKey, type Principal } from '../../api.js';
import { theme } from '../../theme.js';

export function LocalLogin() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const cache = useQueryClient();

  async function signIn(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setBusy(true); setError(null);
    try {
      if (file.size > 4096) throw new Error('Неверный файл локального входа.');
      const ticket = JSON.parse(await file.text()) as { origin?: string; role?: string };
      if (ticket.origin !== location.origin) throw new Error('Этот файл предназначен для другого кабинета.');
      const response = await fetch('/__syntolk_local_login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ticket), credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error('Нажмите «Запустить Syntolk» и выберите новый файл локального входа.');
      const { credential, role } = await response.json() as { credential: string; role: string };
      const principal = await api<Principal>('/auth/whoami', { headers: { Authorization: `Bearer ${credential}` } });
      if (principal.role !== role || role !== ticket.role) throw new Error('Не совпадает кабинет локального входа.');
      await cache.cancelQueries(); cache.clear();
      setApiKey(credential);
      navigate('/');
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось войти.'); }
    finally { setBusy(false); }
  }

  return <div style={{ borderTop: `1px solid ${theme.border}`, marginTop: 20, paddingTop: 16 }}>
    <label style={{ display: 'block', color: theme.textMuted, fontSize: 12 }}>
      Локальный вход
      <input aria-label="Файл локального входа" type="file" accept=".json,application/json" disabled={busy} onChange={signIn} style={{ display: 'block', maxWidth: '100%', marginTop: 8, fontSize: 12, color: theme.textMuted }} />
    </label>
    {error && <div role="alert" style={{ color: theme.danger, fontSize: 12, marginTop: 8 }}>{error}</div>}
  </div>;
}
