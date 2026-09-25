import { prisma } from "@/lib/prisma";

const BOT_MARKERS = ["bot","crawler","spider","scraper","curl","wget","python-requests","go-http-client","okhttp"];

export async function evaluateClickFraud(input: { partnerId: string; ipHash: string; userAgent: string }) {
  let score = 0;
  const reasons: string[] = [];
  const ua = input.userAgent.toLowerCase();

  if (BOT_MARKERS.some(v => ua.includes(v))) { score += 60; reasons.push("bot_user_agent"); }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [hourClicks, partnerClicks] = await Promise.all([
    prisma.referralClick.count({ where: { ipHash: input.ipHash, createdAt: { gte: hourAgo } } }),
    prisma.referralClick.count({ where: { ipHash: input.ipHash, partnerId: input.partnerId, createdAt: { gte: dayAgo } } }),
  ]);

  if (hourClicks >= 10) { score += 30; reasons.push("high_ip_frequency"); }
  if (partnerClicks >= 5) { score += 40; reasons.push("repeated_partner_ip"); }

  return { score: Math.min(score,100), reasons, suspicious: score >= 40 };
}
