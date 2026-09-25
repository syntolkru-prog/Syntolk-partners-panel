import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";

export default function AdminSettingsPage() {
  return (
    <Shell title="Настройки программы" subtitle="Правила атрибуции, комиссии, холд, выплаты и бренд партнёрского кабинета." nav={adminNav} role="АДМИНИСТРАТОР">
      <section className="settings-layout">
        <article className="card">
          <span className="eyebrow">КОМИССИИ</span><h2>Финансовые правила</h2>
          <div className="form-grid">
            <label><span>Базовая комиссия</span><div className="input-suffix"><input className="input" defaultValue="20"/><b>%</b></div></label>
            <label><span>Холд начисления</span><div className="input-suffix"><input className="input" defaultValue="14"/><b>дней</b></div></label>
            <label><span>Минимальная выплата</span><div className="input-suffix"><input className="input" defaultValue="5000"/><b>₽</b></div></label>
            <label><span>Cookie window</span><div className="input-suffix"><input className="input" defaultValue="60"/><b>дней</b></div></label>
          </div>
        </article>

        <article className="card">
          <span className="eyebrow">АТРИБУЦИЯ</span><h2>Правила привлечения</h2>
          <div className="toggle-list">
            <div><div><b>Подтверждать новых партнёров</b><small>Заявка сначала попадает администратору</small></div><span className="toggle on">ON</span></div>
            <div><div><b>Запретить self-referral</b><small>Партнёр не получает комиссию за свой аккаунт</small></div><span className="toggle on">ON</span></div>
            <div><div><b>Скрывать email клиентов</b><small>В кабинете партнёра показывается маска</small></div><span className="toggle on">ON</span></div>
          </div>
        </article>

        <article className="card">
          <span className="eyebrow">CLOUDPAYMENTS</span><h2>Платежная интеграция</h2>
          <div className="integration-status"><span className="dot"></span><div><b>Webhook-адаптер подготовлен</b><small>Pay · Refund · Cancel · HMAC · idempotency</small></div></div>
          <p className="muted">Секрет CloudPayments хранится только в environment variables и не отображается в интерфейсе.</p>
        </article>

        <article className="card">
          <span className="eyebrow">ВЫПЛАТЫ</span><h2>Только вручную</h2>
          <p className="muted">Автоматические Stripe/PayPal payouts отключены концептуально. Система считает сумму и фиксирует статус, перевод делаете вы.</p>
          <div className="callout">Текущий минимум: <b><Money value={5000}/></b></div>
        </article>
      </section>
    </Shell>
  );
}
