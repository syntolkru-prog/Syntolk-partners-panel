import Link from "next/link";
import type { ReactNode } from "react";
import { currentSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

type NavItem = { href: string; label: string };

export async function Shell({
  title,
  subtitle,
  nav,
  role,
  children,
}: {
  title: string;
  subtitle: string;
  nav: NavItem[];
  role: string;
  children: ReactNode;
}) {
  const session = await currentSession();
  const account = session
    ? await prisma.account.findUnique({
        where: { id: session.accountId },
        select: { name: true, email: true },
      })
    : null;

  const name = account?.name ?? (role === "АДМИНИСТРАТОР" ? "Syntolk Admin" : "Партнёр Syntolk");
  const email = account?.email ?? "";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "S";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">S</span>
          <span><b>Syntolk</b><small>Partners</small></span>
        </Link>
        <div className="role-pill">{role}</div>
        <nav>
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="nav-link">{item.label}</Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="avatar">{initials}</div>
          <div><b>{name}</b><small>{email}</small></div>
        </div>
      </aside>
      <main className="content">
        <header className="page-header">
          <div><p className="eyebrow">SYNTOLK PARTNER CENTER</p><h1>{title}</h1><p>{subtitle}</p></div>
          <Link className="button secondary" href={role === "АДМИНИСТРАТОР" ? "/admin/settings" : "/partner/settings"}>Настройки</Link>
        </header>
        {children}
      </main>
    </div>
  );
}

export function Money({ value, currency = "RUB" }: { value: number; currency?: string }) {
  return <>{new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 2 }).format(value)}</>;
}
