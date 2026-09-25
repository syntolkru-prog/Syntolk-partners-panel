import type { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | any;

type Context = {
  amount: number;
  currency: string;
  partner: {
    id: string;
    programId?: string | null;
    groupId?: string | null;
    commissionRate: unknown;
    usesCustomCommission: boolean;
    group?: { commissionRate: unknown } | null;
    program?: { commissionRate: unknown } | null;
  };
  referral?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
  };
  subscriptionId?: string | null;
  invoiceId?: string | null;
};

function conditionsMatch(conditions: unknown, ctx: Context) {
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) return true;
  const c = conditions as Record<string, unknown>;

  if (c.partnerId && String(c.partnerId) !== ctx.partner.id) return false;
  if (c.partnerGroupId && String(c.partnerGroupId) !== String(ctx.partner.groupId ?? "")) return false;
  if (c.currency && String(c.currency).toUpperCase() !== ctx.currency.toUpperCase()) return false;
  if (c.minAmount !== undefined && ctx.amount < Number(c.minAmount)) return false;
  if (c.maxAmount !== undefined && ctx.amount > Number(c.maxAmount)) return false;
  if (c.source && String(c.source) !== String(ctx.referral?.source ?? "")) return false;
  if (c.medium && String(c.medium) !== String(ctx.referral?.medium ?? "")) return false;
  if (c.campaign && String(c.campaign) !== String(ctx.referral?.campaign ?? "")) return false;
  if (c.hasSubscription !== undefined && Boolean(ctx.subscriptionId) !== Boolean(c.hasSubscription)) return false;
  if (c.hasInvoice !== undefined && Boolean(ctx.invoiceId) !== Boolean(c.hasInvoice)) return false;

  return true;
}

export async function calculateCommission(db: Db, ctx: Context) {
  const settings = await db.programSettings.upsert({
    where: { id: "default" },
    create: {},
    update: {},
  });

  const rules = await db.commissionRule.findMany({
    where: {
      isActive: true,
      OR: [
        { programId: null },
        ...(ctx.partner.programId ? [{ programId: ctx.partner.programId }] : []),
      ],
    },
    orderBy: [{ priority: "desc" }, { isDefault: "desc" }, { createdAt: "asc" }],
  });

  const rule = rules.find((item: any) => conditionsMatch(item.conditions, ctx));
  if (rule) {
    const value = Number(rule.value);
    const commissionAmount =
      rule.type === "FIXED"
        ? Math.min(ctx.amount, Math.max(0, value))
        : ctx.amount * (Math.max(0, value) / 100);
    const effectiveRate = ctx.amount > 0 ? (commissionAmount / ctx.amount) * 100 : 0;

    return {
      amount: commissionAmount,
      rate: effectiveRate,
      ruleId: rule.id as string,
      source: `rule:${rule.name}`,
      holdDays: settings.commissionHoldDays as number,
    };
  }

  let rate: number;
  let source: string;

  if (ctx.partner.usesCustomCommission) {
    rate = Number(ctx.partner.commissionRate);
    source = "partner_override";
  } else if (ctx.partner.group) {
    rate = Number(ctx.partner.group.commissionRate);
    source = "partner_group";
  } else if (ctx.partner.program) {
    rate = Number(ctx.partner.program.commissionRate);
    source = "program";
  } else {
    rate = Number(settings.baseCommissionRate);
    source = "program_settings";
  }

  return {
    amount: ctx.amount * (rate / 100),
    rate,
    ruleId: null as string | null,
    source,
    holdDays: settings.commissionHoldDays as number,
  };
}

export function proratedReversal(input: {
  refundAmount: number;
  paymentAmount: number;
  originalCommissionAmount: number;
}) {
  if (input.paymentAmount <= 0) return 0;
  const share = Math.min(1, Math.max(0, input.refundAmount / input.paymentAmount));
  return -(input.originalCommissionAmount * share);
}
