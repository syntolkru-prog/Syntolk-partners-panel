import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminApiKey } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const authError = requireAdminApiKey(request);
  if (authError) return authError;
  const payouts = await prisma.payout.findMany({
    include: { partner: true, items: { include: { commission: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ payouts });
}

export async function POST(request: NextRequest) {
  const authError = requireAdminApiKey(request);
  if (authError) return authError;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const partnerId = String(body?.partnerId ?? "").trim();
  const method = body?.method ? String(body.method) : "MANUAL";
  const note = body?.note ? String(body.note) : null;

  if (!partnerId) return NextResponse.json({ error: "partnerId is required" }, { status: 400 });

  try {
    const payout = await prisma.$transaction(async (tx) => {
      const partner = await tx.partner.findUnique({ where: { id: partnerId } });
      if (!partner) throw new Error("PARTNER_NOT_FOUND");

      const commissions = await tx.commission.findMany({
        where: {
          partnerId,
          status: "APPROVED",
          payoutItems: { none: {} },
        },
        orderBy: { createdAt: "asc" },
      });

      if (!commissions.length) throw new Error("NO_APPROVED_COMMISSIONS");

      const amount = commissions.reduce((sum, item) => sum + Number(item.amount), 0);
      if (amount <= 0) throw new Error("NON_POSITIVE_BALANCE");

      const created = await tx.payout.create({
        data: {
          partnerId,
          amount,
          method,
          note,
          status: "READY",
          preparedAt: new Date(),
          items: {
            create: commissions.map((commission) => ({ commissionId: commission.id })),
          },
        },
        include: { partner: true, items: true },
      });

      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          action: "CREATE_PAYOUT",
          objectType: "PAYOUT",
          objectId: created.id,
          payload: { partnerId, amount, commissionCount: commissions.length },
        },
      });

      return created;
    });

    return NextResponse.json({ payout }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    const status = message === "PARTNER_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  const authError = requireAdminApiKey(request);
  if (authError) return authError;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const payoutId = String(body?.payoutId ?? "").trim();
  const reference = body?.reference ? String(body.reference) : null;
  const note = body?.note ? String(body.note) : undefined;

  if (!payoutId) return NextResponse.json({ error: "payoutId is required" }, { status: 400 });

  try {
    const payout = await prisma.$transaction(async (tx) => {
      const current = await tx.payout.findUnique({
        where: { id: payoutId },
        include: { items: true },
      });

      if (!current) throw new Error("PAYOUT_NOT_FOUND");
      if (current.status === "PAID") return current;
      if (current.status !== "READY") throw new Error("PAYOUT_NOT_READY");

      const paidAt = new Date();

      await tx.commission.updateMany({
        where: { id: { in: current.items.map((item) => item.commissionId) } },
        data: { status: "PAID", paidAt },
      });

      const updated = await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: "PAID",
          paidAt,
          reference,
          ...(note !== undefined ? { note } : {}),
        },
        include: { partner: true, items: true },
      });

      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          action: "MARK_PAYOUT_PAID",
          objectType: "PAYOUT",
          objectId: payoutId,
          payload: { reference, amount: Number(updated.amount) },
        },
      });

      return updated;
    });

    return NextResponse.json({ payout });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    return NextResponse.json({ error: message }, { status: message === "PAYOUT_NOT_FOUND" ? 404 : 400 });
  }
}
