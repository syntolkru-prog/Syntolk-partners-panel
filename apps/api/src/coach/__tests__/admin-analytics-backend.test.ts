import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ulid } from 'ulid';
import { DEFAULT_TENANT_ID as tenantId } from '@openpartner/db';
import { createApp } from '../../app.js';
import { db, appDb } from '../../db.js';
import { createApiKeyRow } from '../../auth.js';
import { assertIsolatedCoachDatabase } from '../test-guard.js';

assertIsolatedCoachDatabase(process.env.DATABASE_URL!, process.env.COACH_WORKING_DB);
if (new URL(process.env.DATABASE_URL!).pathname !== '/syntolk_coach_test_20261012' || process.env.INTEGRATION !== 'run') throw new Error('Use the approved isolated integration runner.');
const app = createApp({ enableLogger: false });
const admin = () => `Bearer ${process.env.ADMIN_API_KEY}`;
const get = (path: string) => request(app).get(path).set('Authorization', admin());
const post = (path: string, body = {}) => request(app).post(path).set('Authorization', admin()).send(body);
afterAll(async () => { await Promise.all([db.destroy(), appDb.destroy()]); });

async function fixture() {
  const prefix = `admin-backend-${ulid()}`;
  const partner = await post('/partners', { name: `${prefix} A`, email: `${ulid()}@example.test`, sendInvite: false });
  expect(partner.status, partner.text).toBe(201);
  const program = await post('/programs', { name: prefix, destinationUrl: 'https://example.test', commissionRule: { type: 'percent', value: 20, recurring: true } });
  expect(program.status, program.text).toBe(201);
  const link = await post(`/partners/${partner.body.id}/links`, { programId: program.body.id, linkKey: `backend-${ulid()}` });
  expect(link.status, link.text).toBe(201);
  const partnerId = partner.body.id as string, userId = ulid();
  const click = async (extra = {}) => {
    const id = ulid();
    const response = await post('/clicks', { id, linkKey: link.body.linkKey, landingUrl: 'https://example.test', ts: new Date(Date.now()-1000).toISOString(), ...extra });
    expect(response.status, response.text).toBe(201); return id;
  };
  const pay = async () => {
    const identified = await post('/attribution/identify', { cref: await click(), userId }); expect(identified.status, identified.text).toBe(200);
    const externalEventId = ulid();
    const paid = await post('/payments/events', { userId, value: 1000, currency: 'RUB', externalEventId });
    expect(paid.status, paid.text).toBe(201); return { eventId: paid.body.eventId as string, externalEventId };
  };
  const query = `partnerId=${partnerId}&period=all`;
  return { prefix, partnerId, userId, programId: program.body.id as string, click, pay, query };
}

