import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { currentSession } from "@/lib/session";

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearer(request: NextRequest) {
  const value = request.headers.get("authorization") ?? "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

export function requireAdminApiKey(request: NextRequest) {
  const expected = process.env.ADMIN_API_KEY ?? "";
  const provided = bearer(request);
  if (!expected || !provided || !safeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function requireSyntolkInternalKey(request: NextRequest) {
  const expected = process.env.SYNTOLK_INTERNAL_API_KEY ?? "";
  const provided = bearer(request);
  if (!expected || !provided || !safeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function requireAdminAccess(request: NextRequest) {
  const session = await currentSession();
  if (session?.role === "ADMIN") return { session, error: null };

  const keyError = requireAdminApiKey(request);
  if (!keyError) return { session: null, error: null };

  return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
}

export async function requirePartnerAccess() {
  const session = await currentSession();
  if (!session || !["PARTNER","ADMIN"].includes(session.role)) {
    return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session, error: null };
}
