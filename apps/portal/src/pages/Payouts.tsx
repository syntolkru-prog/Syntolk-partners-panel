import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote, CheckCircle2, Play } from 'lucide-react';
import { api, type Principal } from '../api.js';
import { theme } from '../theme.js';
import { Button, Card, EmptyState, ErrorBanner, Page, StatusPill, Table, formatDate, money, shortId } from '../ui.js';

interface Payout {
  id: string;
  partnerId: string;
  amount: string;
  currency: string;
  method: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  providerTransferId: string | null;
  providerOperationId: string | null;
  providerStatus: string | null;
  partnerName?: string | null;
  partnerEmail?: string | null;
}

export function PayoutsPage({ principal }: { principal: Principal }) {
  const qc = useQueryClient();
  const queryPartnerId = new URLSearchParams(window.location.search).get('partnerId');
  const partnerId = principal.partnerId ?? queryPartnerId;
  const isAdmin = principal.role === 'admin';

  const runPayouts = useMutation({
    mutationFn: () =>
      api<{
        runId: string;
        payouts: unknown[];
        skippedBelowThreshold: Array<{ partnerId: string; currency: string; amount: number }>;
      }>('/payouts/run', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payouts'] });
      qc.invalidateQueries({ queryKey: ['commissions'] });
      qc.invalidateQueries({ queryKey: ['admin-overview'] });
    },
  });

  const confirmPayout = useMutation({
    mutationFn: (payoutId: string) => api(`/payouts/${payoutId}/confirm`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payouts'] });
      qc.invalidateQueries({ queryKey: ['admin-overview'] });
    },
  });

  const payouts = useQuery({
    queryKey: ['payouts', partnerId ?? 'none'],
    queryFn: () => {
      if (isAdmin) {
        return api<{ payouts: Payout[] }>(`/payouts?limit=200${partnerId ? `&partnerId=${encodeURIComponent(partnerId)}` : ''}`);
      }
      return api<{ payouts: Payout[] }>(`/partners/${partnerId}/payouts`);
    },
    enabled: isAdmin || !!partnerId,
  });

  const subtitle =
    principal.role === 'admin'
      ? partnerId
        ? 'История выплат выбранного партнёра.'
        : 'Общий реестр выплат и подтверждение ручных переводов.'
      : 'История ваших выплат.';

  const actions =
    principal.role === 'admin' ? (
      <Button icon={<Play size={14} />} onClick={() => runPayouts.mutate()} disabled={runPayouts.isPending}>
        {runPayouts.isPending ? 'Запуск…' : 'Рассчитать выплаты'}
      </Button>
    ) : undefined;

  return (
    <Page title="Выплаты" subtitle={subtitle} actions={actions}>
      <ErrorBanner error={runPayouts.error ?? confirmPayout.error ?? payouts.error} />

      {runPayouts.data && (
        <Card style={{ marginBottom: 14, borderColor: `${theme.accentA55}` }}>
          <div style={{ fontSize: 13, color: theme.accent, fontWeight: 500, marginBottom: 8 }}>
            Запуск #{shortId(runPayouts.data.runId)} — выплат: {runPayouts.data.payouts.length}
            {runPayouts.data.skippedBelowThreshold?.length > 0 && (
              <span style={{ color: theme.textMuted, fontWeight: 400 }}>
                {' '}
                · пропущено ниже порога: {runPayouts.data.skippedBelowThreshold.length}
              </span>
            )}
          </div>
          <pre
            style={{
              margin: 0,
              background: theme.bg,
              color: theme.text,
              padding: 14,
              borderRadius: theme.radiusSm,
              fontSize: 12,
              overflow: 'auto',
              maxHeight: 280,
            }}
          >
            {JSON.stringify(
              {
                payouts: runPayouts.data.payouts,
                ...(runPayouts.data.skippedBelowThreshold?.length
                  ? { skippedBelowThreshold: runPayouts.data.skippedBelowThreshold }
                  : {}),
              },
              null,
              2,
            )}
          </pre>
        </Card>
      )}

      {payouts.isLoading ? (
        <Card>Загрузка…</Card>
      ) : (payouts.data?.payouts ?? []).length === 0 ? (
        <EmptyState
          title="Выплат пока нет"
          hint={isAdmin ? 'После расчёта одобренные начисления появятся здесь.' : 'Одобренные начисления попадут сюда после следующего расчёта.'}
          icon={<Banknote size={28} strokeWidth={1.25} />}
        />
      ) : (
        <Table
          columns={[
            ...(isAdmin && !partnerId ? ['Партнёр'] : []),
            'ID',
            { label: 'Сумма', align: 'right' },
            'Метод',
            'Статус',
            'Операция провайдера',
            'Создана',
            'Завершена',
            ...(isAdmin ? ['Действия'] : []),
          ]}
          rows={(payouts.data?.payouts ?? []).map((p) => [
            ...(isAdmin && !partnerId
              ? [
                  <div>
                    <div style={{ fontWeight: 500 }}>{p.partnerName ?? shortId(p.partnerId)}</div>
                    {p.partnerEmail && <div style={{ color: theme.textDim, fontSize: 11 }}>{p.partnerEmail}</div>}
                  </div>,
                ]
              : []),
            <code style={{ color: theme.textDim, fontSize: 12 }}>{shortId(p.id)}</code>,
            <span style={{ fontWeight: 500 }}>{money(p.amount, p.currency)}</span>,
            <span style={{ color: theme.textMuted }}>{p.method === 'manual' ? 'Вручную' : p.method}</span>,
            <StatusPill status={p.status} />,
            <code style={{ color: theme.textMuted, fontSize: 11 }}>{p.providerOperationId ?? '—'}</code>,
            <span style={{ color: theme.textMuted }}>{formatDate(p.createdAt, { relative: true })}</span>,
            <span style={{ color: theme.textMuted }}>{formatDate(p.completedAt, { relative: true })}</span>,
            ...(isAdmin
              ? [
                  p.method === 'manual' && p.status === 'pending' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<CheckCircle2 size={13} />}
                      onClick={() => confirmPayout.mutate(p.id)}
                      disabled={confirmPayout.isPending}
                    >
                      Подтвердить
                    </Button>
                  ) : (
                    <span style={{ color: theme.textDim, fontSize: 12 }}>—</span>
                  ),
                ]
              : []),
          ])}
        />
      )}
    </Page>
  );
}
