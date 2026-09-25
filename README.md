# Syntolk Partners Panel

Партнёрская CRM для Syntolk: кабинет партнёра, административная панель, recurring-комиссии и ручные выплаты.

Основа функциональности адаптирует полезные паттерны MIT-проекта Refferq, но платежная и финансовая модель переработана под Syntolk + CloudPayments. Подробности: `docs/REFFERQ_ADAPTATION.md`.

## Интерфейсы

- `/partner` — обзор партнёра
- `/partner/referrals` — привлечённые клиенты
- `/partner/payouts` — баланс и история выплат
- `/partner/resources` — рекламные материалы
- `/admin` — административный dashboard
- `/admin/partners` — партнёры, заявки, группы и ставки
- `/admin/payouts` — ручные выплаты
- `/admin/settings` — правила программы

## Финансовая модель

```text
Partner
  -> Referral / Syntolk user
      -> Payment #1 -> EARNING commission
      -> Payment #2 -> EARNING commission
      -> Payment #3 -> EARNING commission
      -> Refund     -> negative REFUND commission

APPROVED ledger entries
  -> manual Payout
  -> READY
  -> administrator sends money
  -> PAID
```

По умолчанию комиссия — 20%, но ставка может быть индивидуальной или задаваться группой партнёров.

## CloudPayments

Подготовлены webhook handlers:

- `POST /api/webhooks/cloudpayments/pay`
- `POST /api/webhooks/cloudpayments/refund`
- `POST /api/webhooks/cloudpayments/cancel`

Есть HMAC-проверка, idempotency и корректировки комиссии.

## Attribution

- `POST /api/referrals/capture` — публично фиксирует переход по referral code.
- `POST /api/referrals/identify` — сервер Syntolk привязывает click к реальному `externalUserId`.

## Админ API

- `/api/admin/dashboard`
- `/api/admin/partners`
- `/api/admin/partner-groups`
- `/api/admin/payouts`
- `/api/admin/settings`
- `/api/admin/resources`
- `/api/admin/commissions/mature`

До подключения Syntolk SSO эти endpoint'ы защищены временным `ADMIN_API_KEY`.

## Локальный запуск

```bash
cp .env.example .env
npm install
npx prisma generate
npm run dev
```

## Стек

- Next.js 16
- React 19
- TypeScript
- Prisma
- PostgreSQL

## Лицензии

Сведения о стороннем MIT-коде: `THIRD_PARTY_NOTICES.md`.
