import { Shell, Money } from "@/components/shell";

const nav = [
  { href: "/partner", label: "Обзор" },
  { href: "/partner/referrals", label: "Клиенты" },
  { href: "/partner/payouts", label: "Выплаты" },
  { href: "/partner/resources", label: "Материалы" },
];

const clients = [
  { name: "a***@mail.ru", plan: "Pro", registered: "02.09.2026", status: "Активен", revenue: 14970, earned: 2994 },
  { name: "m***@gmail.com", plan: "Business", registered: "14.09.2026", status: "Активен", revenue: 9990, earned: 1998 },
  { name: "i***@yandex.ru", plan: "Start", registered: "18.09.2026", status: "Активен", revenue: 1990, earned: 398 },
];

export default function PartnerReferralsPage() {
  return (
    <Shell title="Мои клиенты" subtitle="Клиенты, закреплённые за вашей партнёрской ссылкой." nav={nav} role="ПАРТНЁР">
      <section className="stat-grid">
        <article><span>Всего клиентов</span><strong>163</strong><small>за всё время</small></article>
        <article><span>Активные</span><strong>141</strong><small>86,5%</small></article>
        <article><span>Повторные оплаты</span><strong>312</strong><small>recurring</small></article>
        <article><span>Ваш доход</span><strong><Money value={124820}/></strong><small>по этим клиентам</small></article>
      </section>
      <section className="card">
        <div className="section-title"><div><span className="eyebrow">КЛИЕНТЫ</span><h2>История привлечений</h2></div><input className="input compact-input" placeholder="Поиск"/></div>
        <div className="table-wrap"><table><thead><tr><th>Клиент</th><th>Тариф</th><th>Регистрация</th><th>Статус</th><th>Оплатил</th><th>Ваш доход</th></tr></thead><tbody>
          {clients.map(c => <tr key={c.name}><td><b>{c.name}</b></td><td>{c.plan}</td><td>{c.registered}</td><td><span className="status">{c.status}</span></td><td><Money value={c.revenue}/></td><td className="positive"><b><Money value={c.earned}/></b></td></tr>)}
        </tbody></table></div>
      </section>
    </Shell>
  );
}
