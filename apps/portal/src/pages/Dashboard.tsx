import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  MousePointerClick,
  Receipt,
  Wallet,
  Users,
  UserCheck,
  CreditCard,
  Link2,
  CheckCircle2,
  Circle,
  ArrowRight,
} from 'lucide-react';
import { api, type Principal } from '../api.js';
import { useTenantBase } from '../tenant-base.js';
import { TenantLink } from '../tenant-link.js';
import { theme } from '../theme.js';
import { CoachWelcome } from './coach/CoachWelcome.js';
import { useBrand } from '../lib/useBrand.js';
import { Avatar, Button, Card, EmptyState, ErrorBanner, Page, SectionHeading, Stat, StatusPill, money } from '../ui.js';

// ---------- Partner ----------

interface PartnerDashboard {
  partnerId: string;
  since: string;
  clicks: number;
  attributedEvents: number;
  registrations: number;
  payingClients: number;
  conversionRate: number;
  attributedRevenue: number;
  commissionByStatus: Record<string, number>;
  balances: { accrued: number; available: number; pending: number; paid: number; total: number };
  links?: Array<{ linkKey: string; clicks: number; attributedEvents: number; attributedRevenue: number }>;
}

interface PartnerProfile {
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  cloudPaymentsStatus: 'not_connected' | 'connected' | 'error';
}

export function Dashboard({ principal }: { principal: Principal }) {
  if (principal.role === 'admin') return <AdminDashboard />;
  if (principal.role === 'partner') {
    return <PartnerDashboard partnerId={principal.partnerId!} name={principal.partner?.name ?? ''} />;
  }
  return null;
}

interface Funnel {
  stages: { clicks: number; identities: number; signups: number; paid: number };
  rates: { stitchRate: number; signupRate: number; paidRate: number; overall: number };
  revenue: number;
}

