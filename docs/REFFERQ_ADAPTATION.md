# Refferq → Syntolk Partners adaptation

Syntolk Partners uses selected ideas and implementation patterns from the MIT-licensed Refferq project.

Source: https://github.com/Refferq/Refferq  
License notice: see `THIRD_PARTY_NOTICES.md`.

## Reused / adapted concepts

- Admin / affiliate separation
- Partner approval workflow
- Partner groups and custom commission rates
- Program settings
- Manual payout batches
- Marketing resources
- Referral tracking
- Audit log
- Dashboard aggregates
- Commission maturation / hold period

## Replaced for Syntolk

### Payment provider

Refferq payment-specific behavior is not used. Syntolk uses CloudPayments.

Implemented endpoints:

- `POST /api/webhooks/cloudpayments/pay`
- `POST /api/webhooks/cloudpayments/refund`
- `POST /api/webhooks/cloudpayments/cancel`

All notification handlers validate CloudPayments HMAC signatures and use idempotency keys.

### Recurring commissions

Syntolk does not model one affiliate customer as one commission.

Instead:

```text
Partner
  -> Referral (Syntolk user)
      -> Payment 1 -> EARNING ledger entry
      -> Payment 2 -> EARNING ledger entry
      -> Payment 3 -> EARNING ledger entry
      -> Refund    -> negative REFUND ledger entry
```

This supports recurring subscriptions without overwriting previous commission history.

### Refunds after payout

Paid history is immutable. If a customer receives a refund after the affiliate has already been paid, Syntolk creates a negative approved ledger entry. It is carried into a later payout balance.

### Payouts

No automatic payment provider is used.

```text
APPROVED commission entries
        ↓
manual payout batch
        ↓
READY
        ↓
administrator transfers money outside the system
        ↓
reference / note recorded
        ↓
PAID
```

### Attribution

Public click capture:

`POST /api/referrals/capture`

Trusted Syntolk backend identifies the registered account:

`POST /api/referrals/identify`

A previously attributed user is not reassigned by a later click in the current first-touch model.

## Temporary security boundary

Until this repository is connected to the main Syntolk authentication system:

- admin APIs require `ADMIN_API_KEY`;
- identify API requires `SYNTOLK_INTERNAL_API_KEY`;
- CloudPayments webhooks require their HMAC signatures;
- IP addresses are stored only as salted hashes.

These API keys are temporary integration guards, not the final user authentication model.
