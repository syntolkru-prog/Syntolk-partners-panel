import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminApiKey } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const authError = requireAdminApiKey(request);
  if (authError) return authError;

  const [
    partnerCount,
    activePartnerCount,
    pendingPartnerCount,
    referralCount,
    paymentAggregate,
    approvedCommissions,
    pendingCommissions,
    paidCommissions,
    payoutsReady,
    refundsAggregate,
  ] = await Promise.all([
    prisma.partner.count(),
    prisma.partner.count({ where: { status: "ACTIVE" } }),
    prisma.partner.count({ where: { status: "PENDING" } }),
    prisma.referral.count(),
    prisma.payment.aggregate({ where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } }, _sum: { amount: true }, _count: true }),
    prisma.commission.aggregate({ where: { status: "APPROVED" }, _sum: { amount: true }, _count: true }),
    prisma.commission.aggregate({ where: { status: "PENDING" }, _sum: { amount: true }, _count: true }),
    prisma.commission.aggregate({ where: { status: "PAID" }, _sum: { amount: true }, _count: true }),
    prisma.payout.aggregate({ where: { status: "READY" }, _sum: { amount: true }, _count: true }),
    prisma.refund.aggregate({ _sum: { amount: true }, _count: true }),
  ]);

  return NextResponse.json({
    stats: {
      partners: partnerCount,
      activePartners: activePartnerCount,
      pendingPartners: pendingPartnerCount,
      referrals: referralCount,
      payments: paymentAggregate._count,
      revenue: Number(paymentAggregate._sum.amount ?? 0),
      approvedCommissionBalance: Number(approvedCommissions._sum.amount ?? 0),
      approvedCommissionEntries: approvedCommissions._count,
      pendingCommissionBalance: Number(pendingCommissions._sum.amount ?? 0),
      pendingCommissionEntries: pendingCommissions._count,
      paidCommissionTotal: Number(paidCommissions._sum.amount ?? 0),
      paidCommissionEntries: paidCommissions._count,
      payoutsReady: Number(payoutsReady._sum.amount ?? 0),
      payoutsReadyCount: payoutsReady._count,
      refunds: Number(refundsAggregate._sum.amount ?? 0),
      refundCount: refundsAggregate._count,
    },
  });
}
