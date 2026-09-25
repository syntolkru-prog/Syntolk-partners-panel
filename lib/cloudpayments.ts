import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyCloudPaymentsSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseCloudPaymentsBody(rawBody: string, contentType: string | null) {
  if (contentType?.includes("application/json")) {
    return JSON.parse(rawBody) as Record<string, unknown>;
  }

  const params = new URLSearchParams(rawBody);
  return Object.fromEntries(params.entries());
}

export function cloudPaymentsEventKey(type: string, payload: Record<string, unknown>) {
  const tx = String(payload.TransactionId ?? payload.transactionId ?? "unknown");
  return `cloudpayments:${type.toLowerCase()}:${tx}`;
}
