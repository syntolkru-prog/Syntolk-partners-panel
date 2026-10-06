import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../api.js';
import { theme } from '../theme.js';
import { TenantLink } from '../tenant-link.js';
import { Button, Card, ErrorBanner, Input, Label, Page, Select } from '../ui.js';

interface Partner {
  id: string;
  name: string;
  email: string;
}

type CommissionSource = 'approval' | 'backfill' | 'amendment';

interface Snapshot {
  partnerId: string;
  commissionType: 'percent' | 'fixed';
  commissionValue: string; // decimal as string
  recurring: boolean;
  holdbackDays: number | null;
  source: CommissionSource;
  snapshottedAt: string;
}

const SOURCE_LABEL: Record<CommissionSource, string> = {
  approval: 'Зафиксировано при одобрении заявки',
  backfill: 'Восстановлено из текущего правила программы',
  amendment: 'Ручное изменение администратора',
};

export function AdminPartnerCommission() {
  const { id } = useParams<{ id: string }>();
  const partnerId = id ?? '';
  const qc = useQueryClient();

  const partner = useQuery({
    queryKey: ['partner', partnerId],
    queryFn: () => api<Partner>(`/partners/${partnerId}`),
    enabled: !!partnerId,
  });

  const snapshot = useQuery({
    queryKey: ['partner-commission-snapshot', partnerId],
    queryFn: () => api<{ snapshot: Snapshot | null }>(`/partners/${partnerId}/commission-snapshot`),
    enabled: !!partnerId,
  });

  const partnerName = partner.data?.name ?? '…';

  return (
    <Page
      title={`Комиссия · ${partnerName}`}
      subtitle="Измените ставку комиссии или отсрочку для этого партнёра. Подходит для VIP-партнёров с повышенным процентом."
    >
      <div style={{ marginBottom: 14 }}>
        <TenantLink to="/admin/partners" style={{ color: theme.textMuted, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={14} /> К партнёрам
        </TenantLink>
      </div>
      <ErrorBanner error={partner.error ?? snapshot.error} />
      {snapshot.isLoading ? (
        <Card>Загрузка…</Card>
      ) : (
        <>
          <CurrentSnapshotCard snapshot={snapshot.data?.snapshot ?? null} />
          <div style={{ height: 14 }} />
          <EditCard
            partnerId={partnerId}
            current={snapshot.data?.snapshot ?? null}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ['partner-commission-snapshot', partnerId] });
            }}
          />
        </>
      )}
    </Page>
  );
}

function CurrentSnapshotCard({ snapshot }: { snapshot: Snapshot | null }) {
  if (!snapshot) {
    return (
      <Card>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Индивидуальная ставка не задана</div>
        <p style={{ fontSize: 13, color: theme.textMuted, margin: 0, lineHeight: 1.5 }}>
          Для партнёра нет записи <code>PartnerCommission</code>, поэтому комиссии начисляются
          по текущему правилу связанной программы. Установите индивидуальную ставку ниже,
          чтобы сохранить текущие условия и защитить будущие начисления от изменений программы.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Текущая ставка</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
        <Stat
          label="Ставка"
          value={
            snapshot.commissionType === 'percent'
              ? `${Number(snapshot.commissionValue)}%`
              : `${Number(snapshot.commissionValue).toFixed(2)} ₽ фиксировано`
          }
        />
        <Stat label="Регулярно" value={snapshot.recurring ? 'Да' : 'Нет'} />
        <Stat label="Отсрочка" value={snapshot.holdbackDays != null ? `${snapshot.holdbackDays} дн.` : '—'} />
        <Stat label="Источник" value={SOURCE_LABEL[snapshot.source]} muted />
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: theme.textDim }}>
        Зафиксировано: {new Date(snapshot.snapshottedAt).toLocaleString('ru-RU')}
      </div>
    </Card>
  );
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: theme.textDim, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: muted ? 12 : 15, color: muted ? theme.textMuted : theme.text, marginTop: 2, lineHeight: 1.4 }}>
        {value}
      </div>
    </div>
  );
}

