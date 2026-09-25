import { Shell, Money } from "@/components/shell";
import { commissions, partnerStats } from "@/lib/demo-data";

const nav = [
  { href: "/partner", label: "Обзор" },
  { href: "/partner#links", label: "Мои ссылки" },
  { href: "/partner#analytics", label: "Аналитика" },
  { href: "/partner#clients", label: "Клиенты" },
  { href: "/partner#commissions", label: "Начисления" },
  { href: "/partner#payouts", label: "Выплаты" },
  { href: "/partner#materials", label: "Материалы" },
];

export default function PartnerPage() {
  return (
    <Shell title="Партнёрский кабинет" subtitle="Доход, клиенты и выплаты в одном месте." nav={nav} role="ПАРТНЁР">
      <section className="hero-panel">
        <div>
          <span className="muted">Доступно к выплате</span>
          <strong className="hero-money"><Money value={partnerStats.available} /></strong>
          <span className="positive">+18,4% за 30 дней</span>
        </div>
        <div className="hero-meta">
          <span>Ожидает подтверждения <b><Money value={partnerStats.pending} /></b></span>
          <span>Выплачено всего <b><Money value={partnerStats.paid} /></b></span>
        </div>
      </section>

      <section className="stat-grid" id="analytics">
        <article><span>Переходы</span><strong>{partnerStats.clicks.toLocaleString("ru-RU")}</strong><small>по вашим ссылкам</small></article>
        <article><span>Регистрации</span><strong>{partnerStats.registrations}</strong><small>конверсия 6,7%</small></article>
        <article><span>Платные клиенты</span><strong>{partnerStats.paidCustomers}</strong><small>активные подписки</small></article>
        <article><span>Продажи</span><strong><Money value={partnerStats.revenue} /></strong><small>принесено Syntolk</small></article>
      </section>

      <section className="grid-two">
        <article className="card" id="links">
          <div className="section-title"><div><span className="eyebrow">РЕФЕРАЛЬНАЯ ССЫЛКА</span><h2>Ваша основная ссылка</h2></div><span className="tag">20%</span></div>
          <div className="copy-field"><code>https://syntolk.ru/?ref=alexander</code><button>Скопировать</button></div>
          <p className="muted">Клиент закрепляется за вами на 60 дней. Повторные оплаты продолжают приносить комиссию.</p>
        </article>
        <article className="card">
          <span className="eyebrow">КОНВЕРСИЯ</span><h2>Воронка за 30 дней</h2>
          <div className="funnel">
            <div><b>12 842</b><span>Переходы</span></div>
            <div><b>864</b><span>Регистрации</span></div>
            <div><b>163</b><span>Оплаты</span></div>
          </div>
        </article>
      </section>

      <section className="card" id="commissions">
        <div className="section-title"><div><span className="eyebrow">ФИНАНСЫ</span><h2>Последние начисления</h2></div><button className="text-button">Вся история →</button></div>
        <div className="table-wrap"><table><thead><tr><th>Дата</th><th>Клиент</th><th>Тариф</th><th>Продажа</th><th>Комиссия</th><th>Статус</th></tr></thead><tbody>
          {commissions.map((row) => <tr key={row.id}><td>{row.date}</td><td>{row.customer}</td><td>{row.plan}</td><td><Money value={row.revenue}/></td><td className={row.amount < 0 ? "negative" : "positive"}><Money value={row.amount}/></td><td><span className="status">{row.status}</span></td></tr>)}
        </tbody></table></div>
      </section>
    </Shell>
  );
}
