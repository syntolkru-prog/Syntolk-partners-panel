import './env.js';
import { db, appDb } from './db.js';
import { startCoachWorker } from './coach/worker.js';
const stop = startCoachWorker();
console.log('[coach] worker started; reminders:', process.env.COACH_SCHEDULER_ENABLED === '1');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void stop().then(async () => { await db.destroy(); await appDb.destroy(); process.exit(0); }); });
