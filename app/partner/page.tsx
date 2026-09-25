import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell, Money } from "@/components/shell";
import { partnerNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

function mask(value: string) {
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return value.length > 8 ? `${value.slice(0, 3)}***${value.slice(-3)}` : "***";
}

export default async function PartnerPage() {
  const session = await currentSession();
  if (!session?.partnerId) redirect("/login");
  const partnerId = session.partnerId;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const settings = await prisma.programSettings.upsert({ where: { id: "default" }, create: {}, update: {} });
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    include: { group: true, program: true },
  });
  if (!partner) redirect("/login");

  const [clicks, clicks30, referrals, referrals30, paidCustomers, payments30, commissions, payoutsPaid, recent] = await Promise.all([
    prisma.referralClick.count({ where: { partnerId } }),
    prisma.referralClick.count({ where: { partnerId, createdAt: { gte: since } } }),
    prisma.referral.count({ where: { partnerId } }),
    prisma.referral.count({ where: { partnerId, createdAt: { gte: since } } }),
    prisma.referral.count({ where: { partnerId, payments: { some: {} } } }),
    prisma.payment.findMany({ where: { referral: { partnerId }, paidAt: { gte: since } }, select: { amount: true, referralId: true } }),
    prisma.commission.findMany({ where: { partnerId }, select: { amount: true, status: true } }),
    prisma.payout.aggregate({ where: { partnerId, status: "PAID" }, _sum: { amount: true } }),
    prisma.commission.findMany({
      where: { partnerId },
      take: 12,
      orderBy: { createdAt: "desc" },
      include: { payment: { include: { referral: true } }, refund: true },
    }),
  ]);

  const available = commissions.filter(c => c.status === "APPROVED").reduce((s,c) => s + Number(c.amount), 0);
  const pending = commissions.filter(c => c.status === "PENDING").reduce((s,c) => s + Number(c.amount), 0);
  const paid = Number(payoutsPaid._sum.amount ?? 0);
  const revenue30 = payments30.reduce((s,p) => s + Number(p.amount), 0);
  const payers30 = new Set(payments30.map(p => p.referralId)).size;
  const clickToSignup = clicks30 ? (referrals30 / clicks30) * 100 : 0;
  const signupToPay = referrals30 ? (payers30 / referrals30) * 100 : 0;
  const rate = partner.usesCustomCommission ? Number(partner.commissionRate) : partner.group ? Number(partner.group.commissionRate) : partner.program ? Number(partner.program.commissionRate) : Number(settings.baseCommissionRate);
  const baseUrl = (process.env.APP_BASE_URL || "https://partners.syntolk.ru").replace(/\/$/,"");
  const referralUrl = `${baseUrl}/r/${partner.code}`;

  return (
    <Shell title="Партнёрский кабинет" subtitle={partner.status === "ACTIVE" ? "Доход, клиенты и выплаты в одном месте." : "Кабинет создан. Партнёрская заявка ожидает активации."} nav={partnerNav} role="ПАРТНЁР">
      {partner.status !== "ACTIVE" && <section className="notice-banner"><b>Статус: {partner.status}</b><span>Комиссии начнут начисляться после активации партнёра администратором.</span></section>}

      <section className="hero-panel">
        <div><span className="muted">Доступно к выплате</span><strong className="hero-money"><Money value={available} currency={settings.currency}/></strong><span className="positive">{rate}% текущая ставка</span></div>
        <div className="hero-meta"><span>Ожидает холда <b><Money value={pending} currency={settings.currency}/></b></span><span>Выплачено всего <b><Money value={paid} currency={settings.currency}/></b></span></div>
      </section>

      <section className="stat-grid">
        <article><span>Переходы</span><strong>{clicks.toLocaleString("ru-RU")}</strong><small>{clicks30} за 30 дней</small></article>
        <article><span>Регистрации</span><strong>{referrals}</strong><small>{clickToSignup.toFixed(1)}% click → signup</small></article>
        <article><span>Платные клиенты</span><strong>{paidCustomers}</strong><small>{signupToPay.toFixed(1)}% signup → pay за 30 дней</small></article>
        <article><span>Продажи 30 дней</span><strong><Money value={revenue30} currency={settings.currency}/></strong><small>{payments30.length} платежей</small></article>
      </section>

      <section className="grid-two">
        <article className="card">
          <div className="section-title"><div><span className="eyebrow">РЕФЕРАЛЬНАЯ ССЫЛКА</span><h2>Основная ссылка</h2></div><span className="tag">{rate}%</span></div>
          <div className="copy-field"><code>{referralUrl}</code></div>
          <p className="muted">Окно атрибуции: {partner.cookieDays} дней. Повторные платежи закреплённого клиента продолжают создавать отдельные комиссии.</p>
        </article>
        <article className="card">
          <span className="eyebrow">ВОРОНКА 30 ДНЕЙ</span><h2>Конверсия</h2>
          <div className="funnel"><div><b>{clicks30}</b><span>Переходы</span></div><div><b>{referrals30}</b><span>Регистрации</span></div><div><b>{payers30}</b><span>Плательщики</span></div></div>
        </article>
      </section>

      <section className="card">
        <div className="section-title"><div><span className="eyebrow">ФИНАНСЫ</span><h2>Последние начисления</h2></div><Link className="text-button" href="/partner/payouts">Выплаты →</Link></div>
        <div className="table-wrap"><table><thead><tr><th>Дата</th><th>Клиент</th><th>Операция</th><th>Продажа</th><th>Комиссия</th><th>Статус</th></tr></thead><tbody>
          {recent.map(row => <tr key={row.id}>
            <td>{row.createdAt.toLocaleDateString("ru-RU")}</td>
            <td>{row.payment?.referral ? mask(row.payment.referral.externalUserId) : "—"}</td>
            <td>{row.kind === "REFUND" ? "Возврат / корректировка" : (row.payment?.description || "Оплата Syntolk")}</td>
            <td>{row.payment ? <Money value={Number(row.payment.amount)} currency={row.payment.currency}/> : "—"}</td>
            <td className={Number(row.amount) < 0 ? "negative" : "positive"}><Money value={Number(row.amount)} currency={settings.currency}/></td>
            <td><span className="status">{row.status}</span></td>
          </tr>)}
          {!recent.length && <tr><td colSpan={6} className="muted">Начислений пока нет.</td></tr>}
        </tbody></table></div>
      </section>
    </Shell>
  );
}
