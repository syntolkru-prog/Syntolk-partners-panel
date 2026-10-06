import { defineConfig } from 'vitest/config';

// Integration tests share a single Postgres database and truncate
// tables in beforeEach. Running files in parallel causes truncate
// races against each other. Serialize for correctness.
export default defineConfig({
  test: {
    fileParallelism: false,
    setupFiles: ['src/__tests__/setup-env.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // These suites exercise the removed hosted Stripe/funding rail. Keep
    // their source history in the repository, but do not load it as part of
    // the Syntolk self-host test contract: those modules intentionally no
    // longer exist in the production build.
    exclude: [
      'src/__tests__/billing-reconcile.test.ts',
      'src/__tests__/funding-*.test.ts',
      'src/__tests__/network-payouts-report.test.ts',
      'src/__tests__/operator-recovery.test.ts',
      'src/__tests__/payout-transfer-intent.test.ts',
      'src/__tests__/recovery-routes.test.ts',
      'src/__tests__/stripe-webhook*.test.ts',
      'src/__tests__/usage-billing.test.ts',
      'src/__tests__/usage-gmv-types.test.ts',
      'dist/**',
      'node_modules/**',
    ],
  },
});
