import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";

const rows = [
  { partner: "Иван Петров", amount: 48820, entries: 31, method: "СБП / вручную", status: "Готово к выплате" },
  { partner: "Анна Смирнова", amount: 32640, entries: 18, method: "Банк / вручную", status: "Готово к выплате" },
  { partner: "Сергей Волков", amount: 22140, entries: 14, method: "СБП / вручную", status: "Выплачено" },
];

export default function AdminPayoutsPage() {
  return (
    <Shell title="Ручные выплаты" subtitle="Формируйте выплату из подтверждённых комиссий и фиксируйте факт перевода." nav={adminNav} role="АДМИНИСТРАТОР">
      <section className="hero-panel">
        <div><span className="muted">Сейчас готово к выплате</span><strong className="hero-money"><Money value={143820}/></strong><span>14 партнёров</span></div>
        <div className="hero-meta"><span>Минимум <b><Money value={5000}/></b></span><span>Следующая сверка <b>30 сентября</b></span></div>
      </section>

      <section className="card">
        <div className="section-title">
          <div><span className="eyebrow">ОЧЕРЕДЬ</span><h2>Пакеты выплат</h2></div>
          <button className="button primary">Сформировать выплаты</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Партнёр</th><th>Сумма</th><th>Начислений</th><th>Способ</th><th>Статус</th><th></th></tr></thead>
            <tbody>
              {rows.map((row) => <tr key={row.partner}>
                <td><b>{row.partner}</b></td><td><b><Money value={row.amount}/></b></td><td>{row.entries}</td><td>{row.method}</td><td><span className="status">{row.status}</span></td>
                <td><button className="button secondary">Открыть</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid-two">
        <article className="card"><span className="eyebrow">КАК РАБОТАЕТ</span><h2>Без автоматического перевода денег</h2><p className="muted">Система собирает только APPROVED-комиссии, учитывает отрицательные refund-корректировки и создаёт пакет. После реального перевода вы вводите reference и отмечаете выплату как Paid.</p></article>
        <article className="card"><span className="eyebrow">КОНТРОЛЬ</span><h2>История не переписывается</h2><p className="muted">Если возврат пришёл уже после выплаты, он становится отрицательной записью ledger и уменьшает будущий доступный баланс партнёра.</p></article>
      </section>
    </Shell>
  );
}
