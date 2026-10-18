/**
 * Identify is a trusted backend call and uses the normal origin allowlist.
 */

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

const app = createApp({ enableLogger: false });

describe('identify CORS restrictions', () => {
  it('does not allow an arbitrary browser origin', async () => {
    const res = await request(app)
      .options('/attribution/identify')
      .set('Origin', 'https://xispark.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('covers the tenant-scoped path shapes', async () => {
    for (const path of ['/t/xispark/attribution/identify', '/api/t/xispark/attribution/identify']) {
      const res = await request(app)
        .options(path)
        .set('Origin', 'https://brand-site.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('does NOT open any other route — the strict allowlist still governs', async () => {
    for (const path of ['/attribution/events', '/partners', '/t/xispark/config/program']) {
      const res = await request(app)
        .options(path)
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});
