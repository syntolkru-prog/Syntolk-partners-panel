import { loadEnvFile } from 'node:process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../../', import.meta.url));
loadEnvFile(`${root}.env`);
const origin = 'http://127.0.0.1:4601';
if (process.env.OPENPARTNER_MODE && process.env.OPENPARTNER_MODE !== 'selfhost') throw new Error('Локальное демо предназначено только для selfhost');
const adminKey = process.env.ADMIN_API_KEY;
if (!adminKey) throw new Error('ADMIN_API_KEY is missing');
const folder = `${root}.local-demo`;
mkdirSync(folder, { recursive: true });
const stateFile = `${folder}/state.json`;
const state: Record<string, any> = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const command = process.argv[2] ?? 'inspect';
const argument = process.argv[3];

async function request(path: string, body?: unknown, key: string | null = adminKey!, expected = [200, 201]) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!expected.includes(response.status)) throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(result)}`);
  return { code: response.status, ...result };
}
async function dashboard() { return request(`/partners/${state.partnerId}/dashboard?includeLinks=true`); }
async function commissions() { return (await request(`/partners/${state.partnerId}/commissions?limit=500`)).commissions; }
async function payment(amount: number, suffix: string) {
  return request('/payments/simulate', { partnerId: state.partnerId, linkKey: state.linkKey, userId: state.userId, amount, currency: 'RUB', type: 'invoice_paid', externalEventId: `${state.run}_${suffix}` });
}
const log = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const result: Record<string, any> = { command, checkedAt: new Date().toISOString() };

if (command === 'inspect') {
  Object.assign(result, {
    admin: await request('/auth/whoami'),
    signup: await request('/config/partner-signup'),
    payouts: await request('/config/payouts'),
    mail: await request('/config/mail'),
    programs: (await request('/programs')).programs,
    approvedCount: (await request('/commissions?status=approved&limit=500')).commissions.length,
  });
} else if (command === 'prepare') {
  if (state.run) writeFileSync(`${folder}/${state.run}.json`, JSON.stringify(state, null, 2));
  for (const key of Object.keys(state)) delete state[key];
  state.run = `local_${Date.now()}`;
  const program = await request('/programs', {
    name: `Локальная проверка 20% ${state.run}`,
    commissionRule: [{ trigger: 'every', type: 'percent', value: 20, eventType: 'invoice_paid', recurring: true }],
    destinationUrl: 'http://localhost:5673/login', attributionWindowDays: 60, attributionModel: 'last_click', holdbackDays: 0, shareOnNetwork: false,
  });
  state.programId = program.id;
  state.email = `demo-${state.run}@example.test`;
  state.name = `Тестовый партнёр ${state.run}`;
  state.linkKey = `${state.run}-youtube`;
  state.userId = `${state.run}-client-001`;
  Object.assign(result, { programId: state.programId, name: state.name, email: state.email, linkKey: state.linkKey, userId: state.userId, joinUrl: 'http://localhost:5673/join' });
} else if (command === 'create') {
  assert(state.programId && state.email, 'Сначала выполните prepare');
  const partner = await request('/partners', { email: state.email, name: state.name, sendInvite: false, programIds: [state.programId] });
  assert(partner.activatedAt);
  state.partnerId = partner.id;
  Object.assign(result, { partnerId: partner.id, email: partner.email, name: partner.name });
} else if (command === 'access') {
  const email = argument ?? state.email;
  const partner = (await request('/partners?limit=200')).partners.find((p: any) => p.email === email);
  assert(partner, `Партнёр ${email} не найден`);
  const key = await request(`/partners/${partner.id}/api-keys`, { label: `Локальный вход ${new Date().toISOString()}` });
  state.partnerId = partner.id;
  state.partnerKey = key.plaintext;
  Object.assign(result, { partnerId: partner.id, name: partner.name, email: partner.email, loginUrl: 'http://localhost:5673/login', key: key.plaintext });
} else if (command === 'grant') {
  const before = await request('/me/programs', undefined, state.partnerKey);
  await request(`/partners/${state.partnerId}/programs`, { programIds: [state.programId] });
  const after = await request('/me/programs', undefined, state.partnerKey);
  assert(after.programs.some((p: any) => p.id === state.programId));
  Object.assign(result, { before: before.programs, after: after.programs });
} else if (command === 'links') {
  const links = (await request(`/partners/${state.partnerId}/links`, undefined, state.partnerKey)).links;
  assert(links.some((l: any) => l.linkKey === state.linkKey));
  Object.assign(result, { links, dashboard: await dashboard(), shareUrl: `http://localhost:4701/r/${state.linkKey}` });
} else if (command === 'status' || command === 'portal-link') {
  assert(state.partnerId, 'Сначала создайте партнёра и выполните access');
  const after = await dashboard();
  if (command === 'portal-link') {
    assert.equal(after.clicks, 2);
    assert.equal(after.registrations, 1);
    assert.equal(after.balances.paid, 200);
  }
  Object.assign(result, { dashboard: after, payouts: (await request(`/partners/${state.partnerId}/payouts`, undefined, state.partnerKey)).payouts, shareUrl: `http://localhost:5673/r/${state.linkKey}` });
} else if (command === 'register') {
  assert(argument, 'Передайте cref из адреса страницы после перехода по ссылке');
  state.cref = argument;
  const before = await dashboard();
  await request('/attribution/identify', { userId: state.userId, cref: state.cref }, null);
  await request('/attribution/events', { userId: state.userId, type: 'signup', currency: 'RUB', externalEventId: `${state.run}_signup` });
  const after = await dashboard();
  assert.equal(after.registrations, 1);
  assert.equal(after.balances.total, 0);
  Object.assign(result, { before, after });
} else if (command === 'first') {
  const event = await payment(1000, 'payment_1');
  const after = await dashboard();
  assert.equal(after.balances.accrued, 200);
  assert.equal(after.payingClients, 1);
  assert.equal(after.clicks, 1, 'Оплата привязанного клиента не должна создавать ещё один клик');
  Object.assign(result, { event, dashboard: after, commissions: await commissions() });
} else if (command === 'replay') {
  const event = await payment(1000, 'payment_1');
  assert.equal(event.replayed, true);
  assert.equal((await commissions()).length, 1);
  Object.assign(result, { event, dashboard: await dashboard() });
} else if (command === 'repeat') {
  const event = await payment(1500, 'payment_2');
  assert.equal((await dashboard()).balances.accrued, 500);
  Object.assign(result, { event, dashboard: await dashboard() });
} else if (command === 'refund') {
  const refund = await request('/payments/refunds', { originalExternalEventId: `${state.run}_payment_2`, refundExternalEventId: `${state.run}_refund_2`, amount: 1500, currency: 'RUB' });
  const again = await request('/payments/refunds', { originalExternalEventId: `${state.run}_payment_2`, refundExternalEventId: `${state.run}_refund_2`, amount: 1500, currency: 'RUB' });
  assert.equal(again.replayed, true);
  assert.equal((await dashboard()).balances.total, 200);
  Object.assign(result, { refund, replay: again.replayed, dashboard: await dashboard() });
} else if (command === 'approve') {
  const accrued = (await commissions()).filter((c: any) => c.status === 'accrued');
  assert.equal(accrued.length, 1);
  state.commissionId = accrued[0].id;
  await request(`/commissions/${state.commissionId}/approve`, {});
  assert.equal((await dashboard()).balances.available, 200);
  Object.assign(result, { dashboard: await dashboard() });
} else if (command === 'payout-check') {
  const payouts = (await request(`/partners/${state.partnerId}/payouts`, undefined, state.partnerKey)).payouts;
  assert(payouts.length > 0);
  state.payoutId = payouts[0].id;
  Object.assign(result, { payouts, dashboard: await dashboard(), commissions: await commissions() });
} else if (command === 'pending-fixed') {
  const after = await dashboard();
  assert.equal(after.balances.pending, 200);
  assert.equal(after.balances.paid, 0);
  assert.equal(after.balances.available, 0);
  Object.assign(result, { dashboard: after });
} else if (command === 'confirmed') {
  const payouts = (await request(`/partners/${state.partnerId}/payouts`, undefined, state.partnerKey)).payouts;
  assert.equal(payouts[0].status, 'paid');
  assert.equal(Number(payouts[0].amount), 200);
  assert.equal((await dashboard()).balances.paid, 200);
  Object.assign(result, { payouts, dashboard: await dashboard(), commissions: await commissions() });
} else if (command === 'safe-replay') {
  const planned = await request('/payouts/run', { partnerId: state.partnerId });
  assert.equal(planned.payouts.length, 0);
  const duplicate = await request(`/payouts/${state.payoutId}/confirm`, {}, adminKey, [409]);
  const payouts = (await request(`/partners/${state.partnerId}/payouts`)).payouts;
  assert.equal(payouts.length, 1);
  Object.assign(result, { duplicateCalculationCreated: planned.payouts.length, duplicateConfirmation: duplicate.code, payouts });
} else if (command === 'cancel-check') {
  await payment(500, 'payment_cancel_check');
  const accrued = (await commissions()).filter((c: any) => c.status === 'accrued');
  assert.equal(accrued.length, 1);
  await request(`/commissions/${accrued[0].id}/approve`, {});
  const planned = await request('/payouts/run', { partnerId: state.partnerId });
  assert.equal(planned.payouts.length, 1);
  assert.equal(planned.payouts[0].amount, 100);
  const before = await dashboard();
  assert.equal(before.balances.pending, 100);
  assert.equal(before.balances.paid, 200);
  await request(`/payouts/${planned.payouts[0].payoutId}/cancel`, {});
  const after = await dashboard();
  assert.equal(after.balances.available, 100);
  assert.equal(after.balances.pending, 0);
  assert.equal(after.balances.paid, 200);
  // Return this auxiliary test payment, leaving the original paid 200 intact.
  await request('/payments/refunds', { originalExternalEventId: `${state.run}_payment_cancel_check`, refundExternalEventId: `${state.run}_refund_cancel_check`, amount: 500, currency: 'RUB' });
  Object.assign(result, { before, afterCancel: after, afterRefund: await dashboard(), payouts: (await request(`/partners/${state.partnerId}/payouts`)).payouts });
} else if (command === 'scope') {
  const forbidden = await request('/payouts/run', {}, state.partnerKey, [403]);
  const other = (await request('/partners?limit=200')).partners.find((p: any) => p.id !== state.partnerId);
  assert(other, 'Нужен ещё один партнёр для проверки изоляции');
  const otherPartner = await request(`/partners/${other.id}/payouts`, undefined, state.partnerKey, [403]);
  Object.assign(result, { partnerCannotPay: forbidden.code, partnerCannotReadOtherPartner: otherPartner.code });
} else { throw new Error('Команда: inspect | prepare | create | access [email] | grant | links | status | register <cref> | first | replay | repeat | refund | approve | payout-check | pending-fixed | confirmed | safe-replay | cancel-check | scope'); }

writeFileSync(stateFile, JSON.stringify(state, null, 2));
const reportFile = `${folder}/results.json`;
const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : [];
// Keys belong only in the private local state, never in the audit report.
const { key: _key, ...publicResult } = result;
report.push(publicResult);
writeFileSync(reportFile, JSON.stringify(report, null, 2));
log(result);
