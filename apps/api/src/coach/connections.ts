import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { z } from 'zod';
import { encryptSecret, decryptSecret } from '../crypto.js';
import { CoachError, profileSchema } from './schemas.js';
import { generateCoachOutput } from './provider.js';

export const CONNECTION_KEY = 'coach_openrouter';
export const connectionInput = z.object({
  version: z.string().max(80),
  apiKey: z.string().trim().min(16).max(512).regex(/^[\x21-\x7e]+$/).optional(),
  model: z.string().trim().min(3).max(200).regex(/^[~a-zA-Z0-9_.:/+-]+$/),
  modelSelection: z.enum(['catalog', 'manual']).optional(),
}).strict();
interface StoredConnection {
  version: string; ciphertext: string | null; model: string;
  disabled?: boolean;
  modelSelection?: 'catalog' | 'manual';
  verification?: { at: string; ok: boolean; detail: string; model: string };
}
/** Server-only. Never serialize this object or put it in a run/context/audit. */
export interface RouterCredentials { key: string; model: string; version: string; maxCompletionTokens?: number }
async function stored(db: Knex, tenantId: string): Promise<StoredConnection | null> {
  return (await db('Config').where({ tenantId, key: CONNECTION_KEY }).first())?.value ?? null;
}
export async function resolveRouterCredentials(db: Knex, tenantId: string): Promise<RouterCredentials> {
  const value = await stored(db, tenantId);
  return { key: value?.disabled ? '' : value?.ciphertext ? decryptSecret(value.ciphertext) : process.env.OPENROUTER_API_KEY ?? '', model: value?.model ?? process.env.OPENROUTER_MODEL_ID ?? '', version: value?.version ?? 'env' };
}
export async function publicRouterConnection(db: Knex, tenantId: string) {
  const value = await stored(db, tenantId);
  const hasKey = !value?.disabled && !!(value?.ciphertext || process.env.OPENROUTER_API_KEY);
  return { version: value?.version ?? 'env', hasKey, keySource: value?.ciphertext ? 'ui' : hasKey ? 'env' : 'none', model: value?.model ?? process.env.OPENROUTER_MODEL_ID ?? '', modelSelection: value?.modelSelection ?? 'catalog', verification: value?.verification ?? null, secureStorage: !!process.env.SECRETS_ENCRYPTION_KEY };
}
export async function saveRouterConnection(db: Knex, tenantId: string, input: z.infer<typeof connectionInput>) {
  await db('Tenant').where({ id: tenantId }).forUpdate().first();
  const old = await stored(db, tenantId);
  if (input.version !== (old?.version ?? 'env')) throw new CoachError('version_conflict', 409, 'Настройки изменились в другой вкладке. Обновите страницу.');
  if (input.apiKey && !process.env.SECRETS_ENCRYPTION_KEY) throw new CoachError('secure_storage_required', 503, 'Для безопасного хранения ключей серверу нужен SECRETS_ENCRYPTION_KEY.');
  if (!input.apiKey && (old?.disabled || (!old?.ciphertext && !process.env.OPENROUTER_API_KEY))) throw new CoachError('key_required', 422, 'Вставьте API-ключ OpenRouter.');
  const oldModel = old?.model ?? process.env.OPENROUTER_MODEL_ID ?? '';
  const oldKey = input.apiKey ? (old?.ciphertext ? decryptSecret(old.ciphertext) : process.env.OPENROUTER_API_KEY ?? '') : undefined;
  const keyRotated = !!input.apiKey && (old?.disabled === true || input.apiKey !== oldKey);
  const changed = !old || keyRotated || input.model !== oldModel;
  const modelSelection = input.modelSelection ?? old?.modelSelection ?? 'catalog';
  // UI preferences and repeated saves must not invalidate a verified connection,
  // switch its provider, or discard a reply already being generated.
  if (old && !changed && modelSelection === (old.modelSelection ?? 'catalog')) return { changed: false, keyRotated: false };
  const value: StoredConnection = { version: old && !changed ? old.version : randomUUID(), ciphertext: input.apiKey ? encryptSecret(input.apiKey) : old?.ciphertext ?? null, model: input.model, modelSelection, verification: changed ? undefined : old?.verification };
  await db('Config').insert({ tenantId, key: CONNECTION_KEY, value: JSON.stringify(value) }).onConflict(['tenantId', 'key']).merge({ value: JSON.stringify(value), updatedAt: new Date() });
  // A rotation must never silently route new partner data to an untested configuration.
  if (changed) {
    const row = await db('Config').where({ tenantId, key: 'coach_settings' }).first();
    if (row?.value?.provider === 'openrouter') await db('Config').where({ tenantId, key: 'coach_settings' }).update({ value: JSON.stringify({ ...row.value, provider: 'template' }), updatedAt: new Date() });
  }
  return { changed, keyRotated };
}
export async function removeRouterConnection(db: Knex, tenantId: string, version: string) {
  await db('Tenant').where({ id: tenantId }).forUpdate().first();
  const old = await stored(db, tenantId);
  if (!old || version !== old.version) throw new CoachError('version_conflict', 409, 'Настройки изменились. Обновите страницу.');
  // Tombstone prevents a deleted UI key silently falling back to a server key.
  await db('Config').where({ tenantId, key: CONNECTION_KEY }).update({ value: JSON.stringify({ version: randomUUID(), ciphertext: null, model: '', disabled: true }), updatedAt: new Date() });
  const row = await db('Config').where({ tenantId, key: 'coach_settings' }).first();
  if (row?.value) await db('Config').where({ tenantId, key: 'coach_settings' }).update({ value: JSON.stringify({ ...row.value, provider: 'template' }), updatedAt: new Date() });
}
export async function recordRouterVerification(db: Knex, tenantId: string, version: string, result: { ok: boolean; detail: string; model: string }) {
  await db('Tenant').where({ id: tenantId }).forUpdate().first();
  const old = await stored(db, tenantId);
  if ((old?.version ?? 'env') !== version) throw new CoachError('version_conflict', 409, 'Подключение изменено во время проверки. Проверьте новую настройку.');
  if (!old) throw new CoachError('save_first', 409, 'Сначала сохраните подключение.');
  await db('Config').where({ tenantId, key: CONNECTION_KEY }).update({ value: JSON.stringify({ ...old, verification: { ...result, at: new Date().toISOString() } }), updatedAt: new Date() });
}
export interface RouterModel { id: string; name: string; contextLength: number; inputPerMillion: number | null; outputPerMillion: number | null }
const modelSchema = z.object({ id: z.string().max(200), name: z.string().max(300), context_length: z.number().optional(), architecture: z.object({ output_modalities: z.array(z.string()).optional() }).optional(), pricing: z.object({ prompt: z.string().optional(), completion: z.string().optional() }).optional(), supported_parameters: z.array(z.string()).optional() });
export async function listRouterModels(): Promise<RouterModel[]> {
  const response = await fetch('https://openrouter.ai/api/v1/models', { redirect: 'error', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new CoachError('catalog_unavailable', 503, 'Не удалось загрузить каталог OpenRouter. Повторите позже или укажите ID модели вручную.');
  const parsed = z.object({ data: z.array(modelSchema) }).safeParse(await response.json());
  if (!parsed.success) throw new CoachError('catalog_unavailable', 503, 'Формат каталога OpenRouter изменился. Можно указать ID модели вручную.');
  const price = (s?: string) => s !== undefined && Number.isFinite(Number(s)) && Number(s) >= 0 ? Number(s) * 1e6 : null;
  return parsed.data.data.filter(m => !m.id.endsWith(':batch') && m.supported_parameters?.includes('tools') && m.supported_parameters.includes('structured_outputs') && (!m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'))).map(m => ({ id: m.id, name: m.name, contextLength: m.context_length ?? 0, inputPerMillion: price(m.pricing?.prompt), outputPerMillion: price(m.pricing?.completion) })).sort((a, b) => a.name.localeCompare(b.name));
}
/** Explicit admin-initiated paid smoke test, using synthetic data and the actual adapter. */
export async function testRouterConnection(credentials: RouterCredentials) {
  if (!credentials.key || !credentials.model) throw new CoachError('provider_not_configured', 422, 'Сначала сохраните ключ и модель.');
  const response = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${credentials.key}` }, redirect: 'error', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new CoachError('connection_failed', 422, response.status === 401 ? 'OpenRouter отклонил ключ. Проверьте, что скопирован полный API-ключ.' : 'OpenRouter недоступен или отклонил запрос проверки ключа.');
  const profile = profileSchema.parse({ goalMinor: 100, goalMetric: 'monthly_net_accrual', targetDate: '2030-01-01', weeklyMinutes: 30, sessionMinutes: 30, daysPerWeek: 1, timezone: 'Europe/Moscow', channels: [], experience: 'new', productUnderstanding: '', preferences: '', mode: 'on_request', quietStart: 21, quietEnd: 9, proactiveConsent: false, aiConsent: true });
  const result = await generateCoachOutput('openrouter', 'message', 'Это техническая проверка. Верни короткое приветствие по-русски, без задач. Не вызывай инструменты без необходимости.', { profile, metrics: { test: true }, knowledge: [], messages: [], program: { name: 'Техническая проверка — не реальные данные' } }, AbortSignal.timeout(45000), { ...credentials, maxCompletionTokens: 1000 });
  return { ok: true, detail: `Модель ответила: ${result.output.message.slice(0, 300)}`, model: result.model };
}
