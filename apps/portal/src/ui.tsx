import type { CSSProperties, ReactNode } from 'react';
import { theme } from './theme.js';
import { useIsMobile } from './lib/useMediaQuery.js';
import { usePartnerVisual } from './components/tremor/PartnerVisual.js';
import { Card as TremorCard } from './components/tremor/raw/components/Card/Card.js';
import { Button as TremorButton } from './components/tremor/raw/components/Button/Button.js';
import { Input as TremorInput } from './components/tremor/raw/components/Input/Input.js';
import { Textarea as TremorTextarea } from './components/tremor/raw/components/Textarea/Textarea.js';
import { SelectNative as TremorSelect } from './components/tremor/raw/components/SelectNative/SelectNative.js';
import { Label as TremorLabel } from './components/tremor/raw/components/Label/Label.js';
import { Badge as TremorBadge } from './components/tremor/raw/components/Badge/Badge.js';
import { Table as TremorTable, TableRoot, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from './components/tremor/raw/components/Table/Table.js';

// ---------------- Layout ----------------

export function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  return (
    <div className="op-page" style={{ padding: isMobile ? '20px 16px' : '32px 40px', maxWidth: 1280, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          // On mobile the title + actions stack so wide action buttons
          // don't squeeze the heading into an unreadable column.
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'stretch' : 'flex-end',
          marginBottom: isMobile ? 20 : 28,
          gap: isMobile ? 14 : 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: isMobile ? 21 : 24, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</h1>
          {subtitle && (
            <div className="op-page-subtitle" style={{ color: theme.textMuted, fontSize: 14, marginTop: 4 }}>{subtitle}</div>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
      </header>
      {children}
    </div>
  );
}

// ---------------- Card ----------------

export function Card({
  children,
  style,
  padded = true,
  onClick,
}: {
  children: ReactNode;
  style?: CSSProperties;
  padded?: boolean;
  onClick?: () => void;
}) {
  const tremor = usePartnerVisual();
  if (tremor) return <TremorCard className={onClick ? 'op-interactive-card op-card' : 'op-card'} onClick={onClick} style={{ padding: padded ? 24 : 0, cursor: onClick ? 'pointer' : undefined, ...style }}>{children}</TremorCard>;
  return (
    <div
      onClick={onClick}
      className={onClick ? 'op-interactive-card' : undefined}
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radiusMd,
        padding: padded ? 20 : 0,
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionHeading({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '28px 0 12px' }}>
      <h2 className="op-section-heading" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {children}
      </h2>
      <div>{actions}</div>
    </div>
  );
}

// ---------------- Stat ----------------

export function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon?: ReactNode;
}) {
  const tremor=usePartnerVisual();
  if(tremor)return <Card><div className="flex items-center justify-between gap-3 text-sm text-gray-400"><span>{label}</span>{icon}</div><div className="mt-3 text-3xl font-semibold tracking-tight text-gray-50 tabular-nums">{value}</div>{hint&&<div className="mt-2 text-xs text-gray-400">{hint}</div>}</Card>;
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: theme.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </div>
        {icon && <div style={{ color: theme.textDim }}>{icon}</div>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 6 }}>{hint}</div>}
    </Card>
  );
}

// ---------------- Table ----------------

