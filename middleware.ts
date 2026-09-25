import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE = "syntolk-partners-session";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const protectedAdmin = path.startsWith("/admin");
  const protectedPartner = path.startsWith("/partner");
  if (!protectedAdmin && !protectedPartner) return NextResponse.next();

  const token = request.cookies.get(COOKIE)?.value;
  if (!token || !process.env.JWT_SECRET) return NextResponse.redirect(new URL("/login", request.url));

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET));
    const role = String(payload.role ?? "");
    if (protectedAdmin && role !== "ADMIN") return NextResponse.redirect(new URL("/partner", request.url));
    if (protectedPartner && !["PARTNER","ADMIN"].includes(role)) return NextResponse.redirect(new URL("/login", request.url));
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = { matcher: ["/admin/:path*", "/partner/:path*"] };
