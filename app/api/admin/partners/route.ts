import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminApiKey } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const authError = requireAdminApiKey(request);
  if (authError) return authError;
  const partners = await prisma.partner.findMany({
    include: {
      group: true,
      _count: { select: { clicks: true, referrals: true } },
      commissions: { select: { amount: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    partners: partners.map((partner) => ({
      ...partner,
      totals: {
        clicks: partner._count.clicks,
        referrals: partner._count.referrals,
        approvedBalance: partner.commissions
          .filter((c) => c.status === "APPROVED")
          .reduce((sum, c) => sum + Number(c.amount), 0),
        earned: partner.commissions.reduce((sum, c) => sum + Number(c.amount), 0),
      },
      commissions: undefined,
      _count: undefined,
    })),
  });
}

export async function POST(request: NextRequest) {
  const authError = requireAdminApiKey(request);
  if (authError) return authError;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const code = String(body?.code ?? "").trim().toLowerCase();

  if (!name || !email || !code) {
    return NextResponse.json({ error: "name, email and code are required" }, { status: 400 });
  }

  const settings = await prisma.programSettings.upsert({
    where: { id: "default" },
    create: {},
    update: {},
  });

  const partner = await prisma.partner.create({
    data: {
      name,
      email,
      code,
      status: settings.requireApproval ? "PENDING" : "ACTIVE",
      commissionRate: settings.baseCommissionRate,
      cookieDays: settings.cookieDays,
    },
  });

  return NextResponse.json({ partner }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const authError = requireAdminApiKey(request);
  if (authError) return authError;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const data: any = {};
  if (body?.status) {
    const status = String(body.status);
    if (!["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    data.status = status;
    if (status === "ACTIVE") data.approvedAt = new Date();
    if (status === "SUSPENDED") data.suspendedAt = new Date();
  }
  if (body?.commissionRate !== undefined) data.commissionRate = Number(body.commissionRate);
  if (body?.cookieDays !== undefined) data.cookieDays = Number(body.cookieDays);
  if (body?.groupId !== undefined) data.groupId = body.groupId ? String(body.groupId) : null;
  if (body?.note !== undefined) data.note = body.note ? String(body.note) : null;

  const partner = await prisma.partner.update({ where: { id }, data });
  await prisma.auditLog.create({
    data: {
      actorType: "ADMIN",
      action: "UPDATE_PARTNER",
      objectType: "PARTNER",
      objectId: id,
      payload: data,
    },
  });

  return NextResponse.json({ partner });
}
