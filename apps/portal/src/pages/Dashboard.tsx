import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  MousePointerClick,
  Receipt,
  Wallet,
  Users,
  CheckCircle2,
  Circle,
  ArrowRight,
} from 'lucide-react';
import { api, type Principal } from '../api.js';
import { useTenantBase } from '../tenant-base.js';
import { theme } from '../theme.js';
import { PartnerHome } from './PartnerHome.js';
import { useBrand } from '../lib/useBrand.js';
import { Avatar, Button, Card, EmptyState, ErrorBanner, Page, SectionHeading, Stat, money } from '../ui.js';

export function Dashboard({ principal }: { principal: Principal }) {
  if (principal.role === 'admin') return <AdminDashboard />;
  if (principal.role === 'partner') {
    return <PartnerHome partnerId={principal.partnerId!} name={principal.partner?.name ?? ''} />;
  }
  return null;
}

// ---------- Admin ----------

interface AdminOverview {
  since: string;
  totals: {
    partners: number;
    clicks: number;
    registrations: number;
    attributedRevenue: number;
    attributedEvents: number;
    commissionAccrued: number;
    commissionApproved: number;
    commissionPending: number;
    commissionPaid: number;
    netRevenue: number;
  };
  partners: Array<{
    id: string;
    name: string;
    email: string;
    clicks: number;
    registrations: number;
    revenue: number;
    events: number;
    commission: Record<string, number>;
    netRevenue: number;
  }>;
}

