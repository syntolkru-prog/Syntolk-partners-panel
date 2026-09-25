import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { partners } from "@/lib/demo-data";

export default function AdminPage() {
  return (
    <Shell title="Управление партнёрской программой" subtitle="Полный контроль партнёров, комиссий, возвратов и ручных выплат." nav={adminNav} role="АДМИНИСТРАТОР">
      <section className="stat-grid admin-stats">
        <article><span>Партнёры</span><strong>186</strong><small>73 активных</small></article>
        <article><span>Продажи партнёров</span><strong><Money value={1842900}/></strong><small>за 30 дней</small></article>
        <article><span>Начислено</span><strong><Money value={368580}/></strong><small>20% в среднем</small></article>
        <article><span>К выплате</span><strong><Money value={143820}/></strong><small>ручные выплаты</small></article>
      </section>

      <section className="grid-two">
        <article className="card">
          <span className="eyebrow">ЗДОРОВЬЕ ПРОГРАММЫ</span><h2>Ключевые показатели</h2>
          <div className="metrics-list">
            <div><span>Новые партнёры</span><b>+21</b></div>
            <div><span>Новые платные клиенты</span><b>+84</b></div>
            <div><span>Повторные оплаты</span><b>312</b></div>
            <div><span>Возвраты</span><b>1,8%</b></div>
          </div>
        </article>
        <article className="card">
          <span className="eyebrow">ВЫПЛАТЫ</span><h2>Очередь на выплату</h2>
          <div className="payout-box"><strong><Money value={143820}/></strong><span>14 партнёрам</span><button className="button primary">Открыть выплаты</button></div>
        </article>
      </section>

      <section className="card" id="partners">
        <div className="section-title"><div><span className="eyebrow">ПАРТНЁРЫ</span><h2>Управление партнёрами</h2></div><button className="button secondary">+ Добавить партнёра</button></div>
        <div className="table-wrap"><table><thead><tr><th>Партнёр</th><th>Статус</th><th>Клики</th><th>Клиенты</th><th>Продажи</th><th>К выплате</th><th>Ставка</th><th></th></tr></thead><tbody>
          {partners.map((p) => <tr key={p.email}><td><b>{p.name}</b><small className="block muted">{p.email}</small></td><td><span className="status">{p.status}</span></td><td>{p.clicks.toLocaleString("ru-RU")}</td><td>{p.clients}</td><td><Money value={p.revenue}/></td><td><Money value={p.due}/></td><td>{p.rate}%</td><td><button className="kebab">•••</button></td></tr>)}
        </tbody></table></div>
      </section>

      <section className="grid-two" id="settings">
        <article className="card">
          <span className="eyebrow">ПРАВИЛА</span><h2>Настройки программы</h2>
          <div className="settings-list">
            <div><span>Базовая комиссия</span><b>20%</b></div>
            <div><span>Cookie window</span><b>60 дней</b></div>
            <div><span>Холд начислений</span><b>14 дней</b></div>
            <div><span>Self-referral</span><b>Запрещён</b></div>
          </div>
        </article>
        <article className="card">
          <span className="eyebrow">КОНТРОЛЬ</span><h2>Финансовая модель</h2>
          <p className="muted">Комиссия создаётся на каждый успешный платёж клиента. Возвраты формируют корректирующую запись. Деньги партнёрам переводятся только вручную.</p>
          <div className="callout">CloudPayments → Payment → Commission → Approved → Manual payout</div>
        </article>
      </section>
    </Shell>
  );
}
