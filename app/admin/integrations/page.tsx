import Link from "next/link";
import { Shell } from "@/components/shell";
import { IntegrationManager } from "@/components/integration-manager";
import { adminNav } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";

export default async function Page(){
  const [keys,hooks,integrations]=await Promise.all([
    prisma.apiKey.findMany({select:{id:true,name:true,prefix:true,scopes:true,rateLimit:true,isActive:true,lastUsedAt:true,expiresAt:true,_count:{select:{usageLogs:true}}},orderBy:{createdAt:"desc"}}),
    prisma.outgoingWebhook.findMany({include:{logs:{orderBy:{createdAt:"desc"},take:1}},orderBy:{createdAt:"desc"}}),
    prisma.integrationSettings.findMany({orderBy:{createdAt:"desc"}})
  ]);
  return <Shell title="Интеграции" subtitle="CloudPayments, API keys, tracking и исходящие webhooks." nav={adminNav} role="АДМИНИСТРАТОР">
    <section className="grid-two"><article className="card"><span className="eyebrow">CLOUDPAYMENTS</span><h2>Платёжные события</h2><div className="integration-status"><span className="dot"></span><div><b>Pay · Refund · Cancel</b><small>HMAC · idempotency · recurring · proportional reversal</small></div></div><p className="muted">Секрет хранится только в environment variables и никогда не возвращается в UI.</p></article><article className="card"><span className="eyebrow">PUBLIC API</span><h2>Документация</h2><p className="muted">Referral attribution, revenue events и coupon validation доступны через versioned API.</p><Link className="button secondary" href="/api/docs">Открыть API docs</Link></article></section>
    <IntegrationManager/>
    <section className="grid-two">
      <article className="card"><span className="eyebrow">API KEYS</span><h2>{keys.length} ключей</h2><div className="settings-list">{keys.map(k=><div key={k.id}><span>{k.name}<small className="block muted">{k.prefix}… · {k._count.usageLogs} requests</small></span><b>{k.isActive?"ACTIVE":"OFF"} · {k.rateLimit}/min</b></div>)}{!keys.length&&<p className="muted">Ключей нет.</p>}</div></article>
      <article className="card"><span className="eyebrow">WEBHOOKS</span><h2>{hooks.length} endpoint'ов</h2><div className="settings-list">{hooks.map(h=><div key={h.id}><span>{h.name}<small className="block muted">{h.url}</small></span><b>{h.isActive?"ACTIVE":"OFF"} · failures {h.failureCount}</b></div>)}{!hooks.length&&<p className="muted">Webhook endpoint'ов нет.</p>}</div></article>
    </section>
    <section className="card"><span className="eyebrow">TRACKING / SETTINGS</span><h2>Integration settings</h2><div className="settings-list">{integrations.map(i=><div key={i.id}><span>{i.key}<small className="block muted">{i.provider}</small></span><b>{i.isActive?"ACTIVE":"OFF"}</b></div>)}{!integrations.length&&<p className="muted">Отдельные integration settings ещё не создавались.</p>}</div></section>
  </Shell>
}
