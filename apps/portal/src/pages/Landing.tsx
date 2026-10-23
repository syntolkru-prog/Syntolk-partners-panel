import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { theme } from '../theme.js';
import { Logo } from './auth/Shared.js';

/**
 * Public landing for the multi-tenant deployment. Voice mirrors the
 * marketing site at openpartner.dev — plain English, brand+creator
 * parity, no engineering jargon. The marketing site sells; this
 * landing is the door into the app.
 *
 * Auto-redirect: on mount, probe the brand session (op_session) and the
 * creator session (op_network_creator_session via the proxy) in parallel.
 * If either matches, navigate the visitor straight into their portal —
 * no point showing them the marketing splash if they're already signed in.
 */
export function LandingPage() {
  const nav = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function go(home: string) {
      if (!cancelled) nav(home, { replace: true });
    }
    Promise.all([
      fetch('/api/session/home', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { home: null }))
        .catch(() => ({ home: null })),
      fetch('/api/creator-api/creators/whoami', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : { creator: null }))
        .catch(() => ({ creator: null })),
    ]).then(([brand, creator]: [{ home?: string | null }, { creator: unknown }]) => {
      if (cancelled) return;
      if (brand?.home) return go(brand.home);
      if (creator?.creator) return go('/creator');
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [nav]);

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', background: theme.bg }} />
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          padding: '20px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${theme.borderSubtle}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo />
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>Syntolk</div>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', fontSize: 13 }}>
          <a href="/" style={{ color: theme.textMuted }}>О Syntolk</a>
          <a href="/signin" style={{ color: theme.textMuted }}>Войти</a>
          <Link to="/signin" style={{ color: theme.textMuted }}>Войти</Link>
        </div>
      </header>

      <main style={{ flex: 1, padding: '64px 24px 32px' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: theme.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
            Партнёрская программа со встроенной сетью
          </div>
          <h1 style={{ fontSize: 48, lineHeight: 1.1, margin: 0, letterSpacing: '-0.02em', fontWeight: 700 }}>
            Запустите партнёрскую программу.<br />Развивайте её вместе с сетью.
          </h1>
          <p style={{ marginTop: 24, fontSize: 17, color: theme.textMuted, lineHeight: 1.55, maxWidth: 720, marginInline: 'auto' }}>
            Компании запускают партнёрские, реферальные и авторские программы с прозрачными условиями
            комиссий, начислениями и выплатами по правилам программы. Авторы находят реальные предложения и получают заработанное.
          </p>
        </div>

        <div style={{ maxWidth: 1040, margin: '56px auto 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
          <AudienceCard
            eyebrow="Для компаний"
            title="Партнёрская программа для компаний, которым нужно больше, чем просто отслеживание."
            bullets={[
              'Связывайте каждую конверсию с партнёром, который её привёл',
              'Настраивайте фиксированные, процентные и регулярные комиссии',
              'Привлекайте авторов из сети, когда нужен дополнительный охват',
              'Настройте начисления и выплаты партнёрам по правилам Syntolk',
            ]}
            ctaLabel="Зарегистрироваться как компания"
            to="/signup"
          />
          <AudienceCard
            eyebrow="Для авторов"
            title="Каталог партнёрских программ с понятными условиями и прямыми выплатами."
            bullets={[
              'Видите размер комиссии до подачи заявки',
              'Находите предложения в партнёрских, реферальных и авторских программах',
              'Получайте выплаты от компаний по подтверждённым начислениям',
              'Без эксклюзивности и удержаний платформы из вашего заработка',
            ]}
            ctaLabel="Зарегистрироваться как автор"
            to="/creator/signup"
          />
        </div>

        <div style={{ marginTop: 48, textAlign: 'center', color: theme.textDim, fontSize: 13 }}>
          Уже есть аккаунт? <Link to="/signin" style={{ color: theme.accent }}>Войти</Link>
        </div>
      </main>

      <footer style={{ padding: '20px 32px', borderTop: `1px solid ${theme.borderSubtle}`, color: theme.textDim, fontSize: 12, textAlign: 'center' }}>
        Syntolk — партнёрская программа для вашего бизнеса. <a href="/signin" style={{ color: theme.textMuted }}>Войти в кабинет</a>
      </footer>
    </div>
  );
}

function AudienceCard({ eyebrow, title, bullets, ctaLabel, to }: { eyebrow: string; title: string; bullets: string[]; ctaLabel: string; to: string }) {
  return (
    <Link
      className="op-interactive-card"
      to={to}
      style={{
        display: 'block',
        background: theme.surface,
        border: `1px solid ${theme.borderSubtle}`,
        borderRadius: 18,
        padding: 28,
        color: theme.text,
        textDecoration: 'none',
      }}
    >
      <div style={{ fontSize: 11, color: theme.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{eyebrow}</div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.3, marginBottom: 16, letterSpacing: '-0.01em' }}>{title}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px' }}>
        {bullets.map((b) => (
          <li key={b} style={{ color: theme.textMuted, fontSize: 14, padding: '6px 0 6px 20px', position: 'relative', lineHeight: 1.55 }}>
            <span style={{ position: 'absolute', left: 0, color: theme.accent, fontWeight: 700 }}>›</span>
            {b}
          </li>
        ))}
      </ul>
      <span style={{ color: theme.accent, fontWeight: 600, fontSize: 14 }}>{ctaLabel} →</span>
    </Link>
  );
}
