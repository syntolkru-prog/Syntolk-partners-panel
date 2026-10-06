import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api, currentTenantSlug } from '../../api.js';
import { theme } from '../../theme.js';
import { useBrand } from '../../lib/useBrand.js';
import { Button, Card, ErrorBanner, Input, Label, Page } from '../../ui.js';

/**
 * Integration API key surface. Mints scoped keys covering the union
 * of what CRM webhooks (events:write), Zapier/ActivePieces triggers
 * (partners:read + commissions:read for performList), and Zapier/
 * ActivePieces actions (partners:write to create + revoke) need.
 *
 * Why scoped, not admin: brands shouldn't paste a full admin key into
 * a Zap or a CRM workflow. A leaked key with this scope set can
 * fabricate conversion events + create/revoke partners on the tenant
 * — but can't touch billing, payouts, campaigns, or admin surfaces
 * (those have no scope grants anywhere in the API).
 */

interface ApiKeyRow {
  id: string;
  prefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  scopes?: string[] | null;
}

interface CreatedKey {
  id: string;
  plaintext: string;
  scopes: string[];
}

// Scopes minted on every integration key. Covers the union of what
// CRM webhooks (events:write), Zapier/ActivePieces triggers
// (partners:read + commissions:read for performList), and Zapier/
// ActivePieces actions (partners:write to create + revoke) need.
// Keeping a single bundled scope set means admins don't have to
// pick the right combo per platform — and a leaked key still can't
// touch billing, payouts, or admin surfaces (those have no scope
// grants anywhere). Used to be just events:write, which broke
// everything beyond the CRM-event use case.
//
// SCOPE_DESCRIPTIONS is what the dev sees in the UI, sourced from
// the same constant so the displayed list never drifts from what
// the create mutation actually mints.
const SCOPE_DESCRIPTIONS: Array<{ scope: string; description: string }> = [
  { scope: 'events:write', description: 'Передавать события конверсий через CRM-вебхук.' },
  { scope: 'partners:write', description: 'Создавать и отзывать партнёров (действия Zapier/ActivePieces).' },
  { scope: 'partners:read', description: 'Получать список партнёров и искать их по email.' },
  { scope: 'commissions:read', description: 'Получать комиссии для тестовых данных триггеров.' },
  { scope: 'webhooks:write', description: 'Подписывать и отписывать вебхук-эндпоинты.' },
];
const INTEGRATION_SCOPES = SCOPE_DESCRIPTIONS.map((s) => s.scope);
const EVENTS_SCOPE = 'events:write'; // legacy filter on the keys list query

export function AdminIntegrations() {
  const { programName } = useBrand();
  return (
    <Page
      title="Интеграция с CRM"
      subtitle={`Передавайте события конверсий из CRM в ${programName}, чтобы партнёры получали начисления за всю воронку, а не только за самостоятельные регистрации.`}
    >
      <WhyCard />
      <div style={{ height: 18 }} />
      <KeysPanel />
      <div style={{ height: 18 }} />
      <PayloadGuide />
    </Page>
  );
}

function WhyCard() {
  const { programName } = useBrand();
  return (
    <Card>
      <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 15, fontWeight: 500 }}>
        Как это работает
      </h3>
      <p style={{ fontSize: 13, color: theme.textMuted, marginTop: 0, marginBottom: 10, lineHeight: 1.55 }}>
        События конверсий, по которым начисляются партнёрские комиссии, не всегда
        происходят в платёжной системе. В B2B- и SaaS-программах важные изменения —
        «квалифицированный лид», «выигранная сделка», «пробный период оплачен» —
        находятся в CRM. Без сигнала из CRM партнёры получают вознаграждение только
        за самые простые случаи.
      </p>
      <p style={{ fontSize: 13, color: theme.textMuted, marginTop: 0, marginBottom: 10, lineHeight: 1.55 }}>
        Создайте здесь API-ключ с нужными правами, затем отправляйте из CRM
        (или через сценарий Zapier / Make) события конверсий POST-запросом на{' '}
        <code style={{ background: theme.surface2, padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>
          /attribution/events
        </code>{' '}
        с ключом в Bearer-токене. {programName} свяжет событие с исходным
        кликом через <code>userId</code>, который вы назначили при регистрации,
        и начислит комиссию по правилу программы.
      </p>
      <p style={{ fontSize: 13, color: theme.textMuted, margin: 0, lineHeight: 1.55 }}>
        Эти ключи имеют пять прав (events:write, partners:write,
        partners:read, commissions:read, webhooks:write) — этого достаточно
        для сценариев Zapier / ActivePieces / CRM. Утёкший ключ может создавать
        события конверсий, создавать и отзывать партнёров, регистрировать и
        удалять вебхуки в вашей компании, но не имеет доступа к оплате, выплатам,
        программам и админским разделам. Полный список прав находится под кнопкой
        создания ключа.
      </p>
    </Card>
  );
}

