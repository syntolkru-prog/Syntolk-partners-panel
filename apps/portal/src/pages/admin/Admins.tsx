import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserCog } from 'lucide-react';
import { api } from '../../api.js';
import { theme } from '../../theme.js';
import { Avatar, Button, Card, EmptyState, ErrorBanner, Input, Label, Page, StatusPill, Table, formatDate } from '../../ui.js';

interface Admin {
  id: string;
  email: string;
  name: string;
  activatedAt: string | null;
  revokedAt: string | null;
  lastSignInAt: string | null;
  createdAt: string;
}

export function AdminAdmins() {
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);

  const admins = useQuery({ queryKey: ['admins'], queryFn: () => api<{ admins: Admin[] }>('/admins') });

  return (
    <Page
      title="Администраторы"
      subtitle="Пользователи, которые могут управлять этой партнёрской программой. Они получают приглашение по электронной почте и самостоятельно активируют доступ."
      actions={
        <Button icon={<Plus size={14} />} onClick={() => setShowInvite(true)}>
          Пригласить администратора
        </Button>
      }
    >
      <ErrorBanner error={admins.error} />
      {showInvite && (
        <InviteAdmin
          onClose={() => setShowInvite(false)}
          onCreated={() => {
            setShowInvite(false);
            qc.invalidateQueries({ queryKey: ['admins'] });
          }}
        />
      )}
      {admins.isLoading ? (
        <Card>Загрузка…</Card>
      ) : (admins.data?.admins ?? []).length === 0 ? (
        <EmptyState title="Администраторов пока нет" hint="Пригласите свою команду." icon={<UserCog size={28} strokeWidth={1.25} />} />
      ) : (
        <Table
          columns={['Администратор', 'Электронная почта', 'Статус', 'Последний вход', 'Создан', 'Действия']}
          rows={(admins.data?.admins ?? []).map((a) => [
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar name={a.name} size={28} />
              <span style={{ fontWeight: 500 }}>{a.name}</span>
            </div>,
            <a href={`mailto:${a.email}`} style={{ color: theme.textMuted, textDecoration: 'none' }}>
              {a.email}
            </a>,
            a.revokedAt ? <StatusPill status="revoked" /> : a.activatedAt ? <StatusPill status="active" /> : <StatusPill status="invited" />,
            a.lastSignInAt ? (
              <span style={{ color: theme.textMuted }}>{formatDate(a.lastSignInAt, { relative: true })}</span>
            ) : (
              <span style={{ color: theme.textDim }}>—</span>
            ),
            <span style={{ color: theme.textMuted }}>{formatDate(a.createdAt, { relative: true })}</span>,
            <AdminActions admin={a} />,
          ])}
        />
      )}
    </Page>
  );
}

function InviteAdmin({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const mut = useMutation({
    mutationFn: () => api<Admin>('/admins', { method: 'POST', body: { name, email } }),
    onSuccess: onCreated,
  });

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Пригласить администратора</div>
      <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 14 }}>
        Пользователь получит письмо с одноразовой ссылкой для активации аккаунта.
      </div>
      <ErrorBanner error={mut.error} />
      <div className="op-grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <Label>Имя</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Taylor Admin" />
        </div>
        <div>
          <Label>Электронная почта</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="taylor@example.com" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => mut.mutate()} disabled={!name || !email || mut.isPending}>
          {mut.isPending ? 'Отправляем…' : 'Отправить приглашение'}
        </Button>
        <Button variant="secondary" onClick={onClose}>Отмена</Button>
      </div>
    </Card>
  );
}

function AdminActions({ admin }: { admin: Admin }) {
  const qc = useQueryClient();
  const [sent, setSent] = useState(false);
  const revoke = useMutation({
    mutationFn: () => api(`/admins/${admin.id}/revoke`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admins'] }),
  });
  const reinstate = useMutation({
    mutationFn: () => api(`/admins/${admin.id}/reinstate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admins'] }),
  });
  const resend = useMutation({
    mutationFn: () => api(`/admins/${admin.id}/invite`, { method: 'POST' }),
    onSuccess: () => {
      setSent(true);
      setTimeout(() => setSent(false), 2000);
    },
  });

  const isRevoked = !!admin.revokedAt;
  const isPending = !admin.activatedAt && !admin.revokedAt;

  function confirmRevoke() {
    const ok = window.confirm(`Отозвать доступ у ${admin.name}? Пользователь будет выведен из системы и потеряет права администратора.`);
    if (ok) revoke.mutate();
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {isPending && (
        <>
          <button
            onClick={() => resend.mutate()}
            disabled={resend.isPending}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: theme.accent, cursor: 'pointer' }}
          >
            {sent ? 'Отправлено' : resend.isPending ? 'Отправляем…' : 'Отправить повторно'}
          </button>
          <span style={{ color: theme.border }}>·</span>
        </>
      )}
      {isRevoked ? (
        <button
          onClick={() => reinstate.mutate()}
          disabled={reinstate.isPending}
          style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: theme.accent, cursor: 'pointer' }}
        >
          {reinstate.isPending ? '…' : 'Восстановить доступ'}
        </button>
      ) : (
        <button
          onClick={confirmRevoke}
          disabled={revoke.isPending}
          style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: theme.danger, cursor: 'pointer' }}
        >
          {revoke.isPending ? '…' : 'Отозвать доступ'}
        </button>
      )}
    </div>
  );
}
