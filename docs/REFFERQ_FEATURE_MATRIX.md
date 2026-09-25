# Refferq → Syntolk Partners feature matrix

This document is the migration checklist for Refferq functionality. The goal is not to clone Refferq blindly: every useful capability is either implemented, adapted to Syntolk, or explicitly excluded with a reason.

Legend: ✅ implemented/adapted · 🟡 UI/backend integration still being finished · 🚫 intentionally not used.

## Core partner program

| Refferq capability | Syntolk implementation | Status |
|---|---|---|
| Affiliate applications | Account + Partner with PENDING/ACTIVE/SUSPENDED/REJECTED | ✅ |
| Affiliate approval/rejection | Admin partner API + audit log | ✅ |
| Unique referral code | Partner.code + generate-code API | ✅ |
| Referral links | syntolk.ru/?ref={code} / capture API | ✅ |
| Cookie / attribution window | Partner.cookieDays / Program.cookieDays | ✅ |
| Partner groups | PartnerGroup with commission + cookie overrides | ✅ |
| Custom partner commission | Partner.commissionRate | ✅ |
| Multiple programs | Program model + program relation | ✅ |
| Program-level commission | Program.commissionRate | ✅ |
| Commission rules | CommissionRule: percentage/fixed + JSON conditions + priority | ✅ |
| Manual lead submission | Optional partner referral POST controlled by ProgramSettings | ✅ |
| Referral statuses | CAPTURED / REGISTERED / ACTIVE / CANCELED | ✅ |
| First-touch attribution | clickId -> externalUserId, no reassignment after attribution | ✅ |
| Click tracking | ReferralClick | ✅ |
| UTM/source tracking | source/medium/campaign/content/term | ✅ |
| Fraud checks | bot marker + click-frequency scoring + salted IP hash | ✅ |
| Self-referral setting | ProgramSettings.selfReferralBlocked | 🟡 requires Syntolk main-user identity link to enforce perfectly |

## Revenue, recurring and commissions

| Refferq capability | Syntolk implementation | Status |
|---|---|---|
| Conversion/revenue records | Payment ledger | ✅ |
| Recurring subscriptions | Every CloudPayments payment creates its own Payment + EARNING commission | ✅ |
| Percentage commissions | Commission.rate | ✅ |
| Fixed commission rules | CommissionRule FIXED | ✅ |
| Commission hold/maturation | availableAt + /api/admin/commissions/mature | ✅ |
| Pending/approved/paid | CommissionStatus | ✅ |
| Refund clawback | negative REFUND commission entry | ✅ |
| Refund after payout | immutable history; negative future balance | ✅ |
| Transaction history | /api/admin/transactions | ✅ |
| Refund history | /api/admin/refunds | ✅ |
| Estimated/manual referrals | Referral.metadata | ✅ |
| Automated payout engine | intentionally removed; user requires manual payouts | 🚫 |
| Stripe Connect / PayPal mass payout | not used | 🚫 |

## CloudPayments adaptation

| Capability | Status |
|---|---|
| Pay webhook | ✅ |
| Refund webhook | ✅ |
| Cancel webhook | ✅ |
| Content-HMAC / X-Content-HMAC validation | ✅ |
| Idempotent webhook processing | ✅ |
| AccountId -> attributed Syntolk user | ✅ adapter ready |
| SubscriptionId storage | ✅ |
| InvoiceId storage | ✅ |
| Partial refunds | ✅ |
| Manual payouts independent from payment provider | ✅ |

## Manual payouts

| Refferq capability | Syntolk implementation | Status |
|---|---|---|
| Payout batches | Payout + PayoutItem | ✅ |
| Approved commission selection | only APPROVED/unassigned entries | ✅ |
| Minimum payout | configurable | ✅ |
| Payout method/details | Partner.payoutDetails + Payout.method | ✅ |
| Mark paid | READY -> PAID with reference/note | ✅ |
| Payout history | partner payout API | ✅ |
| Invoice linked to payout | Invoice.payoutId | ✅ |

## Admin panel modules

