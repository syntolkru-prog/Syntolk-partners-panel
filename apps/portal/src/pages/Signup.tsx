import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api.js';
import { theme } from '../theme.js';
import { AuthFrame, SignupTabs } from './auth/Shared.js';

type SignupPlan = 'flex' | 'revshare' | 'enterprise';
const PLAN_LABELS: Record<SignupPlan, { name: string; tagline: string }> = {
  flex: { name: 'Flex', tagline: '$49/мес. + 1,5% атрибуцированной выручки · пробный период 14 дней' },
  revshare: { name: 'Revshare', tagline: '3% атрибуцированной выручки, без ежемесячной платы · пробный период 14 дней' },
  enterprise: { name: 'Enterprise', tagline: 'Индивидуальная стоимость — мы свяжемся с вами' },
};
function isPlan(s: string | null): s is SignupPlan {
  return s === 'flex' || s === 'revshare' || s === 'enterprise';
}

interface SignupResult {
  ok: true;
  tenant: { id: string; slug: string };
  mailDelivered?: boolean;
  mailError?: string;
}

export function SignupPage() {
  const [params] = useSearchParams();
  const planParam = params.get('plan');
  const plan: SignupPlan | null = isPlan(planParam) ? planParam : null;
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<SignupResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      // Public signup — explicit fetch so we don't pick up a stale tenant
      // prefix from currentTenantSlug() if the user navigated here from
      // somewhere weird. /signup is mounted before tenantMiddleware on
      // the API side anyway.
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: slug.trim().toLowerCase(),
          displayName: displayName.trim(),
          adminEmail: adminEmail.trim().toLowerCase(),
          adminName: adminName.trim(),
          // Enterprise is sales-led: the API refuses self-declared
          // enterprise (it would bypass the plan-required gate), so the
          // CTA only records intent visually; ops set the plan on close.
          ...(plan && plan !== 'enterprise' ? { plan } : {}),
        }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        throw new ApiError(res.status, String(data.error ?? `${res.status}`), data);
      }
      setResult(data as unknown as SignupResult);
    } catch (e) {
      const code = e instanceof ApiError ? String(e.message) : 'unknown_error';
      setErr(friendlyError(code));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <AuthFrame title="Проверьте почту" subtitle={`Мы отправили ссылку для входа на ${adminEmail}.`}>
        <div style={{ background: theme.successSoft, border: `1px solid ${theme.success}55`, padding: 14, borderRadius: theme.radiusSm, fontSize: 13, color: theme.success }}>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>Аккаунт компании создан.</div>
          <div style={{ color: `${theme.success}cc` }}>
            Ваш идентификатор: <code>{result.tenant.slug}</code>. Ссылка активации действительна 15 минут.
          </div>
        </div>
        {result.mailDelivered === false && (
          <div style={{ marginTop: 12, color: theme.danger, fontSize: 13 }}>
            Не удалось отправить письмо: {result.mailError ?? 'неизвестная ошибка'}. Обратитесь в поддержку.
          </div>
        )}
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Регистрация компании" subtitle="Создайте аккаунт компании — мы отправим ссылку для входа на вашу почту.">
      <SignupTabs active="brand" />
      {plan && (
        <div
          style={{
            background: `${theme.accentA10}`,
            border: `1px solid ${theme.accentA55}`,
            borderRadius: theme.radiusSm,
            padding: '10px 12px',
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 12, color: theme.accent, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 2 }}>
            Тариф: {PLAN_LABELS[plan].name}
          </div>
          <div style={{ fontSize: 12, color: theme.textMuted }}>
            {PLAN_LABELS[plan].tagline}
          </div>
        </div>
      )}
      <form onSubmit={submit}>
        <Field label="Название компании" hint="Так его будут видеть партнёры — например, Syntolk.">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Syntolk"
            required
            style={inputStyle}
          />
        </Field>
        <Field label="URL-идентификатор" hint="Строчные буквы, цифры и дефисы. Используется в адресе кабинета Syntolk.">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="acme"
            pattern="[a-z0-9\-]{3,40}"
            minLength={3}
            maxLength={40}
            required
            style={{ ...inputStyle, fontFamily: theme.fontMono }}
          />
        </Field>
        <Field label="Ваше имя">
          <input
            name="name"
            autoComplete="name"
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            placeholder="Ada Lovelace"
            required
            style={inputStyle}
          />
        </Field>
        <Field label="Ваш email" hint="Сюда мы отправим ссылку активации.">
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder="ada@example.com"
            required
            style={inputStyle}
          />
        </Field>
        {err && <div style={{ color: theme.danger, fontSize: 13, marginTop: 4, marginBottom: 8 }}>{err}</div>}
        <button type="submit" disabled={busy} style={primaryBtnStyle(busy)}>
          {busy ? 'Создаём компанию…' : 'Создать аккаунт компании'}
        </button>
        <div style={{ marginTop: 12, fontSize: 12, color: theme.textDim, textAlign: 'center' }}>
          Уже есть программа? <Link to="/signin" style={{ color: theme.accent }}>Войти</Link>
        </div>
      </form>
    </AuthFrame>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 4 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: theme.textDim, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function friendlyError(code: string): string {
  if (code.includes('slug_taken')) return 'Этот идентификатор уже занят. Выберите другой.';
  if (code.includes('slug_reserved')) return 'Этот идентификатор зарезервирован. Попробуйте другой.';
  if (code.includes('invalid_body')) return 'Проверьте заполнение полей, формат идентификатора и email.';
  if (code.includes('signup_not_available')) return 'Публичная регистрация отключена в этой установке.';
  return 'Произошла ошибка. Повторите попытку или обратитесь в поддержку.';
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
