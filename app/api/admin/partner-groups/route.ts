import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAdminAccess(request);
  if (auth.error) return auth.error;

  const groups = await prisma.partnerGroup.findMany({
    include: { _count: { select: { partners: true } } },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return NextResponse.json({ groups });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminAccess(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const name = String(body?.name ?? "").trim();
  const commissionRate = Number(body?.commissionRate ?? 20);
  const cookieDays = Number(body?.cookieDays ?? 60);

  if (!name || !Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
    return NextResponse.json({ error: "Invalid partner group" }, { status: 400 });
  }

  const group = await prisma.partnerGroup.create({
    data: {
      name,
      description: body?.description ? String(body.description) : null,
      commissionRate,
      cookieDays,
      isDefault: Boolean(body?.isDefault),
    },
  });

  if (group.isDefault) {
    await prisma.partnerGroup.updateMany({
      where: { id: { not: group.id }, isDefault: true },
      data: { isDefault: false },
    });
  }

  return NextResponse.json({ group }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminAccess(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const data: any = {};
  if (body?.name !== undefined) data.name = String(body.name);
  if (body?.description !== undefined) data.description = body.description ? String(body.description) : null;
  if (body?.commissionRate !== undefined) data.commissionRate = Number(body.commissionRate);
  if (body?.cookieDays !== undefined) data.cookieDays = Number(body.cookieDays);
  if (body?.isDefault !== undefined) data.isDefault = Boolean(body.isDefault);

  const group = await prisma.partnerGroup.update({ where: { id }, data });

  if (group.isDefault) {
    await prisma.partnerGroup.updateMany({
      where: { id: { not: group.id }, isDefault: true },
      data: { isDefault: false },
    });
  }

  await prisma.auditLog.create({
    data: { actorType: "ADMIN", action: "UPDATE_PARTNER_GROUP", objectType: "PARTNER_GROUP", objectId: id, payload: data },
  });

  return NextResponse.json({ group });
}
