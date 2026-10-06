import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api.js';
import { Button, Card, ErrorBanner, Input, Label, Page } from '../../ui.js';
import { theme } from '../../theme.js';

interface NetworkMembership {
  enabled: boolean;
  networkUrl: string;
  hasVendorToken: boolean;
  scopedKeyId: string | null;
  autoEnroll: boolean;
}

interface NetworkSelf {
  id: string;
  displayName: string;
  status: string;
  partnerCount: number;
}

interface BackfillResult {
  total: number;
  pushed: number;
  queued: number;
}

export function AdminNetwork() {
  return (
    <Page
      title="Сеть партнёров"
      subtitle="Разместите компанию в сети Syntolk, чтобы авторы могли находить ваши программы и подавать заявки."
    >
      <NetworkConnection />
    </Page>
  );
}

function NetworkConnection() {
  const qc = useQueryClient();
  const { data: membership, isLoading, error } = useQuery({
    queryKey: ['network-membership'],
    queryFn: () => api<NetworkMembership>('/config/network'),
  });

  // Connected once enabled=true AND vendor token saved.
  const connected = !!(membership?.enabled && membership.hasVendorToken);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error && <ErrorBanner error={"Не удалось загрузить настройки сети партнёров."} />}
      {isLoading && <Card><p style={{ fontSize: 13, margin: 0, color: theme.textMuted }}>Загрузка…</p></Card>}
      {membership && (
        <>
          {!connected ? <ConnectForm membership={membership} /> : <ConnectedPanel membership={membership} />}
          {connected && <AutoEnrollPanel membership={membership} onChange={() => qc.invalidateQueries({ queryKey: ['network-membership'] })} />}
          {connected && <BackfillPanel />}
        </>
      )}
    </div>
  );
}