describe('admin analytics backend authorization, pagination, diagnostics and query budget', () => {
  it('serves canonical overview metrics and source definitions without loading lifetime payouts or scenario records',async()=>{
    const f=await fixture();await f.pay();
    const base=`${f.query}&includeSeries=true&timezone=UTC&until=${encodeURIComponent(new Date(Date.now()+1000).toISOString())}`;
    const full=await get(`/admin/analytics?${base}`);expect(full.status,full.text).toBe(200);
    const queries:string[]=[],listener=(q:{sql:string})=>queries.push(q.sql);appDb.on('query',listener);
    let overview;try{overview=await get(`/admin/analytics?${base}&view=summary`);}finally{appDb.removeListener('query',listener);}
    expect(overview.status,overview.text).toBe(200);
    for(const key of ['counts','amountsMinor','conversions','period','series','currency','timezone'])expect(overview.body[key]).toEqual(full.body[key]);
    expect(overview.body.balances).toBeUndefined();expect(overview.body.options.scenarios).toEqual([]);
    expect(queries.some(sql=>/"Payout"/.test(sql))).toBe(false);
    expect(overview.body.options.formats.some((format:any)=>format.id==='circle')).toBe(true);
    expect(overview.body.selectedPartners).toEqual([{id:f.partnerId,name:`${f.prefix} A`}]);
  });

  it('filters empty partners by actual period activity and includes them only on request',async()=>{
    const f=await fixture();await f.pay();const emptyId=ulid();await db('Partner').insert({id:emptyId,tenantId,name:'Active but empty',email:`${ulid()}@example.test`,activatedAt:new Date()});
    const q=new URLSearchParams({period:'all',activity:'results'});q.append('partnerIds',f.partnerId);q.append('partnerIds',emptyId);
    const active=await get(`/admin/analytics/partners?${q}`);expect(active.status,active.text).toBe(200);
    expect(active.body.items.map((p:any)=>p.id)).toEqual([f.partnerId]);expect(active.body.items[0].counts.paymentCount).toBe(1);
    expect(active.body.items[0].balances).toBeUndefined();expect(active.body.summary).toEqual({partners:2,activePartners:1});
    q.set('activity','all');const all=await get(`/admin/analytics/partners?${q}`);expect(all.body.items).toHaveLength(2);
    expect(all.body.items.find((p:any)=>p.id===emptyId).counts.clicks).toBe(0);
  });

  it('compares named partners and preserves the click owner and public link key in history',async()=>{
    const a=await fixture(),b=await fixture();await a.pay();await b.pay();
    const q=new URLSearchParams({period:'all',view:'summary',includeSeries:'true',seriesBy:'partner',timezone:'UTC'});q.append('partnerIds',a.partnerId);q.append('partnerIds',b.partnerId);
    const report=await get(`/admin/analytics?${q}`);expect(report.status,report.text).toBe(200);
    expect(report.body.series.groups.map((g:any)=>g.name).sort()).toEqual([`${a.prefix} A`,`${b.prefix} A`].sort());
    const history=await get(`/admin/analytics/details?${a.query}`);expect(history.status,history.text).toBe(200);
    const click=history.body.history.items.find((item:any)=>item.kind==='click');expect(click.partnerNames).toEqual([`${a.prefix} A`]);expect(click.linkKeys[0]).toMatch(/^backend-/);
    expect(history.text).not.toContain('userId');expect(history.text).not.toContain('email');
  });

  it('adapts the legacy timeseries to the same refund and fraud rules',async()=>{
    const f=await fixture(),paid=await f.pay();await f.click({fraudFlag:'manual'});
    expect((await post('/payments/refunds',{originalExternalEventId:paid.externalEventId,refundExternalEventId:ulid(),amount:500})).status).toBe(201);
    const query=`since=${encodeURIComponent(new Date(Date.now()-86400000).toISOString())}&until=${encodeURIComponent(new Date(Date.now()+1000).toISOString())}`;
    const old=await get(`/partners/${f.partnerId}/timeseries?${query}`);expect(old.status,old.text).toBe(200);
    expect(old.body.buckets.reduce((n:number,row:any)=>n+row.clicks,0)).toBe(1);
    expect(old.body.buckets.reduce((n:number,row:any)=>n+row.earnings,0)).toBe(100);
    expect(old.body.buckets.reduce((n:number,row:any)=>n+row.revenue,0)).toBe(1000);
  });

  it('requires admin credentials on all four routes; partner and scoped read keys cannot promote themselves', async () => {
    const f = await fixture();
    const partner = await createApiKeyRow(db, { tenantId, partnerId: f.partnerId });
    const scoped = await createApiKeyRow(db, { tenantId, scopes: ['partners:read'] });
    for (const path of ['/admin/analytics', '/admin/analytics/details', '/admin/analytics/partners', '/admin/overview']) {
      expect((await request(app).get(path)).status).toBe(401);
      for (const token of [partner.plaintext, scoped.plaintext]) expect((await request(app).get(path).set('Authorization', `Bearer ${token}`)).status).toBe(403);
    }
    const accepted = await get(`/admin/analytics?${f.query}`); expect(accepted.status, accepted.text).toBe(200);
  });

  it.each(['page=0', 'page=oops', 'pageSize=101', 'limit=0', 'sort=arbitrary_sql', 'direction=sideways', 'groupBy=unknown', 'currency=all', 'period=custom&from=2026-02-30&to=2026-03-02'])('rejects malformed report input: %s', async query => {
    const response = await get(`/admin/analytics?${query}`); expect(response.status, response.text).toBe(400); expect(response.body.error).toBe('invalid_query');
  });

  it('bounds the combined OR selection at 50 and rejects malformed cursors and option page sizes', async () => {
    const query = new URLSearchParams(); for (let i = 0; i < 51; i++) query.append('partnerIds', `partner-${i}`);
    expect((await get(`/admin/analytics?${query}`)).status).toBe(400);
    query.delete('partnerIds'); for (let i = 0; i < 50; i++) query.append('partnerIds', `partner-${i}`); query.append('partnerId', 'one-more');
    expect((await get(`/admin/analytics?${query}`)).status).toBe(400);
    expect((await get('/admin/analytics/details?cursor=bad-json')).status).toBe(400);
    expect((await get('/admin/analytics/partners?pageSize=51')).status).toBe(400);
  });

  it('searches, sorts and pages partner rows in SQL while retaining the full summary and bounded options', async () => {
    const f = await fixture(); await f.pay();
    const others = Array.from({ length: 24 }, (_, i) => ({ id: ulid(), tenantId, name: `${f.prefix} ${String(i+1).padStart(2,'0')}`, email: `${ulid()}@example.test`, activatedAt: new Date() }));
    await db('Partner').insert(others);
    const selection = new URLSearchParams({ period: 'all', sort: 'name', direction: 'asc', pageSize: '5' });
    for (const id of [f.partnerId, ...others.map(p => p.id)]) selection.append('partnerIds', id);
    const first = await get(`/admin/analytics?${selection}`); expect(first.status, first.text).toBe(200);
    expect(first.body.rows).toHaveLength(5); expect(first.body.partnerTable.rows).toHaveLength(5);
    expect(first.body.pagination).toMatchObject({ page: 1, pageSize: 5, total: 25, totalPages: 5 });
    expect(first.body.summary).toEqual({ partners: 25, activePartners: 1 });
    expect(first.body.rows.map((row: any) => row.name)).toEqual(others.slice(0,5).map(p => p.name));
    expect(first.body.rows[0]).toMatchObject({ email: others[0].email, status: 'active', balances: { debt: 0 } });
    selection.set('page', '2'); const second = await get(`/admin/analytics?${selection}`); expect(second.status, second.text).toBe(200);
    expect(new Set([...first.body.rows, ...second.body.rows].map((row: any) => row.id)).size).toBe(10);
    expect(second.body.counts).toEqual(first.body.counts); expect(second.body.amountsMinor).toEqual(first.body.amountsMinor);
    selection.set('search', `${f.prefix} A`); selection.set('page', '1'); const searched = await get(`/admin/analytics?${selection}`);
    expect(searched.status, searched.text).toBe(200); expect(searched.body.rows.map((row: any) => row.id)).toEqual([f.partnerId]);
    expect(searched.body.pagination.total).toBe(1); expect(searched.body.summary).toEqual(first.body.summary);
    expect(searched.body.counts).toEqual(first.body.counts);
    const options = await get(`/admin/analytics/partners?search=${f.prefix}&pageSize=7&page=2`); expect(options.status, options.text).toBe(200);
    expect(options.body.items).toHaveLength(7); expect(options.body.pagination).toEqual({ page: 2, pageSize: 7, total: 25, totalPages: 4 });
    const drill = await get(`/admin/analytics?${selection}&groupBy=link`); expect(drill.status, drill.text).toBe(200);
    expect(drill.body.groupBy).toBe('link'); expect(drill.body.rows[0].counts.clicks).toBe(1);
    expect(drill.body.partnerTable.rows.map((row: any) => row.id)).toEqual([f.partnerId]);
  });

  it('keeps unknown and foreign partners, profiles and picker results outside the tenant response', async () => {
    const otherTenantId = `analytics-${ulid()}`, foreignPartnerId = ulid(), foreignName = `foreign-${ulid()}`;
    await db('Tenant').insert({ id: otherTenantId, slug: otherTenantId.toLowerCase(), displayName: 'Foreign analytics', status: 'active' });
    await db('Partner').insert({ id: foreignPartnerId, tenantId: otherTenantId, name: foreignName, email: `${foreignPartnerId}@example.test` });
    try {
      for (const id of [foreignPartnerId, ulid()]) {
        const response = await get(`/admin/analytics?partnerId=${id}&period=all`); expect(response.status, response.text).toBe(200);
        expect(response.body.rows).toEqual([]); expect(response.body.summary).toEqual({ partners: 0, activePartners: 0 });
        expect(response.text).not.toContain(foreignName);
        const details = await get(`/admin/analytics/details?partnerId=${id}&period=all`); expect(details.status, details.text).toBe(200);
        expect(details.body.history.items).toEqual([]);
      }
      const options = await get(`/admin/analytics/partners?search=${foreignName}`); expect(options.status, options.text).toBe(200); expect(options.body.items).toEqual([]);
    } finally { await db('Partner').where({ id: foreignPartnerId, tenantId: otherTenantId }).del(); await db('Tenant').where({ id: otherTenantId }).del(); }
  });

  it('reports scoped exclusions, legacy IDs, refund adjustments and lifetime debt without claiming production verification', async () => {
    const f = await fixture(), previous = await db('Tenant').where({ id: tenantId }).first();
    await db('Tenant').where({ id: tenantId }).update({ payoutThresholdCents: 0 });
    try {
      const paid = await f.pay();
      const commission = await db('Commission').where({ tenantId, partnerId: f.partnerId }).first();
      expect((await post(`/commissions/${commission.id}/approve`)).status).toBe(200);
      const planned = await post('/payouts/run', { partnerId: f.partnerId }); expect(planned.status, planned.text).toBe(200);
      expect((await post(`/payouts/${planned.body.payouts[0].payoutId}/confirm`)).status).toBe(200);
      const refund = await post('/payments/refunds', { originalExternalEventId: paid.externalEventId, refundExternalEventId: ulid(), amount: 500 }); expect(refund.status, refund.text).toBe(201);
      await f.click({ fraudFlag: 'manual' });
      // Reproduce a historical row missing its provider ID after creating it through the real flow.
      await db('Event').where({ tenantId, id: paid.eventId }).update({ externalEventId: null });
      const response = await get(`/admin/analytics?${f.query}`); expect(response.status, response.text).toBe(200);
      expect(response.body.diagnostics).toMatchObject({ flaggedClicks: 1, legacyFinancialEventsWithoutExternalId: 1,
        refundAdjustments: { count: 1, amountMinor: -10000 }, outstandingDebtMinor: 10000 });
      expect(response.body.dataQuality).toMatchObject({ signupTracking: 'not_verified_end_to_end', paymentTracking: 'not_verified_end_to_end', views: 'unavailable', ctr: 'unavailable' });
      expect(response.body.views).toBeNull(); expect(response.body.ctr).toBeNull();
      expect(response.body.commissionByStatus.paid).toBe(100);
      const overview = await get(`/admin/overview?${f.query}`); expect(overview.status, overview.text).toBe(200);
      expect(overview.body.totals).toMatchObject({ commissionPaid: 200, netRevenue: 400 });
      expect(overview.body.partners[0]).toMatchObject({ commission: { paid: 200 }, netRevenue: 400 });
      const scoped = await get(`/admin/analytics?${f.query}&sourceId=unknown`); expect(scoped.status, scoped.text).toBe(200);
      expect(scoped.body.diagnostics).toMatchObject({ flaggedClicks: 0, legacyFinancialEventsWithoutExternalId: 0, refundAdjustments: { count: 0, amountMinor: 0 }, outstandingDebtMinor: 10000 });
    } finally { await db('Tenant').where({ id: tenantId }).update({ payoutThresholdCents: previous.payoutThresholdCents }); }
  });

  it('paginates global graph history with tied timestamps without duplicate actions or raw personal data', async () => {
    const f = await fixture(), ts = new Date(Date.now()-1000).toISOString();
    for (let i = 0; i < 25; i++) await f.click({ ts });
    const path = `/admin/analytics/details?${f.query}`;
    const first = await get(path); expect(first.status, first.text).toBe(200); expect(first.body.history.items).toHaveLength(20);
    const second = await get(`${path}&cursor=${encodeURIComponent(first.body.history.nextCursor)}`); expect(second.status, second.text).toBe(200); expect(second.body.history.items).toHaveLength(5);
    expect(new Set([...first.body.history.items, ...second.body.history.items].map((item: any) => item.id)).size).toBe(25);
    expect(second.body.history.nextCursor).toBeNull(); expect(first.text).not.toContain('userId'); expect(first.text).not.toContain('email');
  });

  it('keeps SQL query count fixed when selection grows from one to thirty partners', async () => {
    const f = await fixture(); await f.pay();
    const others = Array.from({ length: 29 }, () => ({ id: ulid(), tenantId, name: `Query budget ${ulid()}`, email: `${ulid()}@example.test` }));
    await db('Partner').insert(others);
    const measured = async (ids: string[]) => {
      const queries: string[] = [], listener = (query: { sql: string }) => queries.push(query.sql);
      appDb.on('query', listener);
      try {
        const query = new URLSearchParams({ period: 'all', includeSeries: 'true', seriesBy: 'platform', pageSize: '5' });
        for (const id of ids) query.append('partnerIds', id);
        const response = await get(`/admin/analytics?${query}`); expect(response.status, response.text).toBe(200);
        return { response, queries };
      } finally { appDb.removeListener('query', listener); }
    };
    const one = await measured([f.partnerId]), many = await measured([f.partnerId, ...others.map(p => p.id)]);
    expect(one.queries.length).toBeGreaterThan(0);
    // The one-partner route also resolves its profile timezone once.
    expect(many.queries.length).toBeLessThanOrEqual(one.queries.length);
    expect(many.queries.length).toBeGreaterThanOrEqual(one.queries.length-1);
    expect(many.queries.length).toBeLessThan(65);
    expect(many.response.body.rows).toHaveLength(5); expect(many.response.body.pagination.total).toBe(30);
    expect(many.queries.some(sql => /order by.*limit/is.test(sql))).toBe(true);
  });

  it('retains the existing overview field contract through the shared adapter', async () => {
    const f = await fixture(); await f.pay();
    const response = await get(`/admin/overview?${f.query}`); expect(response.status, response.text).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['partners', 'since', 'totals']);
    expect(Object.keys(response.body.totals).sort()).toEqual(['attributedEvents', 'attributedRevenue', 'clicks', 'commissionAccrued', 'commissionApproved', 'commissionPaid', 'commissionPending', 'netRevenue', 'partners', 'registrations']);
    expect(Object.keys(response.body.partners[0]).sort()).toEqual(['clicks', 'commission', 'email', 'events', 'id', 'name', 'netRevenue', 'registrations', 'revenue']);
    const analytics=await get(`/admin/analytics?${f.query}`);
    expect(response.body.totals.registrations).toBe(analytics.body.counts.registrations);
    expect(response.body.partners[0].registrations).toBe(analytics.body.rows[0].counts.registrations);
  });
});
