import Link from "next/link";
import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";

export default async function AdminPage() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const settings = await prisma.programSettings.upsert({ where: { id: "default" }, create: {}, update: {} });

  const [
    partnersCount,
    activePartners,
    pendingPartners,
    newPartners,
    payments,
    refunds,
    pendingCommissions,
    approvedCommissions,
    readyPayouts,
    recentPartners,
  ] = await Promise.all([
    prisma.partner.count(),
    prisma.partner.count({ where: { status: "ACTIVE" } }),
    prisma.partner.count({ where: { status: "PENDING" } }),
    prisma.partner.count({ where: { createdAt: { gte: since } } }),
    prisma.payment.findMany({
      where: { paidAt: { gte: since } },
      select: { id: true, amount: true, subscriptionId: true, referralId: true },
    }),
    prisma.refund.findMany({ where: { refundedAt: { gte: since } }, select: { amount: true } }),
    prisma.commission.aggregate({ where: { status: "PENDING" }, _sum: { amount: true } }),
    prisma.commission.aggregate({
      where: { status: "APPROVED", payoutItems: { none: {} } },
      _sum: { amount: true },
    }),
    prisma.payout.aggregate({ where: { status: "READY" }, _sum: { amount: true }, _count: true }),
    prisma.partner.findMany({
      take: 6,
      orderBy: { createdAt: "desc" },
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
    }),
  ]);

  const revenue = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const refunded = refunds.reduce((sum, r) => sum + Number(r.amount), 0);
  const netRevenue = revenue - refunded;
  const paidReferralIds = new Set(payments.map(p => p.referralId));
  const recurringPayments = payments.filter(p => p.subscriptionId).length;
  const refundRate = revenue > 0 ? (refunded / revenue) * 100 : 0;
  const due = Number(approvedCommissions._sum.amount ?? 0);

  return (
    <Shell title="Управление партнёрской программой" subtitle="Полный контроль партнёров, комиссий, возвратов и ручных выплат." nav={adminNav} role="АДМИНИСТРАТОР">
      <section className="stat-grid admin-stats">
        <article><span>Партнёры</span><strong>{partnersCount}</strong><small>{activePartners} активных · {pendingPartners} на проверке</small></article>
        <article><span>Продажи партнёров</span><strong><Money value={netRevenue} currency={settings.currency}/></strong><small>чистая выручка за 30 дней</small></article>
        <article><span>На холде</span><strong><Money value={Number(pendingCommissions._sum.amount ?? 0)} currency={settings.currency}/></strong><small>ожидает созревания</small></article>
        <article><span>К выплате</span><strong><Money value={due} currency={settings.currency}/></strong><small>{readyPayouts._count} подготовленных пакетов</small></article>
      </section>

      <section className="grid-two">
        <article className="card">
          <span className="eyebrow">ЗДОРОВЬЕ ПРОГРАММЫ</span><h2>Последние 30 дней</h2>
          <div className="metrics-list">
            <div><span>Новые партнёры</span><b>+{newPartners}</b></div>
            <div><span>Платные клиенты</span><b>{paidReferralIds.size}</b></div>
            <div><span>Платежи с SubscriptionId</span><b>{recurringPayments}</b></div>
            <div><span>Возвраты</span><b>{refundRate.toFixed(1)}%</b></div>
          </div>
        </article>
        <article className="card">
          <span className="eyebrow">ВЫПЛАТЫ</span><h2>Очередь на выплату</h2>
          <div className="payout-box">
            <strong><Money value={due} currency={settings.currency}/></strong>
            <span>подтверждённый незакрытый баланс</span>
            <Link className="button primary" href="/admin/payouts">Открыть выплаты</Link>
          </div>
        </article>
      </section>

      <section className="card">
        <div className="section-title">
          <div><span className="eyebrow">ПАРТНЁРЫ</span><h2>Последние партнёры</h2></div>
          <Link className="button secondary" href="/admin/partners">Все партнёры</Link>
        </div>
        <div className="table-wrap"><table><thead><tr><th>Партнёр</th><th>Статус</th><th>Клики</th><th>Клиенты</th><th>Продажи</th><th>К выплате</th><th>Ставка</th></tr></thead><tbody>
          {recentPartners.map((p) => {
            const partnerRevenue = p.referrals.flatMap(r => r.payments).reduce((sum, pay) => sum + Number(pay.amount), 0);
            const partnerDue = p.commissions.reduce((sum, com) => sum + Number(com.amount), 0);
            const rate = p.usesCustomCommission ? Number(p.commissionRate) : p.group ? Number(p.group.commissionRate) : p.program ? Number(p.program.commissionRate) : Number(settings.baseCommissionRate);
            return <tr key={p.id}>
              <td><Link href={`/admin/partners/${p.id}`}><b>{p.name}</b></Link><small className="block muted">{p.email}</small></td>
              <td><span className="status">{p.status}</span></td>
              <td>{p._count.clicks.toLocaleString("ru-RU")}</td>
              <td>{p._count.referrals}</td>
              <td><Money value={partnerRevenue} currency={settings.currency}/></td>
              <td><Money value={partnerDue} currency={settings.currency}/></td>
              <td>{rate.toFixed(2).replace(".00","")}%</td>
            </tr>;
          })}
          {!recentPartners.length && <tr><td colSpan={7} className="muted">Партнёров пока нет.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="grid-two">
        <article className="card">
          <span className="eyebrow">ПРАВИЛА</span><h2>Настройки программы</h2>
          <div className="settings-list">
            <div><span>Базовая комиссия</span><b>{Number(settings.baseCommissionRate)}%</b></div>
            <div><span>Cookie window</span><b>{settings.cookieDays} дней</b></div>
            <div><span>Холд начислений</span><b>{settings.commissionHoldDays} дней</b></div>
            <div><span>Self-referral</span><b>{settings.selfReferralBlocked ? "Запрещён" : "Разрешён"}</b></div>
          </div>
        </article>
        <article className="card">
          <span className="eyebrow">КОНТРОЛЬ</span><h2>Финансовая модель</h2>
          <p className="muted">Каждый успешный платёж создаёт отдельную ledger-комиссию. Возвраты и отмены создают отдельные отрицательные корректировки. Фактические выплаты выполняются вручную.</p>
          <div className="callout">CloudPayments → Payment → Commission → Hold → Approved → Manual payout</div>
        </article>
      </section>
    </Shell>
  );
}
