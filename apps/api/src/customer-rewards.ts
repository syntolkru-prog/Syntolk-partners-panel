/**
 * Customer reward hook for the Syntolk/CloudPayments integration.
 *
 * Coupon attribution remains local and provider-neutral. CloudPayments
 * discount provisioning is intentionally not guessed here: the merchant
 * checkout must decide how a coupon is applied and pass the resulting order
 * metadata to the payment notification. Legacy provider ID columns remain
 * nullable for importing old data.
 */

import type { CustomerReward } from '@openpartner/db';

export interface ProvisionedReward {
  stripeCouponId: string;
  stripePromotionCodeId: string;
}

/** The local build keeps the coupon in Syntolk and does not call a provider. */
export async function provisionCustomerReward(
  _reward: CustomerReward,
  _code: string,
  _campaignName: string,
): Promise<ProvisionedReward | null> {
  return null;
}

/** Provider-neutral deactivation hook kept for old coupon rows. */
export async function deactivateCustomerReward(_providerPromotionCodeId: string): Promise<void> {
  return;
}
