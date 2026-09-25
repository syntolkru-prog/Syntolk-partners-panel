import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing">
      <section className="landing-card">
        <div className="brand-mark">S</div>
        <div>
          <p className="eyebrow">SYNTOLK PARTNERS</p>
          <h1>Партнёрская программа Syntolk</h1>
          <p className="lead">
            Отдельный кабинет для партнёров и полноценная административная панель
            с recurring-комиссиями, возвратами и ручными выплатами.
          </p>
        </div>
        <div className="landing-actions">
          <Link className="button primary" href="/partner">Открыть кабинет партнёра</Link>
          <Link className="button secondary" href="/admin">Открыть админку</Link>
        </div>
      </section>
    </main>
  );
}
