"use client";
import { FormEvent, useState } from "react";

export default function LoginPage(){
  const [mode,setMode]=useState<"password"|"otp">("password");
  const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [code,setCode]=useState("");
  const [sent,setSent]=useState(false); const [message,setMessage]=useState("");

  async function login(e:FormEvent){e.preventDefault();setMessage("");
    const res=await fetch("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});
    const data=await res.json(); if(!res.ok){setMessage(data.error||"Ошибка входа");return;} window.location.href=data.role==="ADMIN"?"/admin":"/partner";
  }
  async function sendOtp(){setMessage("");const res=await fetch("/api/auth/send-otp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});if(res.ok){setSent(true);setMessage("Код отправлен на email");}else setMessage("Не удалось отправить код");}
  async function verifyOtp(e:FormEvent){e.preventDefault();const res=await fetch("/api/auth/verify-otp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,code})});const data=await res.json();if(!res.ok){setMessage(data.error||"Неверный код");return;}window.location.href=data.role==="ADMIN"?"/admin":"/partner";}

  return <main className="auth-page"><section className="auth-card">
    <a className="brand auth-brand" href="/"><span className="brand-mark">S</span><span><b>Syntolk</b><small>Partners</small></span></a>
    <p className="eyebrow">ВХОД</p><h1>Партнёрский кабинет</h1><p className="muted">Статистика, клиенты, начисления и выплаты.</p>
    <div className="auth-tabs"><button className={mode==="password"?"active":""} onClick={()=>setMode("password")}>Пароль</button><button className={mode==="otp"?"active":""} onClick={()=>setMode("otp")}>Код на email</button></div>
    {mode==="password"?<form className="auth-form" onSubmit={login}><label>Email<input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Пароль<input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="button primary" type="submit">Войти</button></form>:
    <form className="auth-form" onSubmit={verifyOtp}><label>Email<input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>{sent&&<label>Код из письма<input className="input" inputMode="numeric" value={code} maxLength={6} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} required/></label>}{!sent?<button className="button primary" type="button" onClick={sendOtp}>Получить код</button>:<button className="button primary" type="submit">Подтвердить и войти</button>}</form>}
    {message&&<p className="form-message">{message}</p>}<p className="auth-footer">Ещё не партнёр? <a href="/register">Подать заявку</a></p>
  </section></main>;
}
