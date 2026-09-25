import { Shell, Money } from "@/components/shell";

const nav = [
  { href: "/partner", label: "Обзор" },
  { href: "/partner/referrals", label: "Клиенты" },
  { href: "/partner/payouts", label: "Выплаты" },
  { href: "/partner/resources", label: "Материалы" },
];

export default function PartnerPayoutsPage() {
  return (
    <Shell title="Выплаты" subtitle="Баланс, готовые суммы и история ручных выплат." nav={nav} role="ПАРТНЁР">
      <section className="hero-panel"><div><span className="muted">Доступно к выплате</span><strong className="hero-money"><Money value={86420}/></strong><span className="positive">Минимум 5 000 ₽ выполнен</span></div><div className="hero-meta"><span>Ожидает холда <b><Money value={38400}/></b></span><span>Выплачено <b><Money value={35620}/></b></span></div></section>
      <section className="card">
        <div className="section-title"><div><span className="eyebrow">ИСТОРИЯ</span><h2>Последние выплаты</h2></div></div>
        <div className="table-wrap"><table><thead><tr><th>Период</th><th>Сумма</th><th>Начислений</th><th>Способ</th><th>Статус</th></tr></thead><tbody>
          <tr><td>Август 2026</td><td><b><Money value={22140}/></b></td><td>17</td><td>Ручной перевод</td><td><span className="status">Выплачено</span></td></tr>
          <tr><td>Июль 2026</td><td><b><Money value={13480}/></b></td><td>11</td><td>Ручной перевод</td><td><span className="status">Выплачено</span></td></tr>
        </tbody></table></div>
      </section>
      <section className="card"><span className="eyebrow">ВАЖНО</span><h2>Как формируется баланс</h2><p className="muted">Каждая успешная оплата клиента создаёт отдельное начисление. После холда оно становится доступным. Возвраты отображаются отдельной отрицательной строкой и уменьшают следующий баланс.</p></section>
    </Shell>
  );
}
