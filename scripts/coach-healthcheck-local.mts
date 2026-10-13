import '../apps/api/src/env.js';
import { randomUUID } from 'node:crypto';
import { createDb, DEFAULT_TENANT_ID } from '../packages/db/src/index.js';

// Local diagnostics. Never prints credentials, full profiles or partner messages.
// --smoke sends ONE real model request, exclusively for the synthetic test owner.
const db = await createDb({ connectionString: process.env.DATABASE_URL!, bypassRls: true });
const headers = { Authorization: `Bearer ${process.env.ADMIN_API_KEY}`, 'Content-Type': 'application/json' };
async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:4601${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}, ${data.error ?? 'request_failed'}`);
  return data;
}
try {
  const owner = await db('Partner').where({ tenantId: DEFAULT_TENANT_ID, email: 'coach-smoke-20261013@example.test' }).first();
  if (!owner) throw new Error('Synthetic test partner not found; refusing to use real partner data.');
  const prefix = `/admin/coach/partners/${owner.id}`;
  const overview = await api('/admin/coach/overview');
  const connection = await api('/admin/coach/openrouter');
  const me = await api(prefix);
  const programId = me.programs?.[0]?.id;
  if (!programId) throw new Error('No existing program assigned to the synthetic partner.');
  const checks: Array<{ path: string; status: string }> = [];
  for (const path of ['/admin/coach/behavior', '/admin/coach/knowledge', '/admin/coach/control', ...['welcome', 'plans', 'tasks', 'management', 'reviews', 'messages', 'runs', 'results', 'notifications', 'forecast-snapshots', 'directives', `context?programId=${encodeURIComponent(programId)}`].map(p => `${prefix}/${p}`)]) {
    await api(path);
    checks.push({ path, status: 'HTTP 200' });
  }
  console.log(JSON.stringify({ adminEnabled: overview.settings.enabled, provider: overview.settings.provider, configured: me.configured, takeover: me.takeover, profileMode: me.profile?.data.mode, savedKey: connection.hasKey, model: connection.model, modelSelection: connection.modelSelection, verified: connection.verification?.ok === true, endpoints: checks }, null, 2));
  if (process.argv.includes('--smoke') || process.argv.includes('--manager-smoke')) {
    if (!overview.settings.enabled || overview.settings.provider !== 'openrouter' || !me.configured) throw new Error('The existing verified OpenRouter connection must already be enabled.');
    if (me.profile?.status !== 'complete') throw new Error('Synthetic test profile must be complete.');
    if (me.takeover) {
      await api(`${prefix}/takeover`, 'POST', { enabled: false });
      console.log(JSON.stringify({ syntheticOnly: true, takeoverReleasedForAiTest: true }));
    }
    // Only the legacy test flag is changed; current integration needs no checkbox.
    if (me.profile.data.aiConsent) await api(`${prefix}/profile`, 'PATCH', { version: me.profile.version, complete: true, profile: { ...me.profile.data, aiConsent: false } });
    const text=process.argv.includes('--manager-smoke')?'Посмотри мою анкету и get_management: я застрял на первых пяти секундах кружочка по текущему заданию. Сегодня есть 20 минут. Как мой менеджер, помоги довести именно эту работу до проверки: дай готовый заход и один следующий шаг, не новый план. Ответь коротко.':'У меня сегодня 20 минут. Предложи один конкретный шаг для короткого ролика про сравнение документов в Syntolk. Ответь коротко, не создавай новый недельный план.';
    const started = await api(`${prefix}/messages`, 'POST', { programId, requestId: `healthcheck-${randomUUID()}`, text });
    if (!started.run) throw new Error('The message was routed to a manager; no AI run was created.');
    let run = started.run;
    const deadline = Date.now() + 125000;
    while (['queued', 'processing'].includes(run.status) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      run = (await api(`${prefix}/runs/${run.id}`)).run;
    }
    console.log(JSON.stringify({ syntheticOnly: true, legacyAiConsent: false, liveRun: run.id, status: run.status, model: run.data.model, usage: run.data.usage, responseLength: run.data.output?.message?.length ?? 0, errorCode: run.data.error?.code ?? null }));
    if (run.status !== 'completed') process.exitCode = 1;
  }
} finally { await db.destroy(); }
