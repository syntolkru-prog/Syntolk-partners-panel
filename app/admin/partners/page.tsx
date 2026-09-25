import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { partners } from "@/lib/demo-data";

export default function AdminPartnersPage() {
  return (
    <Shell title="Партнёры" subtitle="Заявки, индивидуальные условия, клиенты и финансовые показатели." nav={adminNav} role="АДМИНИСТРАТОР">
      <section className="toolbar card compact">
        <div>
          <span className="eyebrow">БАЗА ПАРТНЁРОВ</span>
          <h2>186 партнёров</h2>
        </div>
        <div className="toolbar-actions">
          <input className="input" placeholder="Поиск по имени, email или коду" />
          <button className="button secondary">Фильтры</button>
          <button className="button primary">+ Добавить партнёра</button>
        </div>
      </section>

      <section className="stat-grid">
        <article><span>Активные</span><strong>73</strong><small>получают комиссию</small></article>
        <article><span>На проверке</span><strong>12</strong><small>ждут решения</small></article>
        <article><span>Средний чек</span><strong><Money value={5810}/></strong><small>по партнёрскому каналу</small></article>
        <article><span>К выплате</span><strong><Money value={143820}/></strong><small>14 партнёрам</small></article>
      </section>

      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Партнёр</th><th>Статус</th><th>Клики</th><th>Клиенты</th><th>Продажи</th><th>К выплате</th><th>Ставка</th><th></th></tr></thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.email}>
                  <td><b>{p.name}</b><small className="block muted">{p.email}</small></td>
                  <td><span className="status">{p.status}</span></td>
                  <td>{p.clicks.toLocaleString("ru-RU")}</td>
                  <td>{p.clients}</td>
                  <td><Money value={p.revenue}/></td>
                  <td><b><Money value={p.due}/></b></td>
                  <td><span className="tag">{p.rate}%</span></td>
                  <td><button className="kebab">•••</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid-two">
        <article className="card">
          <span className="eyebrow">ГРУППЫ ПАРТНЁРОВ</span>
          <h2>Разные условия для разных каналов</h2>
          <div className="settings-list">
            <div><span>Блогеры</span><b>20% · 60 дней</b></div>
            <div><span>Агентства</span><b>25% · 90 дней</b></div>
            <div><span>Фрилансеры</span><b>20% · 60 дней</b></div>
            <div><span>VIP партнёры</span><b>30% · 120 дней</b></div>
          </div>
        </article>
        <article className="card">
          <span className="eyebrow">ЗАЯВКИ</span>
          <h2>12 ждут проверки</h2>
          <p className="muted">Перед активацией можно проверить площадку, указать индивидуальную ставку и добавить внутренний комментарий.</p>
          <button className="button primary">Открыть заявки</button>
        </article>
      </section>
    </Shell>
  );
}