function KeysPanel() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['integration-keys'],
    queryFn: () => api<{ apiKeys: ApiKeyRow[] }>('/api-keys?scope=events:write'),
  });
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState<CreatedKey | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api<CreatedKey>('/api-keys/scoped', {
        method: 'POST',
        body: { scopes: [...INTEGRATION_SCOPES], label: label.trim() || 'CRM webhook' },
      }),
    onSuccess: (res) => {
      setCreated(res);
      setLabel('');
      qc.invalidateQueries({ queryKey: ['integration-keys'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integration-keys'] }),
  });

  const keys = (list.data?.apiKeys ?? []).filter((k) => !k.revokedAt && (k.scopes ?? []).includes(EVENTS_SCOPE));

  return (
    <Card>
      <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 15, fontWeight: 500 }}>API-ключи для CRM</h3>
      <p style={{ fontSize: 12, color: theme.textMuted, margin: '0 0 14px' }}>
        Один ключ на интеграцию — отдельный ключ для HubSpot, Zapier и внутренних скриптов
        упрощает контроль утечек и отзыв доступа.
      </p>
      <ErrorBanner error={create.error ?? revoke.error ?? list.error} />

      {created && (
        <div
          style={{
            background: `${theme.success}10`,
            border: `1px solid ${theme.success}55`,
            borderRadius: theme.radiusSm,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 500, color: theme.success, marginBottom: 6 }}>
            Новый ключ создан — скопируйте его сейчас
          </div>
          <p style={{ fontSize: 12, color: theme.textMuted, margin: '0 0 8px' }}>
            Мы нигде не сохраняем ключ в открытом виде. После ухода со страницы вы больше
            не увидите его — при потере создайте новый.
          </p>
          <code
            style={{
              display: 'block',
              padding: '10px 12px',
              background: theme.surface2,
              border: `1px solid ${theme.borderSubtle}`,
              borderRadius: 6,
              fontSize: 13,
              wordBreak: 'break-all',
              userSelect: 'all',
            }}
          >
            {created.plaintext}
          </code>
          <Button
            variant="secondary"
            onClick={() => {
              navigator.clipboard.writeText(created.plaintext).catch(() => {});
            }}
            style={{ marginTop: 10 }}
          >
            Скопировать в буфер
          </Button>
          <button
            type="button"
            onClick={() => setCreated(null)}
            style={{
              marginLeft: 8,
              background: 'transparent',
              border: 'none',
              color: theme.textMuted,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Скрыть
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
           <Label>Название</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
             placeholder="HubSpot — продакшн"
            maxLength={120}
          />
        </div>
        <Button onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? 'Создаём…' : 'Создать ключ'}
        </Button>
      </div>
      <ScopesPanel />
      <div style={{ height: 14 }} />

      {list.isLoading ? (
        <p style={{ fontSize: 13, color: theme.textMuted, margin: 0 }}>Загрузка…</p>
      ) : keys.length === 0 ? (
        <p style={{ fontSize: 13, color: theme.textDim, margin: 0 }}>
          CRM-ключей пока нет. Создайте ключ выше, чтобы начать получать события.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {keys.map((k) => (
            <div
              key={k.id}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                padding: '10px 12px',
                background: theme.surface2,
                border: `1px solid ${theme.borderSubtle}`,
                borderRadius: theme.radiusSm,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: theme.text }}>{k.label ?? 'CRM webhook'}</div>
                <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
                  <code>{k.prefix}…</code> · создан {new Date(k.createdAt).toLocaleDateString()}
                  {k.lastUsedAt && <> · последнее использование {new Date(k.lastUsedAt).toLocaleDateString()}</>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                    if (confirm(`Отозвать «${k.label ?? 'CRM-вебхук'}»? CRM, использующая этот ключ, перестанет получать события.`)) {
                    revoke.mutate(k.id);
                  }
                }}
                disabled={revoke.isPending}
                style={{
                  background: 'transparent',
                  border: `1px solid ${theme.danger}55`,
                  borderRadius: 6,
                  padding: '5px 10px',
                  fontSize: 12,
                  color: theme.danger,
                  cursor: 'pointer',
                }}
              >
                Отозвать
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Surfaces the scope set this page mints so devs can verify what
 *  the key carries before generating it (and after, when auditing).
 *  Sourced from the same SCOPE_DESCRIPTIONS constant the create
 *  mutation reads, so what's shown is what's minted — they can't
 *  drift. Collapsible to keep the create flow visually quiet for
 *  admins who don't care. */
function ScopesPanel() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        padding: '8px 12px',
        background: theme.surface2,
        border: `1px solid ${theme.borderSubtle}`,
        borderRadius: theme.radiusSm,
        fontSize: 12,
        color: theme.textMuted,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((s) => !s)}
        style={{
          background: 'transparent',
          border: 'none',
          color: theme.textMuted,
          cursor: 'pointer',
          padding: 0,
          fontSize: 12,
          fontFamily: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span>{expanded ? '▾' : '▸'}</span>
        Generated keys carry <strong style={{ color: theme.text }}>{INTEGRATION_SCOPES.length} scopes</strong>
        {!expanded && (
          <span style={{ color: theme.textDim, marginLeft: 4 }}>
            ({INTEGRATION_SCOPES.join(', ')})
          </span>
        )}
      </button>
      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {SCOPE_DESCRIPTIONS.map(({ scope, description }) => (
            <div key={scope} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <code style={{ color: theme.accent, fontSize: 12, minWidth: 130, fontWeight: 500 }}>{scope}</code>
              <span style={{ color: theme.textMuted, fontSize: 12 }}>{description}</span>
            </div>
          ))}
          <div style={{ marginTop: 4, color: theme.textDim, fontSize: 11, lineHeight: 1.5 }}>
            Эти права не дают доступа к оплате, выплатам, программам и админским разделам.
            Утёкший ключ может создавать события конверсий и создавать/отзывать партнёров
            только в этой компании.
          </div>
        </div>
      )}
    </div>
  );
}

function PayloadGuide() {
  // Build the actual full URL the admin should paste into their CRM /
  // Zapier / Make / curl. On multi-tenant installs the path includes
  // the tenant slug — leaving it out 500s with a generic error and
  // is the single most common configuration mistake. Render the real
  // URL so admins copy-paste it correctly without thinking.
  const origin = typeof window === 'undefined' ? 'https://your-instance' : window.location.origin;
  const slug = currentTenantSlug();
  const { programName } = useBrand();
  const apiBase = slug ? `${origin}/t/${slug}` : origin;
  return (
    <Card>
      <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 15, fontWeight: 500 }}>
        Формат запроса
      </h3>
      {slug && (
        <div
          style={{
            margin: '0 0 12px',
            padding: 10,
            background: `${theme.accentA10}`,
            border: `1px solid ${theme.accentA55}`,
            borderRadius: 6,
            fontSize: 12,
            color: theme.text,
            lineHeight: 1.55,
          }}
        >
          <strong>URL многокомпанийной установки:</strong> путь содержит slug компании{' '}
          (<code>/t/{slug}</code>) перед <code>/api/...</code>. Используйте полный URL ниже
          как есть — без slug сервер вернёт ошибку 400 <code>tenant_slug_missing</code>.
        </div>
      )}
      <p style={{ fontSize: 12, color: theme.textMuted, margin: '0 0 12px' }}>
        Отправляйте POST-запрос с ключом в Bearer-токене. <code>userId</code> — тот же идентификатор,
        который вы назначаете при регистрации, чтобы {programName} связал событие с кликом. <code>type</code>{' '}
        может быть любой строкой: используйте <code>opportunity_won</code> для B2B-сделок,
        <code>trial_converted</code> для перехода с пробного периода на оплату или свои значения.
      </p>
      <pre
        style={{
          padding: 14,
          background: theme.surface2,
          border: `1px solid ${theme.borderSubtle}`,
          borderRadius: 6,
          fontSize: 12,
          overflow: 'auto',
          margin: 0,
        }}
      >{`curl -X POST ${apiBase}/api/attribution/events \\
  -H "Authorization: Bearer <your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "userId": "user_or_email_from_your_system",
    "type": "opportunity_won",
    "value": 4500.00,
    "currency": "RUB",
    "metadata": {
      "deal_id": "0061k00000ABC",
      "stage": "Closed Won"
    }
  }'`}</pre>
      <h4 style={{ margin: '18px 0 6px', fontSize: 14, fontWeight: 500 }}>Контракт платежей Syntolk</h4>
      <p style={{ fontSize: 12, color: theme.textMuted, margin: '0 0 10px' }}>
        Для первой оплаты и каждого продления отправляйте уникальный <code>externalEventId</code>.
        Повторная доставка одного события не создаст двойную комиссию.
      </p>
      <pre
        style={{
          padding: 14,
          background: theme.surface2,
          border: `1px solid ${theme.borderSubtle}`,
          borderRadius: 6,
          fontSize: 12,
          overflow: 'auto',
          margin: 0,
        }}
      >{`curl -X POST ${apiBase}/api/payments/events \\
  -H "Authorization: Bearer <your-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "userId": "syntolk-user-5842",
    "type": "invoice_paid",
    "value": 1000.00,
    "currency": "RUB",
    "externalEventId": "payment_2026_000001",
    "metadata": { "tariff": "monthly" }
  }'`}</pre>
      <p style={{ fontSize: 12, color: theme.textMuted, margin: '12px 0 0' }}>
        Смотрите{' '}
        <a
          href="/admin/settings"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: theme.accent, display: 'inline-flex', alignItems: 'center', gap: 3 }}
        >
          документацию по интеграции с CRM
          <ExternalLink size={12} />
        </a>{' '}
        с пошаговыми инструкциями для HubSpot, Salesforce, Pipedrive и Zapier.
      </p>
    </Card>
  );
}

