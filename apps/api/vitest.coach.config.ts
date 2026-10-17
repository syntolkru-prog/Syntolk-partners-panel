import { defineConfig } from 'vitest/config';
import { assertIsolatedCoachDatabase } from './src/coach/test-guard.js';
assertIsolatedCoachDatabase(process.env.DATABASE_URL ?? '', process.env.COACH_WORKING_DB);
export default defineConfig({ test: { fileParallelism: false, include: ['src/coach/__tests__/*.test.ts', 'src/__tests__/partner-messages.test.ts'], testTimeout: 30000, hookTimeout: 30000 } });
