import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";
import { sendTemplatedEmail } from "@/lib/email";
import { triggerOutgoingWebhook } from "@/lib/outgoing-webhooks";

export async function GET(request: NextRequest) {
  const auth = await requireAdminAccess(request);
  if (auth.error) return auth.error;
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
  const auth = await requireAdminAccess(request);
  if (auth.error) return auth.error;

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
      commissionRate: body?.commissionRate !== undefined ? Number(body.commissionRate) : settings.baseCommissionRate,
      usesCustomCommission: body?.commissionRate !== undefined,
      cookieDays: body?.cookieDays !== undefined ? Number(body.cookieDays) : settings.cookieDays,
      groupId: body?.groupId ? String(body.groupId) : null,
      programId: body?.programId ? String(body.programId) : null,
      syntolkUserId: body?.syntolkUserId ? String(body.syntolkUserId) : null,
    },
  });

  return NextResponse.json({ partner }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminAccess(request);
  if (auth.error) return auth.error;

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
  if (body?.commissionRate !== undefined) {
    data.commissionRate = Number(body.commissionRate);
    data.usesCustomCommission = true;
  }
  if (body?.resetCommissionOverride === true) data.usesCustomCommission = false;
  if (body?.cookieDays !== undefined) data.cookieDays = Number(body.cookieDays);
  if (body?.groupId !== undefined) data.groupId = body.groupId ? String(body.groupId) : null;
  if (body?.programId !== undefined) data.programId = body.programId ? String(body.programId) : null;
  if (body?.syntolkUserId !== undefined) data.syntolkUserId = body.syntolkUserId ? String(body.syntolkUserId) : null;
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

  if (data.status === "ACTIVE" || data.status === "REJECTED") {
    const type = data.status === "ACTIVE" ? "PARTNER_APPROVED" : "PARTNER_REJECTED";
    await prisma.notification.create({ data: { partnerId: partner.id, type, title: data.status === "ACTIVE" ? "Заявка одобрена" : "Заявка отклонена", message: data.status === "ACTIVE" ? "Ваш аккаунт Syntolk Partners активирован." : "Статус вашей заявки изменён администратором." } });
    await sendTemplatedEmail({ type, to: partner.email, recipientId: partner.id, variables: { name: partner.name }, fallbackSubject: data.status === "ACTIVE" ? "Syntolk Partners: заявка одобрена" : "Syntolk Partners: статус заявки", fallbackBody: data.status === "ACTIVE" ? "<h2>Добро пожаловать в Syntolk Partners</h2><p>Ваша заявка одобрена.</p>" : "<h2>Syntolk Partners</h2><p>Ваша заявка не была одобрена.</p>" }).catch(()=>null);
    await triggerOutgoingWebhook(data.status === "ACTIVE" ? "partner.approved" : "partner.rejected", { partnerId: partner.id, email: partner.email }).catch(()=>null);
  }

  return NextResponse.json({ partner });
}
