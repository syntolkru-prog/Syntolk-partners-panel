import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAdminAccess(request);
  if (auth.error) return auth.error;

  const resources = await prisma.marketingResource.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ resources });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminAccess(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const title = String(body?.title ?? "").trim();
  const type = String(body?.type ?? "OTHER");

  if (!title || !["BANNER", "LOGO", "TEXT", "LANDING", "EMAIL_TEMPLATE", "SOCIAL_POST", "DOCUMENT", "VIDEO", "OTHER"].includes(type)) {
    return NextResponse.json({ error: "Invalid resource" }, { status: 400 });
  }

  const resource = await prisma.marketingResource.create({
    data: {
      title,
      type: type as any,
      description: body?.description ? String(body.description) : null,
      url: body?.url ? String(body.url) : null,
      content: body?.content ? String(body.content) : null,
      fileUrl: body?.fileUrl ? String(body.fileUrl) : null,
      fileName: body?.fileName ? String(body.fileName) : null,
      fileSize: body?.fileSize !== undefined ? Number(body.fileSize) : null,
      mimeType: body?.mimeType ? String(body.mimeType) : null,
      category: body?.category ? String(body.category) : null,
      tags: Array.isArray(body?.tags) ? body.tags : [],
      createdBy: auth.session?.accountId ?? "api",
      sortOrder: Number(body?.sortOrder ?? 0),
      isActive: body?.isActive === undefined ? true : Boolean(body.isActive),
    },
  });

  return NextResponse.json({ resource }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminAccess(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const data: any = {};
  for (const key of ["title", "description", "url", "content", "fileUrl", "fileName", "mimeType", "category"] as const) {
    if (body?.[key] !== undefined) data[key] = body[key] ? String(body[key]) : null;
  }
  if (body?.type !== undefined) data.type = String(body.type);
  if (body?.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder);
  if (body?.fileSize !== undefined) data.fileSize = Number(body.fileSize);
  if (body?.tags !== undefined) data.tags = Array.isArray(body.tags) ? body.tags : [];
  if (body?.isActive !== undefined) data.isActive = Boolean(body.isActive);

  const resource = await prisma.marketingResource.update({ where: { id }, data });
  return NextResponse.json({ resource });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminAccess(request);
  if (auth.error) return auth.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await prisma.marketingResource.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
