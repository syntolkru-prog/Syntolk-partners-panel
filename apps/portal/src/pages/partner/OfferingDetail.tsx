import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type Principal } from '../../api.js';
import { TenantLink } from '../../tenant-link.js';
import { Button, Card, ErrorBanner, Input, Label, Page, Textarea } from '../../ui.js';
import { theme } from '../../theme.js';

interface Offering {
  id: string;
  title: string;
  description: string | null;
  productUrl: string;
  vendorId: string;
  vendorName: string;
  terms: {
    commissionDescription?: string;
    cookieWindowDays?: number;
    payoutCadence?: string;
    bonuses?: string[];
  };
  createdAt: string;
}

export function OfferingDetailPage({ principal }: { principal: Principal }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const [preferredSlug, setPreferredSlug] = useState('');

  const { data: offering, isLoading, error } = useQuery({
    queryKey: ['network-offering', id],
    queryFn: () => api<Offering>(`/network/offerings/${id}`),
    enabled: !!id,
    retry: false,
  });

  const apply = useMutation({
    mutationFn: () =>
      api(`/network/offerings/${id}/apply`, {
        method: 'POST',
        body: { message: message || undefined, preferredSlug: preferredSlug || undefined },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['network-my-requests'] });
      navigate('/network/requests');
    },
  });

  const canApply = principal.role === 'partner';

  return (
    <Page title={offering?.title ?? 'Программа'} subtitle={offering?.vendorName}>
      <ErrorBanner error={error} />
      {isLoading && <Card>Загрузка…</Card>}
      {offering && (
        <>
          <Card>
            {offering.terms.commissionDescription && (
              <p style={{ color: theme.textMuted, fontSize: 14 }}>
                {offering.terms.commissionDescription}
              </p>
            )}
            {offering.description && <p style={{ marginTop: 8 }}>{offering.description}</p>}
            <p style={{ marginTop: 12 }}>
              <a href={offering.productUrl} target="_blank" rel="noopener noreferrer">
                Открыть сайт →
              </a>
            </p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, color: theme.textMuted, fontSize: 13 }}>
              {offering.terms.cookieWindowDays != null && (
                <span>Окно cookie: {offering.terms.cookieWindowDays} дн.</span>
              )}
              {offering.terms.payoutCadence && <span>Выплаты: {offering.terms.payoutCadence}</span>}
            </div>
          </Card>

          <div style={{ height: 18 }} />

          <Card>
            <h3 style={{ marginTop: 0 }}>Подать заявку на продвижение</h3>
            {!canApply ? (
              <p style={{ color: theme.textMuted }}>
                Подавать заявки могут только аккаунты партнёров. <TenantLink to="/login">Сменить аккаунт</TenantLink>?
              </p>
            ) : (
              <>
                <ErrorBanner error={apply.error} />
                {apply.error instanceof ApiError && apply.error.detail && typeof apply.error.detail === 'object' &&
                  'detail' in (apply.error.detail as { detail?: { detail?: string } }) &&
                  (apply.error.detail as { detail?: string }).detail === 'request_already_exists' && (
                  <p style={{ color: theme.textMuted, fontSize: 13 }}>
                    У вас уже есть ожидающая или активная заявка на эту программу.
                  </p>
                )}
                <div style={{ marginTop: 8 }}>
                  <Label>Предпочтительный идентификатор ссылки (необязательно)</Label>
                  <Input
                    placeholder="your-handle"
                    value={preferredSlug}
                    onChange={(e) => setPreferredSlug(e.target.value)}
                  />
                </div>
                <div style={{ marginTop: 12 }}>
                  <Label>Сообщение компании (необязательно)</Label>
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    placeholder="Почему вы подходите для партнёрства…"
                  />
                </div>
                <div style={{ marginTop: 12 }}>
                  <Button onClick={() => apply.mutate()} disabled={apply.isPending}>
                    {apply.isPending ? 'Отправляем…' : 'Подать заявку'}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
