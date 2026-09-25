import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await prisma.account.findUnique({
    where: { id: session.accountId },
    include: { partner: { include: { group: true, program: true } } },
  });
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    account: {
      id: account.id, email: account.email, name: account.name, role: account.role, status: account.status,
      partner: account.partner,
    },
  });
}
