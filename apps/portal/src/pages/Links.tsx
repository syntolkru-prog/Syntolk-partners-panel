import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus, ArrowRight, Check, Copy } from 'lucide-react';
import { api, type Principal } from '../api.js';
import { theme } from '../theme.js';
import { TenantLink } from '../tenant-link.js';
import { shareUrlBase } from '../lib/share-links.js';
import { Avatar, Button, Card, EmptyState, ErrorBanner, Input, Label, Page, Select, Table, formatDate } from '../ui.js';
import './links.css';

function CopyableShareLink({ linkKey, base }: { linkKey: string; base: string | null }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  if (!base) return <code style={{ color: theme.accent }}>/r/{linkKey}</code>;
  const url = `${base}/${linkKey}`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
    <a href={url} target="_blank" rel="noreferrer" style={{ color: theme.accent, fontFamily: theme.fontMono }}>
      {url.replace(/^https?:\/\//, '')}
    </a>
    <button
      type="button"
      title={copyError ? 'Браузер не разрешил копирование. Скопируйте адрес самой ссылки.' : 'Скопировать партнёрскую ссылку'}
      aria-label="Скопировать партнёрскую ссылку"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopyError(false);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => setCopyError(true));
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        fontFamily: theme.fontMono,
        fontSize: 13,
        color: theme.accent,
        whiteSpace: 'nowrap',
      }}
    >
      {copied ? <Check size={13} style={{ color: theme.success }} /> : <Copy size={13} style={{ color: theme.textDim }} />}
    </button>
    </span>
  );
}

interface LinkRow {
  id: string;
  linkKey: string;
  destinationUrl: string | null;
  programId: string;
  partnerId: string;
  createdAt: string;
  label: string | null;
  channel: string | null;
  archived?: boolean;
}

interface Program {
  id: string;
  name: string;
  destinationUrl: string;
  deepLinkAllowedDomains: string | null;
}

export function LinksPage({ principal }: { principal: Principal }) {
  const queryPartnerId = new URLSearchParams(window.location.search).get('partnerId');
  const partnerId = principal.partnerId ?? queryPartnerId;
  const isAdmin = principal.role === 'admin';

  if (isAdmin && !partnerId) {
    return <AdminLinksHub />;
  }
  // An admin opening a partner's links from the admin area must be able to
  // create a link for that partner as well. The API already authorizes this
  // operation for admins; keeping the page read-only made the feature look
  // broken because the create action was hidden entirely.
  return <PartnerLinks partnerId={partnerId!} readOnly={false} />;
}

function AdminLinksHub() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['partners'],
    queryFn: () =>
      api<{ partners: Array<{ id: string; name: string; email: string; revokedAt: string | null }> }>('/partners'),
  });
  const activePartners = data?.partners.filter((partner) => !partner.revokedAt) ?? [];

  return (
    <Page title="Ссылки" subtitle="Выберите партнёра, чтобы посмотреть и создать его ссылки.">
      <ErrorBanner error={error} />
      {isLoading ? (
        <Card>Загрузка…</Card>
      ) : activePartners.length === 0 ? (
        <EmptyState
          title="Активных партнёров пока нет"
          hint="Добавьте или восстановите партнёра в разделе «Партнёры»."
          icon={<Link2 size={28} strokeWidth={1.25} />}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {activePartners.map((p) => (
            <TenantLink
              key={p.id}
              to={`/links?partnerId=${p.id}`}
              style={{
                display: 'block',
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                borderRadius: theme.radiusMd,
                padding: 16,
                transition: 'all 120ms',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = theme.accent)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = theme.border)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={p.name} size={32} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: theme.textMuted }}>{p.email}</div>
                </div>
                <ArrowRight size={14} color={theme.textDim} />
              </div>
            </TenantLink>
          ))}
        </div>
      )}
    </Page>
  );
}

