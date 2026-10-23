// Credentials travel only through a random, current-user-only Windows named pipe.
// This helper never listens on TCP and never prints a credential.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash, createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { resolve } from 'node:path';

export function readAdminKey(text) {
  const match = text.match(/^[ \t]*(?:export[ \t]+)?ADMIN_API_KEY[ \t]*=[ \t]*(.*?)[ \t]*$/m);
  if (!match) throw new Error('В .env отсутствует ADMIN_API_KEY.');
  let value = match[1];
  if (value.startsWith('"') || value.startsWith("'")) {
    const end = value.indexOf(value[0], 1);
    if (end < 0) throw new Error('Не удалось прочитать ADMIN_API_KEY.');
    value = value.slice(1, end);
  } else value = value.replace(/\s+#.*$/, '').trim();
  if (!value) throw new Error('ADMIN_API_KEY пуст.');
  return value;
}

export function decryptPartner(saved, adminKey) {
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(adminKey, 'utf8').digest(), Buffer.from(saved.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(saved.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(saved.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export function encryptPartner(token, adminKey, metadata = {}) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(adminKey, 'utf8').digest(), nonce);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { ...metadata, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

const partnerId = '01M4T7PS69XFYMTPZPMNV4ET9V';
const partnerName = 'Локальный партнёр Syntolk';

async function request(path, token, body) {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:4601${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    });
  } catch { throw new Error('Нет соединения с локальным API на порту 4601.'); }
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

export async function credentials(root) {
  const adminKey = readAdminKey(await readFile(resolve(root, '.env'), 'utf8'));
  const admin = await request('/auth/whoami', adminKey);
  if (admin.status !== 200 || admin.data.role !== 'admin') throw new Error(`Вход администратора отклонён: HTTP ${admin.status}.`);
  const file = resolve(root, '.local-demo/partner-login.encrypted.json');
  let partnerToken;
  try { partnerToken = decryptPartner(JSON.parse(await readFile(file, 'utf8')), adminKey); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Не удалось расшифровать сохранённый вход партнёра. Файл и ключи оставлены без изменений.');
  }
  let partner = partnerToken ? await request('/auth/whoami', partnerToken) : null;
  // Only a missing or definitively rejected credential permits creating one.
  if (!partner || partner.status === 401) {
    const created = await request(`/partners/${partnerId}/api-keys`, adminKey, { label: 'Syntolk: локальный запускатель Windows' });
    if (![200, 201].includes(created.status) || typeof created.data.plaintext !== 'string') throw new Error(`Не удалось создать локальный вход партнёра: HTTP ${created.status}.`);
    partnerToken = created.data.plaintext;
    partner = await request('/auth/whoami', partnerToken);
    if (partner.status !== 200 || partner.data.role !== 'partner' || partner.data.partnerId !== partnerId || partner.data.partner?.name !== partnerName) throw new Error('Новый вход не соответствует локальному партнёру.');
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(encryptPartner(partnerToken, adminKey, { partnerId, name: partnerName, created: new Date().toISOString() }), null, 2), { mode: 0o600 });
    await rename(temporary, file);
  }
  if (partner.status !== 200 || partner.data.role !== 'partner' || partner.data.partnerId !== partnerId || partner.data.partner?.name !== partnerName) throw new Error(`Сохранённый вход партнёра не прошёл проверку: HTTP ${partner.status}.`);
  return { admin: { token: adminKey, role: 'admin' }, partner: { token: partnerToken, role: 'partner', partnerId, name: partnerName } };
}

if (process.argv[2] === '--pipe') {
  const pipe = process.argv[3];
  if (!/^syntolk-launcher-[a-f0-9]{32}$/.test(pipe ?? '')) process.exit(2);
  const socket = connect(`\\\\.\\pipe\\${pipe}`);
  socket.on('error', (error) => { console.error('Локальный канал входа: ' + error.code); process.exit(2); });
  socket.setTimeout(45000, () => socket.destroy());
  try {
    const result = await credentials(process.cwd());
    socket.end(JSON.stringify({ ok: true, ...result }) + '\n');
  } catch (error) {
    socket.end(JSON.stringify({ ok: false, error: error.message }) + '\n');
  }
}
