import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";
import { triggerOutgoingWebhook } from "@/lib/outgoing-webhooks";

export async function POST(request: NextRequest) {
  const auth = await requireAdminAccess(request);
  if (auth.error) return auth.error;

  const now = new Date();
  const due = await prisma.commission.findMany({
    where: { status: "PENDING", availableAt: { lte: now } },
    select: { id: true, partnerId: true, amount: true },
  });

  if (due.length) {
    await prisma.commission.updateMany({
      where: { id: { in: due.map(x => x.id) } },
      data: { status: "APPROVED", approvedAt: now },
    });

    const grouped = new Map<string, number>();
    for (const item of due) grouped.set(item.partnerId, (grouped.get(item.partnerId) ?? 0) + Number(item.amount));

    for (const [partnerId, amount] of grouped) {
      await prisma.notification.create({
        data: {
          partnerId,
          type: "COMMISSION_APPROVED",
          title: "Начисления доступны к выплате",
          message: `${amount.toLocaleString("ru-RU")} ₽ прошли холд и теперь доступны к выплате.`,
        },
      });
    }

    await triggerOutgoingWebhook("commission.approved", { count: due.length, at: now.toISOString() }).catch(()=>null);
  }

  await prisma.auditLog.create({
    data: {
      actorType: "SYSTEM",
      action: "MATURE_COMMISSIONS",
      objectType: "COMMISSION",
      payload: { count: due.length, at: now.toISOString() },
    },
  });

  return NextResponse.json({ matured: due.length });
}
