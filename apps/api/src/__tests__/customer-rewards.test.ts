/**
 * Syntolk customer-reward contract.
 *
 * The local build keeps the reward definition and coupon attribution in its
 * own database. It deliberately does not call Stripe or another payment
 * provider while minting a coupon; the checkout/payment notification is the
 * provider boundary.
 */

import { describe, expect, it } from 'vitest';
import { provisionCustomerReward } from '../customer-rewards.js';

describe('provisionCustomerReward', () => {
  it('does not call an external provider for a percent discount', async () => {
    const result = await provisionCustomerReward(
      { type: 'percent_off', value: 25, duration: 'repeating', durationInMonths: 6 },
      'SYNTOLK25',
      'Syntolk Demo',
    );
    expect(result).toBeNull();
  });

  it('does not call an external provider for a fixed discount', async () => {
    const result = await provisionCustomerReward(
      { type: 'amount_off', value: 200, currency: 'RUB', duration: 'once' },
      'SYNTOLK200',
      'Syntolk Demo',
    );
    expect(result).toBeNull();
  });

  it('does not call an external provider for free months', async () => {
    const result = await provisionCustomerReward(
      { type: 'free_months', value: 2, duration: 'repeating' },
      'SYNTOLKFREE',
      'Syntolk Demo',
    );
    expect(result).toBeNull();
  });
});
