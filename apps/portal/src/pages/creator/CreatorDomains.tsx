import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import { Button, Card, EmptyState, ErrorBanner, Input, Label, Page } from '../../ui.js';
import { theme } from '../../theme.js';
import { creatorApi, ApiError } from './creator-api.js';

type DomainStatus = 'pending' | 'verified' | 'failed';

interface Instructions {
  txt: { name: string; value: string };
  cname: { name: string; value: string };
}

interface Domain {
  id: string;
  domain: string;
  status: DomainStatus;
  verifiedAt: string | null;
  createdAt: string;
  instructions: Instructions | null;
}

export function CreatorDomainsPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['creator-domains'],
    queryFn: () => creatorApi<{ domains: Domain[] }>('/creators/me/domains'),
    retry: false,
  });

  const [showAdd, setShowAdd] = useState(false);

  return (
    <Page
      title="Пользовательские домены"
      subtitle="Используйте свой домен для партнёрских ссылок вместо стандартного адреса Syntolk."
      actions={
        <Button onClick={() => setShowAdd(true)}>Добавить домен</Button>
      }
    >
      <ErrorBanner error={list.error} />
      {showAdd && (
        <AddDomainCard
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            qc.invalidateQueries({ queryKey: ['creator-domains'] });
          }}
        />
      )}
      {list.isLoading ? (
        <Card>Загрузка…</Card>
      ) : !list.data || list.data.domains.length === 0 ? (
        <EmptyState
          title="Пользовательских доменов пока нет"
          hint="Направьте свой домен на роутер Syntolk — партнёрские ссылки будут иметь вид https://yourdomain.com/r/<program>."
          icon={<Globe size={28} strokeWidth={1.25} />}
        />
      ) : (
        list.data.domains.map((d) => <DomainCard key={d.id} domain={d} />)
      )}
    </Page>
  );
}

function AddDomainCard({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [domain, setDomain] = useState('');
  const mut = useMutation({
    mutationFn: () =>
      creatorApi<Domain>('/creators/me/domains', { method: 'POST', body: { domain: domain.trim().toLowerCase() } }),
    onSuccess: onAdded,
  });

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Добавить домен</div>
      <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 14 }}>
        Используйте поддомен, например <code>share.yourbrand.com</code> — большинство DNS-провайдеров не поддерживают CNAME для корневых доменов.
      </div>
      <ErrorBanner error={mut.error} />
      <div style={{ marginBottom: 14 }}>
        <Label>Домен</Label>
        <Input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="share.yourbrand.com"
          style={{ fontFamily: theme.fontMono }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => mut.mutate()} disabled={!domain.trim() || mut.isPending}>
          {mut.isPending ? 'Добавляем…' : 'Добавить домен'}
        </Button>
        <Button variant="secondary" onClick={onClose}>Отмена</Button>
      </div>
    </Card>
  );
}

function DomainCard({ domain }: { domain: Domain }) {
  const qc = useQueryClient();
  const verify = useMutation({
    mutationFn: () => creatorApi(`/creators/me/domains/${domain.id}/verify`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creator-domains'] }),
    onError: () => qc.invalidateQueries({ queryKey: ['creator-domains'] }),
  });
  const remove = useMutation({
    mutationFn: () => creatorApi(`/creators/me/domains/${domain.id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creator-domains'] }),
  });

  const verifyError = verify.error as ApiError | null;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h3 style={{ marginTop: 0, marginBottom: 0, flex: 1, fontFamily: theme.fontMono }}>
          {domain.domain}
        </h3>
        <StatusChip status={domain.status} />
      </div>
      {domain.status === 'verified' ? (
        <p style={{ color: theme.textMuted, fontSize: 13, margin: '4px 0 0' }}>
          Подтверждён. Ссылки на ваши программы доступны по адресу{' '}
          <code>https://{domain.domain}/r/&lt;program&gt;</code>.
        </p>
      ) : (
        <>
          <p style={{ color: theme.textMuted, fontSize: 13, margin: '4px 0 14px' }}>
            Добавьте эти две записи у DNS-провайдера, затем нажмите «Проверить».
          </p>
          {domain.instructions && <DnsBlock instructions={domain.instructions} />}
          {verifyError && <VerifyErrorBox error={verifyError} />}
        </>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {domain.status !== 'verified' && (
          <Button onClick={() => verify.mutate()} disabled={verify.isPending}>
            {verify.isPending ? 'Проверяем…' : 'Проверить'}
          </Button>
        )}
        <Button
          variant="danger"
          onClick={() => {
            if (confirm(`Удалить ${domain.domain}? Существующие ссылки на этом домене сразу перестанут работать.`)) {
              remove.mutate();
            }
          }}
          disabled={remove.isPending}
        >
          Удалить
        </Button>
      </div>
    </Card>
  );
}

function VerifyErrorBox({ error }: { error: ApiError }) {
  let detail: string | null = null;
  if (error.detail && typeof error.detail === 'object' && 'detail' in error.detail) {
    const d = (error.detail as { detail: unknown }).detail;
    if (typeof d === 'string') detail = d;
  }
  return (
    <div style={{ background: `${theme.danger}10`, border: `1px solid ${theme.danger}55`, borderRadius: theme.radiusSm, padding: 12, marginTop: 12, fontSize: 13, color: theme.danger }}>
      {error.message}
      {detail && (
        <div style={{ marginTop: 6, color: `${theme.danger}cc`, fontSize: 12 }}>{detail}</div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: DomainStatus }) {
  const palette: Record<DomainStatus, { bg: string; fg: string; label: string }> = {
    pending: { bg: `${theme.accentA15}`, fg: theme.accent, label: 'Ожидает проверки' },
    verified: { bg: theme.successSoft, fg: theme.success, label: 'Подтверждён' },
    failed: { bg: `${theme.danger}15`, fg: theme.danger, label: 'Ошибка' },
  };
  const p = palette[status];
  return (
    <span style={{ background: p.bg, color: p.fg, fontSize: 11, padding: '3px 10px', borderRadius: 12, fontWeight: 600 }}>
      {p.label}
    </span>
  );
}

function DnsBlock({ instructions }: { instructions: Instructions }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <DnsRow label="TXT" name={instructions.txt.name} value={instructions.txt.value} />
      <DnsRow label="CNAME" name={instructions.cname.name} value={instructions.cname.value} />
      <p style={{ color: theme.textDim, fontSize: 12, margin: 0 }}>
        Большинство DNS-провайдеров не разрешают CNAME для корневых доменов — используйте поддомен
        (<code>share.yourbrand.com</code>) или эквивалент ALIAS / ANAME. Пока выпускается сертификат,
        можно включить гибкий SSL Cloudflare или использовать HTTP для тестирования.
      </p>
    </div>
  );
}

function DnsRow({ label, name, value }: { label: string; name: string; value: string }) {
  return (
    <div style={{ background: theme.surface2, border: `1px solid ${theme.borderSubtle}`, borderRadius: theme.radiusSm, padding: 10 }}>
      <div style={{ fontSize: 11, color: theme.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        Запись {label}
      </div>
      <div style={{ fontFamily: theme.fontMono, fontSize: 13, wordBreak: 'break-all' }}>
        <span style={{ color: theme.textMuted }}>{name}</span>
        {' = '}
        <span>{value}</span>
      </div>
    </div>
  );
}
