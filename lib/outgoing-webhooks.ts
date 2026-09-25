import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

export function safeWebhookUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (["localhost","127.0.0.1","0.0.0.0","::1"].includes(host)) return false;
    if (/^10\.|^127\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch { return false; }
}

export const AVAILABLE_PARTNER_EVENTS = [
  "partner.approved","partner.rejected","referral.created","commission.created",
  "commission.approved","commission.refund_adjustment","payment.canceled",
  "payout.ready","payout.paid"
] as const;

export async function triggerOutgoingWebhook(eventType: string, data: unknown) {
  const hooks = await prisma.outgoingWebhook.findMany({ where: { isActive: true } });
  const subscribed = hooks.filter(h => Array.isArray(h.events) && (h.events as string[]).includes(eventType));

  for (const hook of subscribed) {
    if (!safeWebhookUrl(hook.url)) continue;
    const payload = JSON.stringify({ event: eventType, data, timestamp: new Date().toISOString() });
    const signature = createHmac("sha256", hook.secret).update(payload).digest("hex");
    const log = await prisma.outgoingWebhookLog.create({
      data: { webhookId: hook.id, eventType, payload: JSON.parse(payload), attempts: 1 },
    });

    try {
      const response = await fetch(hook.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-syntolk-signature": signature, "x-syntolk-event": eventType },
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });
      const responseText = await response.text().catch(() => "");
      if (response.ok) {
        await prisma.$transaction([
          prisma.outgoingWebhook.update({ where: { id: hook.id }, data: { failureCount: 0, lastTriggeredAt: new Date() } }),
          prisma.outgoingWebhookLog.update({ where: { id: log.id }, data: { status: "SUCCESS", statusCode: response.status, response: responseText, completedAt: new Date() } }),
        ]);
      } else {
        const failures = hook.failureCount + 1;
        await prisma.$transaction([
          prisma.outgoingWebhook.update({ where: { id: hook.id }, data: { failureCount: failures, isActive: failures < 10 } }),
          prisma.outgoingWebhookLog.update({ where: { id: log.id }, data: { status: "FAILED", statusCode: response.status, response: responseText, error: `HTTP ${response.status}`, completedAt: new Date() } }),
        ]);
      }
    } catch (error) {
      const failures = hook.failureCount + 1;
      await prisma.$transaction([
        prisma.outgoingWebhook.update({ where: { id: hook.id }, data: { failureCount: failures, isActive: failures < 10 } }),
        prisma.outgoingWebhookLog.update({ where: { id: log.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : "network_error", completedAt: new Date() } }),
      ]);
    }
  }
}


export async function retryOutgoingWebhookLog(logId: string) {
  const log = await prisma.outgoingWebhookLog.findUnique({
    where: { id: logId },
    include: { webhook: true },
  });
  if (!log) throw new Error("WEBHOOK_LOG_NOT_FOUND");
  if (!log.webhook.isActive) throw new Error("WEBHOOK_DISABLED");
  if (!safeWebhookUrl(log.webhook.url)) throw new Error("UNSAFE_WEBHOOK_URL");

  const payload = JSON.stringify(log.payload);
  const signature = createHmac("sha256", log.webhook.secret).update(payload).digest("hex");
  const attempt = log.attempts + 1;

  try {
    const response = await fetch(log.webhook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-syntolk-signature": signature,
        "x-syntolk-event": log.eventType,
      },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    });
    const responseText = await response.text().catch(() => "");
    await prisma.outgoingWebhookLog.update({
      where: { id: log.id },
      data: {
        attempts: attempt,
        status: response.ok ? "SUCCESS" : "FAILED",
        statusCode: response.status,
        response: responseText,
        error: response.ok ? null : `HTTP ${response.status}`,
        completedAt: new Date(),
        nextRetryAt: response.ok ? null : new Date(Date.now() + Math.min(60, attempt * 5) * 60_000),
      },
    });
    if (response.ok) {
      await prisma.outgoingWebhook.update({ where: { id: log.webhookId }, data: { failureCount: 0, lastTriggeredAt: new Date() } });
    }
    return { success: response.ok, statusCode: response.status };
  } catch (error) {
    await prisma.outgoingWebhookLog.update({
      where: { id: log.id },
      data: {
        attempts: attempt,
        status: "FAILED",
        error: error instanceof Error ? error.message : "network_error",
        completedAt: new Date(),
        nextRetryAt: new Date(Date.now() + Math.min(60, attempt * 5) * 60_000),
      },
    });
    return { success: false };
  }
}
