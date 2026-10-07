import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Receipt } from 'lucide-react';
import { api, type Principal } from '../api.js';
import { theme } from '../theme.js';
import { Button, Card, EmptyState, ErrorBanner, Page, StatusPill, Table, eventLabel, formatDate, money, shortId } from '../ui.js';

export { StatusPill };

interface Commission {
  id: string;
  partnerId: string;
  amount: string;
  currency: string;
  status: string;
  payoutId: string | null;
  payoutStatus: string | null;
  accruedAt: string;
  paidAt: string | null;
  customerLabel: string | null;
  campaignName: string | null;
  eventType: string | null;
  paymentAmount: string | null;
  paymentCurrency: string | null;
  eventTs: string | null;
}

export function CommissionsPage({ principal }: { principal: Principal }) {
  const queryPartnerId = new URLSearchParams(window.location.search).get('partnerId');
  const partnerId = principal.partnerId ?? queryPartnerId;

  const url = partnerId ? `/partners/${partnerId}/commissions?limit=500` : `/commissions?limit=500`;
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['commissions', partnerId ?? 'all'],
    queryFn: () => api<{ commissions: Commission[] }>(url),
  });

  const isAdminView = principal.role === 'admin' && !partnerId;
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const adjust = useMutation({
    mutationFn: () => api(`/commissions/${adjustingId}/adjust`, {
      method: 'POST',
      body: { amount: Number(adjustmentAmount), reason: adjustmentReason },
    }),
    onSuccess: () => {
      setAdjustingId(null);
      setAdjustmentAmount('');
      setAdjustmentReason('');
      void refetch();
    },
  });
  const columns = isAdminView
    ? ['ID', 'Партнёр', 'Клиент', 'Тариф / событие', { label: 'Платёж', align: 'right' as const }, { label: 'Комиссия', align: 'right' as const }, 'Статус', 'Начислено', 'Выплачено', 'Действие']
    : ['ID', 'Клиент', 'Тариф / событие', { label: 'Платёж', align: 'right' as const }, { label: 'Комиссия', align: 'right' as const }, 'Статус', 'Начислено', 'Выплачено'];

  const rows = (data?.commissions ?? []).map((c) => {
    const base = [
      <code style={{ color: theme.textDim, fontSize: 12 }}>{shortId(c.id)}</code>,
      isAdminView ? <code style={{ color: theme.textDim, fontSize: 12 }}>{shortId(c.partnerId)}</code> : null,
      <code style={{ color: theme.textMuted, fontSize: 12 }}>{c.customerLabel ?? '—'}</code>,
      <span style={{ color: theme.textMuted }}>{c.campaignName ?? eventLabel(c.eventType)}</span>,
      <span style={{ color: theme.textMuted }}>{c.paymentAmount ? money(c.paymentAmount, c.paymentCurrency ?? c.currency) : '—'}</span>,
      <span style={{ fontWeight: 500 }}>{money(c.amount, c.currency)}</span>,
      <StatusPill status={c.payoutId && c.payoutStatus !== 'paid' && ['approved', 'paid'].includes(c.status) ? 'pending' : c.status} />,
      <span style={{ color: theme.textMuted }}>{formatDate(c.accruedAt, { relative: true })}</span>,
      <span style={{ color: theme.textMuted }}>{formatDate(c.payoutId && c.payoutStatus !== 'paid' ? null : c.paidAt, { relative: true })}</span>,
    ];
    return base.filter((x) => x !== null) as React.ReactNode[];
  });

  return (
    <Page title="Начисления" subtitle={partnerId ? 'Доход с оплаченных событий клиентов.' : 'Все партнёры и все начисления.'}>
      <ErrorBanner error={error} />
      {adjustingId && isAdminView && (
        <Card style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Ручная корректировка комиссии</div>
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr auto', gap: 10, alignItems: 'end' }}>
            <div><label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5 }}>Сумма (+ / −), ₽</label><input value={adjustmentAmount} onChange={(e) => setAdjustmentAmount(e.target.value)} type="number" step="0.01" style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: theme.surface2, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm }} /></div>
            <div><label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5 }}>Причина</label><input value={adjustmentReason} onChange={(e) => setAdjustmentReason(e.target.value)} placeholder="Например, исправление интеграции" style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: theme.surface2, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm }} /></div>
            <div style={{ display: 'flex', gap: 6 }}><button onClick={() => adjust.mutate()} disabled={adjust.isPending || !adjustmentReason.trim() || !Number.isFinite(Number(adjustmentAmount))} style={{ padding: '8px 12px', border: 0, borderRadius: theme.radiusSm, background: theme.accent, color: theme.accentInk, cursor: 'pointer' }}>{adjust.isPending ? 'Сохраняем…' : 'Сохранить'}</button><button onClick={() => setAdjustingId(null)} style={{ padding: '8px 12px', border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm, background: 'transparent', color: theme.text, cursor: 'pointer' }}>Отмена</button></div>
          </div>
          <ErrorBanner error={adjust.error} />
        </Card>
      )}
      {isLoading ? (
        <Card>Загрузка…</Card>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Начислений пока нет"
          hint="Начисление появится после привязанной регистрации или оплаты."
          icon={<Receipt size={28} strokeWidth={1.25} />}
        />
      ) : (
        <Table columns={columns} rows={rows.map((row, index) => {
          if (!isAdminView) return row;
          const commission = data?.commissions[index];
          return [...row, <Button size="sm" variant="ghost" onClick={() => setAdjustingId(commission?.id ?? null)}>Исправить</Button>];
        })} />
      )}
    </Page>
  );
}
