"use client";
import { FormEvent, useState } from "react";

export function IntegrationManager(){
  const [apiSecret,setApiSecret]=useState("");
  const [webhookSecret,setWebhookSecret]=useState("");
  const [message,setMessage]=useState("");

  async function createKey(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setMessage("");
    const fd=new FormData(e.currentTarget);
    const res=await fetch("/api/admin/api-keys",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:fd.get("name"),scopes:["read","write"],rateLimit:Number(fd.get("rateLimit")||100)})});
    const data=await res.json();
    if(!res.ok){setMessage(data.error||"Не удалось создать API key");return;}
    setApiSecret(data.key.secret);setMessage("API key создан. Скопируйте его сейчас — позже он не показывается.");
    e.currentTarget.reset();
  }

  async function createWebhook(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setMessage("");
    const fd=new FormData(e.currentTarget);
    const res=await fetch("/api/admin/webhooks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"create",name:fd.get("name"),url:fd.get("url"),events:["partner.approved","commission.created","commission.approved","commission.refund_adjustment","payout.ready","payout.paid","payment.canceled"]})});
    const data=await res.json();
    if(!res.ok){setMessage(data.error||"Не удалось создать webhook");return;}
    setWebhookSecret(data.webhook.secret);setMessage("Webhook создан. Сохраните signing secret.");
    e.currentTarget.reset();
  }

  return <div className="grid-two">
    <article className="card"><span className="eyebrow">CREATE API KEY</span><h2>Новый ключ</h2>
      <form onSubmit={createKey} className="form-stack"><input className="input" name="name" placeholder="Например: Syntolk backend" required/><input className="input" name="rateLimit" type="number" defaultValue="100" min="1"/><button className="button primary" type="submit">Создать API key</button></form>
      {apiSecret&&<div className="secret-box"><b>Показывается один раз</b><code>{apiSecret}</code></div>}
    </article>
    <article className="card"><span className="eyebrow">CREATE WEBHOOK</span><h2>Новый endpoint</h2>
      <form onSubmit={createWebhook} className="form-stack"><input className="input" name="name" placeholder="Название" required/><input className="input" name="url" type="url" placeholder="https://example.com/webhooks/syntolk" required/><button className="button primary" type="submit">Создать webhook</button></form>
      {webhookSecret&&<div className="secret-box"><b>Signing secret</b><code>{webhookSecret}</code></div>}
    </article>
    {message&&<p className="form-message">{message}</p>}
  </div>;
}
