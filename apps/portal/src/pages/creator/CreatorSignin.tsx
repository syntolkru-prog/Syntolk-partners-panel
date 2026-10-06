import { useState } from 'react';
import { Link } from 'react-router-dom';
import { theme } from '../../theme.js';
import { AuthFrame } from '../auth/Shared.js';
import { creatorApi, ApiError } from './creator-api.js';

export function CreatorSigninPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await creatorApi('/creators/signin', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setSent(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Что-то пошло не так.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthFrame title="Проверьте входящие" subtitle={`Если аккаунт для ${email} существует, мы отправили ссылку для входа.`}>
        <div style={{ background: theme.successSoft, border: `1px solid ${theme.success}55`, padding: 14, borderRadius: theme.radiusSm, fontSize: 13, color: theme.success }}>
          Ссылка действует 15 минут.
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Вход автора" subtitle="Мы отправим на email одноразовую ссылку для входа.">
      <form onSubmit={submit}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>Email</div>
          <input type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ada@example.com" required autoFocus style={inputStyle} />
        </div>
        {err && <div style={{ color: theme.danger, fontSize: 13, marginBottom: 8 }}>{err}</div>}
        <button type="submit" disabled={busy} style={primaryBtnStyle(busy)}>
          {busy ? 'Отправляем…' : 'Отправить ссылку для входа'}
        </button>
        <div style={{ marginTop: 12, fontSize: 12, color: theme.textDim, textAlign: 'center' }}>
          Впервые здесь? <Link to="/creator/signup" style={{ color: theme.accent }}>Создать аккаунт</Link> · <Link to="/" style={{ color: theme.accent }}>Главная</Link>
        </div>
      </form>
    </AuthFrame>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  background: theme.surface2,
  border: `1px solid ${theme.border}`,
  borderRadius: theme.radiusSm,
  color: theme.text,
};

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    marginTop: 6,
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
