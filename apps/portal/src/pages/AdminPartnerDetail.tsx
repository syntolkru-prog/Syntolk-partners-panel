import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Save } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { theme } from '../theme.js';
import { TenantLink } from '../tenant-link.js';
import {
  Button,
  Card,
  ErrorBanner,
  Input,
  Label,
  Page,
  SectionHeading,
  Select,
  Stat,
  StatusPill,
  Table,
  eventLabel,
  formatDate,
  money,
  shortId,
} from '../ui.js';

interface Partner {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  cloudPaymentsStatus: 'not_connected' | 'connected' | 'error';
  cloudPaymentsAccountId: string | null;
  cloudPaymentsError: string | null;
  tier: 'standard' | 'pro' | 'top';
}

interface DashboardData {
  clicks: number;
  attributedEvents: number;
  registrations: number;
  payingClients: number;
  conversionRate: number;
  attributedRevenue: number;
  balances: { accrued: number; available: number; pending: number; paid: number; total: number };
  links?: Array<{ linkKey: string; clicks: number; attributedEvents: number; attributedRevenue: number }>;
}

interface LinkRow {
  id: string;
  linkKey: string;
  label: string | null;
  channel: string | null;
  createdAt: string;
}

interface CommissionRow {
  id: string;
  amount: string;
  currency: string;
  status: string;
  payoutId: string | null;
  payoutStatus: string | null;
  customerLabel: string | null;
  eventType: string | null;
  paymentAmount: string | null;
  accruedAt: string;
}

interface PayoutRow {
  id: string;
  amount: string;
  currency: string;
  method: string;
  status: string;
  providerOperationId: string | null;
  createdAt: string;
  completedAt: string | null;
  metadata?: { cancellationReason?: string };
}

