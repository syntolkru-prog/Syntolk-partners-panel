import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { api } from '../../api.js';
import { theme } from '../../theme.js';
import { Button, Card, ErrorBanner, Input, Label, Page, Select } from '../../ui.js';

interface Partner {
  id: string;
  name: string;
  email: string;
}

interface LinkRow {
  id: string;
  linkKey: string;
  programId: string;
}

interface SimulationResult {
  eventId: string;
  replayed: boolean;
  attribution: { status: string; touches?: Array<{ partnerId: string; commissionId?: string }> } | null;
}

export function PaymentSimulator() {
  const partners = useQuery({
    queryKey: ['payment-simulator-partners'],
    queryFn: () => api<{ partners: Partner[] }>('/partners?limit=200'),
  });
  const [partnerId, setPartnerId] = useState('');
  const [linkKey, setLinkKey] = useState('');
  const [userId, setUserId] = useState('demo-client-001');
  const [amount, setAmount] = useState('1000');
  const [lastExternalId, setLastExternalId] = useState('');
  const [lastAmount, setLastAmount] = useState('');
  const [result, setResult] = useState<SimulationResult | null>(null);

  useEffect(() => {
    if (!partnerId && partners.data?.partners[0]) setPartnerId(partners.data.partners[0].id);
  }, [partnerId, partners.data]);

  const links = useQuery({
    queryKey: ['payment-simulator-links', partnerId],
    enabled: !!partnerId,
    queryFn: () => api<{ links: LinkRow[] }>(`/partners/${partnerId}/links`),
  });

  useEffect(() => {
    if (links.data?.links[0] && !links.data.links.some((l) => l.linkKey === linkKey)) {
      setLinkKey(links.data.links[0].linkKey);
    }
  }, [linkKey, links.data]);

  const simulate = useMutation({
    mutationFn: () => {
      const externalEventId = `local_payment_${Date.now()}`;
      return api<SimulationResult>('/payments/simulate', {
        method: 'POST',
        body: {
          partnerId,
          linkKey,
          userId: userId.trim(),
          amount: Number(amount),
          currency: 'RUB',
          type: 'invoice_paid',
          externalEventId,
        },
      }).then((response) => ({ response, externalEventId }));
    },
    onSuccess: ({ response, externalEventId }) => {
      setResult(response);
      setLastExternalId(externalEventId);
      setLastAmount(amount);
    },
  });

  const refund = useMutation({
    mutationFn: () =>
      api('/payments/refunds', {
        method: 'POST',
        body: {
          originalExternalEventId: lastExternalId,
          refundExternalEventId: `local_refund_${Date.now()}`,
          amount: Number(lastAmount),
          currency: 'RUB',
        },
      }),
    onSuccess: () => setResult(null),
  });

  const error = partners.error ?? links.error ?? simulate.error ?? refund.error;
  const partnerOptions = partners.data?.partners ?? [];
  const linkOptions = links.data?.links ?? [];

  return (
    <Page
      title="Тестовые платежи"
      subtitle="Локальная проверка реферальной ссылки, начисления 20% и возврата без обращения к CloudPayments."
    >
      <ErrorBanner error={error} />
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <FlaskConical size={18} color={theme.accent} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>Симуляция оплаты</h3>
        </div>
        <p style={{ color: theme.textMuted, fontSize: 13, lineHeight: 1.55, marginTop: 0 }}>
          Выберите партнёра и его ссылку, укажите клиента и сумму. Первый платёж привяжет клиента к партнёру,
          повторный платёж с тем же клиентом начислит комиссию по правилу программы.
        </p>
        <div className="op-grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <Label>Партнёр</Label>
            <Select value={partnerId} onChange={(e) => { setPartnerId(e.target.value); setLinkKey(''); }}>
              <option value="">Выберите партнёра</option>
              {partnerOptions.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.email}</option>)}
            </Select>
          </div>
          <div>
            <Label>Партнёрская ссылка</Label>
            <Select value={linkKey} onChange={(e) => setLinkKey(e.target.value)} disabled={!partnerId || linkOptions.length === 0}>
              <option value="">{linkOptions.length ? 'Выберите ссылку' : 'У партнёра нет ссылок'}</option>
              {linkOptions.map((l) => <option key={l.id} value={l.linkKey}>{l.linkKey}</option>)}
            </Select>
          </div>
          <div>
            <Label>ID клиента</Label>
            <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="client-001" />
          </div>
          <div>
            <Label>Сумма платежа, ₽</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <Button
            icon={<FlaskConical size={14} />}
            disabled={simulate.isPending || !partnerId || !linkKey || !userId.trim() || Number(amount) <= 0}
            onClick={() => simulate.mutate()}
          >
            {simulate.isPending ? 'Начисляем…' : 'Провести тестовый платёж'}
          </Button>
          <Button
            variant="secondary"
            icon={<RotateCcw size={14} />}
            disabled={refund.isPending || !lastExternalId}
            onClick={() => refund.mutate()}
          >
            {refund.isPending ? 'Возвращаем…' : 'Вернуть последний платёж'}
          </Button>
        </div>
        {result && (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 6, background: `${theme.success}12`, border: `1px solid ${theme.success}55`, fontSize: 13 }}>
            <strong style={{ color: theme.success }}>Платёж обработан.</strong>{' '}
            {result.replayed ? 'Повторная доставка не создала новое начисление.' : `Статус атрибуции: ${result.attribution?.status ?? '—'}.`}
          </div>
        )}
      </Card>
      <Card style={{ marginTop: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 500 }}>Как проверить</h3>
        <ol style={{ margin: 0, paddingLeft: 22, color: theme.textMuted, fontSize: 13, lineHeight: 1.7 }}>
          <li>Проведите платёж на 1 000 ₽ — комиссия при ставке 20% составит 200 ₽.</li>
          <li>Проведите платёж ещё раз с тем же ID клиента — появится второе начисление.</li>
          <li>Нажмите «Вернуть последний платёж» — начисление будет компенсировано.</li>
          <li>Откройте разделы «Комиссии» и «Выплаты», чтобы проверить реестр.</li>
        </ol>
      </Card>
    </Page>
  );
}