function ConnectForm({ membership }: { membership: NetworkMembership }) {
  const qc = useQueryClient();
  const [contactEmail, setContactEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  // One-click path: backend uses NETWORK_ADMIN_API_KEY to skip the
  // email-verify round trip. Available on the hosted deployment; not
  // on self-host (where the operator doesn't have the Network's admin
  // key).
  const auto = useMutation({
    mutationFn: () => api('/config/network/auto-enroll', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network-membership'] }),
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'failed';
      // If admin token isn't configured, fall back to the manual form.
      if (msg.includes('admin_token_not_configured')) setShowManual(true);
      setError(msg);
    },
  });

  const manual = useMutation({
    mutationFn: () => api('/config/network/start-connect', {
      method: 'POST',
      body: { contactEmail: contactEmail || undefined, displayName: displayName || undefined },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network-membership'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'failed'),
  });

  return (
    <Card>
      <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 500 }}>Не подключено</h3>
      <p style={{ fontSize: 13, color: theme.textMuted, marginTop: 0 }}>
        Находите авторов в сети Syntolk. После подключения ваши опубликованные предложения
        появятся в каталоге авторов, а заявки будут поступать в очередь запросов.
      </p>
      {membership.networkUrl && (
        <p style={{ fontSize: 13, color: theme.textMuted, margin: '0 0 14px' }}>
          Сеть: <code>{membership.networkUrl}</code>
        </p>
      )}
      {error && (
        <ErrorBanner error={error === 'network_url_not_configured' ? 'NETWORK_URL env not set on this instance.' : error} />
      )}
      {!showManual ? (
        <>
          <Button onClick={() => auto.mutate()} disabled={auto.isPending}>
            {auto.isPending ? 'Подключаем…' : 'Разместить компанию в сети'}
          </Button>
          <p style={{ marginTop: 10, fontSize: 12, color: theme.textDim }}>
            Локальная установка?{' '}
            <button type="button" onClick={() => setShowManual(true)} style={{ background: 'transparent', border: 'none', color: theme.accent, cursor: 'pointer', padding: 0, font: 'inherit' }}>
              Использовать подтверждение по email
            </button>
          </p>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <Label>Контактный email (сюда придёт ссылка подтверждения)</Label>
            <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="admin@syntolk.ru" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <Label>Отображаемое имя (его увидят авторы)</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Syntolk" />
          </div>
          <Button onClick={() => manual.mutate()} disabled={manual.isPending || !contactEmail}>
            {manual.isPending ? 'Отправляем…' : 'Отправить письмо подтверждения'}
          </Button>
          {manual.isSuccess && (
            <p style={{ marginTop: 12, fontSize: 13, color: theme.success }}>
              Письмо подтверждения отправлено. Перейдите по ссылке, чтобы завершить подключение.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function ConnectedPanel({ membership }: { membership: NetworkMembership }) {
  const { data: self, error, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['network-self'],
    queryFn: () => api<NetworkSelf>('/admin/network/me'),
    retry: 1,
  });
  // On-demand heartbeat fire — useful when the brand admin updated their
  // logo / name / etc. and is wondering why the marketplace listing
  // hasn't refreshed. Returns the result inline so propagation failures
  // (Network rejected, vendor token bad, etc.) surface visibly instead
  // of dying in the cron logs.
  const heartbeat = useMutation({
    mutationFn: () =>
      api<{ sent: boolean; partnerCount: number; reason?: string }>('/admin/network/heartbeat', { method: 'POST' }),
    onSuccess: () => refetch(),
  });
  return (
    <Card>
      <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 15, fontWeight: 500, color: theme.success }}>Подключено ✓</h3>
      <p style={{ fontSize: 13, color: theme.textMuted, marginTop: 0, marginBottom: 8 }}>
        Сеть: <code>{membership.networkUrl}</code>
      </p>
      {isLoading && <p style={{ fontSize: 13, color: theme.textMuted, margin: 0 }}><em>Загрузка профиля компании…</em></p>}
      {!isLoading && self && (
        <p style={{ fontSize: 13, color: theme.textMuted, margin: 0 }}>
          В каталоге как <strong style={{ color: theme.text }}>{self.displayName}</strong> · статус: {self.status} · активных партнёров: {self.partnerCount}
        </p>
      )}
      {!isLoading && error && (
        <div style={{ marginTop: 6 }}>
          <div style={{ color: theme.danger, fontSize: 13 }}>
            Не удалось загрузить профиль компании из сети: {error instanceof Error ? error.message : String(error)}
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isRefetching}
            style={{
              marginTop: 8,
              background: 'transparent',
              color: theme.accent,
              border: `1px solid ${theme.accent}`,
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 13,
              cursor: isRefetching ? 'wait' : 'pointer',
            }}
          >
            {isRefetching ? 'Повторяем…' : 'Повторить'}
          </button>
        </div>
      )}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${theme.borderSubtle}` }}>
        <button
          type="button"
          onClick={() => heartbeat.mutate()}
          disabled={heartbeat.isPending}
          style={{
            background: 'transparent',
            color: theme.accent,
            border: `1px solid ${theme.accentA55}`,
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 12,
            cursor: heartbeat.isPending ? 'wait' : 'pointer',
          }}
        >
          {heartbeat.isPending ? 'Отправляем…' : 'Обновить карточку в каталоге'}
        </button>
        <span style={{ marginLeft: 10, fontSize: 12, color: theme.textDim }}>
          В обычном режиме синхронизация выполняется каждый час. Используйте кнопку после изменения логотипа или названия.
        </span>
        {heartbeat.data && (
          <div style={{ marginTop: 8, fontSize: 12, color: heartbeat.data.sent ? theme.success : theme.danger }}>
            {heartbeat.data.sent
              ? 'Отправлено — изменения появятся в каталоге в течение минуты.'
              : `Ошибка: ${heartbeat.data.reason ?? 'неизвестная причина'}`}
          </div>
        )}
        {heartbeat.error && (
          <div style={{ marginTop: 8, fontSize: 12, color: theme.danger }}>
            Ошибка: {heartbeat.error instanceof Error ? heartbeat.error.message : String(heartbeat.error)}
          </div>
        )}
      </div>
    </Card>
  );
}

function AutoEnrollPanel({ membership, onChange }: { membership: NetworkMembership; onChange: () => void }) {
  const m = useMutation({
    mutationFn: (autoEnroll: boolean) =>
      api('/config/network', { method: 'POST', body: { autoEnroll } }),
    onSuccess: onChange,
  });
  return (
    <Card>
      <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 500 }}>Автоматически добавлять новых партнёров</h3>
      <p style={{ fontSize: 13, color: theme.textMuted, marginTop: 0 }}>
        Если включено, каждый новый партнёр автоматически отправляется в сеть. Дубликаты объединяются по email —
        один человек, работающий с несколькими компаниями, получает единую запись в сети.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: theme.text }}>
        <input
          type="checkbox"
          checked={membership.autoEnroll}
          disabled={m.isPending}
          onChange={(e) => m.mutate(e.target.checked)}
        />
        <span>Добавлять автоматически при создании и регистрации</span>
      </label>
    </Card>
  );
}

function BackfillPanel() {
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api<BackfillResult>('/config/network/backfill', { method: 'POST', body: {} }),
    onSuccess: (r) => { setResult(r); setError(null); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'failed'),
  });
  useEffect(() => { setResult(null); }, []);
  return (
    <Card>
      <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 500 }}>Добавить существующих партнёров</h3>
      <p style={{ fontSize: 13, color: theme.textMuted, marginTop: 0 }}>
        Если вы подключили сеть после добавления партнёров, запустите эту операцию один раз, чтобы отправить
        существующий список и объединить записи по email. Авторы, уже добавленные другой компанией, будут
        отмечены, чтобы вы видели их присутствие в других программах.
      </p>
      {error && <ErrorBanner error={error} />}
      <Button onClick={() => m.mutate()} disabled={m.isPending}>
        {m.isPending ? 'Добавляем…' : 'Добавить сейчас'}
      </Button>
      {result && (
        <p style={{ marginTop: 12, fontSize: 13, color: theme.textMuted }}>
          Отправлено <strong style={{ color: theme.text }}>{result.pushed}</strong> из <strong style={{ color: theme.text }}>{result.total}</strong>.
          {result.queued > 0 && <> В очереди на повтор: {result.queued}.</>}
        </p>
      )}
    </Card>
  );
}
