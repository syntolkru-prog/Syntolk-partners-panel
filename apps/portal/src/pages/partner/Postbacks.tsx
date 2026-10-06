import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Webhook as WebhookIcon, Trash2 } from 'lucide-react';
import { api, type Principal } from '../../api.js';
import { theme } from '../../theme.js';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Input,
  Label,
  Page,
  StatusPill,
  formatDate,
} from '../../ui.js';

const POSTBACK_EVENTS = [
  'commission.accrued',
  'commission.approved',
  'commission.paid',
  'commission.reversed',
] as const;

type PostbackEvent = (typeof POSTBACK_EVENTS)[number];

interface PostbackRow {
  id: string;
  partnerId: string;
  url: string;
  events: PostbackEvent[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastFiredAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  successCount: number;
  failureCount: number;
}

export function PartnerPostbacksPage({ principal }: { principal: Principal }) {
  const qc = useQueryClient();
  const partnerId = principal.role === 'partner' ? principal.partnerId : null;
  const [showCreate, setShowCreate] = useState(false);

  const list = useQuery({
    queryKey: ['partner-postbacks', partnerId],
    queryFn: () =>
      api<{ postbacks: PostbackRow[]; supportedEvents: string[] }>(
        `/partners/${partnerId}/postbacks`,
      ),
    enabled: !!partnerId,
  });

  const create = useMutation({
    mutationFn: (body: { url: string; events: PostbackEvent[] }) =>
      api<PostbackRow>(`/partners/${partnerId}/postbacks`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-postbacks', partnerId] });
      setShowCreate(false);
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api<PostbackRow>(`/partners/${partnerId}/postbacks/${id}`, { method: 'PATCH', body: { enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-postbacks', partnerId] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api<void>(`/partners/${partnerId}/postbacks/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-postbacks', partnerId] }),
  });

  if (!partnerId) {
    return (
      <Page title="URL постбэков">
        <EmptyState
          title="Только для партнёров"
          hint="URL постбэков — интеграция на стороне партнёра."
          icon={<WebhookIcon size={28} strokeWidth={1.25} />}
        />
      </Page>
    );
  }

  const rows = list.data?.postbacks ?? [];

  return (
    <Page
      title="URL постбэков"
      subtitle="Передавайте события конверсий в свой трекер (Voluum, RedTrack, Bemob или собственный)."
      actions={
        <Button icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
          Добавить постбэк
        </Button>
      }
    >
      <ErrorBanner error={list.error ?? create.error ?? toggleEnabled.error ?? remove.error} />

      {showCreate && (
        <CreateForm
          onCancel={() => setShowCreate(false)}
          onSubmit={(body) => create.mutate(body)}
          pending={create.isPending}
        />
      )}

      {list.isLoading ? (
        <Card>Загрузка…</Card>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Постбэков пока нет"
          hint="Добавьте постбэк, чтобы отправлять GET-запрос в трекер при начислении, подтверждении или выплате комиссии."
          icon={<WebhookIcon size={28} strokeWidth={1.25} />}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((p) => (
            <PostbackCard
              key={p.id}
              row={p}
              onToggle={() => toggleEnabled.mutate({ id: p.id, enabled: !p.enabled })}
              onDelete={() => remove.mutate(p.id)}
            />
          ))}
        </div>
      )}

      <MacroReference />
    </Page>
  );
}

function PostbackCard({
  row,
  onToggle,
  onDelete,
}: {
  row: PostbackRow;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const totalFires = row.successCount + row.failureCount;
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <StatusPill status={row.enabled ? 'active' : 'paused'} />
            <code style={{ fontSize: 12, color: theme.textMuted, wordBreak: 'break-all' }}>
              {row.url}
            </code>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {row.events.map((e) => (
              <span
                key={e}
                style={{
                  fontSize: 11,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: theme.surface2,
                  color: theme.textMuted,
                }}
              >
                {e}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" variant="secondary" onClick={onToggle}>
            {row.enabled ? 'Пауза' : 'Возобновить'}
          </Button>
          <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={onDelete} />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10,
          paddingTop: 10,
          borderTop: `1px solid ${theme.borderSubtle}`,
          fontSize: 12,
          color: theme.textMuted,
        }}
      >
        <Stat label="Отправлено" value={String(totalFires)} />
        <Stat label="Успешно" value={String(row.successCount)} />
        <Stat label="Ошибок" value={String(row.failureCount)} />
        <Stat label="Последняя отправка" value={row.lastFiredAt ? formatDate(row.lastFiredAt) : '—'} />
        <Stat
          label="Последний статус"
          value={
            row.lastStatus
              ? `HTTP ${row.lastStatus}`
              : row.lastError
                ? row.lastError.slice(0, 30)
                : '—'
          }
        />
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13, color: theme.text, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function CreateForm({
  onCancel,
  onSubmit,
  pending,
}: {
  onCancel: () => void;
  onSubmit: (body: { url: string; events: PostbackEvent[] }) => void;
  pending: boolean;
}) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<PostbackEvent[]>(['commission.accrued']);

  const submit = () => {
    if (!url || events.length === 0) return;
    onSubmit({ url, events });
  };

  return (
    <Card style={{ marginBottom: 14, borderColor: theme.accent }}>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Новый URL постбэка</div>
      <Label>URL с макросами</Label>
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://tracker.example.com/postback?cid={click_id}&payout={commission_amount}"
      />
      <div style={{ marginTop: 12 }}>
        <Label>События для отправки</Label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {POSTBACK_EVENTS.map((ev) => (
            <label
              key={ev}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                padding: '4px 8px',
                borderRadius: 4,
                background: events.includes(ev) ? theme.accentSoft : theme.surface2,
                color: events.includes(ev) ? theme.accent : theme.textMuted,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={events.includes(ev)}
                onChange={(e) =>
                  setEvents((prev) =>
                    e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev),
                  )
                }
              />
              {ev}
            </label>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <Button onClick={submit} disabled={pending || !url || events.length === 0}>
          {pending ? 'Создаём…' : 'Создать'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </Card>
  );
}

function MacroReference() {
  const macros: Array<[string, string]> = [
    ['{click_id}', 'Исходный клик — доступен только для commission.accrued'],
    ['{partner_id}', 'ID партнёра'],
    ['{commission_id}', 'ID записи комиссии'],
    ['{commission_amount}', 'Сумма в основных единицах, например 12.50'],
    ['{currency}', 'Трёхбуквенный код валюты, например RUB'],
    ['{event_id}', 'ID события, создавшего комиссию'],
    ['{transaction_id}', 'Псевдоним {event_id} для трекеров'],
    ['{event_type}', 'invoice_paid / signup / ваше событие'],
    ['{program_id}', 'ID программы'],
    ['{payout_id}', 'Доступен только для commission.paid'],
  ];
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Доступные макросы</div>
      <Card>
        <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 10 }}>
          Значения макросов кодируются для URL при отправке. Неизвестные макросы остаются как есть,
          чтобы вы заметили опечатку. Постбэки намеренно не подписываются — для проверки добавьте
          общий секрет в параметр запроса: <code style={{ color: theme.text }}>?secret=…</code>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '6px 14px', fontSize: 12 }}>
          {macros.map(([macro, desc]) => (
            <FragmentRow key={macro} macro={macro} desc={desc} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function FragmentRow({ macro, desc }: { macro: string; desc: string }) {
  return (
    <>
      <code style={{ color: theme.accent }}>{macro}</code>
      <div style={{ color: theme.textMuted }}>{desc}</div>
    </>
  );
}
