import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAdminKey, encryptPartner, decryptPartner, credentials } from './credentials.mjs';

test('reads only the requested dotenv entry, including quotes and inline comments', () => {
  assert.equal(readAdminKey('OTHER=do-not-use\nADMIN_API_KEY=op_example # local\nLAST=unused'), 'op_example');
  assert.equal(readAdminKey('ADMIN_API_KEY="op_example" # local'), 'op_example');
  assert.equal(readAdminKey("export ADMIN_API_KEY='op_example'"), 'op_example');
  assert.throws(() => readAdminKey('OTHER=anything'));
  assert.throws(() => readAdminKey('ADMIN_API_KEY=\nOTHER=anything'));
});
test('saved login round-trips with the existing AES-256-GCM format', () => {
  const saved = encryptPartner('test-partner-key', 'test-admin-key', { partnerId: 'test-id' });
  assert.equal(decryptPartner(saved, 'test-admin-key'), 'test-partner-key');
  assert.equal(saved.partnerId, 'test-id');
  assert.notEqual(encryptPartner('test-partner-key', 'test-admin-key').nonce, saved.nonce);
  assert.throws(() => decryptPartner(saved, 'wrong-key'));
  const changed = Buffer.from(saved.ciphertext, 'base64'); changed[0] ^= 1;
  assert.throws(() => decryptPartner({ ...saved, ciphertext: changed.toString('base64') }, 'test-admin-key'));
});

const id = '01M4T7PS69XFYMTPZPMNV4ET9V';
const identity = { role: 'partner', partnerId: id, partner: { name: 'Локальный партнёр Syntolk' } };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'syntolk-launcher-test-'));
  await mkdir(join(root, '.local-demo'));
  await writeFile(join(root, '.env'), 'OTHER=not-used\nADMIN_API_KEY=test-admin\n');
  const saved = join(root, '.local-demo/partner-login.encrypted.json');
  await writeFile(saved, JSON.stringify(encryptPartner('test-partner', 'test-admin')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, saved };
}
function respond(body, status = 200) { return new Response(JSON.stringify(body), { status }); }

test('reuses a valid saved login without creating keys or rewriting the file', async t => {
  const f = await fixture(t), before = await readFile(f.saved, 'utf8'), calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(options.method);
    return respond(options.headers.Authorization === 'Bearer test-admin' ? { role: 'admin' } : identity);
  });
  const result = await credentials(f.root);
  assert.equal(result.partner.partnerId, id);
  assert.deepEqual(calls, ['GET', 'GET']);
  assert.equal(await readFile(f.saved, 'utf8'), before);
});

test('database and network failures never create a replacement key', async t => {
  const f = await fixture(t), calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(options.method);
    return options.headers.Authorization === 'Bearer test-admin' ? respond({ role: 'admin' }) : respond({ error: 'internal_error' }, 500);
  });
  await assert.rejects(credentials(f.root), /HTTP 500/);
  assert.ok(calls.every(m => m === 'GET'));
});

test('a rejected key is replaced once, verified and saved encrypted for next launch', async t => {
  const f = await fixture(t); let issued = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'POST') { issued++; return respond({ plaintext: 'test-new-partner' }, 201); }
    if (options.headers.Authorization === 'Bearer test-admin') return respond({ role: 'admin' });
    if (options.headers.Authorization === 'Bearer test-new-partner') return respond(identity);
    return respond({ error: 'unauthorized' }, 401);
  });
  await credentials(f.root);
  const saved = JSON.parse(await readFile(f.saved, 'utf8'));
  assert.equal(decryptPartner(saved, 'test-admin'), 'test-new-partner');
  assert.ok(!(await readFile(f.saved, 'utf8')).includes('test-new-partner'));
  await credentials(f.root);
  assert.equal(issued, 1);
});

test('a corrupted encrypted file is preserved and never rotates credentials', async t => {
  const f = await fixture(t); let calls = 0;
  await writeFile(f.saved, 'damaged-file');
  t.mock.method(globalThis, 'fetch', async () => { calls++; return respond({ role: 'admin' }); });
  await assert.rejects(credentials(f.root), /расшифровать/);
  assert.equal(calls, 1);
  assert.equal(await readFile(f.saved, 'utf8'), 'damaged-file');
});
