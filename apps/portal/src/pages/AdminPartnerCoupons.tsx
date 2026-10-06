import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, ApiError } from '../api.js';
import { theme } from '../theme.js';
import { TenantLink } from '../tenant-link.js';
import { Button, Card, ErrorBanner, Input, Label, Page } from '../ui.js';

interface Partner {
  id: string;
  name: string;
}

interface CouponRow {
  id: string;
  code: string;
  programId: string;
  createdAt: string;
  redemptions90d?: number;
  revenue90d?: number;
  /** Null = active. Non-null = retired; the provider promotion code is
   *  disabled so customers entering this string at checkout get an
   *  invalid-code error. Historical attribution stays attached. */
  deactivatedAt?: string | null;
}

interface ProgramBrief {
  id: string;
  name: string;
}

export function AdminPartnerCoupons() {
  const { id } = useParams<{ id: string }>();
  const partnerId = id ?? '';
  const qc = useQueryClient();

  const partner = useQuery({
    queryKey: ['partner', partnerId],
    queryFn: () => api<Partner>(`/partners/${partnerId}`),
    enabled: !!partnerId,
  });

  const coupons = useQuery({
    queryKey: ['partner-coupons', partnerId],
    queryFn: () => api<{ coupons: CouponRow[] }>(`/partners/${partnerId}/coupons`),
    enabled: !!partnerId,
  });
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api<{ programs: ProgramBrief[] }>('/programs'),
  });

  const [pickedProgram, setPickedProgram] = useState('');
  const [customCode, setCustomCode] = useState('');

  const mint = useMutation({
    mutationFn: () =>
      api(`/partners/${partnerId}/coupons`, {
        method: 'POST',
        body: { programId: pickedProgram, code: customCode.trim() ? customCode.trim().toUpperCase() : undefined },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-coupons', partnerId] });
      setCustomCode('');
      setPickedProgram('');
    },
  });

  const gateError = mint.error instanceof ApiError && mint.error.message === 'verification_required'
    ? (mint.error.detail as { detail?: string; threshold?: number; existing?: number } | undefined)
    : null;

  // Programs that still have an ACTIVE coupon — admin can re-mint
  // freely once an old code is deactivated (append-only model).
  const programsWithActiveCoupon = new Set(
    (coupons.data?.coupons ?? []).filter((c) => !c.deactivatedAt).map((c) => c.programId),
  );
  const availableCampaigns = (campaigns.data?.programs ?? []).filter(
    (c) => !programsWithActiveCoupon.has(c.id),
  );

  const deactivate = useMutation({
    mutationFn: (couponId: string) =>
      api(`/partners/${partnerId}/coupons/${couponId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-coupons', partnerId] }),
  });
  const campaignNameById = new Map((campaigns.data?.programs ?? []).map((c) => [c.id, c.name]));
  const partnerName = partner.data?.name ?? '…';

  return (
    <Page
      title={`Купоны · ${partnerName}`}
      subtitle="Промокоды связывают оплату с партнёром, когда клиент вводит код на оплате вместо перехода по ссылке. Ваш сайт вызывает POST /coupons/redeem с кодом — дальше работает тот же поток начисления комиссии."
    >
      <div style={{ marginBottom: 14 }}>
        <TenantLink to="/admin/partners" style={{ color: theme.textMuted, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={14} /> К партнёрам
        </TenantLink>
      </div>
      <ErrorBanner error={partner.error ?? coupons.error ?? (gateError ? null : mint.error)} />
      {gateError && (
        <div style={{ background: `${theme.danger}10`, border: `1px solid ${theme.danger}55`, borderRadius: theme.radiusSm, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: theme.danger, fontWeight: 500, marginBottom: 6 }}>
            Проверьте интеграцию промокодов перед созданием новых
          </div>
          <div style={{ fontSize: 12, color: theme.text, lineHeight: 1.5 }}>
            {gateError.detail}
          </div>
        </div>
      )}
      <Card>
        {coupons.isLoading ? (
          <p style={{ color: theme.textMuted, fontSize: 13 }}>Загрузка…</p>
        ) : (
          <>
            {(coupons.data?.coupons ?? []).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {(coupons.data?.coupons ?? []).map((c) => {
                  const isDeactivated = !!c.deactivatedAt;
                  return (
                    <div
                      key={c.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        background: theme.surface2,
                        border: `1px solid ${theme.borderSubtle}`,
                        borderRadius: theme.radiusSm,
                        opacity: isDeactivated ? 0.55 : 1,
                      }}
                    >
                      <code style={{ fontSize: 14, fontWeight: 500, color: theme.text, flex: 1, textDecoration: isDeactivated ? 'line-through' : 'none' }}>
                        {c.code}
                      </code>
                      <span style={{ color: theme.textMuted, fontSize: 12 }}>
                        {campaignNameById.get(c.programId) ?? c.programId}
                      </span>
                      <span style={{ color: theme.textMuted, fontSize: 11, whiteSpace: 'nowrap' }}>
                        {(c.redemptions90d ?? 0) > 0
                          ? `${c.redemptions90d} использований (90 дн.)`
                          : 'не использован (90 дн.)'}
                      </span>
                      {isDeactivated ? (
                        <span style={{ fontSize: 11, color: theme.textDim, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Отключён
                        </span>
                      ) : (
                        <button
                          onClick={() => deactivate.mutate(c.id)}
                          disabled={deactivate.isPending}
                          style={{
                            background: 'transparent',
                            border: `1px solid ${theme.borderSubtle}`,
                            borderRadius: 6,
                            padding: '4px 8px',
                            fontSize: 11,
                            color: theme.textMuted,
                            cursor: 'pointer',
                          }}
                        >
                          Отключить
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {availableCampaigns.length > 0 ? (
              <div className="op-grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                <div>
                  <Label>Программа</Label>
                  <select
                    value={pickedProgram}
                    onChange={(e) => setPickedProgram(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', background: theme.surface2, border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm, color: theme.text, fontSize: 13 }}
                  >
                    <option value="">— выберите кампанию —</option>
                    {availableCampaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Код (необязательно)</Label>
                  <Input
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                    placeholder="сгенерируется автоматически"
                    style={{ fontFamily: theme.fontMono }}
                  />
                </div>
                <Button onClick={() => mint.mutate()} disabled={!pickedProgram || mint.isPending}>
                  {mint.isPending ? 'Создаём…' : 'Создать промокод'}
                </Button>
              </div>
            ) : (
              <p style={{ color: theme.textMuted, fontSize: 13, margin: 0 }}>
                {(coupons.data?.coupons ?? []).length === 0
                  ? 'Нет доступных кампаний. Сначала создайте кампанию в разделе «Кампании».'
                  : 'У этого партнёра уже есть промокод для каждой кампании.'}
              </p>
            )}
          </>
        )}
      </Card>
    </Page>
  );
}
