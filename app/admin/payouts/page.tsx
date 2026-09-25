import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Shell, Money } from "@/components/shell";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";
import { triggerOutgoingWebhook } from "@/lib/outgoing-webhooks";

async function requireAdmin() {
  const session = await currentSession();
  if (!session || session.role !== "ADMIN") redirect("/login");
  return session;
}

async function preparePayout(formData: FormData) {
  "use server";
  await requireAdmin();
  const partnerId = String(formData.get("partnerId") ?? "");
  if (!partnerId) return;

  await prisma.$transaction(async tx => {
    const settings = await tx.programSettings.upsert({ where: { id: "default" }, create: {}, update: {} });
    const commissions = await tx.commission.findMany({
      where: { partnerId, status: "APPROVED", payoutItems: { none: {} } },
      orderBy: { createdAt: "asc" },
    });
    const amount = commissions.reduce((sum, c) => sum + Number(c.amount), 0);
    if (!commissions.length || amount <= 0 || amount < Number(settings.minimumPayoutAmount)) return;

    const payout = await tx.payout.create({
      data: {
        partnerId,
        amount,
        status: "READY",
        method: "MANUAL",
        preparedAt: new Date(),
        items: { create: commissions.map(c => ({ commissionId: c.id })) },
      },
    });
    await tx.notification.create({
      data: {
        partnerId,
        type: "PAYOUT_READY",
        title: "Выплата подготовлена",
        message: `${amount.toLocaleString("ru-RU")} ₽ подготовлено к ручной выплате.`,
        metadata: { payoutId: payout.id },
      },
    });
    await tx.auditLog.create({
      data: { actorType: "ADMIN", action: "CREATE_PAYOUT", objectType: "PAYOUT", objectId: payout.id, payload: { partnerId, amount } },
    });
  });

  await triggerOutgoingWebhook("payout.ready", { partnerId }).catch(() => null);
  revalidatePath("/admin/payouts");
}

async function markPaid(formData: FormData) {
  "use server";
  await requireAdmin();
  const payoutId = String(formData.get("payoutId") ?? "");
  const reference = String(formData.get("reference") ?? "").trim() || null;
  if (!payoutId) return;

  const result = await prisma.$transaction(async tx => {
    const payout = await tx.payout.findUnique({ where: { id: payoutId }, include: { partner: true, items: true } });
    if (!payout || payout.status !== "READY") return null;
    const paidAt = new Date();
    await tx.commission.updateMany({
      where: { id: { in: payout.items.map(i => i.commissionId) } },
      data: { status: "PAID", paidAt },
    });
    const updated = await tx.payout.update({ where: { id: payoutId }, data: { status: "PAID", paidAt, reference } });
    await tx.notification.create({
      data: {
        partnerId: payout.partnerId,
        type: "PAYOUT_PAID",
        title: "Выплата выполнена",
        message: `${Number(payout.amount).toLocaleString("ru-RU")} ₽ отмечено как выплачено.`,
        metadata: { payoutId, reference },
      },
    });
    await tx.auditLog.create({
      data: { actorType: "ADMIN", action: "MARK_PAYOUT_PAID", objectType: "PAYOUT", objectId: payoutId, payload: { reference, amount: Number(payout.amount) } },
    });
    return { payoutId, partnerId: payout.partnerId, amount: Number(updated.amount), reference };
  });

  if (result) await triggerOutgoingWebhook("payout.paid", result).catch(() => null);
  revalidatePath("/admin/payouts");
}

export default async function AdminPayoutsPage() {
  await requireAdmin();
  const settings = await prisma.programSettings.upsert({ where: { id: "default" }, create: {}, update: {} });
  const [approved, payouts] = await Promise.all([
    prisma.commission.findMany({
      where: { status: "APPROVED", payoutItems: { none: {} } },
      include: { partner: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.payout.findMany({ include: { partner: true, items: true }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);

  const balances = new Map<string, { partnerId: string; name: string; amount: number; entries: number }>();
  for (const commission of approved) {
    const row = balances.get(commission.partnerId) ?? { partnerId: commission.partnerId, name: commission.partner.name, amount: 0, entries: 0 };
    row.amount += Number(commission.amount);
    row.entries += 1;
    balances.set(commission.partnerId, row);
  }
  const available = [...balances.values()].filter(x => x.amount > 0).sort((a,b) => b.amount - a.amount);
  const totalAvailable = available.reduce((sum, x) => sum + x.amount, 0);
  const readyTotal = payouts.filter(p => p.status === "READY").reduce((sum,p) => sum + Number(p.amount), 0);

  return (
    <Shell title="Ручные выплаты" subtitle="Формируйте выплаты из подтверждённых комиссий и фиксируйте факт реального перевода." nav={adminNav} role="АДМИНИСТРАТОР">
      <section className="hero-panel">
        <div><span className="muted">Доступно к формированию</span><strong className="hero-money"><Money value={totalAvailable} currency={settings.currency}/></strong><span>{available.length} партнёров с положительным балансом</span></div>
        <div className="hero-meta"><span>Минимум <b><Money value={Number(settings.minimumPayoutAmount)} currency={settings.currency}/></b></span><span>Уже в READY <b><Money value={readyTotal} currency={settings.currency}/></b></span></div>
      </section>

      <section className="card">
        <div className="section-title"><div><span className="eyebrow">ДОСТУПНЫЙ БАЛАНС</span><h2>Сформировать ручную выплату</h2></div></div>
        <div className="table-wrap"><table><thead><tr><th>Партнёр</th><th>Сумма</th><th>Начислений</th><th>Минимум</th><th></th></tr></thead><tbody>
          {available.map(row => {
            const eligible = row.amount >= Number(settings.minimumPayoutAmount);
            return <tr key={row.partnerId}>
              <td><b>{row.name}</b></td><td><b><Money value={row.amount} currency={settings.currency}/></b></td><td>{row.entries}</td><td>{eligible ? "Выполнен" : "Не достигнут"}</td>
              <td>{eligible ? <form action={preparePayout}><input type="hidden" name="partnerId" value={row.partnerId}/><button className="button primary" type="submit">Сформировать</button></form> : <span className="muted">—</span>}</td>
            </tr>;
          })}
          {!available.length && <tr><td colSpan={5} className="muted">Нет доступных начислений.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="card">
        <div className="section-title"><div><span className="eyebrow">ИСТОРИЯ</span><h2>Пакеты выплат</h2></div></div>
        <div className="table-wrap"><table><thead><tr><th>Партнёр</th><th>Сумма</th><th>Начислений</th><th>Способ</th><th>Статус</th><th>Reference / действие</th></tr></thead><tbody>
          {payouts.map(p => <tr key={p.id}>
            <td><b>{p.partner.name}</b><small className="block muted">{p.createdAt.toLocaleDateString("ru-RU")}</small></td>
            <td><b><Money value={Number(p.amount)} currency={settings.currency}/></b></td>
            <td>{p.items.length}</td><td>{p.method ?? "MANUAL"}</td><td><span className="status">{p.status}</span></td>
            <td>{p.status === "READY" ? <form action={markPaid} className="inline-form"><input type="hidden" name="payoutId" value={p.id}/><input className="input mini-input" name="reference" placeholder="№ перевода / комментарий"/><button className="button primary" type="submit">Отметить Paid</button></form> : <span>{p.reference ?? "—"}</span>}</td>
          </tr>)}
          {!payouts.length && <tr><td colSpan={6} className="muted">Выплат пока нет.</td></tr>}
        </tbody></table></div>
      </section>
    </Shell>
  );
}
