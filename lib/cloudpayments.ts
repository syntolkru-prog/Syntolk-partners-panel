import { createHmac, timingSafeEqual } from "node:crypto";

function matchesHmac(message: string, signature: string | null, secret: string) {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(message, "utf8").digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyCloudPaymentsSignature(
  rawBody: string,
  headers: { contentHmac: string | null; xContentHmac: string | null },
  secret: string,
) {
  // Content-HMAC is calculated over the URL-encoded/raw body.
  if (matchesHmac(rawBody, headers.contentHmac, secret)) return true;

  // X-Content-HMAC is calculated over the decoded body.
  let decodedBody = rawBody;
  try {
    decodedBody = decodeURIComponent(rawBody.replace(/\+/g, " "));
  } catch {
    // Keep raw body if decoding fails; signature validation will simply fail.
  }

  return matchesHmac(decodedBody, headers.xContentHmac, secret);
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
