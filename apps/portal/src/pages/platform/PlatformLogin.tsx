import { useState } from 'react';
import { theme } from '../../theme.js';
import { Button, Input, Label } from '../../ui.js';
import { PlatformFrame } from './components.js';
import { papi, friendlyPlatformError } from './lib.js';

/**
 * Operator sign-in. POSTs the email to /platform-admin/signin, which always
 * returns 200 (no account enumeration), so we show the same "check your
 * email" confirmation regardless of whether the address is actually an
 * operator.
 */
export function PlatformLoginPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await papi('/platform-admin/signin', { method: 'POST', body: { email: email.trim() } });
      setSent(true);
    } catch (e) {
      setErr(friendlyPlatformError(e));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <PlatformFrame
        title="Check your email for a sign-in link"
        subtitle="If that address belongs to an operator, a link is on its way."
      >
        <div
          style={{
            background: theme.successSoft,
            border: `1px solid ${theme.success}55`,
            padding: 14,
            borderRadius: theme.radiusSm,
            fontSize: 13,
            color: theme.success,
          }}
        >
          Ссылку получают только операторы Syntolk. Она действует недолго — если срок истёк, запросите новую
          from this page if it expires.
        </div>
      </PlatformFrame>
    );
  }

  return (
    <PlatformFrame title="Вход оператора" subtitle="Введите рабочий email Syntolk — мы отправим ссылку для входа.">
      <form onSubmit={submit}>
        <div style={{ marginBottom: 12 }}>
          <Label>Email</Label>
          <Input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@syntolk.ru"
            required
            autoFocus
          />
        </div>
        {err && <div style={{ color: theme.danger, fontSize: 13, marginBottom: 8 }}>{err}</div>}
        <Button type="submit" disabled={busy || !email} style={{ width: '100%', justifyContent: 'center' }}>
          {busy ? 'Sending…' : 'Email me a sign-in link'}
        </Button>
      </form>
    </PlatformFrame>
  );
}
