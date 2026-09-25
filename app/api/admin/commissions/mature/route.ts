import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminApiKey } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const authError = requireAdminApiKey(request);
  if (authError) return authError;
  const now = new Date();

  const result = await prisma.commission.updateMany({
    where: {
      status: "PENDING",
      availableAt: { lte: now },
    },
    data: {
      status: "APPROVED",
      approvedAt: now,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorType: "SYSTEM",
      action: "MATURE_COMMISSIONS",
      objectType: "COMMISSION",
      payload: { count: result.count, at: now.toISOString() },
    },
  });

  return NextResponse.json({ matured: result.count });
}