export function Table({
  columns,
  rows,
  empty = 'Пока нет данных.',
}: {
  columns: (string | { label: string; align?: 'left' | 'right' })[];
  rows: ReactNode[][];
  empty?: string;
}) {
  const cols = columns.map((c) => (typeof c === 'string' ? { label: c, align: 'left' as const } : c));
  const isMobile = useIsMobile();
  const tremor = usePartnerVisual();
  if (tremor && !isMobile) return <Card padded={false}><TableRoot><TremorTable><TableHead><TableRow>{cols.map(column => <TableHeaderCell key={column.label} style={{ textAlign: column.align }}>{column.label}</TableHeaderCell>)}</TableRow></TableHead><TableBody>{rows.length ? rows.map((row, index) => <TableRow key={index}>{row.map((cell, column) => <TableCell key={column} style={{ textAlign: cols[column]?.align }}>{cell}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={cols.length} style={{ textAlign: 'center', padding: 32 }}>{empty}</TableCell></TableRow>}</TableBody></TremorTable></TableRoot></Card>;

  // On phones, a multi-column table forces horizontal scrolling and hides
  // data off-screen. Reflow each row into a stacked "label: value" card so
  // every field is visible without scrolling sideways. The first column is
  // treated as the row's title (rendered full-width, larger).
  if (isMobile) {
    if (rows.length === 0) {
      return (
        <Card style={{ textAlign: 'center', color: theme.textDim, fontSize: 14 }}>{empty}</Card>
      );
    }
    return (
      <Card padded={false} style={{ overflow: 'hidden' }}>
        {rows.map((row, i) => (
          <div
            key={i}
            style={{
              padding: '14px 16px',
              borderBottom: i < rows.length - 1 ? `1px solid ${theme.borderSubtle}` : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {row.map((cell, j) => {
              const isTitle = j === 0;
              return (
                <div
                  key={j}
                  style={
                    isTitle
                      ? { fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }
                      : {
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          gap: 12,
                        }
                  }
                >
                  {!isTitle && (
                    <span
                      style={{
                        flexShrink: 0,
                        color: theme.textMuted,
                        fontSize: 11,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {cols[j]?.label}
                    </span>
                  )}
                  <span
                    style={{
                      minWidth: 0,
                      textAlign: isTitle ? 'left' : 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {cell}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </Card>
    );
  }

  return (
    <Card padded={false} style={{ overflow: 'hidden' }}>
      {/* Horizontal scroll as a fallback for very wide content on tablet/
          desktop widths; phones use the stacked card layout above. */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 'max-content' }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.label}
                style={{
                  textAlign: c.align ?? 'left',
                  padding: '12px 18px',
                  fontWeight: 500,
                  color: theme.textMuted,
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: `1px solid ${theme.border}`,
                  background: theme.surface2,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} style={{ padding: 32, textAlign: 'center', color: theme.textDim, fontSize: 14 }}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${theme.borderSubtle}` : 'none' }}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    style={{
                      padding: '14px 18px',
                      textAlign: cols[j]?.align ?? 'left',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
    </Card>
  );
}

// ---------------- Button ----------------

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  size = 'md',
  type,
  style,
  icon,
  'aria-pressed': ariaPressed,
}: {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  type?: 'button' | 'submit';
  style?: CSSProperties;
  icon?: ReactNode;
  'aria-pressed'?: React.AriaAttributes['aria-pressed'];
}) {
  const tremor = usePartnerVisual();
  const palettes = {
    primary: { bg: theme.accent, color: theme.accentInk, border: theme.accent },
    secondary: { bg: theme.surface2, color: theme.text, border: theme.border },
    ghost: { bg: 'transparent', color: theme.text, border: 'transparent' },
    danger: { bg: theme.dangerSoft, color: theme.danger, border: theme.dangerSoft },
  } as const;
  const p = palettes[variant];
  const padY = size === 'sm' ? 6 : 8;
  const padX = size === 'sm' ? 10 : 14;
  const fontSize = size === 'sm' ? 13 : 14;

  if (tremor) return <TremorButton type={type ?? 'button'} data-op-variant={variant} aria-pressed={ariaPressed} onClick={onClick} disabled={disabled} variant={variant === 'danger' ? 'destructive' : variant} className={size === 'sm' ? 'gap-2 px-2.5 py-1.5 text-xs' : 'gap-2'} style={style}>{icon}{children}</TremorButton>;

  return (
    <button
      type={type ?? 'button'}
      data-op-variant={variant}
      aria-pressed={ariaPressed}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: p.bg,
        color: p.color,
        border: `1px solid ${p.border}`,
        borderRadius: theme.radiusSm,
        padding: `${padY}px ${padX}px`,
        fontSize,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 160ms ease',
        ...style,
      }}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------- Input / Label ----------------

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const tremor = usePartnerVisual();
  if (tremor) return <TremorInput {...props} />;
  return (
    <input
      {...props}
      style={{
        padding: '10px 12px',
        fontSize: 14,
        background: theme.surface2,
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radiusSm,
        color: theme.text,
        width: '100%',
        fontFamily: theme.fontSans,
        ...props.style,
      }}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  const tremor = usePartnerVisual();
  if (tremor) return <TremorSelect {...props} />;
  return (
    <select
      {...props}
      style={{
        padding: '10px 12px',
        fontSize: 14,
        background: theme.surface2,
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radiusSm,
        color: theme.text,
        width: '100%',
        fontFamily: theme.fontSans,
        ...props.style,
      }}
    >
      {props.children}
    </select>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const tremor = usePartnerVisual();
  if (tremor) return <TremorTextarea {...props} />;
  return (
    <textarea
      {...props}
      style={{
        padding: '10px 12px',
        fontSize: 14,
        background: theme.surface2,
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radiusSm,
        color: theme.text,
        width: '100%',
        fontFamily: 'inherit',
        resize: 'vertical',
        ...props.style,
      }}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  const tremor = usePartnerVisual();
  if (tremor) return <TremorLabel className="mb-1.5 block">{children}</TremorLabel>;
  return (
    <label
      style={{
        display: 'block',
        fontSize: 12,
        color: theme.textMuted,
        marginBottom: 6,
        fontWeight: 500,
      }}
    >
      {children}
    </label>
  );
}

// ---------------- Badge / StatusPill ----------------

export function StatusPill({ status }: { status: string }) {
  const tremor = usePartnerVisual();
  const palette: Record<string, { bg: string; fg: string }> = {
    accrued: { bg: theme.warnSoft, fg: theme.warn },
    approved: { bg: theme.infoSoft, fg: theme.info },
    paid: { bg: theme.successSoft, fg: theme.success },
    reversed: { bg: theme.dangerSoft, fg: theme.danger },
    pending: { bg: theme.surface2, fg: theme.textMuted },
    failed: { bg: theme.dangerSoft, fg: theme.danger },
    connected: { bg: theme.successSoft, fg: theme.success },
    not_connected: { bg: theme.surface2, fg: theme.textMuted },
    error: { bg: theme.dangerSoft, fg: theme.danger },
    invited: { bg: theme.warnSoft, fg: theme.warn },
    active: { bg: theme.successSoft, fg: theme.success },
    paused: { bg: theme.warnSoft, fg: theme.warn },
    revoked: { bg: theme.dangerSoft, fg: theme.danger },
  };
  const c = palette[status] ?? { bg: theme.surface2, fg: theme.textMuted };
  const labels: Record<string, string> = {
    accrued: 'ожидает подтверждения',
    approved: 'доступно',
    paid: 'выплачено',
    reversed: 'отменено',
    pending: 'ожидает',
    failed: 'ошибка',
    connected: 'подключён',
    not_connected: 'не подключён',
    error: 'ошибка',
    invited: 'приглашён',
    active: 'активен',
    paused: 'на паузе',
    revoked: 'заблокирован',
  };
  if (tremor) return <TremorBadge variant={['paid','connected','active'].includes(status) ? 'success' : ['failed','error','revoked','reversed'].includes(status) ? 'error' : ['accrued','invited','paused'].includes(status) ? 'warning' : status === 'approved' ? 'default' : 'neutral'}>{labels[status] ?? status}</TremorBadge>;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: c.bg,
        color: c.fg,
        padding: '3px 9px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'lowercase',
        letterSpacing: '0.02em',
      }}
    >
      {labels[status] ?? status}
    </span>
  );
}

// ---------------- Avatar ----------------

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
  const hue = hashHue(name);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `hsl(${hue}, 30%, 22%)`,
        color: `hsl(${hue}, 70%, 70%)`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 600,
        letterSpacing: '0.02em',
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

// ---------------- Feedback ----------------

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div
      style={{
        background: theme.dangerSoft,
        color: theme.danger,
        padding: '10px 14px',
        borderRadius: theme.radiusSm,
        marginBottom: 16,
        fontSize: 13,
        border: `1px solid ${theme.danger}33`,
      }}
    >
      {msg}
    </div>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <Card style={{ textAlign: 'center', padding: '48px 24px' }}>
      {icon && <div style={{ color: theme.textDim, marginBottom: 12, display: 'inline-flex' }}>{icon}</div>}
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: 13, color: theme.textMuted }}>{hint}</div>}
    </Card>
  );
}

// ---------------- Formatters ----------------

// Syntolk's local billing and CloudPayments flow are denominated in rubles.
// Individual ledger rows still pass their stored currency explicitly; this
// default covers aggregate dashboard fields that do not carry a currency.
export function money(amount: number | string | null, currency: string = 'RUB'): string {
  const n = typeof amount === 'number' ? amount : amount == null ? 0 : Number(amount);
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(n);
}

export function eventLabel(eventType: string | null | undefined): string {
  if (!eventType) return '—';
  const labels: Record<string, string> = {
    invoice_paid: 'Счёт оплачен',
    subscription_created: 'Подписка создана',
    trial_started: 'Пробный период начат',
    signup: 'Регистрация',
  };
  return labels[eventType] ?? eventType.replace(/_/g, ' ');
}

export function formatDate(d: string | Date | null, opts: { relative?: boolean } = {}): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (opts.relative) {
    const diff = Date.now() - date.getTime();
    const min = 60_000;
    if (diff < min) return 'только что';
    if (diff < 60 * min) return `${Math.floor(diff / min)} мин назад`;
    if (diff < 24 * 60 * min) return `${Math.floor(diff / (60 * min))} ч назад`;
    if (diff < 30 * 24 * 60 * min) return `${Math.floor(diff / (24 * 60 * min))} дн. назад`;
  }
  return date.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function shortId(id: string, chars: number = 8): string {
  return id.slice(0, chars);
}