function PartnerDashboard({ partnerId, name }: { partnerId: string; name: string }) {
  const { programTermsUrl } = useBrand();
  const [period, setPeriod] = useState<'today' | '7d' | '30d' | 'all'>('30d');
  const since = period === 'today'
    ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
    : period === '7d'
      ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      : period === 'all' ? '2000-01-01T00:00:00.000Z' : undefined;
  const { data, error, isLoading } = useQuery({
    queryKey: ['dashboard', partnerId, period],
    queryFn: () => api<PartnerDashboard>(`/partners/${partnerId}/dashboard${since ? `?since=${encodeURIComponent(since)}&includeLinks=true` : '?includeLinks=true'}`),
  });
  const funnel = useQuery({
    queryKey: ['funnel', partnerId],
    queryFn: () => api<Funnel>(`/partners/${partnerId}/funnel`),
  });
  const links = useQuery({
    queryKey: ['links', partnerId],
    queryFn: () => api<{ links: unknown[] }>(`/partners/${partnerId}/links`),
  });
  const profile = useQuery({
    queryKey: ['partner-profile', partnerId],
    queryFn: () => api<PartnerProfile>(`/partners/${partnerId}`),
  });
  const acceptTerms = useMutation({
    mutationFn: () => api(`/partners/${partnerId}/terms`, {
      method: 'POST',
      body: { accepted: true, version: 'syntolk-v1' },
    }),
    onSuccess: () => profile.refetch(),
  });

  const linkCount = links.data?.links.length ?? 0;
  const hasLink = linkCount > 0;
  const showGettingStarted = !links.isLoading && !hasLink;

  return (
    <Page
      title={`Здравствуйте, ${name.split(' ')[0] || 'партнёр'}`}
      subtitle="Партнёрская статистика Syntolk"
      actions={
        <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} style={{ padding: '8px 10px', borderRadius: theme.radiusSm, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text }}>
          <option value="today">Сегодня</option>
          <option value="7d">7 дней</option>
          <option value="30d">30 дней</option>
          <option value="all">За всё время</option>
        </select>
      }
    >
      <ErrorBanner error={error} />
      <CoachWelcome partnerId={partnerId} />
      {!profile.isLoading && profile.data && !profile.data.termsAcceptedAt && (
        <Card style={{ marginBottom: 14, borderColor: `${theme.warn}66`, background: theme.warnSoft }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 5 }}>Подтвердите условия партнёрской программы</div>
          <div style={{ fontSize: 13, color: theme.textMuted, lineHeight: 1.5, marginBottom: 12 }}>
            Перед началом работы подтвердите условия Syntolk. Это сохранится в истории кабинета вместе с версией документа.
            {programTermsUrl && (
              <> {' '}<a href={programTermsUrl} target="_blank" rel="noreferrer" style={{ color: theme.accent }}>Открыть условия</a></>
            )}
          </div>
          <ErrorBanner error={acceptTerms.error} />
          <Button onClick={() => acceptTerms.mutate()} disabled={acceptTerms.isPending}>
            {acceptTerms.isPending ? 'Сохраняем…' : 'Принять условия'}
          </Button>
        </Card>
      )}
      {showGettingStarted && (
        <GettingStarted hasLink={hasLink} />
      )}
      {isLoading || !data ? (
        <Card>Загрузка…</Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <Stat label="Переходы" value={data.clicks} icon={<MousePointerClick size={16} />} />
            <Stat label="Регистрации" value={data.registrations} icon={<Receipt size={16} />} />
            <Stat label="Платящие клиенты" value={data.payingClients} icon={<CreditCard size={16} />} />
            <Stat label="Конверсия" value={`${(data.conversionRate * 100).toFixed(1)}%`} icon={<CreditCard size={16} />} />
            <Stat label="Доход от клиентов" value={money(data.attributedRevenue)} icon={<Wallet size={16} />} />
            <Stat label="Начислено всего" value={money(data.balances.total)} icon={<Wallet size={16} />} />
            <Stat label="Доступно к выплате" value={money(data.balances.available)} icon={<Wallet size={16} />} />
            <Stat label="Ожидает выплаты" value={money(data.balances.pending ?? 0)} icon={<Wallet size={16} />} />
            <Stat label="Выплачено" value={money(data.balances.paid)} icon={<Wallet size={16} />} />
          </div>

          {funnel.data && <FunnelChart funnel={funnel.data} />}

          {(data.links ?? []).length > 0 && (
            <>
              <SectionHeading>Эффективность ссылок</SectionHeading>
              <Card>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {data.links!.map((link) => (
                    <div key={link.linkKey} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 80px 100px 130px', gap: 10, alignItems: 'center', fontSize: 13 }}>
                      <code style={{ color: theme.accent }}>{link.linkKey}</code>
                      <span style={{ color: theme.textMuted }}>{link.clicks} переходов</span>
                      <span style={{ color: theme.textMuted }}>{link.attributedEvents} событий</span>
                      <span style={{ fontWeight: 500 }}>{money(link.attributedRevenue)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}

          <SectionHeading>Начисления</SectionHeading>
          <Card>
            {Object.keys(data.commissionByStatus).length === 0 ? (
              <div style={{ color: theme.textMuted, fontSize: 14 }}>
                Здесь появятся начисления после регистрации и оплаты клиентов.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(['accrued', 'approved', 'pending', 'paid', 'reversed'] as const).map((status) => {
                  const amount = data.commissionByStatus[status] ?? 0;
                  if (amount === 0) return null;
                  return (
                    <div key={status} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <StatusPill status={status} />
                      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 15, fontWeight: 500 }}>
                        {money(amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}

function GettingStarted({ hasLink }: { hasLink: boolean }) {
  return (
    <Card>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Начало работы</div>
      <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 16 }}>
        Два простых шага — и вы сможете зарабатывать. Карточка исчезнет после выполнения обоих.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ChecklistRow
          done={hasLink}
          icon={<Link2 size={16} />}
           title="Создайте первую партнёрскую ссылку"
           hint="Выберите короткий идентификатор — каждый клик по ссылке будет учтён за вами."
           cta="Создать ссылку"
          to="/links"
        />
      </div>
    </Card>
  );
}

function ChecklistRow({
  done,
  icon,
  title,
  hint,
  cta,
  to,
}: {
  done: boolean;
  icon: React.ReactNode;
  title: string;
  hint: string;
  cta: string;
  to: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: done ? theme.successSoft : theme.surface2,
        border: `1px solid ${done ? `${theme.success}44` : theme.borderSubtle}`,
        borderRadius: theme.radiusSm,
      }}
    >
      <div style={{ color: done ? theme.success : theme.textDim, display: 'inline-flex' }}>
        {done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
      </div>
      <div style={{ color: theme.textMuted, display: 'inline-flex' }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: theme.text, textDecoration: done ? 'line-through' : 'none' }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: theme.textDim, marginTop: 2 }}>{hint}</div>
      </div>
      {!done && (
        <TenantLink to={to} style={{ textDecoration: 'none' }}>
          <Button size="sm">{cta}</Button>
        </TenantLink>
      )}
    </div>
  );
}

function FunnelChart({ funnel }: { funnel: Funnel }) {
  const stages = [
    { key: 'clicks', label: 'Переходы', value: funnel.stages.clicks, icon: <MousePointerClick size={14} />, rate: null },
    { key: 'identities', label: 'Связанные', value: funnel.stages.identities, icon: <UserCheck size={14} />, rate: funnel.rates.stitchRate },
    { key: 'signups', label: 'Регистрации', value: funnel.stages.signups, icon: <Receipt size={14} />, rate: funnel.rates.signupRate },
    { key: 'paid', label: 'Оплачено', value: funnel.stages.paid, icon: <CreditCard size={14} />, rate: funnel.rates.paidRate },
  ];
  const max = Math.max(1, ...stages.map((s) => s.value));
  const pct = (n: number | null | undefined) => (n == null ? '' : `${Math.round(n * 100)}%`);

  return (
    <>
       <SectionHeading>Воронка</SectionHeading>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {stages.map((s, i) => {
            const width = `${Math.max(6, (s.value / max) * 100)}%`;
            return (
              <div key={s.key} className="op-grid-collapse" style={{ display: 'grid', gridTemplateColumns: '120px 1fr 140px', gap: 12, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: theme.textMuted }}>
                  <span style={{ color: theme.accent, display: 'inline-flex' }}>{s.icon}</span>
                  {s.label}
                </div>
                <div style={{ background: theme.bg, border: `1px solid ${theme.borderSubtle}`, borderRadius: theme.radiusSm, height: 28, position: 'relative', overflow: 'hidden' }}>
                  <div
                    style={{
                      width,
                      height: '100%',
                      background: `linear-gradient(90deg, ${theme.accent}, ${theme.accentHover})`,
                      opacity: 0.85,
                    }}
                  />
                  <div style={{ position: 'absolute', left: 12, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 600, color: theme.accentInk, mixBlendMode: 'multiply' }}>
                    {s.value.toLocaleString()}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: theme.textMuted, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {i > 0 && (
                    <>
                       <span style={{ color: theme.textDim }}>от предыдущего этапа</span>{' '}
                      <span style={{ color: theme.text, fontWeight: 500 }}>{pct(s.rate)}</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${theme.borderSubtle}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           <span style={{ fontSize: 13, color: theme.textMuted }}>Переход → оплата</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: theme.accent, fontVariantNumeric: 'tabular-nums' }}>
            {pct(funnel.rates.overall)}
          </span>
        </div>
      </Card>
    </>
  );
}

// ---------- Admin ----------

interface AdminOverview {
  since: string;
  totals: {
    partners: number;
    clicks: number;
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
      {isLoading || !data ? (
        <Card>Загрузка…</Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <Stat label="Партнёры" value={data.totals.partners} icon={<Users size={16} />} />
            <Stat label="Переходы (30 дн.)" value={data.totals.clicks} icon={<MousePointerClick size={16} />} />
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
      )}
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
