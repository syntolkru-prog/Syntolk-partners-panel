import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Globe, RefreshCw, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api.js';
import { theme } from '../../theme.js';
import { Button, Card, ErrorBanner, Input, Label, Page, SectionHeading, StatusPill } from '../../ui.js';

/**
 * White-label wizard (spec Phase 3): enable the billing add-on, register a
 * custom domain, publish the two DNS records, verify. Everything here is
 * driven by /billing/white-label + /config/domain — the same endpoints ops
 * uses, so the concierge and self-serve paths can't drift.
 */

interface WhiteLabelBilling {
  provisioned: boolean;
  effective: boolean;
  plan: string | null;
  mode: string;
  subscribed: boolean;
  priceConfigured: boolean;
}

interface DnsInstructions {
  cname: { name: string; target: string };
  txt: { name: string; value: string };
  note: string;
}

interface DomainRow {
  id: string;
  domain: string;
  status: 'pending' | 'verified' | 'failed';
  edgeKind: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  dnsInstructions: DnsInstructions;
  edge?: string;
}

export function AdminWhiteLabel() {
  const billing = useQuery({
    queryKey: ['white-label-billing'],
    queryFn: () => api<WhiteLabelBilling>('/billing/white-label'),
  });
  const domains = useQuery({
    queryKey: ['white-label-domains'],
    queryFn: () => api<{ domains: DomainRow[] }>('/config/domain'),
    enabled: !!billing.data?.effective,
  });

  return (
    <Page
      title="Белая метка"
      subtitle="Открывайте кабинет партнёров на собственном домене только с вашим брендом."
    >
      <ErrorBanner error={billing.error} />
      {billing.isLoading ? (
        <Card>Загрузка…</Card>
      ) : billing.data ? (
        <>
          <AddOnCard billing={billing.data} />
          <div style={{ height: 16 }} />
          {billing.data.effective && (
            <DomainsCard rows={domains.data?.domains ?? []} loading={domains.isLoading} />
          )}
        </>
      ) : null}
    </Page>
  );
}

