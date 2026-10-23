import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, open, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentials } from './credentials.mjs';

export const localOrigins = { admin: 'http://localhost:5673', partner: 'http://127.0.0.1:5673' };
const directory = root => resolve(root, '.local-demo/browser-login');
const ticketPath = (root, role) => resolve(directory(root), `${role}.ticket.json`);

export async function issueBrowserTickets(root) {
  await mkdir(directory(root), { recursive: true, mode: 0o700 });
  for (const name of await readdir(directory(root))) {
    if (!/^(admin|partner)\.ticket\.json\.claim\.[a-f0-9]{64}$/.test(name)) continue;
    const marker = resolve(directory(root), name);
    if ((await stat(marker)).mtimeMs < Date.now() - 11 * 60_000) await unlink(marker);
  }
  for (const [role, origin] of Object.entries(localOrigins)) {
    const ticket = { version: 1, role, origin, token: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
    const temporary = `${ticketPath(root, role)}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(ticket), { mode: 0o600 });
    await rename(temporary, ticketPath(root, role));
  }
}

function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b)
    && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function redeemBrowserTicket(root, ticket, origin, loadCredentials = credentials) {
  if (!ticket || !Object.hasOwn(localOrigins, ticket.role) || localOrigins[ticket.role] !== origin || ticket.origin !== origin || ticket.version !== 1) return null;
  const file = ticketPath(root, ticket.role);
  let saved;
  try { saved = JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
  const expires = Date.parse(saved.expiresAt);
  if (!Number.isFinite(expires) || expires < Date.now() || expires > Date.now() + 11 * 60_000
    || saved.role !== ticket.role || saved.origin !== origin || !equal(saved.token, ticket.token)) return null;
  const verified = await loadCredentials(root);
  // CREATE_NEW is atomic on Windows; two simultaneous renames are not a lock.
  let claim;
  try { claim = await open(`${file}.claim.${saved.token}`, 'wx', 0o600); } catch { return null; }
  await claim.close();
  await unlink(file).catch(() => {});
  return { credential: verified[ticket.role].token, role: ticket.role };
}

export function localBrowserLogin(root) {
  return {
    name: 'syntolk-local-browser-login', apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/__syntolk_local_login') return next();
        const respond = (status, payload) => {
          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          res.end(JSON.stringify(payload));
        };
        const origin = req.headers.origin;
        const localSocket = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        if (req.method !== 'POST' || !localSocket || !Object.values(localOrigins).includes(origin)
          || `http://${req.headers.host}` !== origin || req.headers['sec-fetch-site'] !== 'same-origin'
          || req.headers['content-type'] !== 'application/json') return respond(403, { error: 'local_login_forbidden' });
        try {
          let size = 0;
          const chunks = [];
          for await (const chunk of req) { size += chunk.length; if (size > 4096) return respond(413, { error: 'invalid_local_ticket' }); chunks.push(chunk); }
          let ticket;
          try { ticket = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return respond(400, { error: 'invalid_local_ticket' }); }
          const result = await redeemBrowserTicket(root, ticket, origin);
          return result ? respond(200, result) : respond(401, { error: 'invalid_or_expired_local_ticket' });
        } catch { return respond(503, { error: 'local_login_unavailable' }); }
      });
    },
  };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  try { await issueBrowserTickets(root); console.log('Одноразовый локальный вход подготовлен.'); }
  catch { console.error('Не удалось подготовить локальный вход.'); process.exitCode = 1; }
}
if (process.argv[2] === '--issue') void main();