function PartnerLinks({ partnerId, readOnly }: { partnerId: string; readOnly: boolean }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const shareBase = shareUrlBase();

  const links = useQuery({
    queryKey: ['links', partnerId],
    queryFn: () => api<{ links: LinkRow[];archivedCount:number }>(`/partners/${partnerId}/links?archived=1`),
  });

  // Partners need this too — they pick a Program when creating a link
  // and we surface the inherited destination. /me/campaigns is the
  // partner-friendly read-only slice (no commission rules etc.).
  const campaigns = useQuery({
    queryKey: ['me-campaigns'],
    queryFn: () => api<{ programs: Program[] }>('/me/programs').catch(() => ({ programs: [] })),
  });

  const allLinks=links.data?.links??[];
  const activeLinks=allLinks.filter(link=>!link.archived);
  const archivedLinks=allLinks.filter(link=>link.archived);
  const renderLinksTable=(rows:LinkRow[])=><Table
    columns={['Основная ссылка', 'Канал', 'Назначение', 'Программа', 'Создана']}
    rows={rows.map((l) => {
      const campaign = campaigns.data?.programs.find((c) => c.id === l.programId);
      const dest = l.destinationUrl ?? campaign?.destinationUrl ?? '—';
      return [
        <CopyableShareLink linkKey={l.linkKey} base={shareBase} />,
        <span style={{ color: theme.textMuted, fontSize: 13 }}>{l.label || l.channel || '—'}</span>,
        <span style={{ color: theme.textMuted, fontSize: 13 }}>
          {dest}
          {l.destinationUrl && (
            <span style={{ color: theme.accent, fontSize: 11, marginLeft: 8 }}>(прямая ссылка)</span>
          )}
        </span>,
        <span>{campaign?.name ?? <code style={{ color: theme.textDim, fontSize: 12 }}>{l.programId.slice(0, 8)}…</code>}</span>,
        <span style={{ color: theme.textMuted }}>{formatDate(l.createdAt, { relative: true })}</span>,
      ];
    })}
  />;
  return (
    <Page
      title="Ссылки"
      subtitle={
        readOnly
          ? "Ссылки, созданные этим партнёром."
          : "Постоянные ссылки — для профиля и закрепов. Ссылки материалов — в календаре и «Результатах»."
      }
      actions={
        readOnly ? undefined : (
          <Button icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
            Новая ссылка
          </Button>
        )
      }
    >
      <ErrorBanner error={links.error} />
      {showCreate && !readOnly && (
        <CreateLink
          partnerId={partnerId}
          campaigns={campaigns.data?.programs ?? []}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['links', partnerId] });
          }}
        />
      )}
      {links.isLoading ? (
        <Card>Загрузка…</Card>
      ) : allLinks.length === 0 ? (
        <EmptyState
          title="Ссылок пока нет"
          hint={readOnly ? 'У этого партнёра пока нет ссылок.' : 'Создайте ссылку, чтобы начать учитывать переходы.'}
          icon={<Link2 size={28} strokeWidth={1.25} />}
        />
      ) : (
        <>
          {activeLinks.length>0&&renderLinksTable(activeLinks)}
          {archivedLinks.length>0&&<Card padded={false} style={{marginTop:16,overflow:'hidden'}}><details className="links-disclosure"><summary>Архив</summary><div className="links-disclosure__body">{renderLinksTable(archivedLinks)}</div></details></Card>}
        </>
      )}
    </Page>
  );
}

function CreateLink({
  partnerId,
  campaigns,
  onClose,
  onCreated,
}: {
  partnerId: string;
  campaigns: Program[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [linkKey, setLinkKey] = useState('');
  const [programId, setProgramId] = useState(new URLSearchParams(window.location.search).get('programId') ?? campaigns[0]?.id ?? '');
  const [useDeepLink, setUseDeepLink] = useState(false);
  const [destinationOverride, setDestinationOverride] = useState('');
  const [label, setLabel] = useState('');
  const [channel, setChannel] = useState('');

  const selectedProgram = campaigns.find((c) => c.id === programId);
  const deepLinkAllowed = !!selectedProgram?.deepLinkAllowedDomains;

  const mut = useMutation({
    mutationFn: () =>
      api(`/partners/${partnerId}/links`, {
        method: 'POST',
        body: {
          linkKey,
          programId,
          // Only send destinationUrl when the partner has explicitly
          // opted into a deep-link override on a  Program that allows it.
          destinationUrl: useDeepLink && destinationOverride ? destinationOverride : undefined,
          label: label || undefined,
          channel: channel || undefined,
        },
      }),
    onSuccess: onCreated,
  });

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 16 }}>Новая ссылка</div>
      <ErrorBanner error={mut.error} />
      <div style={{ marginBottom: 14 }}>
        <Label>Программа</Label>
        {campaigns.length === 0 ? (
          <Input value={programId} onChange={(e) => setProgramId(e.target.value)} placeholder="ID программы" />
        ) : (
          <Select value={programId} onChange={(e) => setProgramId(e.target.value)}>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        {selectedProgram && (
          <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 6 }}>
            Адрес перехода: <code style={{ color: theme.textMuted }}>{selectedProgram.destinationUrl}</code>
          </div>
        )}
      </div>
      <div style={{ marginBottom: 14 }}>
        <Label>Название ссылки</Label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Telegram — закреплённый пост" />
      </div>
      <div style={{ marginBottom: 14 }}>
        <Label>Канал</Label>
        <Input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="telegram, tiktok, youtube или site" />
      </div>
      <div style={{ marginBottom: 14 }}>
        <Label>Ключ ссылки</Label>
        <Input value={linkKey} onChange={(e) => setLinkKey(e.target.value)} placeholder="partner-ada" />
        <div style={{ fontSize: 12, color: theme.textDim, marginTop: 6 }}>
          Будет доступна по адресу <code style={{ color: theme.textDim }}>/r/{linkKey || 'ваш-ключ'}</code>.
        </div>
      </div>
      {deepLinkAllowed && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: theme.text, marginBottom: 8 }}>
            <input type="checkbox" checked={useDeepLink} onChange={(e) => setUseDeepLink(e.target.checked)} />
            Вести на конкретную страницу сайта Syntolk
          </label>
          {useDeepLink && (
            <>
              <Input
                type="url"
                value={destinationOverride}
                onChange={(e) => setDestinationOverride(e.target.value)}
                placeholder={`https://${selectedProgram?.deepLinkAllowedDomains?.split(',')[0]?.trim() ?? 'yourbrand.com'}/some/page`}
              />
              <div style={{ fontSize: 12, color: theme.textDim, marginTop: 6 }}>
                Разрешённые домены: {selectedProgram?.deepLinkAllowedDomains}
              </div>
            </>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => mut.mutate()} disabled={!linkKey || !programId || mut.isPending}>
          {mut.isPending ? 'Создание…' : 'Создать ссылку'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </Card>
  );
}
