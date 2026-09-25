import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing">
      <section className="landing-card">
        <div className="brand-mark">S</div>
        <div>
          <p className="eyebrow">SYNTOLK PARTNERS</p>
          <h1>Партнёрская программа Syntolk</h1>
          <p className="lead">Кабинет для блогеров, фрилансеров, агентств и экспертов: referral links, recurring-комиссии, аналитика и прозрачная история ручных выплат.</p>
        </div>
        <div className="landing-actions">
          <Link className="button primary" href="/register">Стать партнёром</Link>
          <Link className="button secondary" href="/login">Войти в кабинет</Link>
        </div>
        <p className="muted">Базовая комиссия: 20% с оплаченных продаж. Повторные платежи учитываются отдельно.</p>
      </section>
    </main>
  );
}