function EditCard({
  partnerId,
  current,
  onSaved,
}: {
  partnerId: string;
  current: Snapshot | null;
  onSaved: () => void;
}) {
  const [type, setType] = useState<'percent' | 'fixed'>(current?.commissionType ?? 'percent');
  const [value, setValue] = useState(current ? String(Number(current.commissionValue)) : '20');
  const [recurring, setRecurring] = useState(current?.recurring ?? true);
  const [holdback, setHoldback] = useState(
    current?.holdbackDays != null ? String(current.holdbackDays) : '',
  );

  // Re-sync the form when the underlying snapshot changes (e.g. after
  // the user just saved). Without this the form would keep showing
  // the pre-save values until a hard refresh.
  useEffect(() => {
    setType(current?.commissionType ?? 'percent');
    setValue(current ? String(Number(current.commissionValue)) : '20');
    setRecurring(current?.recurring ?? true);
    setHoldback(current?.holdbackDays != null ? String(current.holdbackDays) : '');
  }, [current]);

  const save = useMutation({
    mutationFn: () =>
      api(`/partners/${partnerId}/commission-snapshot`, {
        method: 'PUT',
        body: {
          commissionType: type,
          commissionValue: Number(value),
          recurring,
          holdbackDays: holdback === '' ? null : Number(holdback),
        },
      }),
    onSuccess: onSaved,
  });

  const clear = useMutation({
    mutationFn: () =>
      api(`/partners/${partnerId}/commission-snapshot`, { method: 'DELETE' }),
    onSuccess: onSaved,
  });

  return (
    <Card>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
        {current ? 'Изменить ставку' : 'Задать ставку'}
      </div>
      <p style={{ fontSize: 12, color: theme.textMuted, margin: '0 0 14px', lineHeight: 1.5 }}>
        Создаёт запись <code>PartnerCommission</code> с источником{' '}
        <code>source = &lsquo;amendment&rsquo;</code>. Начиная со следующей конверсии, комиссии
        этого партнёра будут начисляться по ставке ниже независимо от правила программы.
        Прошлые начисления не пересчитываются — изменятся только будущие события.
      </p>
      <ErrorBanner error={save.error ?? clear.error} />
      <div className="op-grid-collapse" style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', gap: 12, marginBottom: 14, alignItems: 'end' }}>
        <div>
          <Label>Тип ставки</Label>
          <Select value={type} onChange={(e) => setType(e.target.value as 'percent' | 'fixed')}>
            <option value="percent">Процент</option>
            <option value="fixed">Фиксированная сумма</option>
          </Select>
        </div>
        <div>
          <Label>Значение</Label>
          <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 10, color: theme.textMuted }}>
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
          Регулярное начисление
        </label>
      </div>
      <div style={{ marginBottom: 14, maxWidth: 220 }}>
        <Label>Отсрочка (дни, пусто — без отсрочки)</Label>
        <Input
          type="number"
          value={holdback}
          onChange={(e) => setHoldback(e.target.value)}
          placeholder="0"
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !value}>
          {save.isPending ? 'Сохраняем…' : current ? 'Обновить ставку' : 'Задать ставку'}
        </Button>
        {current && (
          <button
            type="button"
            onClick={() => {
              if (confirm('Удалить индивидуальную ставку? Партнёр вернётся к текущему правилу программы.')) {
                clear.mutate();
              }
            }}
            disabled={clear.isPending}
            style={{
              background: 'transparent',
              border: `1px solid ${theme.danger}55`,
              borderRadius: 6,
              padding: '8px 14px',
              fontSize: 13,
              color: theme.danger,
              cursor: 'pointer',
            }}
          >
            {clear.isPending ? 'Удаляем…' : 'Удалить ставку'}
          </button>
        )}
      </div>
    </Card>
  );
}
