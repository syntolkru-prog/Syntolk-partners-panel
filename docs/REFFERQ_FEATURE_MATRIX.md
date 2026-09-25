# Refferq → Syntolk Partners feature matrix

Checked after the full Refferq tree review. This is a functional adaptation, not a branding/code clone: useful Refferq capabilities are implemented for Syntolk, while automated third-party payout flows and Refferq-specific assets are intentionally excluded.

Legend: ✅ implemented in this repository · 🔌 requires production/external Syntolk wiring · 🚫 intentionally excluded.

## Core partner program

| Capability | Syntolk implementation | Status |
|---|---|---|
| Partner applications | Account + Partner with PENDING/ACTIVE/SUSPENDED/REJECTED | ✅ |
| Approval/rejection | Admin UI/API + email + notification + audit | ✅ |
| Unique referral code | Partner.code + generator + personalized-link policy | ✅ |
| Short referral links | /r/{code} redirect + click creation | ✅ |
| Browser tracking | public/scripts/syntolk-partner-tracker.js | ✅ |
| Attribution window | Partner / group / program cookieDays | ✅ |
| Partner groups | Commission/cookie overrides | ✅ |
| Custom partner commission | Explicit override flag + rate | ✅ |
| Multiple programs | Program model and admin UI | ✅ |
| Commission rules | Percentage/fixed, JSON conditions, priority | ✅ |
| Rule evaluation | Rule → partner override → group → program → base | ✅ |
| Manual referrals | Optional, controlled by ProgramSettings | ✅ |
| Referral lifecycle | CAPTURED / REGISTERED / ACTIVE / CANCELED | ✅ |
| First-touch attribution | clickId -> externalUserId, no reassignment | ✅ |
| UTM tracking | source/medium/campaign/content/term | ✅ |
| Fraud checks | bot/frequency scoring + salted IP hashes | ✅ |
| Self-referral blocking | authoritative Partner.syntolkUserId comparison | ✅ |
| Main Syntolk signup call | syntolk.ru must call /api/referrals/identify with click_id | 🔌 |

## CloudPayments, revenue and commissions

| Capability | Status |
|---|---|
| Pay webhook | ✅ |
| Refund webhook | ✅ |
| Cancel webhook | ✅ |
| Content-HMAC / X-Content-HMAC verification | ✅ |
| Idempotent webhook processing | ✅ |
| AccountId attribution | ✅ adapter |
| SubscriptionId / recurring tracking | ✅ |
| InvoiceId storage | ✅ |
| Separate commission per successful payment | ✅ |
| Partial refund | ✅ |
| Refund after payout | ✅ immutable negative future-balance entry |
| Refund reverses the actual original commission, not today's rate | ✅ |
| Cancel reverses only remaining commission after prior refunds | ✅ |
| Commission hold / maturation | ✅ |
| Pending / approved / paid ledger | ✅ |
| Fixed and percentage rules | ✅ |
| Generic revenue API | ✅ |

## Manual payouts

| Capability | Status |
|---|---|
| Approved/unassigned commission selection | ✅ |
| Minimum payout | ✅ |
| Payout batch + PayoutItem | ✅ |
| Partner payout details | ✅ |
| Admin UI to prepare payout | ✅ |
| Admin UI to mark Paid + reference | ✅ |
| Partner payout history | ✅ |
| Invoice records linked to payouts | ✅ |
| Notifications/webhooks on READY and PAID | ✅ |
| Stripe/PayPal/Wise auto-payout | 🚫 manual payouts are a product requirement |

## Admin CRM

| Module | Status |
|---|---|
| Dashboard | ✅ live DB |
| Partners | ✅ live DB |
| Partner detail/edit | ✅ |
| Batch partner API | ✅ |
| Customers | ✅ |
| Customer detail | ✅ |
| Transactions | ✅ |
| Commissions | ✅ |
| Refunds | ✅ |
| Payouts | ✅ |
| Programs | ✅ |
| Partner groups | ✅ |
| Commission rules | ✅ |
| Coupons | ✅ |
| Marketing resources | ✅ |
| Invoices | ✅ |
| Reports | ✅ |
| Cohort report | ✅ |
| CSV exports | ✅ |
| Saved reports | ✅ |
| Scheduled report definitions | ✅ |
| Scheduled report runner endpoint | ✅ |
| Email templates/logs/test | ✅ |
| API keys | ✅ |
| API usage analytics | ✅ |
| Outgoing webhooks | ✅ |
| Webhook test/trigger/retry | ✅ |
| Integration settings | ✅ |
| Team roles | ✅ |
| Audit log | ✅ |
| Program settings / policy flags | ✅ |

