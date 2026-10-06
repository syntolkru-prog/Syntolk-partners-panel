import { useQuery } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import { api, ApiError } from '../../api.js';
import { TenantLink } from '../../tenant-link.js';
import { Card, EmptyState, ErrorBanner, Page, Stat, StatusPill, formatDate, money } from '../../ui.js';
import { theme } from '../../theme.js';

interface Affiliation {
  id: string;
  vendorId: string;
  vendorPartnerId: string;
  status: string;
  joinedVendorAt: string;
  vendorName: string;
  vendorInstanceUrl: string;
}

interface Earnings {
  partnerId: string;
  since: string;
  clicks: number;
  attributedEvents: number;
  attributedRevenue: number;
  commissionByStatus: Record<string, number>;
}

function EarningsBlock({ aff }: { aff: Affiliation }) {
  // Skip the federated dashboard fetch for non-active affiliations.
  // Pending = no Partner row yet on that vendor; revoked = cut access.
  const enabled = aff.status === 'active';
  const { data, isLoading, error } = useQuery<Earnings, ApiError>({
    queryKey: ['network-aff-earnings', aff.id],
    queryFn: () => api<Earnings>(`/network/me/affiliations/${aff.id}/earnings`),
    enabled,
    retry: false,
    staleTime: 60_000,
  });

  if (!enabled) {
    return <p style={{ color: theme.textMuted, fontSize: 13 }}>Начисления появятся после активации партнёрства.</p>;
  }
  if (isLoading) return <p style={{ color: theme.textMuted, fontSize: 13 }}>Загрузка начислений…</p>;
  if (error) {
    if (error.status === 502) {
      return <p style={{ color: theme.textMuted, fontSize: 13 }}>Сервис компании недоступен — начисления обновятся после восстановления.</p>;
    }
    return <p style={{ color: theme.textMuted, fontSize: 13 }}>Не удалось загрузить начисления.</p>;
  }
  if (!data) return null;
  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 12 }}>
      <Stat label="Клики (30 дн.)" value={data.clicks.toLocaleString()} />
      <Stat label="Атрибуцированные события" value={data.attributedEvents.toLocaleString()} />
      <Stat label="Выручка" value={money(data.attributedRevenue, 'RUB')} />
      {Object.entries(data.commissionByStatus ?? {}).map(([status, amount]) => (
        <Stat key={status} label={`${commissionStatusLabel(status)} комиссия`} value={money(amount, 'RUB')} />
      ))}
    </div>
  );
}

function commissionStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    accrued: 'начисленная',
    approved: 'подтверждённая',
    paid: 'выплаченная',
    reversed: 'отменённая',
  };
  return labels[status] ?? status;
}

export function MyAffiliationsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['network-my-affiliations'],
    queryFn: () => api<{ affiliations: Affiliation[] }>(`/network/me/affiliations`),
    retry: false,
  });

  return (
    <Page title="Мои партнёрства" subtitle="Программы сети, в которых вы участвуете.">
      <ErrorBanner error={error} />
      {isLoading ? (
        <Card>Загрузка…</Card>
      ) : !data || data.affiliations.length === 0 ? (
        <EmptyState
          title="Партнёрств пока нет"
          hint="Найдите программу и подайте заявку, чтобы начать."
          icon={<Globe size={28} strokeWidth={1.25} />}
        />
      ) : (
        data.affiliations.map((a) => (
          <Card key={a.id}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <h3 style={{ marginTop: 0, marginBottom: 4, flex: 1 }}>
                <TenantLink to={`/network/vendors/${a.vendorId}`}>{a.vendorName}</TenantLink>
              </h3>
              <StatusPill status={a.status} />
            </div>
            <p style={{ color: theme.textMuted, fontSize: 13 }}>Подключено {formatDate(a.joinedVendorAt, { relative: true })}</p>
            <EarningsBlock aff={a} />
          </Card>
        ))
      )}
    </Page>
  );
}
