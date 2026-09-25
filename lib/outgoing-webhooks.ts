import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

function safeWebhookUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (["localhost","127.0.0.1","0.0.0.0","::1"].includes(host)) return false;
    if (/^10\.|^127\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch { return false; }
}

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