function AddOnCard({ billing }: { billing: WhiteLabelBilling }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['white-label-billing'] });
    void qc.invalidateQueries({ queryKey: ['white-label-domains'] });
    void qc.invalidateQueries({ queryKey: ['program-settings'] });
    void qc.invalidateQueries({ queryKey: ['public-branding'] });
  };

  const enable = useMutation({
    mutationFn: () => api<{ ok: boolean }>('/billing/white-label', { method: 'POST' }),
    onSuccess: refresh,
    onError: (err) => {
      if (err instanceof ApiError && String(err.message).includes('subscription_required')) {
        // Shouldn't happen (the button routes unsubscribed tenants through
        // Checkout instead) — but a race with a just-cancelled sub can.
        setError('Подписка на тариф неактивна — используйте кнопку подписки, чтобы возобновить её вместе с белой меткой.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Не удалось включить дополнение.');
      }
      refresh();
    },
  });
  const disable = useMutation({
    mutationFn: () => api<{ ok: boolean }>('/billing/white-label', { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Не удалось отключить дополнение.'),
  });
  // No active subscription: don't bounce the admin to Billing and back —
  // one Checkout with the plan AND the add-on bundled (the webhook flips
  // whiteLabel on completion, so the page is active when they return).
  const subscribeWithAddOn = useMutation({
    mutationFn: () =>
      api<{ url: string }>('/billing/checkout', {
        method: 'POST',
        body: {
          successUrl: `${window.location.origin}${window.location.pathname}?checkout=success`,
          cancelUrl: window.location.href,
          whiteLabel: true,
        },
      }),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: (err) => {
      if (err instanceof ApiError && String(err.message).includes('no_plan_chosen')) {
        setError('Сначала выберите тариф на странице оплаты — затем здесь можно подключить дополнение вместе с подпиской.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Не удалось открыть оплату.');
      }
    },
  });

  const selfhost = billing.mode === 'selfhost';
  // Enterprise has no Checkout; direct-enable is correct there. Everyone
  // else needs a live subscription for the add-on item to attach to.
  const needsCheckout = !billing.subscribed && billing.plan !== 'enterprise';

  return (
    <Card>
      <SectionHeading
        actions={
          selfhost ? null : billing.provisioned ? (
            <Button
              variant="ghost"
              onClick={() => {
                if (
                  window.confirm(
                    'Отключить белую метку? Собственный домен перестанет открываться, а брендинг платформы вернётся. Дополнение будет удалено из подписки с пропорциональным перерасчётом.',
                  )
                ) {
                  disable.mutate();
                }
              }}
              disabled={disable.isPending}
            >
              {disable.isPending ? 'Отключаем…' : 'Отключить дополнение'}
            </Button>
          ) : needsCheckout ? (
            <Button
              onClick={() => subscribeWithAddOn.mutate()}
              disabled={subscribeWithAddOn.isPending || !billing.priceConfigured}
            >
              {subscribeWithAddOn.isPending ? 'Открываем оплату…' : 'Оформить подписку с белой меткой'}
            </Button>
          ) : (
            <Button onClick={() => enable.mutate()} disabled={enable.isPending || !billing.priceConfigured}>
              {enable.isPending ? 'Включаем…' : 'Включить белую метку'}
            </Button>
          )
        }
      >
        Дополнение «Белая метка»
      </SectionHeading>
      {error && <div style={{ color: theme.danger, fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <div style={{ fontSize: 13, color: theme.textMuted, lineHeight: 1.6 }}>
        {selfhost ? (
          <>В локальных установках белая метка доступна всегда — настройте бренд в разделе «Настройки» и пропустите эту страницу.</>
        ) : billing.effective ? (
          <>
            <StatusPill status="active" /> Дополнение активно. Брендинг платформы удалён, разделы сети скрыты,
            а кабинет можно открыть на собственном домене ниже.
          </>
        ) : billing.provisioned ? (
          <>
            <StatusPill status="warning" /> Дополнение подготовлено, но пока недоступно — проверьте активность
            подписки на странице оплаты. Собственный домен не будет открываться до восстановления оплаты.
          </>
        ) : (
          <>
            Убирает брендинг Syntolk из кабинета партнёра и писем, скрывает общую сеть и
            кабинет открывается на вашем домене (например, <code>partners.syntolk.ru</code>). Дополнение оплачивается
            ежемесячно вместе с тарифом{billing.priceConfigured ? '' : ' — стоимость ещё не настроена в этой установке; обратитесь в поддержку'}.
            {needsCheckout && billing.priceConfigured && (
              <>
                {' '}Подписка на тариф ещё не активна — одна оплата запустит её вместе с дополнением.
              </>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function DomainsCard({ rows, loading }: { rows: DomainRow[]; loading: boolean }) {
  const qc = useQueryClient();
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['white-label-domains'] });
    void qc.invalidateQueries({ queryKey: ['public-branding'] });
  };

  const register = useMutation({
    mutationFn: (d: string) => api<DomainRow>('/config/domain', { method: 'POST', body: { domain: d } }),
    onSuccess: () => {
      setDomain('');
      setError(null);
      refresh();
    },
    onError: (err) => setError(friendlyDomainError(err)),
  });

  return (
    <Card>
      <SectionHeading>Собственный домен</SectionHeading>
      {rows.length === 0 && (
        <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 12, lineHeight: 1.6 }}>
          Используйте принадлежащий вам поддомен, например <code>partners.syntolk.ru</code>. После регистрации
          появятся две DNS-записи; когда они обновятся, нажмите «Проверить», и TLS настроится автоматически.
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (domain.trim()) register.mutate(domain.trim().toLowerCase());
        }}
        style={{ display: 'flex', gap: 8, marginBottom: rows.length > 0 ? 18 : 0, maxWidth: 480 }}
      >
        <Input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="partners.syntolk.ru"
          style={{ flex: 1 }}
        />
        <Button type="submit" disabled={register.isPending || !domain.trim()}>
          {register.isPending ? 'Регистрируем…' : 'Зарегистрировать'}
        </Button>
      </form>
      {error && <div style={{ color: theme.danger, fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {loading && <div style={{ fontSize: 13, color: theme.textMuted }}>Загрузка…</div>}
      {rows.map((row) => (
        <DomainRowView key={row.id} row={row} onChanged={refresh} />
      ))}
    </Card>
  );
}

function DomainRowView({ row, onChanged }: { row: DomainRow; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: () => api<DomainRow & { edge?: string }>(`/config/domain/${row.id}/verify`, { method: 'POST' }),
    onSuccess: (r) => {
      setError(null);
      setVerifyNote(
        r.edge === 'skipped' || r.edge === 'failed'
          ? 'Проверено, но регистрацию на edge нужно выполнить оператору. Поддержка получила сигнал в журнале.'
          : 'Проверено. TLS настраивается — обычно домен становится доступен через несколько минут.',
      );
      onChanged();
    },
    onError: (err) => {
      setVerifyNote(null);
      setError(
        err instanceof ApiError && String(err.message).includes('verification_failed')
          ? row.status === 'verified'
            ? 'Запись подтверждения владения пока не видна — домен остаётся активным, проверка повторится завтра.'
            : 'DNS-записи пока не видны — обновление может занять несколько минут. Значения не изменились, повторите попытку позже.'
          : friendlyDomainError(err),
      );
    },
  });
  const remove = useMutation({
    mutationFn: () => api<{ ok: boolean }>(`/config/domain/${row.id}`, { method: 'DELETE' }),
    onSuccess: onChanged,
    onError: (err) => setError(friendlyDomainError(err)),
  });

  return (
    <div
      style={{
        border: `1px solid ${theme.borderSubtle}`,
        borderRadius: theme.radiusSm,
        padding: 14,
        marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Globe size={15} style={{ color: theme.textMuted }} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{row.domain}</span>
        <StatusPill status={row.status === 'verified' ? 'active' : row.status} />
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={() => verify.mutate()} disabled={verify.isPending}>
          <RefreshCw size={13} /> {verify.isPending ? 'Проверяем…' : row.status === 'verified' ? 'Проверить повторно' : 'Проверить'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            if (window.confirm(`Удалить ${row.domain}? Кабинет сразу перестанет открываться на этом домене.`)) {
              remove.mutate();
            }
          }}
          disabled={remove.isPending}
        >
          <Trash2 size={13} />
        </Button>
      </div>
      {error && <div style={{ color: theme.danger, fontSize: 13, marginTop: 8 }}>{error}</div>}
      {verifyNote && <div style={{ color: theme.success, fontSize: 13, marginTop: 8 }}>{verifyNote}</div>}
      <div style={{ marginTop: 12 }}>
        <Label>DNS-записи для публикации (TXT-запись должна оставаться постоянно)</Label>
        <DnsRecord kind="CNAME" name={row.dnsInstructions.cname.name} value={row.dnsInstructions.cname.target} />
        <DnsRecord kind="TXT" name={row.dnsInstructions.txt.name} value={row.dnsInstructions.txt.value} />
      </div>
      {row.status === 'verified' && row.verifiedAt && (
        <div style={{ fontSize: 12, color: theme.textDim, marginTop: 8 }}>
          Проверено {new Date(row.verifiedAt).toLocaleString()} · проверка владения выполняется ежедневно
        </div>
      )}
    </div>
  );
}

function DnsRecord({ kind, name, value }: { kind: string; name: string; value: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, which: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: theme.fontMono,
        fontSize: 12,
        background: theme.surface2,
        border: `1px solid ${theme.borderSubtle}`,
        borderRadius: 6,
        padding: '8px 10px',
        marginTop: 6,
        overflowX: 'auto',
      }}
    >
      <span style={{ color: theme.accent, minWidth: 46 }}>{kind}</span>
      <CopyChunk text={name} copied={copied === 'name'} onCopy={() => copy(name, 'name')} />
      <span style={{ color: theme.textDim }}>→</span>
      <CopyChunk text={value} copied={copied === 'value'} onCopy={() => copy(value, 'value')} />
    </div>
  );
}

function CopyChunk({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <button
      type="button"
      onClick={onCopy}
      title="Скопировать"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: 'transparent',
        border: 'none',
        color: theme.text,
        fontFamily: 'inherit',
        fontSize: 'inherit',
        cursor: 'pointer',
        padding: 0,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
      {copied ? <Check size={12} style={{ color: theme.success }} /> : <Copy size={12} style={{ color: theme.textDim }} />}
    </button>
  );
}

function friendlyDomainError(err: unknown): string {
  const code = err instanceof ApiError ? String(err.message) : '';
  if (code.includes('domain_taken')) return 'Этот домен уже зарегистрирован в другой компании.';
  if (code.includes('subdomain_required')) return 'Корневые домены пока не поддерживаются — используйте поддомен, например partners.syntolk.ru.';
  if (code.includes('reserved_host')) return 'Это имя хоста зарезервировано.';
  if (code.includes('invalid_domain')) return 'Имя хоста не похоже на корректный домен.';
  if (code.includes('white_label_not_entitled')) return 'Дополнение «Белая метка» не активно — сначала включите его выше.';
  return code || 'Произошла ошибка.';
}
