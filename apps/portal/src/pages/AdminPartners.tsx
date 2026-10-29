import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { api } from '../api.js';
import { theme } from '../theme.js';
import { TenantLink } from '../tenant-link.js';
import { Avatar, Button, Card, EmptyState, ErrorBanner, Input, Label, Page, StatusPill, Table, formatDate } from '../ui.js';

interface Partner {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  cloudPaymentsStatus: 'not_connected' | 'connected' | 'error';
}

export function AdminPartners() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [revoking, setRevoking] = useState<Partner | null>(null);

  const partners = useQuery({ queryKey: ['partners'], queryFn: () => api<{ partners: Partner[] }>('/partners') });

  return (
    <Page
      title="Партнёры"
      subtitle="Приглашайте партнёров — они активируют свой кабинет по ссылке из письма."
      actions={
        <Button icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
          Пригласить партнёра
        </Button>
      }
    >
      <ErrorBanner error={partners.error} />
      {showCreate && (
        <CreatePartner
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['partners'] });
            qc.invalidateQueries({ queryKey: ['admin-overview'] });
          }}
        />
      )}
      {revoking && (
        <RevokeDialog
          partner={revoking}
          onClose={() => setRevoking(null)}
          onDone={() => {
            setRevoking(null);
            qc.invalidateQueries({ queryKey: ['partners'] });
          }}
        />
      )}

      {partners.error ? null : partners.isLoading ? (
        <Card>Загрузка…</Card>
      ) : (partners.data?.partners ?? []).length === 0 ? (
        <EmptyState title="Партнёров пока нет" hint="Пригласите первого, чтобы начать отслеживать атрибуцированную выручку." icon={<Users size={28} strokeWidth={1.25} />} />
      ) : (
        <Table
          columns={['Партнёр', 'Email', 'Статус', 'CloudPayments', 'Создан', 'Действия']}
          rows={(partners.data?.partners ?? []).map((p) => [
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar name={p.name} size={28} />
              <span style={{ fontWeight: 500 }}>{p.name}</span>
            </div>,
            <a href={`mailto:${p.email}`} style={{ color: theme.textMuted, textDecoration: 'none' }}>
              {p.email}
            </a>,
            p.revokedAt
              ? <StatusPill status="revoked" />
              : p.activatedAt
                ? <StatusPill status="active" />
                : <StatusPill status="invited" />,
            <StatusPill status={p.cloudPaymentsStatus === 'connected' ? 'connected' : p.cloudPaymentsStatus === 'error' ? 'error' : 'not_connected'} />,
            <span style={{ color: theme.textMuted }}>{formatDate(p.createdAt, { relative: true })}</span>,
            <div style={{ display: 'flex', gap: 6 }}>
              <TenantLink to={`/admin/partners/${p.id}`} style={{ color: theme.accent, fontSize: 13 }}>Карточка</TenantLink>
              <span style={{ color: theme.border }}>·</span>
              <TenantLink to={`/links?partnerId=${p.id}`} style={{ color: theme.accent, fontSize: 13 }}>Ссылки</TenantLink>
              <span style={{ color: theme.border }}>·</span>
              <TenantLink to={`/admin/partners/${p.id}/programs`} style={{ color: theme.accent, fontSize: 13 }}>Программы</TenantLink>
              <span style={{ color: theme.border }}>·</span>
              <TenantLink to={`/admin/partners/${p.id}/coupons`} style={{ color: theme.accent, fontSize: 13 }}>Купоны</TenantLink>
              <span style={{ color: theme.border }}>·</span>
              <TenantLink to={`/admin/partners/${p.id}/commission`} style={{ color: theme.accent, fontSize: 13 }}>Комиссия</TenantLink>
              <span style={{ color: theme.border }}>·</span>
              <TenantLink to={`/payouts?partnerId=${p.id}`} style={{ color: theme.accent, fontSize: 13 }}>Выплаты</TenantLink>
              {!p.activatedAt && !p.revokedAt && (
                <>
                  <span style={{ color: theme.border }}>·</span>
                  <ResendInvite partnerId={p.id} />
                </>
              )}
              <span style={{ color: theme.border }}>·</span>
              <RevokeAction partner={p} openDialog={() => setRevoking(p)} />
            </div>,
          ])}
        />
      )}
    </Page>
  );
}

interface CreateProgramOption {
  id: string;
  name: string;
}


