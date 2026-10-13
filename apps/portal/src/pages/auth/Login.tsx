import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Mail } from 'lucide-react';
import { api, setApiKey, ApiError, type Principal } from '../../api.js';
import { useTenantBase } from '../../tenant-base.js';
import { theme } from '../../theme.js';
import { Logo, AuthFrame } from './Shared.js';

type Tab = 'email' | 'key';

export function LoginPage() {
  const [tab, setTab] = useState<Tab>('email');
  return (
    <AuthFrame title="Вход" subtitle="Выберите способ входа.">
      <div style={{ display: 'flex', gap: 4, background: theme.bg, padding: 4, borderRadius: theme.radiusSm, marginBottom: 20 }}>
        <TabButton active={tab === 'email'} onClick={() => setTab('email')} icon={<Mail size={14} />}>
          Email
        </TabButton>
        <TabButton active={tab === 'key'} onClick={() => setTab('key')} icon={<KeyRound size={14} />}>
          Ключ администратора / партнёра
        </TabButton>
      </div>
      {tab === 'email' ? <EmailTab /> : <KeyTab />}
    </AuthFrame>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: '7px 10px',
        background: active ? theme.surface : 'transparent',
        color: active ? theme.text : theme.textMuted,
        border: 'none',
        borderRadius: theme.radiusSm,
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        justifyContent: 'center',
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function EmailTab() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/auth/signin', { method: 'POST', body: { email } });
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div style={{ background: theme.successSoft, border: `1px solid ${theme.success}55`, padding: 14, borderRadius: theme.radiusSm, fontSize: 13, color: theme.success }}>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>Проверьте входящие</div>
        <div style={{ color: `${theme.success}cc` }}>
          Если аккаунт для адреса <strong>{email}</strong> существует, мы отправили ссылку для входа. Она действует 15 минут.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <div style={{ position: 'relative' }}>
        <Mail size={15} style={{ position: 'absolute', left: 12, top: 12, color: theme.textDim, pointerEvents: 'none' }} />
        <input
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoFocus
          required
          style={inputStyle}
        />
      </div>
      {err && <div style={{ color: theme.danger, fontSize: 13, marginTop: 8 }}>{err}</div>}
      <button type="submit" disabled={busy || !email} style={primaryBtnStyle(busy || !email)}>
        {busy ? 'Отправляем…' : 'Отправить ссылку для входа'}
      </button>
    </form>
  );
}

function KeyTab() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const tenantBase = useTenantBase();
  const [token, setToken] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const credential = token.trim();
      await api<Principal>('/auth/whoami', { headers: { Authorization: `Bearer ${credential}` } });
      await queryClient.cancelQueries();
      queryClient.clear();
      setApiKey(credential);
      // Land on the tenant root (admin dashboard for admin keys,
      // partner dashboard for partner keys) rather than '/' which
      // strips the tenant prefix and falls through to the marketing
      // landing page on multi-tenant deployments.
      nav(tenantBase || '/');
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) {
          setErr('Этот ключ не подошёл.');
        } else if (e.status === 403 && typeof e.message === 'string' && e.message.includes('scoped_key_not_for_portal')) {
          // Common confusion: pasting a scoped integration key
          // (CRM / Zapier / federation) into the portal sign-in.
          // Tell them what kind of key actually works here.
          setErr(
            'Это ключ интеграции с ограниченной областью — он не подходит для входа в кабинет. Используйте ссылку администратора (вкладка Email) или API-ключ администратора.',
          );
        } else {
          setErr(e.message || 'Не удалось связаться с API.');
        }
      } else {
        setErr('Не удалось связаться с API.');
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div style={{ position: 'relative' }}>
        <KeyRound size={15} style={{ position: 'absolute', left: 12, top: 12, color: theme.textDim, pointerEvents: 'none' }} />
        <input
          type="password"
          name="apiKey"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="op_..."
          autoFocus
          style={{ ...inputStyle, fontFamily: theme.fontMono }}
        />
      </div>
      {err && <div style={{ color: theme.danger, fontSize: 13, marginTop: 8 }}>{err}</div>}
      <button type="submit" disabled={busy || !token} style={primaryBtnStyle(busy || !token)}>
        {busy ? 'Проверяем…' : 'Войти'}
      </button>
      <div style={{ marginTop: 12, fontSize: 12, color: theme.textDim, lineHeight: 1.6 }}>
        Ключи администратора задаются через <code style={{ color: theme.textMuted }}>ADMIN_API_KEY</code>.
        Ключи партнёров создаются в разделе администрирования партнёров.
        <br />
        <strong style={{ color: theme.textMuted }}>Не используйте ключ интеграции</strong> — ключи,
        созданные в разделе «Администрирование → Интеграция с CRM», предназначены для обмена между серверами
        и не подходят для входа в кабинет.
      </div>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px 10px 34px',
  fontSize: 14,
  background: theme.surface2,
  border: `1px solid ${theme.border}`,
  borderRadius: theme.radiusSm,
  color: theme.text,
};

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    marginTop: 14,
    width: '100%',
    padding: '10px 14px',
    background: theme.accent,
    color: theme.accentInk,
    border: 'none',
    borderRadius: theme.radiusSm,
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

export { Logo };
