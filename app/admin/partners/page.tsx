import Link from "next/link";
import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";

export default async function AdminPartnersPage() {
  const settings = await prisma.programSettings.upsert({ where: { id: "default" }, create: {}, update: {} });
  const partners = await prisma.partner.findMany({
    include: {
      group: true,
      program: true,
      _count: { select: { clicks: true, referrals: true } },
      referrals: { select: { payments: { select: { amount: true } } } },
      commissions: {
        where: { status: "APPROVED", payoutItems: { none: {} } },
        select: { amount: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const active = partners.filter(p => p.status === "ACTIVE").length;
  const pending = partners.filter(p => p.status === "PENDING").length;
  const allPayments = await prisma.payment.aggregate({ _sum: { amount: true }, _count: true });
  const averageCheck = allPayments._count ? Number(allPayments._sum.amount ?? 0) / allPayments._count : 0;
  const due = partners.reduce((sum, p) => sum + p.commissions.reduce((s, c) => s + Number(c.amount), 0), 0);
  const groups = await prisma.partnerGroup.findMany({ include: { _count: { select: { partners: true } } }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });

  return (
    <Shell title="Партнёры" subtitle="Заявки, индивидуальные условия, клиенты и финансовые показатели." nav={adminNav} role="АДМИНИСТРАТОР">
      <section className="toolbar card compact">
        <div><span className="eyebrow">БАЗА ПАРТНЁРОВ</span><h2>{partners.length} партнёров</h2></div>
        <div className="toolbar-actions">
          <input className="input" placeholder="Поиск по имени, email или коду" />
          <Link className="button secondary" href="/admin/programs">Группы и программы</Link>
        </div>
      </section>

      <section className="stat-grid">
        <article><span>Активные</span><strong>{active}</strong><small>получают комиссию</small></article>
        <article><span>На проверке</span><strong>{pending}</strong><small>ждут решения</small></article>
        <article><span>Средний чек</span><strong><Money value={averageCheck} currency={settings.currency}/></strong><small>по партнёрскому каналу</small></article>
        <article><span>К выплате</span><strong><Money value={due} currency={settings.currency}/></strong><small>подтверждённый баланс</small></article>
      </section>

      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Партнёр</th><th>Статус</th><th>Клики</th><th>Клиенты</th><th>Продажи</th><th>К выплате</th><th>Ставка</th><th>Группа</th></tr></thead>
            <tbody>
              {partners.map((p) => {
                const revenue = p.referrals.flatMap(r => r.payments).reduce((sum, pay) => sum + Number(pay.amount), 0);
                const available = p.commissions.reduce((sum, c) => sum + Number(c.amount), 0);
                const rate = p.usesCustomCommission ? Number(p.commissionRate) : p.group ? Number(p.group.commissionRate) : p.program ? Number(p.program.commissionRate) : Number(settings.baseCommissionRate);
                return <tr key={p.id}>
                  <td><Link href={`/admin/partners/${p.id}`}><b>{p.name}</b></Link><small className="block muted">{p.email} · {p.code}</small></td>
                  <td><span className="status">{p.status}</span></td>
                  <td>{p._count.clicks.toLocaleString("ru-RU")}</td>
                  <td>{p._count.referrals}</td>
                  <td><Money value={revenue} currency={settings.currency}/></td>
                  <td><b><Money value={available} currency={settings.currency}/></b></td>
                  <td><span className="tag">{rate.toFixed(2).replace(".00","")}%</span></td>
                  <td>{p.group?.name ?? "—"}</td>
                </tr>;
              })}
              {!partners.length && <tr><td colSpan={8} className="muted">Партнёров пока нет.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid-two">
        <article className="card">
          <span className="eyebrow">ГРУППЫ ПАРТНЁРОВ</span><h2>Условия по каналам</h2>
          <div className="settings-list">
            {groups.map(g => <div key={g.id}><span>{g.name} <small className="muted">({g._count.partners})</small></span><b>{Number(g.commissionRate)}% · {g.cookieDays} дней</b></div>)}
            {!groups.length && <p className="muted">Группы ещё не созданы. Запустите seed или создайте их через API.</p>}
          </div>
        </article>
        <article className="card">
          <span className="eyebrow">ЗАЯВКИ</span><h2>{pending} ждут проверки</h2>
          <p className="muted">В карточке партнёра можно активировать аккаунт, назначить группу, индивидуальную ставку, cookie window и связать Syntolk user ID.</p>
          <Link className="button primary" href="/admin/partners">Просмотреть заявки</Link>
        </article>
      </section>
    </Shell>
  );
}