function CreatePartner({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [grantAll, setGrantAll] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const campaigns = useQuery({
    queryKey: ['me-campaigns-for-invite'],
    queryFn: () => api<{ programs: CreateProgramOption[] }>('/me/programs'),
  });

  const mut = useMutation({
    mutationFn: () =>
      api<Partner>('/partners', {
        method: 'POST',
        body: {
          name,
          email,
          phone: phone || undefined,
          // Only send programIds when admin scoped explicitly. Omitting
          // it preserves the legacy "grant all current campaigns"
          // default the backend already implements.
          programIds: grantAll ? undefined : Array.from(picked),
        },
      }),
    onSuccess: onCreated,
  });

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Пригласить партнёра</div>
      <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 14 }}>
        Партнёр получит письмо с одноразовой ссылкой для настройки кабинета.
      </div>
      <ErrorBanner error={mut.error} />
      <div className="op-grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <Label>Имя</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
        </div>
        <div>
          <Label>Электронная почта</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ada@example.com" />
        </div>
        <div>
          <Label>Телефон</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 900 000-00-00" />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: theme.text, marginBottom: 8 }}>
          <input type="checkbox" checked={grantAll} onChange={(e) => setGrantAll(e.target.checked)} />
          Дать доступ ко всем текущим кампаниям (по умолчанию)
        </label>
        {!grantAll && (
          <div style={{ marginTop: 8, padding: 12, background: theme.surface2, border: `1px solid ${theme.borderSubtle}`, borderRadius: theme.radiusSm }}>
            <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 8 }}>
              Выберите кампании, для которых партнёр сможет создавать ссылки. Позже это можно изменить в строке партнёра.
            </div>
            {(campaigns.data?.programs ?? []).length === 0 ? (
              <div style={{ fontSize: 13, color: theme.textDim }}>Кампаний пока нет — сначала создайте кампанию в разделе «Программы».</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(campaigns.data?.programs ?? []).map((c) => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: theme.text }}>
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          onClick={() => mut.mutate()}
          disabled={!name || !email || mut.isPending || (!grantAll && picked.size === 0)}
        >
          {mut.isPending ? 'Отправляем…' : 'Отправить приглашение'}
        </Button>
        <Button variant="secondary" onClick={onClose}>Отмена</Button>
      </div>
    </Card>
  );
}

function RevokeAction({ partner, openDialog }: { partner: Partner; openDialog: () => void }) {
  const qc = useQueryClient();
  const isRevoked = !!partner.revokedAt;
  // Reinstate is single-click (no email, no reason). Revoke opens the
  // dialog so the admin can set a reason + opt out of notification.
  const reinstate = useMutation({
    mutationFn: () => api(`/partners/${partner.id}/reinstate`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partners'] });
      qc.invalidateQueries({ queryKey: ['admin-overview'] });
    },
  });

  return (
    <button
      onClick={() => (isRevoked ? reinstate.mutate() : openDialog())}
      disabled={reinstate.isPending}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        fontSize: 13,
        color: isRevoked ? theme.accent : theme.danger,
        cursor: 'pointer',
      }}
    >
      {reinstate.isPending ? '…' : isRevoked ? 'Восстановить доступ' : 'Отозвать доступ'}
    </button>
  );
}

function RevokeDialog({
  partner,
  onClose,
  onDone,
}: {
  partner: Partner;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const mut = useMutation({
    mutationFn: () =>
      api(`/partners/${partner.id}/revoke`, {
        method: 'POST',
        body: { reason: reason.trim() || undefined, notify },
      }),
    onSuccess: onDone,
  });

  return (
    <Card style={{ marginBottom: 14, borderColor: `${theme.danger}44` }}>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6, color: theme.danger }}>
        Отозвать доступ у {partner.name}?
      </div>
      <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 14 }}>
        Пользователь будет сразу выведен из системы, а новые клики по его ссылкам перестанут приносить комиссию.
        Исторические комиссии сохранятся. Доступ можно восстановить в любой момент.
      </div>
      <ErrorBanner error={mut.error} />
      <div style={{ marginBottom: 14 }}>
        <Label>Причина (необязательно, будет указана в письме)</Label>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Например: партнёрство завершено"
          maxLength={500}
        />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: theme.textMuted, marginBottom: 16 }}>
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        Отправить партнёру письмо о приостановке
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? 'Отзываем…' : 'Отозвать доступ'}
        </Button>
        <Button variant="secondary" onClick={onClose}>Отмена</Button>
      </div>
    </Card>
  );
}

function ResendInvite({ partnerId }: { partnerId: string }) {
  const [sent, setSent] = useState(false);
  const mut = useMutation({
    mutationFn: () => api(`/partners/${partnerId}/invite`, { method: 'POST' }),
    onSuccess: () => {
      setSent(true);
      setTimeout(() => setSent(false), 2000);
    },
  });
  return (
    <button
      onClick={() => mut.mutate()}
      disabled={mut.isPending}
      style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: theme.accent, cursor: 'pointer' }}
    >
      {sent ? 'Отправлено' : mut.isPending ? 'Отправляем…' : 'Отправить повторно'}
    </button>
  );
}

