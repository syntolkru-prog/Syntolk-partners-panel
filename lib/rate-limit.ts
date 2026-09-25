import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

export async function checkRateLimit(identifier: string, endpoint: string, limit = 30, windowMs = 60_000) {
  const now = new Date();
  const currentWindow = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const entry = await prisma.rateLimitEntry.upsert({
    where: { identifier_endpoint_windowStart: { identifier, endpoint, windowStart: currentWindow } },
    update: { requestCount: { increment: 1 } },
    create: { identifier, endpoint, windowStart: currentWindow, requestCount: 1 },
  });

  return {
    allowed: entry.requestCount <= limit,
    limit,
    remaining: Math.max(0, limit - entry.requestCount),
    resetAt: new Date(currentWindow.getTime() + windowMs),
  };
}

export function requestIpHash(headers: Headers) {
  const raw = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
  const salt = process.env.REFERRAL_IP_HASH_SALT || process.env.JWT_SECRET || "development-only";
  return createHash("sha256").update(`${salt}:${raw}`).digest("hex");
}
