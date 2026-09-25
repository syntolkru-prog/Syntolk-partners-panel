import Link from "next/link";
import type { ReactNode } from "react";

type NavItem = { href: string; label: string };

export function Shell({
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
          <div className="avatar">AP</div>
          <div><b>Александр Петров</b><small>alex@syntolk.ru</small></div>
        </div>
      </aside>
      <main className="content">
        <header className="page-header">
          <div><p className="eyebrow">SYNTOLK PARTNER CENTER</p><h1>{title}</h1><p>{subtitle}</p></div>
          <button className="button secondary">Помощь</button>
        </header>
        {children}
      </main>
    </div>
  );
}

export function Money({ value }: { value: number }) {
  return <>{new Intl.NumberFormat("ru-RU").format(value)} ₽</>;
}
