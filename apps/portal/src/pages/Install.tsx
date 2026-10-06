import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Rocket } from 'lucide-react';
import { api } from '../api.js';
import { theme } from '../theme.js';
import { Button, ErrorBanner, Input, Label, Select } from '../ui.js';
import { AuthFrame } from './auth/Shared.js';

/**
 * Three-step first-run install:
 *   1. You      — admin identity (name + email)
 *   2. Program  — program name + optional support email
 *   3. Mail     — transport + credentials (so the invite email can send)
 * Final screen tells the admin to go check their inbox.
 */

type MailKind = 'smtp' | 'postmark' | 'none';

export function InstallPage() {
  const [step, setStep] = useState(0);

  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [programName, setProgramName] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [mailKind, setMailKind] = useState<MailKind>('smtp');
  const [mailFrom, setMailFrom] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [pmToken, setPmToken] = useState('');
  const [pmStream, setPmStream] = useState('outbound');

  const mut = useMutation({
    mutationFn: () =>
      api('/install', {
        method: 'POST',
        body: {
          adminName,
          adminEmail,
          programName,
          supportEmail: supportEmail || undefined,
          mail: {
            kind: mailKind,
            from: mailFrom || undefined,
            smtp:
              mailKind === 'smtp'
                ? {
                    host: smtpHost,
                    port: Number(smtpPort || 587),
                    secure: smtpSecure,
                    user: smtpUser || undefined,
                    password: smtpPass || undefined,
                  }
                : undefined,
            postmark:
              mailKind === 'postmark' ? { serverToken: pmToken, messageStream: pmStream || 'outbound' } : undefined,
          },
        },
      }),
  });

  if (mut.isSuccess) {
    return (
      <AuthFrame title="Проверьте почту" subtitle={`Ссылка для входа отправлена на ${adminEmail}.`} brand={programName}>
        <div style={{ fontSize: 13, color: theme.textMuted, lineHeight: 1.6 }}>
          Перейдите по ссылке, чтобы активировать учётную запись администратора. Ссылка действует 15 минут.
          <br />
          <br />
          <span style={{ color: theme.textDim }}>
            Письмо не пришло? Проверьте папку «Спам» или убедитесь, что настроенный почтовый провайдер
            может доставить письмо на адрес <strong>{adminEmail}</strong>.
          </span>
        </div>
      </AuthFrame>
    );
  }

  const steps = ['Администратор', 'Программа', 'Доставка почты'];
  const stepValid =
    (step === 0 && adminName && adminEmail) ||
    (step === 1 && programName) ||
    (step === 2 &&
      (mailKind === 'none' ||
        (mailKind === 'smtp' && smtpHost && mailFrom) ||
        (mailKind === 'postmark' && pmToken && mailFrom)));
  const isLast = step === steps.length - 1;

  function onNext() {
    if (!stepValid) return;
    if (isLast) mut.mutate();
    else setStep(step + 1);
  }

  return (
    <AuthFrame title="Установка Syntolk" subtitle="Первоначальная настройка.">
      <Stepper steps={steps} current={step} />

      {step === 0 && (
        <>
          <WelcomeLine>Добро пожаловать — начнём настройку.</WelcomeLine>
          <div style={{ marginBottom: 12 }}>
            <Label>Ваше имя</Label>
            <Input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Ada Lovelace" autoFocus />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Label>Ваш email</Label>
            <Input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="ada@example.com" />
            <Hint>Сюда будет отправлена ссылка для активации.</Hint>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div style={{ marginBottom: 12 }}>
            <Label>Название программы</Label>
            <Input value={programName} onChange={(e) => setProgramName(e.target.value)} placeholder="e.g. Acme Partners" autoFocus />
            <Hint>Так партнёры будут видеть программу в своём кабинете.</Hint>
          </div>
          <div style={{ marginBottom: 16 }}>
            <Label>Email поддержки (необязательно)</Label>
            <Input type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@yourdomain.com" />
            <Hint>Партнёры увидят этот адрес в подвале кабинета для связи.</Hint>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div style={{ marginBottom: 12 }}>
            <Label>Провайдер</Label>
            <Select value={mailKind} onChange={(e) => setMailKind(e.target.value as MailKind)}>
              <option value="smtp">SMTP (Gmail, SES, Mailgun, SendGrid, Postfix, …)</option>
              <option value="postmark">Postmark HTTP API</option>
              <option value="none">Не отправлять — выводить ссылку в консоль сервера (только для разработки)</option>
            </Select>
          </div>
          {mailKind !== 'none' && (
            <div style={{ marginBottom: 12 }}>
              <Label>Адрес отправителя</Label>
              <Input type="email" value={mailFrom} onChange={(e) => setMailFrom(e.target.value)} placeholder='"Acme Partners" <partners@acme.com>' />
              <Hint>Отображается во всех письмах. Адрес должен быть подтверждён у провайдера.</Hint>
            </div>
          )}
          {mailKind === 'smtp' && (
            <>
              <div className="op-grid-collapse" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <Label>SMTP-сервер</Label>
                  <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
                </div>
                <div>
                  <Label>Порт</Label>
                  <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <Label>Имя пользователя (необязательно)</Label>
                <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="apikey or username" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <Label>Пароль</Label>
                <Input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder="••••••••" />
                <Hint>Хранится в зашифрованном виде.</Hint>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: theme.textMuted, marginBottom: 12 }}>
                <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
                Использовать неявный TLS (порт 465). Для STARTTLS на порту 587 оставьте флажок снятым.
              </label>
            </>
          )}
          {mailKind === 'postmark' && (
            <>
              <div style={{ marginBottom: 12 }}>
                <Label>Токен сервера Postmark</Label>
                <Input type="password" value={pmToken} onChange={(e) => setPmToken(e.target.value)} placeholder="••••••••" />
                <Hint>Хранится в зашифрованном виде.</Hint>
              </div>
              <div style={{ marginBottom: 12 }}>
                <Label>Поток сообщений</Label>
                <Input value={pmStream} onChange={(e) => setPmStream(e.target.value)} placeholder="исходящие" />
              </div>
            </>
          )}
          {mailKind === 'none' && (
            <Hint>Ссылка для входа будет выведена в стандартный поток сервера. Для разработки и консольного режима.</Hint>
          )}
        </>
      )}

      <ErrorBanner error={mut.error} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, gap: 8 }}>
        {step > 0 ? (
          <Button variant="secondary" icon={<ArrowLeft size={14} />} onClick={() => setStep(step - 1)}>
            Назад
          </Button>
        ) : (
          <div />
        )}
        <Button
          onClick={onNext}
          disabled={!stepValid || mut.isPending}
          icon={isLast ? <Check size={14} /> : <ArrowRight size={14} />}
        >
          {isLast ? (mut.isPending ? 'Отправка…' : 'Отправить ссылку для настройки') : 'Продолжить'}
        </Button>
      </div>
    </AuthFrame>
  );
}

function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const c = done ? theme.accent : active ? theme.text : theme.textDim;
        const bg = done ? theme.accent : active ? theme.surface2 : 'transparent';
        const border = done ? theme.accent : active ? theme.accent : theme.border;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i === steps.length - 1 ? 0 : 1 }}>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: bg,
                border: `1px solid ${border}`,
                color: done ? theme.accentInk : c,
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {done ? <Check size={12} /> : i + 1}
            </div>
            <div style={{ fontSize: 12, color: c, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{label}</div>
            {i !== steps.length - 1 && <div style={{ height: 1, flex: 1, background: theme.border, marginLeft: 4 }} />}
          </div>
        );
      })}
    </div>
  );
}

function WelcomeLine({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, color: theme.accent }}>
      <Rocket size={16} />
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, color: theme.textDim, marginTop: 6 }}>{children}</div>;
}