function AdminDashboard() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api<AdminOverview>('/admin/overview'),
  });

  return (
    <Page title="Партнёрская программа" subtitle="Обзор всех партнёров и привлечённой ими атрибуцированной выручки.">
      <ErrorBanner error={error} />
      <BrandOnboarding />
      {isLoading ? (
        <Card>Загрузка…</Card>
      ) : data ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <Stat label="Партнёры" value={data.totals.partners} icon={<Users size={16} />} />
            <Stat label="Переходы (30 дн.)" value={data.totals.clicks} icon={<MousePointerClick size={16} />} />
            <Stat label="Регистрации (30 дн.)" value={data.totals.registrations} icon={<Receipt size={16} />} />
            <Stat label="Выручка от партнёров" value={money(data.totals.attributedRevenue)} icon={<Wallet size={16} />} />
            <Stat label="Осталось Syntolk" value={money(data.totals.netRevenue)} icon={<Wallet size={16} />} />
            <Stat
              label="Ожидает подтверждения"
              value={money(data.totals.commissionAccrued)}
              hint={`${money(data.totals.commissionApproved)} доступно, ${money(data.totals.commissionPending ?? 0)} ожидает, ${money(data.totals.commissionPaid)} выплачено`}
              icon={<Receipt size={16} />}
            />
          </div>

          <SectionHeading>Партнёры</SectionHeading>
          {data.partners.length === 0 ? (
            <EmptyState
              title="Партнёров пока нет"
              hint="Добавьте партнёра через раздел «Администрирование → Партнёры»."
              icon={<Users size={28} strokeWidth={1.25} />}
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
              {data.partners.map((p) => (
                <PartnerCard key={p.id} partner={p} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </Page>
  );
}

function PartnerCard({
  partner,
}: {
  partner: AdminOverview['partners'][number];
}) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Avatar name={partner.name} size={40} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {partner.name}
          </div>
          <div style={{ fontSize: 12, color: theme.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {partner.email}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <MiniStat label="Выручка" value={money(partner.revenue)} />
        <MiniStat label="Осталось Syntolk" value={money(partner.netRevenue)} />
        <MiniStat
          label="Выплаты"
          value={money((partner.commission.paid ?? 0) + (partner.commission.approved ?? 0))}
        />
        <MiniStat label="Переходы" value={String(partner.clicks)} />
        <MiniStat label="Регистрации" value={String(partner.registrations)} />
        <MiniStat label="События" value={String(partner.events)} />
      </div>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

interface BrandOnboardingStatus {
  brandInfoComplete: boolean;
  campaignCount: number;
  networkConnected: boolean;
  networkOptional: boolean;
  offeringPublishedCount: number;
  partnerCount: number;
  pendingPartnershipRequests: number;
  complete: boolean;
}

function BrandOnboarding() {
  const tenantBase = useTenantBase();
  const { whiteLabel } = useBrand();
  const { data } = useQuery({
    queryKey: ['admin-onboarding-status'],
    queryFn: () => api<BrandOnboardingStatus>('/admin/onboarding-status'),
    staleTime: 30_000,
    retry: false,
  });
  if (!data || data.complete) return null;
  const networkRequired = !whiteLabel && !data.networkOptional;
  const items = [
     { done: true, label: 'Аккаунт компании создан', href: null as string | null },
    {
      done: data.brandInfoComplete,
       label: 'Укажите название компании и email поддержки',
      href: `${tenantBase}/admin/settings`,
    },
    {
      done: data.campaignCount > 0,
       label: 'Создайте первую программу (кампанию)',
       hint: 'Укажите URL назначения и условия комиссии.',
      href: `${tenantBase}/admin/programs`,
    },
    // The Network is the shared cross-tenant marketplace — white-label
    // tenants are isolated from it, so drop the listing step entirely.
    ...(networkRequired
      ? [
          {
            done: data.networkConnected,
            label: 'Разместить компанию в сети Syntolk',
            hint: 'Авторы из всей сети смогут найти вас и подать заявку.',
            href: `${tenantBase}/admin/network`,
          },
        ]
      : []),
    ...(networkRequired
      ? [
          {
            done: data.offeringPublishedCount > 0,
            label: 'Опубликуйте программу',
            hint:
              data.networkConnected
                ? 'Компания автоматически размещается в сети Syntolk при включённой публикации.'
                : 'Подключите сеть авторов, чтобы опубликовать программу.',
            href: `${tenantBase}/admin/programs`,
          },
        ]
      : []),
    {
      done: data.partnerCount > 0,
       label: whiteLabel ? 'Пригласите партнёра' : 'Пригласите партнёра или дождитесь заявок из сети',
      href: `${tenantBase}/admin/partners`,
    },
  ];
  return (
    <Card style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Начало работы</div>
      <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 14 }}>
        Несколько простых шагов — и компания будет полностью настроена. Карточка исчезнет после завершения.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it, i) => (
          <BrandStep key={i} done={it.done} label={it.label} hint={it.hint} href={it.href} />
        ))}
      </div>
    </Card>
  );
}

type StepTone = 'default' | 'warning' | 'danger';

interface OnboardingStep {
  done: boolean;
  label: string;
  hint?: string;
  href: string | null;
  tone?: StepTone;
}

function BrandStep({ done, label, hint, href, tone = 'default' }: OnboardingStep) {
  const palette = stepPalette(done, tone);
  const inner = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: theme.radiusSm,
      }}
    >
      <div style={{ color: palette.icon, display: 'inline-flex' }}>
        {done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: theme.text, textDecoration: done ? 'line-through' : 'none' }}>
          {label}
        </div>
        {hint && !done && <div style={{ fontSize: 12, color: palette.hint, marginTop: 2 }}>{hint}</div>}
      </div>
      {!done && href && <ArrowRight size={14} color={theme.textDim} />}
    </div>
  );
  if (done || !href) return inner;
  return <Link to={href} style={{ textDecoration: 'none' }}>{inner}</Link>;
}

function stepPalette(done: boolean, tone: StepTone) {
  if (done) {
    return { bg: theme.successSoft, border: `${theme.success}44`, icon: theme.success, hint: theme.textDim };
  }
  if (tone === 'danger') {
    return { bg: theme.dangerSoft, border: `${theme.danger}66`, icon: theme.danger, hint: theme.danger };
  }
  if (tone === 'warning') {
    return { bg: theme.warnSoft, border: `${theme.warn}66`, icon: theme.warn, hint: theme.warn };
  }
  return { bg: theme.surface2, border: theme.borderSubtle, icon: theme.textDim, hint: theme.textDim };
}
