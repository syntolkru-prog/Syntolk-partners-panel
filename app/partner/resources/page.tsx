import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { partnerNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { currentSession } from "@/lib/session";

export default async function PartnerResourcesPage() {
  const session=await currentSession();if(!session?.partnerId)redirect("/login");
  const resources=await prisma.marketingResource.findMany({where:{isActive:true},orderBy:[{sortOrder:"asc"},{createdAt:"desc"}]});
  return <Shell title="Материалы" subtitle="Готовые материалы, чтобы быстрее рассказывать о Syntolk." nav={partnerNav} role="ПАРТНЁР">
    <section className="resource-grid">
      {resources.map(r=><article className="resource-card" key={r.id}>
        <span className="tag">{r.type}</span>
        <div className="resource-preview">{r.type==="LOGO"?"Syntolk":r.category||"Syntolk Partners"}</div>
        <h2>{r.title}</h2><p className="muted">{r.description||r.fileName||r.mimeType||"Материал партнёрской программы"}</p>
        <div className="landing-actions">
          {r.url&&<a className="button secondary" href={r.url} target="_blank" rel="noreferrer">Открыть</a>}
          {r.fileUrl&&<a className="button secondary" href={r.fileUrl} target="_blank" rel="noreferrer">Файл</a>}
        </div>
        {r.content&&<div className="resource-copy">{r.content}</div>}
        <small className="muted">Открытий/скачиваний: {r.downloads}</small>
      </article>)}
      {!resources.length&&<article className="card"><h2>Материалы готовятся</h2><p className="muted">Администратор пока не добавил баннеры, тексты и посадочные страницы.</p></article>}
    </section>
  </Shell>
}