| Refferq admin screen | Syntolk equivalent | Status |
|---|---|---|
| Dashboard | /admin | ✅ |
| Partners | /admin/partners | ✅ |
| Partner detail | API/model ready; detailed UI being expanded | 🟡 |
| Customers | referrals + payments customer view | 🟡 |
| Payouts | /admin/payouts | ✅ |
| Program settings | /admin/settings | ✅ |
| Programs | /api/admin/programs + screen | 🟡 |
| Partner groups | /api/admin/partner-groups | ✅ |
| Commission rules | /api/admin/commission-rules | ✅ |
| Transactions | /api/admin/transactions | ✅ |
| Refunds | /api/admin/refunds | ✅ |
| Coupons | /api/admin/coupons | ✅ |
| Invoices | /api/admin/invoices | ✅ |
| Resources | /api/admin/resources | ✅ |
| Reports | /api/admin/reports | ✅ |
| Saved reports | /api/admin/saved-reports | ✅ |
| Scheduled reports | /api/admin/scheduled-reports | ✅ data/control plane |
| Emails | /api/admin/emails | ✅ |
| Email test | /api/admin/emails/test | ✅ |
| API keys | /api/admin/api-keys | ✅ |
| API usage analytics | /api/admin/api-usage | ✅ |
| Outgoing webhooks | /api/admin/webhooks | ✅ |
| Integration settings | /api/admin/integration | ✅ |
| Team | /api/admin/team | ✅ |
| Audit log | AuditLog | ✅ |

## Partner portal modules

| Refferq affiliate screen | Syntolk equivalent | Status |
|---|---|---|
| Dashboard | /partner + /api/partner/dashboard | ✅ |
| Referrals/customers | /partner/referrals + API | ✅ |
| Payouts | /partner/payouts + API | ✅ |
| Resources | /partner/resources + API | ✅ |
| Reports | /api/partner/reports + screen | 🟡 |
| Settings/profile | /api/partner/profile + screen | 🟡 |
| Referral code generation | /api/partner/generate-code | ✅ |
| Branding | /api/partner/branding | ✅ |
| Notifications | /api/partner/notifications | ✅ |

## Authentication and security

| Refferq capability | Syntolk implementation | Status |
|---|---|---|
| Registration | partner application registration | ✅ |
| Password login | bcrypt + JWT httpOnly cookie | ✅ |
| OTP login/verification | hashed 6-digit OTP + expiration/attempts | ✅ |
| Role separation | ADMIN / PARTNER | ✅ |
| Pending partner approval | separate account verification and partner approval | ✅ |
| Rate limiting | DB-backed rate limits | ✅ |
| API scopes/rate limit | ApiKey.scopes/rateLimit | ✅ |
| Sensitive API key hashing | SHA-256, secret shown once | ✅ |
| IP privacy | salted hashes instead of raw IP | ✅ |
| Admin browser auth | session role protection | ✅ |
| Server-to-server admin access | ADMIN_API_KEY fallback | ✅ |
| Syntolk internal identify access | SYNTOLK_INTERNAL_API_KEY | ✅ |

## Email / notifications

| Capability | Status |
|---|---|
| DB email templates | ✅ |
| Email send logs | ✅ |
| Resend integration | ✅ |
| Partner application message | ✅ |
| OTP email | ✅ |
| Commission/payout/refund template types | ✅ |
| In-app notifications model/API | ✅ |
| Notification UI center | 🟡 |

## Developer / integration features

| Capability | Status |
|---|---|
| API keys | ✅ |
| API usage logs | ✅ |
| Rate limits | ✅ |
| Integration settings | ✅ |
| Outgoing webhook subscriptions | ✅ |
| HMAC webhook signing | ✅ |
| Webhook delivery logs | ✅ |
| SSRF protection for webhook URLs | ✅ |
| Auto-disable after repeated failures | ✅ |
| Public referral capture API | ✅ |
| Trusted identify API | ✅ |

## Reporting

| Capability | Status |
|---|---|
| Admin date-range performance report | ✅ |
| Per-partner report | ✅ |
| Saved report definitions | ✅ |
| Scheduled report definitions | ✅ |
| Cohort report | 🟡 |
| CSV export | 🟡 |
| Scheduled email execution worker | 🟡 deployment cron/worker required |

## Assets/UI consciously not copied

- Refferq branding, logos and marketing assets: 🚫 replaced by Syntolk.
- Refferq's old frontend/submodule: 🚫 not needed.
- Large generic shadcn component bundle: 🚫 only UI primitives needed by Syntolk should be added.
- Stripe/PayPal/Wise automated payout code: 🚫 manual payouts are a product requirement.
- Refferq's hard-coded currencies/defaults: 🚫 replaced with RUB/Syntolk settings.
- Refferq's raw-IP fraud storage: 🚫 replaced by salted hashes.
- Refferq's practice of emailing generated passwords: 🚫 replaced by password registration + OTP verification.

## Remaining completion items before production

1. Connect real Syntolk user/account repository and enforce self-referral using authoritative user identity.
2. Replace remaining preview data in React pages with live API calls.
3. Add cohort report/export worker and scheduled report runner.
4. Seed default email templates/program/settings.
5. Add Prisma migration and production PostgreSQL deployment.
6. Add automated tests for attribution, duplicate webhooks, recurring payment, partial refund, refund after paid payout, payout batching and access control.
7. Final security review and CloudPayments fixture tests.
