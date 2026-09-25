import { Shell } from "@/components/shell";

const nav = [
  { href: "/partner", label: "Обзор" },
  { href: "/partner/referrals", label: "Клиенты" },
  { href: "/partner/payouts", label: "Выплаты" },
  { href: "/partner/resources", label: "Материалы" },
];

const resources = [
  { type: "Баннер", title: "Syntolk — работа с документами", text: "1200×628 · PNG" },
  { type: "Текст", title: "Короткий пост для Telegram", text: "Готовый текст · RU" },
  { type: "Landing", title: "Syntolk для юристов", text: "Посадочная страница" },
  { type: "Логотип", title: "Syntolk Brand Pack", text: "SVG · PNG" },
];

export default function PartnerResourcesPage() {
  return (
    <Shell title="Материалы" subtitle="Готовые материалы, чтобы быстрее рассказывать о Syntolk." nav={nav} role="ПАРТНЁР">
      <section className="resource-grid">
        {resources.map(r => <article className="resource-card" key={r.title}><span className="tag">{r.type}</span><div className="resource-preview">Syntolk</div><h2>{r.title}</h2><p className="muted">{r.text}</p><button className="button secondary">Открыть материал</button></article>)}
      </section>
    </Shell>
  );
}