export function AdminPartnerDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const partner = useQuery({
    queryKey: ['partner', id],
    queryFn: () => api<Partner>(`/partners/${id}`),
    enabled: !!id,
  });
  const dashboard = useQuery({
    queryKey: ['partner-detail-dashboard', id],
    queryFn: () => api<DashboardData>(`/partners/${id}/dashboard?since=2000-01-01T00:00:00.000Z&includeLinks=true`),
    enabled: !!id,
  });
  const links = useQuery({
    queryKey: ['partner-detail-links', id],
    queryFn: () => api<{ links: LinkRow[] }>(`/partners/${id}/links`),
    enabled: !!id,
  });
  const commissions = useQuery({
    queryKey: ['partner-detail-commissions', id],
    queryFn: () => api<{ commissions: CommissionRow[] }>(`/partners/${id}/commissions?limit=8`),
    enabled: !!id,
  });
  const payouts = useQuery({
    queryKey: ['partner-detail-payouts', id],
    queryFn: () => api<{ payouts: PayoutRow[] }>(`/partners/${id}/payouts`),
    enabled: !!id,
  });
  const terms = useQuery({
    queryKey: ['partner-terms-history', id],
    queryFn: () => api<{ history: Array<{ id: string; version: string; acceptedAt: string }> }>(`/partners/${id}/terms-history`),
    enabled: !!id,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['partner', id] });
    qc.invalidateQueries({ queryKey: ['partners'] });
    qc.invalidateQueries({ queryKey: ['partner-detail-dashboard', id] });
  };

  if (partner.isLoading) return <Page title="Карточка партнёра"><Card>Загрузка…</Card></Page>;

  const error = partner.error ?? dashboard.error ?? links.error ?? commissions.error ?? payouts.error ?? terms.error;
  const p = partner.data;
  if (!p) {
    return (
      <Page title="Партнёр не найден">
        <ErrorBanner error={error ?? new Error('Партнёр не найден')} />
        <TenantLink to="/admin/partners" style={{ color: theme.accent }}>Вернуться к партнёрам</TenantLink>
      </Page>
    );
  }

  const d = dashboard.data;
  return (
    <Page
      title={p.name}
      subtitle={`${p.email}${p.phone ? ` · ${p.phone}` : ''}`}
      actions={
        <>
          <TenantLink to={`/links?partnerId=${p.id}`} style={{ color: theme.accent, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ExternalLink size={14} /> Открыть ссылки
          </TenantLink>
          <TenantLink to="/admin/partners" style={{ color: theme.textMuted, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ArrowLeft size={14} /> К партнёрам
          </TenantLink>
        </>
      }
    >
      <ErrorBanner error={error} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <Stat label="Переходы" value={d?.clicks ?? 0} />
        <Stat label="Регистрации" value={d?.registrations ?? 0} />
        <Stat label="Платящие клиенты" value={d?.payingClients ?? 0} />
        <Stat label="Выручка" value={money(d?.attributedRevenue ?? 0)} />
        <Stat label="Начислено" value={money(d?.balances.total ?? 0)} />
        <Stat label="Доступно" value={money(d?.balances.available ?? 0)} />
        <Stat label="Ожидает выплаты" value={money(d?.balances.pending ?? 0)} />
        <Stat label="Выплачено" value={money(d?.balances.paid ?? 0)} />
      </div>

      <SectionHeading>Профиль и выплаты</SectionHeading>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <PartnerProfileCard partner={p} onSaved={invalidate} />
        <CloudPaymentsCard partner={p} onSaved={invalidate} />
      </div>

      <SectionHeading>Эффективность ссылок</SectionHeading>
      {(d?.links ?? []).length === 0 ? (
        <Card style={{ color: theme.textMuted, fontSize: 13 }}>Ссылок пока нет.</Card>
      ) : (
        <Table
          columns={['Ссылка', 'Переходы', 'События', 'Выручка']}
          rows={(d?.links ?? []).map((link) => [
            <code style={{ color: theme.accent }}>{link.linkKey}</code>,
            link.clicks,
            link.attributedEvents,
            money(link.attributedRevenue),
          ])}
        />
      )}

      <SectionHeading>Последние начисления</SectionHeading>
      <Table
        columns={['Клиент', 'Событие', 'Сумма оплаты', 'Комиссия', 'Статус', 'Дата']}
        empty="Начислений пока нет."
        rows={(commissions.data?.commissions ?? []).map((c) => [
          c.customerLabel ?? '—',
          eventLabel(c.eventType),
          c.paymentAmount ? money(c.paymentAmount, c.currency) : '—',
          money(c.amount, c.currency),
          <StatusPill status={c.payoutId && c.payoutStatus !== 'paid' && ['approved', 'paid'].includes(c.status) ? 'pending' : c.status} />,
          formatDate(c.accruedAt),
        ])}
      />

      <SectionHeading>История выплат</SectionHeading>
      <Table
        columns={['ID', 'Сумма', 'Метод', 'Статус', 'Операция провайдера', 'Создана', 'Завершена']}
        empty="Выплат пока нет."
        rows={(payouts.data?.payouts ?? []).map((row) => [
          <code style={{ color: theme.textDim }}>{shortId(row.id)}</code>,
          money(row.amount, row.currency),
          row.method === 'manual' ? 'Вручную' : row.method,
          row.metadata?.cancellationReason === 'manual_cancel'
            ? <span style={{ color: theme.textMuted }}>отменена</span>
            : <StatusPill status={row.status} />,
          row.providerOperationId ?? '—',
          formatDate(row.createdAt),
          formatDate(row.completedAt),
        ])}
      />

      <SectionHeading>Созданные ссылки и принятие условий</SectionHeading>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
          <Info label="Ссылок создано" value={String(links.data?.links.length ?? 0)} />
          <Info label="Регистрация" value={p.activatedAt ? formatDate(p.activatedAt) : 'Приглашён, ещё не вошёл'} />
          <Info label="Условия" value={p.termsAcceptedAt ? `${p.termsVersion ?? 'версия не указана'} · ${formatDate(p.termsAcceptedAt)}` : 'Не приняты'} />
          <Info label="Конверсия" value={`${((d?.conversionRate ?? 0) * 100).toFixed(1)}%`} />
        </div>
        {terms.data?.history && terms.data.history.length > 0 && (
          <div style={{ color: theme.textMuted, fontSize: 12 }}>
            История версий: {terms.data.history.map((h) => `${h.version} (${formatDate(h.acceptedAt)})`).join(' · ')}
          </div>
        )}
      </Card>
    </Page>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: theme.textDim, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 14 }}>{value}</div>
    </div>
  );
}

function PartnerProfileCard({ partner, onSaved }: { partner: Partner; onSaved: () => void }) {
  const [tier, setTier] = useState(partner.tier);
  useEffect(() => setTier(partner.tier), [partner.tier]);
  const save = useMutation({
    mutationFn: () => api(`/partners/${partner.id}/tier`, { method: 'PATCH', body: { tier } }),
    onSuccess: onSaved,
  });
  return (
    <Card>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Профиль партнёра</div>
      <div style={{ display: 'grid', gap: 10 }}>
        <Info label="Статус" value={partner.revokedAt ? 'Заблокирован' : partner.activatedAt ? 'Активен' : 'Приглашён'} />
        <Info label="Создан" value={formatDate(partner.createdAt)} />
        {partner.revokedAt && <Info label="Причина блокировки" value={partner.revokeReason ?? 'Не указана'} />}
        <div>
          <Label>Уровень партнёра</Label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Select value={tier} onChange={(e) => setTier(e.target.value as Partner['tier'])}>
              <option value="standard">Стандарт</option>
              <option value="pro">Pro</option>
              <option value="top">Top</option>
            </Select>
            <Button size="sm" icon={<Save size={13} />} onClick={() => save.mutate()} disabled={save.isPending || tier === partner.tier}>
              {save.isPending ? '…' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </div>
      <ErrorBanner error={save.error} />
    </Card>
  );
}

function CloudPaymentsCard({ partner, onSaved }: { partner: Partner; onSaved: () => void }) {
  const [status, setStatus] = useState(partner.cloudPaymentsStatus);
  const [accountId, setAccountId] = useState(partner.cloudPaymentsAccountId ?? '');
  const [errorText, setErrorText] = useState(partner.cloudPaymentsError ?? '');
  useEffect(() => {
    setStatus(partner.cloudPaymentsStatus);
    setAccountId(partner.cloudPaymentsAccountId ?? '');
    setErrorText(partner.cloudPaymentsError ?? '');
  }, [partner.cloudPaymentsStatus, partner.cloudPaymentsAccountId, partner.cloudPaymentsError]);
  const save = useMutation({
    mutationFn: () => api(`/partners/${partner.id}/cloudpayments`, {
      method: 'PATCH',
      body: { status, accountId: accountId.trim() || null, error: status === 'error' ? errorText.trim() || null : null },
    }),
    onSuccess: onSaved,
  });
  return (
    <Card>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 5 }}>CloudPayments</div>
      <div style={{ color: theme.textMuted, fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
        Здесь хранится только состояние подключения и внешний идентификатор. Секреты и данные карт в Syntolk не сохраняются.
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <Label>Статус</Label>
          <Select value={status} onChange={(e) => setStatus(e.target.value as Partner['cloudPaymentsStatus'])}>
            <option value="not_connected">Не подключён</option>
            <option value="connected">Подключён</option>
            <option value="error">Ошибка</option>
          </Select>
        </div>
        <div>
          <Label>ID аккаунта / получателя</Label>
          <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Внешний идентификатор CloudPayments" />
        </div>
        {status === 'error' && (
          <div>
            <Label>Описание ошибки</Label>
            <Input value={errorText} onChange={(e) => setErrorText(e.target.value)} placeholder="Что нужно исправить" />
          </div>
        )}
        <Button size="sm" icon={<Save size={13} />} onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Сохраняем…' : 'Сохранить состояние'}
        </Button>
      </div>
      <div style={{ marginTop: 10 }}><StatusPill status={partner.cloudPaymentsStatus} /></div>
      <ErrorBanner error={save.error} />
    </Card>
  );
}