## Partner portal

| Module | Status |
|---|---|
| Dashboard | ✅ live DB |
| Customers/referrals | ✅ live DB |
| Analytics | ✅ live DB |
| Payouts | ✅ live DB |
| Marketing resources | ✅ live DB |
| Profile and payout details | ✅ editable |
| Referral code | ✅ editable when policy permits |
| Notification preferences | ✅ |
| Notification center | ✅ |
| Branding/program options API | ✅ |

## Authentication and security

| Capability | Status |
|---|---|
| Partner registration | ✅ |
| Password login | ✅ bcrypt |
| OTP login/verification | ✅ hashed OTP |
| OTP rate limiting / cleanup | ✅ |
| ADMIN / PARTNER separation | ✅ |
| httpOnly JWT session cookie | ✅ |
| Admin browser session auth | ✅ |
| Server-to-server ADMIN_API_KEY | ✅ |
| SYNTOLK_INTERNAL_API_KEY | ✅ |
| DB rate limits | ✅ |
| API key scopes / expiry / rate limit | ✅ |
| Raw API key shown once and only hash stored | ✅ |
| Salted IP hashes | ✅ |
| Webhook SSRF protection | ✅ |
| Outgoing webhook HMAC signing | ✅ |
| Auto-disable after repeated webhook failures | ✅ |
| Business-email policy | ✅ |
| Country / keyword / ad-source blocking | ✅ |

## Reporting and notifications

| Capability | Status |
|---|---|
| Admin performance report | ✅ |
| Partner performance report | ✅ |
| Cohorts | ✅ |
| CSV export | ✅ |
| Scheduled report runner | ✅ |
| External scheduler/cron calling runner | 🔌 |
| DB email templates | ✅ |
| Email logs | ✅ |
| Resend integration | ✅ |
| In-app notifications | ✅ |
| Financial-event notifications | ✅ |

## API / integration

| Capability | Status |
|---|---|
| Versioned API | ✅ /api/v1 |
| Referral attribution API | ✅ |
| Revenue API | ✅ |
| Coupon validation API | ✅ |
| API docs endpoint | ✅ |
| API keys and usage logs | ✅ |
| Public tracking endpoint | ✅ |
| Trusted identify endpoint | ✅ |
| Outgoing event webhooks | ✅ |
| Short redirect links | ✅ |

## Verification

- GitHub Actions runs Prisma generate, TypeScript check, regression tests and production Next.js build.
- Regression tests cover CloudPayments HMAC, body parsing, event idempotency-key construction, commission rule precedence/fallbacks and proportional refund reversal.
- Authenticated admin/partner route segments are force-dynamic so production builds do not require a live database during prerender.
- Main CRM/partner pages no longer use lib/demo-data; the obsolete file was removed.

## Intentionally not copied from Refferq

- Refferq branding/assets and generic component bundle.
- Stripe Connect, PayPal, Wise or other automated payout flows.
- Refferq currency defaults and hard-coded values.
- Raw IP storage.
- Emailing generated passwords.

## Production integration checklist

These are deployment/integration tasks, not missing Refferq features in this repository:

1. 🔌 Configure production PostgreSQL and create/apply a Prisma migration (the repository currently has the schema but no committed migration directory).
2. 🔌 Configure JWT_SECRET, CloudPayments secret, internal/admin keys, IP hash salt and Resend credentials.
3. 🔌 Add the Syntolk main-app signup/login integration that sends the captured click_id and authoritative Syntolk user ID to /api/referrals/identify.
4. 🔌 Configure CloudPayments Pay/Refund/Cancel notification URLs to this service.
5. 🔌 Configure an external scheduler/cron to call /api/admin/scheduled-reports/run and maintenance endpoints.
6. 🔌 Run real CloudPayments test-mode webhook fixtures against the deployed URL.
7. 🔌 Add database-backed end-to-end tests for duplicate webhook delivery, partial refund after payout, payout batching and role/access boundaries; current CI already covers core pure logic.
