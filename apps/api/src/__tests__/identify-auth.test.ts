import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ulid } from 'ulid';
import { DEFAULT_TENANT_ID as tenantId, TABLES } from '@openpartner/db';
import { createApp } from '../app.js';
import { createApiKeyRow } from '../auth.js';
import { db, appDb } from '../db.js';
import { assertIsolatedCoachDatabase } from '../coach/test-guard.js';

const skip = !process.env.DATABASE_URL || process.env.INTEGRATION === 'skip';
if (!skip) assertIsolatedCoachDatabase(process.env.DATABASE_URL!, process.env.COACH_WORKING_DB);
const adminKey = 'identify-security-test-admin';
process.env.ADMIN_API_KEY = adminKey;
const app = createApp({ enableLogger: false });
const auth = { Authorization: `Bearer ${adminKey}` };
afterAll(async () => { await Promise.all([db.destroy(), appDb.destroy()]); });

describe.skipIf(skip)('trusted identity binding', () => {
  it('rejects anonymous and partner binding; accepts only the event-write integration and admin', async () => {
    const partner = await request(app).post('/partners').set(auth).send({ email: `${ulid()}@example.test`, name: 'Identity test', sendInvite: false });
    expect(partner.status).toBe(201);
    const program = await request(app).post('/programs').set(auth).send({ name: 'Identity test', commissionRule: { type: 'percent', value: 20 }, destinationUrl: 'https://example.test' });
    expect(program.status).toBe(201);
    const link = await request(app).post(`/partners/${partner.body.id}/links`).set(auth).send({ programId: program.body.id, linkKey: `identify-${ulid()}` });
    expect(link.status).toBe(201);
    const cref = ulid(), userId = ulid();
    await db(TABLES.Click).insert({ id: cref, tenantId, linkId: link.body.id, partnerId: partner.body.id, programId: program.body.id, landingUrl: 'https://example.test', ipHash: 'test' });
    const partnerKey = await createApiKeyRow(db, { tenantId, partnerId: partner.body.id });
    const readKey = await createApiKeyRow(db, { tenantId, scopes: ['partners:read'] });
    const writerKey = await createApiKeyRow(db, { tenantId, scopes: ['events:write'] });
    const bind = (key?: string) => {
      const req = request(app).post('/attribution/identify');
      return (key ? req.set('Authorization', `Bearer ${key}`) : req).send({ cref, userId });
    };
    expect((await bind()).status).toBe(401);
    expect((await bind(partnerKey.plaintext)).status).toBe(403);
    expect((await bind(readKey.plaintext)).status).toBe(403);
    expect(await db(TABLES.Identity).where({ clickId: cref })).toHaveLength(0);
    expect((await bind(writerKey.plaintext)).status).toBe(200);
    const replay = await bind(adminKey);
    expect(replay.status).toBe(200);
    expect(replay.body.firstStitch).toBe(false);
    expect(await db(TABLES.Identity).where({ clickId: cref, userId })).toHaveLength(1);
  });
});
