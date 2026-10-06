import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HelpCircle, Plus, Tag, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { theme } from '../theme.js';
import { useBrand } from '../lib/useBrand.js';
import { Button, Card, EmptyState, ErrorBanner, Input, Label, Page, Select, Table, formatDate } from '../ui.js';
import { renderCommissionSummary } from '../lib/commission-summary.js';
import { PROGRAM_CATEGORIES, categoryLabel } from '@openpartner/db';

interface CommissionSubRule {
  trigger: 'every' | 'first' | 'subsequent';
  eventType?: string;
  type: 'percent' | 'fixed';
  value: number;
  currency?: string;
  recurring?: boolean;
  recurringMonths?: number;
}

interface CustomerReward {
  type: 'percent_off' | 'amount_off' | 'free_months';
  value: number;
  currency?: string;
  duration: 'once' | 'forever' | 'repeating';
  durationInMonths?: number;
}

interface Program {
  id: string;
  name: string;
  /** Server returns the array form post-migration. The single-object
   *  shape is still tolerated client-side for older API responses
   *  surfaced during a deploy gap — `normalizeRules` handles both. */
  commissionRule: CommissionSubRule[] | { type: 'percent' | 'fixed'; value: number; recurring?: boolean };
  attributionWindowDays: number;
  attributionModel: string;
  destinationUrl: string;
  deepLinkAllowedDomains: string | null;
  holdbackDays: number | null;
  startsAt: string | null;
  endsAt: string | null;
  customerReward: CustomerReward | null;
  shareOnNetwork: boolean;
  partnersMayCustomizeCode?: boolean;
  marketplaceDescription: string | null;
  networkOfferingId: string | null;
  categories: string[];
  createdAt: string;
}

interface NetworkConnectionState {
  enabled: boolean;
}

function normalizeRules(raw: Program['commissionRule']): CommissionSubRule[] {
  if (Array.isArray(raw)) return raw;
  return [{ trigger: 'every', type: raw.type, value: raw.value, recurring: raw.recurring }];
}

function summarizeRules(raw: Program['commissionRule'], reward: CustomerReward | null): string {
  return renderCommissionSummary(normalizeRules(raw), reward);
}

type ProgramStatus = 'scheduled' | 'active' | 'ended';
function statusOf(c: Pick<Program, 'startsAt' | 'endsAt'>, at: Date = new Date()): ProgramStatus {
  if (c.startsAt && at < new Date(c.startsAt)) return 'scheduled';
  if (c.endsAt && at >= new Date(c.endsAt)) return 'ended';
  return 'active';
}

export function AdminPrograms() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Program | null>(null);
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api<{ programs: Program[] }>('/programs'),
  });

  // End-now sets endsAt = current time. Existing share-links keep
  // redirecting (the router doesn't gate on endsAt — that would break
  // creators' embeds), only new commission accrual stops. So this is
  // safe to fire without a multi-step flow.
  const endNow = useMutation({
    mutationFn: (id: string) =>
      api(`/programs/${id}`, {
        method: 'PATCH',
        body: { endsAt: new Date().toISOString() },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  return (
    <Page
       title="Программы"
       subtitle="Правила комиссий, окна атрибуции и модели, применяемые к партнёрским кликам."
      actions={
        <Button icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
           Новая кампания
        </Button>
      }
    >
      <ErrorBanner error={campaigns.error ?? endNow.error} />
      {showCreate && (
        <CreateProgram
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['campaigns'] });
          }}
        />
      )}
      {editing && (
        <EditProgramDates
          campaign={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['campaigns'] });
          }}
        />
      )}
      {/* Hide the program list while the edit or create form is open —
          duplicating the row being edited is just visual noise, and on a
          single-program tenant it pushes the form off-screen. */}
      {editing || showCreate ? null : campaigns.isLoading ? (
         <Card>Загрузка…</Card>
      ) : (campaigns.data?.programs ?? []).length === 0 ? (
         <EmptyState title="Программ пока нет" hint="Программа содержит правила комиссии и настройки атрибуции." icon={<Tag size={28} strokeWidth={1.25} />} />
      ) : (
        <Table
           columns={['Название', 'Статус', 'Назначение', 'Комиссия', 'Окно', 'Отсрочка', 'Модель', 'Создано', 'Действия']}
          rows={(campaigns.data?.programs ?? []).map((c) => {
            const status = statusOf(c);
            return [
              <span style={{ fontWeight: 500 }}>{c.name}</span>,
              <ProgramStatusPill campaign={c} />,
              <span style={{ color: theme.textMuted, fontSize: 12, fontFamily: theme.fontMono }}>
                {c.destinationUrl ? new URL(c.destinationUrl).hostname + new URL(c.destinationUrl).pathname.replace(/\/$/, '') : '—'}
                {c.deepLinkAllowedDomains && (
                   <span style={{ color: theme.accent, fontSize: 11, marginLeft: 8 }}>+ дополнительная ссылка</span>
                )}
              </span>,
              <span style={{ fontSize: 13 }}>{summarizeRules(c.commissionRule, c.customerReward)}</span>,
              <span style={{ color: theme.textMuted }}>{c.attributionWindowDays} дн.</span>,
              <span style={{ color: c.holdbackDays ? theme.text : theme.textDim }}>
                {c.holdbackDays ? `${c.holdbackDays} дн.` : '—'}
              </span>,
              <span style={{ color: theme.accent, fontSize: 12 }}>{modelLabel(c.attributionModel)}</span>,
              <span style={{ color: theme.textMuted }}>{formatDate(c.createdAt, { relative: true })}</span>,
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setEditing(c)}
                  style={smallActionStyle(theme.textMuted)}
                >
                   Изменить
                </button>
                {status !== 'ended' && (
                  <button
                    type="button"
                    onClick={() => {
                       if (confirm(`Завершить кампанию «${c.name}» сейчас? Существующие ссылки продолжат работать, но новые комиссии начисляться не будут.`)) {
                        endNow.mutate(c.id);
                      }
                    }}
                    disabled={endNow.isPending}
                    style={smallActionStyle(theme.danger)}
                  >
                     Завершить сейчас
                  </button>
                )}
              </div>,
            ];
          })}
        />
      )}
    </Page>
  );
}

function smallActionStyle(color: string): React.CSSProperties {
  return {
    background: 'transparent',
    border: `1px solid ${color}55`,
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    color,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

/**
 * Inline edit form for an existing campaign.
 *
 * Dates section: free to edit. Just scheduling.
 *
 * Terms section: behind a banner explaining the snapshot semantics.
 * Editing commission rate or holdback only affects partnerships
 * approved AFTER the change — existing partners keep the rate they
 * were quoted (snapshot is stamped at PartnershipRequest approval
 * time and stored on PartnerCommission, queried at accrual). This is
 * what makes "rate cut without losing creators" safe and matches the
 * grandfathering pattern of mature affiliate networks (Impact,
 * Partnerize).
 */
function EditProgramDates({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: Program;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [startsAt, setStartsAt] = useState(campaign.startsAt ? toDateTimeLocal(campaign.startsAt) : '');
  const [endsAt, setEndsAt] = useState(campaign.endsAt ? toDateTimeLocal(campaign.endsAt) : '');
  const [rules, setRules] = useState<CommissionSubRule[]>(normalizeRules(campaign.commissionRule));
  const [customerReward, setCustomerReward] = useState<CustomerReward | null>(campaign.customerReward);
  const { whiteLabel } = useBrand();
  const [shareOnNetwork, setShareOnNetwork] = useState(campaign.shareOnNetwork);
  const [marketplaceDescription, setMarketplaceDescription] = useState(campaign.marketplaceDescription ?? '');
  const [categories, setCategories] = useState<string[]>(campaign.categories ?? []);
  const [partnersMayCustomizeCode, setPartnersMayCustomizeCode] = useState(
    campaign.partnersMayCustomizeCode ?? false,
  );
  const [holdbackDays, setHoldbackDays] = useState(
    campaign.holdbackDays != null ? String(campaign.holdbackDays) : '0',
  );

  const save = useMutation({
    mutationFn: () =>
      api(`/programs/${campaign.id}`, {
        method: 'PATCH',
        body: {
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
          commissionRule: rules,
          customerReward,
          shareOnNetwork,
          marketplaceDescription: marketplaceDescription.trim() || null,
          categories,
          partnersMayCustomizeCode,
          holdbackDays: Number(holdbackDays) || 0,
        },
      }),
    onSuccess: onSaved,
  });

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>
         Редактирование кампании — {campaign.name}
      </div>
      <ErrorBanner error={save.error} />

      <div style={{ marginTop: 14, fontSize: 12, color: theme.textMuted, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
         Расписание
      </div>
      <p style={{ fontSize: 12, color: theme.textDim, margin: '4px 0 12px' }}>
         Если указать прошедшую дату в поле <strong>Окончание</strong>, кампания сразу получит статус «Завершена».
         После этой даты существующие ссылки продолжат работать, но новые комиссии начисляться не будут.
      </p>
      <div className="op-grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
        <div>
           <Label>Начало</Label>
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>
             Пустое значение — начать сразу. До будущей даты кампания скрыта от партнёров.
          </div>
        </div>
        <div>
           <Label>Окончание</Label>
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>
             Пустое значение — без ограничения по времени.
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12, color: theme.textMuted, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
         Условия
      </div>
      <div
        style={{
          margin: '6px 0 12px',
          padding: 10,
          background: `${theme.accentA10}`,
          border: `1px solid ${theme.accentA55}`,
          borderRadius: 6,
          fontSize: 12,
          color: theme.text,
        }}
      >
         Изменение ставки или отсрочки влияет только на <strong>новые партнёрства</strong>.
         Действующие партнёры сохраняют ставку, с которой были одобрены: снимок условий фиксируется
         при одобрении и используется при начислении.
      </div>
      <CompoundRuleEditor rules={rules} onChange={setRules} />
      <CustomerRewardEditor reward={customerReward} onChange={setCustomerReward} />
      <PartnerCodeCustomizationField
        enabled={partnersMayCustomizeCode}
        onChange={setPartnersMayCustomizeCode}
      />
      {/* Network listing is a shared-marketplace surface — hidden for
          white-label tenants, which never appear on the Network. */}
      {!whiteLabel && (
        <MarketplaceFields
          shareOnNetwork={shareOnNetwork}
          onShareChange={setShareOnNetwork}
          description={marketplaceDescription}
          onDescriptionChange={setMarketplaceDescription}
          categories={categories}
          onCategoriesChange={setCategories}
        />
      )}
      <div style={{ marginBottom: 16 }}>
         <Label>Отсрочка выплаты (дни)</Label>
        <Select value={holdbackDays} onChange={(e) => setHoldbackDays(e.target.value)}>
           <option value="0">Нет</option>
           <option value="7">7 дней</option>
           <option value="14">14 дней</option>
           <option value="30">30 дней</option>
           <option value="60">60 дней</option>
           <option value="90">90 дней</option>
        </Select>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          onClick={() => save.mutate()}
          disabled={
            save.isPending ||
            rules.length === 0 ||
            (shareOnNetwork && !marketplaceDescription.trim())
          }
        >
           {save.isPending ? 'Сохраняем…' : 'Сохранить изменения'}
        </Button>
         <Button variant="secondary" onClick={onClose}>Отмена</Button>
      </div>
    </Card>
  );
}

/** Format an ISO timestamp into the value shape <input type="datetime-local">
 *  expects (YYYY-MM-DDTHH:mm in local time). The native control will not
 *  pre-fill from a Z-suffixed ISO string. */
function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CreateProgram({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  // Network status drives the smart default for shareOnNetwork. When the
  // brand is connected, default ON; otherwise hide the toggle entirely
  // (no point promising marketplace listing for a brand that isn't on
  // the marketplace).
  const network = useQuery({
    queryKey: ['network-membership'],
    queryFn: () => api<NetworkConnectionState>('/config/network'),
  });
  const { whiteLabel } = useBrand();
  // White-label tenants are isolated from the Network — treat them as
  // never enabled so the marketplace fields never render.
  const networkEnabled = (network.data?.enabled ?? false) && !whiteLabel;

  const [name, setName] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [deepLinkDomains, setDeepLinkDomains] = useState('');
  const [rules, setRules] = useState<CommissionSubRule[]>([
    { trigger: 'every', type: 'percent', value: 20, recurring: true },
  ]);
  const [customerReward, setCustomerReward] = useState<CustomerReward | null>(null);
  const [shareOnNetwork, setShareOnNetwork] = useState(true);
  const [marketplaceDescription, setMarketplaceDescription] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [partnersMayCustomizeCode, setPartnersMayCustomizeCode] = useState(false);
  const [windowDays, setWindowDays] = useState('60');
  const [model, setModel] = useState<'last_click' | 'first_click' | 'linear' | 'position'>('last_click');
  const [holdbackDays, setHoldbackDays] = useState('0');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [grantToAllPartners, setGrantToAllPartners] = useState(false);

  // The API requires a full URL (z.string().url()) — surface that next to
  // the field instead of a bare 400 after submit. First real-world trip-up:
  // typing "yourbrand.com" without the scheme, so offer the one-click fix.
  const urlProblem = destinationUrlProblem(destinationUrl);
  const schemeFix =
    urlProblem && /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(destinationUrl.trim())
      ? `https://${destinationUrl.trim()}`
      : null;

  const mut = useMutation({
    mutationFn: () =>
      api<Program>('/programs', {
        method: 'POST',
        body: {
          name,
          destinationUrl,
          deepLinkAllowedDomains: deepLinkDomains.trim() || undefined,
          commissionRule: rules,
          attributionWindowDays: Number(windowDays),
          attributionModel: model,
          holdbackDays: Number(holdbackDays) || undefined,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
          customerReward,
          // Only send shareOnNetwork when the brand is connected; otherwise
          // let the server apply its own default (false). Same for
          // marketplaceDescription which has no effect when not listed.
          shareOnNetwork: networkEnabled ? shareOnNetwork : undefined,
          marketplaceDescription:
            networkEnabled && shareOnNetwork && marketplaceDescription.trim()
              ? marketplaceDescription.trim()
              : undefined,
          categories: categories.length > 0 ? categories : undefined,
          partnersMayCustomizeCode: partnersMayCustomizeCode || undefined,
          grantToAllPartners: grantToAllPartners || undefined,
        },
      }),
    onSuccess: onCreated,
  });

  return (
    <Card style={{ marginBottom: 14 }}>
       <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 14 }}>Новая кампания</div>
      <ErrorBanner error={mut.error} />
      <div style={{ marginBottom: 14 }}>
         <Label>Название</Label>
         <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, основная программа" />
      </div>
      <div style={{ marginBottom: 14 }}>
         <Label>URL назначения</Label>
        <Input
          type="url"
          value={destinationUrl}
          onChange={(e) => setDestinationUrl(e.target.value)}
           placeholder="https://syntolk.ru/landing-page"
        />
        {urlProblem ? (
          <div style={{ fontSize: 12, color: theme.danger, marginTop: 4 }}>
            {urlProblem}
            {schemeFix && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => setDestinationUrl(schemeFix)}
                  style={{ background: 'none', border: 'none', color: theme.accent, cursor: 'pointer', padding: 0, fontSize: 12, textDecoration: 'underline' }}
                >
                   Использовать {schemeFix}
                </button>
              </>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>
             Адрес, на который ведут партнёрские ссылки этой кампании. Партнёры не смогут изменить его,
             если ниже не разрешить дополнительные адреса.
          </div>
        )}
      </div>
      <div style={{ marginBottom: 14 }}>
         <Label>Разрешённые домены дополнительных адресов (необязательно)</Label>
        <Input
          value={deepLinkDomains}
          onChange={(e) => setDeepLinkDomains(e.target.value)}
           placeholder="syntolk.ru,docs.syntolk.ru"
        />
        <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>
           Список доменов через запятую. Партнёры смогут менять адрес ссылки только на один из этих доменов.
           Оставьте поле пустым, чтобы запретить изменение адреса.
        </div>
      </div>
      <CompoundRuleEditor rules={rules} onChange={setRules} />
      <CustomerRewardEditor reward={customerReward} onChange={setCustomerReward} />
      <PartnerCodeCustomizationField
        enabled={partnersMayCustomizeCode}
        onChange={setPartnersMayCustomizeCode}
      />
      {networkEnabled && (
        <MarketplaceFields
          shareOnNetwork={shareOnNetwork}
          onShareChange={setShareOnNetwork}
          description={marketplaceDescription}
          onDescriptionChange={setMarketplaceDescription}
          categories={categories}
          onCategoriesChange={setCategories}
        />
      )}
      <div className="op-grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14, marginBottom: 16 }}>
        <div>
           <Label>Окно атрибуции (дни)</Label>
          <Input type="number" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
        </div>
        <div>
          <LabelWithHelp
             label="Модель атрибуции"
            help={[
               'Какому клику назначается комиссия, если в окне было несколько взаимодействий.',
              '',
               'Последний клик — последний клик получает 100%. Простой и предсказуемый вариант по умолчанию.',
               'Первый клик — самый первый клик получает 100%. Поощряет партнёра, который представил компанию.',
               'Линейная — комиссия равномерно делится между всеми кликами в окне.',
               'Позиционная (40 / 20 / 40) — первый и последний клик получают по 40%, средние делят оставшиеся 20%.',
            ].join('\n')}
          />
          <Select value={model} onChange={(e) => setModel(e.target.value as typeof model)}>
             <option value="last_click">Последний клик</option>
             <option value="first_click">Первый клик</option>
             <option value="linear">Линейная</option>
             <option value="position">Позиционная (40 / 20 / 40)</option>
          </Select>
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <LabelWithHelp
           label="Отсрочка выплаты (дни)"
          help={[
             'Сколько дней после конверсии комиссия должна находиться в ожидании перед выплатой.',
            '',
             'Настройте срок под окно возврата или пробный период — например, 30 дней для гарантии возврата или 14 дней для пробного периода. Комиссия начисляется сразу, но остаётся в отсрочке до окончания срока.',
            '',
             'Срок виден партнёрам в описании программы до подачи заявки.',
            '',
             '0 (по умолчанию) = без отсрочки, комиссию можно подтвердить сразу после начисления.',
          ].join('\n')}
        />
        <Select value={holdbackDays} onChange={(e) => setHoldbackDays(e.target.value)}>
           <option value="0">Нет — подтверждать сразу</option>
           <option value="7">7 дней</option>
           <option value="14">14 дней (как пробный период)</option>
           <option value="30">30 дней (как срок возврата)</option>
           <option value="60">60 дней</option>
           <option value="90">90 дней</option>
        </Select>
      </div>
      <div className="op-grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        <div>
           <Label>Начало (необязательно)</Label>
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>
             Оставьте пустым, чтобы начать сразу. До этой даты кампания скрыта от партнёров.
          </div>
        </div>
        <div>
           <Label>Окончание (необязательно)</Label>
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>
             Оставьте пустым, чтобы кампания работала бессрочно. После этой даты ссылки продолжат работать,
             но новые комиссии начисляться не будут.
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: theme.text }}>
          <input
            type="checkbox"
            checked={grantToAllPartners}
            onChange={(e) => setGrantToAllPartners(e.target.checked)}
          />
           Также дать доступ всем действующим партнёрам
        </label>
        <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4, marginLeft: 24 }}>
           По умолчанию выключено, чтобы закрытые кампании оставались приватными. Настройка действует
           только на текущий список партнёров — новым приглашённым доступ нужно выдать отдельно.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          onClick={() => mut.mutate()}
          disabled={
            !name ||
            rules.length === 0 ||
            rules.some((r) => !r.value) ||
            !destinationUrl ||
            urlProblem != null ||
            (networkEnabled && shareOnNetwork && !marketplaceDescription.trim()) ||
            mut.isPending
          }
        >
           {mut.isPending ? 'Создаём…' : 'Создать кампанию'}
        </Button>
         <Button variant="secondary" onClick={onClose}>Отмена</Button>
      </div>
    </Card>
  );
}

/**
 * Editor for one Campaign's commissionRule[]. Each row is one sub-rule.
 *
 * Sub-rules combine: a `subscription_created` event might match both a
 * first-sale bonus AND an every-event recurring rule, producing two
 * Commission rows against the same Attribution. Order in the array doesn't
 * affect engine semantics (each sub-rule evaluates independently).
 */
function CompoundRuleEditor({
  rules,
  onChange,
}: {
  rules: CommissionSubRule[];
  onChange: (rules: CommissionSubRule[]) => void;
}) {
  const update = (i: number, patch: Partial<CommissionSubRule>) => {
    onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const remove = (i: number) => {
    onChange(rules.filter((_, j) => j !== i));
  };
  const add = () => {
    onChange([...rules, { trigger: 'first', eventType: 'subscription_created', type: 'fixed', value: 100 }]);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
         <Label>Правила комиссии</Label>
        <span style={{ fontSize: 12, color: theme.textDim }}>
           Правила складываются — например, разовый бонус плюс регулярная доля выручки.
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        {rules.map((rule, i) => (
          <SubRuleRow
            key={i}
            rule={rule}
            onChange={(patch) => update(i, patch)}
            onRemove={rules.length > 1 ? () => remove(i) : undefined}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        style={{
          background: 'transparent',
          border: `1px dashed ${theme.accentA88}`,
          borderRadius: 6,
          padding: '6px 12px',
          color: theme.accent,
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
         + Добавить бонус или правило
      </button>
    </div>
  );
}

/** Built-in event types brands typically reward on. The list mirrors
 *  EventType in @openpartner/db; custom event names are still accepted
 *  by the engine (string passthrough) but require the "Custom…" escape
 *  hatch in the UI so a typo doesn't silently misroute commissions to
 *  an event that never fires. */
const STANDARD_EVENT_TYPES = [
  { value: 'invoice_paid', label: 'Счёт оплачен' },
  { value: 'subscription_created', label: 'Подписка создана' },
  { value: 'trial_started', label: 'Пробный период начат' },
  { value: 'signup', label: 'Регистрация' },
] as const;
const STANDARD_EVENT_VALUES: ReadonlySet<string> = new Set(STANDARD_EVENT_TYPES.map((e) => e.value));

function SubRuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: CommissionSubRule;
  onChange: (patch: Partial<CommissionSubRule>) => void;
  onRemove?: () => void;
}) {
  // 'custom' is a UI-only sentinel that flips the picker to a freeform
  // input. The eventType payload itself is still a plain string.
  const isCustomEvent = rule.eventType != null && !STANDARD_EVENT_VALUES.has(rule.eventType);
  // Default for the 'every'-trigger "all events" case (no eventType set)
  // is the empty-string sentinel — distinct from picking a known type so
  // the UI can render "All events with value" as the selected option.
  const eventSelectValue = isCustomEvent ? '__custom__' : rule.eventType ?? '';

  return (
    <div
      className="op-grid-collapse"
      style={{
        display: 'grid',
        gridTemplateColumns: '110px 180px 110px 1fr 90px auto',
        gap: 8,
        alignItems: 'center',
        padding: 8,
        background: theme.surface2,
        borderRadius: 6,
      }}
    >
      <Select
        value={rule.trigger}
        onChange={(e) => {
          const trigger = e.target.value as 'every' | 'first' | 'subsequent';
          // Re-default eventType per trigger when the prior value would
          // be confusing in the new context. 'first' / 'subsequent'
          // require an event type — pick a sensible default. 'every'
          // tolerates absent (= all events with value).
          const patch: Partial<CommissionSubRule> = { trigger };
          if ((trigger === 'first' || trigger === 'subsequent') && !rule.eventType) {
            patch.eventType = trigger === 'first' ? 'subscription_created' : 'invoice_paid';
          }
          onChange(patch);
        }}
      >
        <option value="every">На каждое событие</option>
        <option value="first">Только первое</option>
        <option value="subsequent">На каждое последующее</option>
      </Select>
      <Select
        value={eventSelectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__custom__') {
            // Seed with the current value if we already had one, else
            // empty so the user is forced to type. Empty string passes
            // through as undefined on save.
            onChange({ eventType: rule.eventType && !STANDARD_EVENT_VALUES.has(rule.eventType) ? rule.eventType : '' });
          } else if (v === '') {
            onChange({ eventType: undefined });
          } else {
            onChange({ eventType: v });
          }
        }}
      >
        {/* Empty-string option only meaningful for 'every' — 'first' and
            'subsequent' require a specific eventType, so we hide it. */}
       {rule.trigger === 'every' && <option value="">Все события со значением</option>}
        {STANDARD_EVENT_TYPES.map((e) => (
          <option key={e.value} value={e.value}>{e.label}</option>
        ))}
       <option value="__custom__">Пользовательское событие…</option>
      </Select>
      <Select value={rule.type} onChange={(e) => onChange({ type: e.target.value as 'percent' | 'fixed' })}>
         <option value="percent">Процент</option>
         <option value="fixed">Фиксированная сумма</option>
      </Select>
      <Input
        type="number"
        value={rule.value}
        onChange={(e) => onChange({ value: Number(e.target.value) })}
      />
      <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', color: theme.textMuted }}>
        <input
          type="checkbox"
          checked={rule.recurring ?? false}
          onChange={(e) => onChange({ recurring: e.target.checked, recurringMonths: e.target.checked ? rule.recurringMonths : undefined })}
        />
         Регулярная
      </label>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Удалить правило"
          style={{
            background: 'transparent',
            border: 'none',
            color: theme.danger,
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
          }}
        >
          <Trash2 size={14} />
        </button>
      ) : (
        <span />
      )}
      {isCustomEvent && (
        <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, alignItems: 'center' }}>
           <span style={{ fontSize: 12, color: theme.textMuted }}>Название события</span>
          <Input
             placeholder="например, demo_booked"
            value={rule.eventType ?? ''}
            onChange={(e) => onChange({ eventType: e.target.value.trim() || undefined })}
          />
        </div>
      )}
      {rule.recurring && (
        <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'auto 120px 1fr', gap: 8, alignItems: 'center' }}>
           <span style={{ fontSize: 12, color: theme.textMuted }}>Ограничить регулярные начисления</span>
          <Input
            type="number"
            placeholder="∞"
            value={rule.recurringMonths ?? ''}
            onChange={(e) => onChange({ recurringMonths: e.target.value ? Number(e.target.value) : undefined })}
          />
             <span style={{ fontSize: 12, color: theme.textDim }}>
             месяцев с первого атрибуцированного события этого типа. Пустое значение — без ограничения.
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Per-program toggle: can partners self-rename their coupon code?
 *
 * Off (default) = admin-only. The Coupon row's `code` is set at mint time
 * and only the admin can change it. On = the creator portal exposes a
 * rename action; the vendor accepts a federated PATCH on the coupon row.
 *
 * Either way the brand owns the discount terms (customerReward); the
 * partner can only change the string customers type at checkout.
 */
function PartnerCodeCustomizationField({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: theme.text, marginBottom: 6 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onChange(e.target.checked)} />
         Разрешить партнёрам менять промокод
      </label>
      <div style={{ fontSize: 12, color: theme.textDim, marginLeft: 24 }}>
         Выключено (по умолчанию) — все коды контролирует администратор. Включено — партнёр сможет
         выбрать короткий код в своём кабинете (например, <code>GRACIE15</code>). Условия скидки остаются
         неизменными — партнёр меняет только текст кода. При переименовании старый код перестаёт работать.
      </div>
    </div>
  );
}

/**
 * Marketplace presence for the campaign. Only rendered when the brand is
 * connected to the Network (caller gates the mount). Toggle off = the
 * campaign stays private (existing partners only); toggle on = every save
 * upserts the Network listing automatically.
 *
 * marketplaceDescription is the public-facing card copy. Required when
 * shareOnNetwork is on — the marketplace card is the brand's only sales
 * surface for cold creator traffic; an empty card is a missed conversion.
 * UI gates Save when missing; the API also rejects 400.
 */
function MarketplaceFields({
  shareOnNetwork,
  onShareChange,
  description,
  onDescriptionChange,
  categories,
  onCategoriesChange,
}: {
  shareOnNetwork: boolean;
  onShareChange: (v: boolean) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  categories: string[];
  onCategoriesChange: (v: string[]) => void;
}) {
  const toggleCategory = (slug: string) => {
    if (categories.includes(slug)) {
      onCategoriesChange(categories.filter((c) => c !== slug));
    } else {
      // 5-cap matches the API; UI gates here so the user gets feedback
      // before the request rejects.
      if (categories.length >= 5) return;
      onCategoriesChange([...categories, slug]);
    }
  };
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: theme.text, marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={shareOnNetwork}
          onChange={(e) => onShareChange(e.target.checked)}
        />
        Разместить в сети Syntolk
      </label>
      <div style={{ fontSize: 12, color: theme.textDim, marginLeft: 24, marginBottom: shareOnNetwork ? 12 : 0 }}>
         Партнёры в каталоге смогут найти эту кампанию и подать заявку.
         Выключено = приватная кампания (только действующие партнёры).
      </div>
      {shareOnNetwork && (
        <div style={{ marginLeft: 24 }}>
           <Label>Описание в каталоге <span style={{ color: theme.danger }}>*</span></Label>
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={3}
             placeholder="Что вы предлагаете, для кого это и почему это интересно клиентам."
            required
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 13,
              background: theme.surface,
              color: theme.text,
              border: `1px solid ${description.trim() ? theme.borderSubtle : `${theme.danger}66`}`,
              borderRadius: 6,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
          <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4, marginBottom: 12 }}>
             Публичное описание в карточке каталога. Обязательно, если кампания опубликована.
          </div>
           <Label>Категории (до 5)</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {PROGRAM_CATEGORIES.map((cat) => {
              const selected = categories.includes(cat.slug);
              const disabled = !selected && categories.length >= 5;
              return (
                <button
                  key={cat.slug}
                  type="button"
                  onClick={() => toggleCategory(cat.slug)}
                  disabled={disabled}
                  style={{
                    fontSize: 12,
                    padding: '4px 10px',
                    borderRadius: 999,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.4 : 1,
                    background: selected ? `${theme.accentA25}` : 'transparent',
                    color: selected ? theme.accent : theme.textMuted,
                    border: `1px solid ${selected ? theme.accent : theme.borderSubtle}`,
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>
             Помогает партнёрам фильтровать каталог. Выбирайте только подходящие категории —
             слишком большое число меток ухудшает поиск.
          </div>
        </div>
      )}
    </div>
  );
}

function CustomerRewardEditor({
  reward,
  onChange,
}: {
  reward: CustomerReward | null;
  onChange: (reward: CustomerReward | null) => void;
}) {
  const enabled = reward != null;
  const update = (patch: Partial<CustomerReward>) => {
    onChange({ ...(reward as CustomerReward), ...patch });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: theme.text, marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { type: 'percent_off', value: 20, duration: 'repeating', durationInMonths: 3 }
                : null,
            )
          }
        />
        Дать клиенту скидку (двусторонняя программа)
      </label>
      <div style={{ fontSize: 12, color: theme.textDim, marginLeft: 24, marginBottom: 8 }}>
        Автоматически создаётся на коде партнёра. Клиент вводит код при оплате в CloudPayments,
        после чего скидка применяется по правилам вашей программы.
      </div>
      {enabled && reward && (
        <div
          className="op-grid-collapse"
          style={{
            display: 'grid',
            gridTemplateColumns: '160px 130px 130px 1fr',
            gap: 8,
            padding: 8,
            background: theme.surface2,
            borderRadius: 6,
            alignItems: 'end',
          }}
        >
          <div>
         <Label>Тип</Label>
            <Select
              value={reward.type}
              onChange={(e) => {
                const type = e.target.value as CustomerReward['type'];
                if (type === 'free_months') {
                  onChange({ type, value: reward.value || 1, duration: 'repeating' });
                } else {
                  update({ type });
                }
              }}
            >
           <option value="percent_off">Скидка в %</option>
           <option value="amount_off">Скидка в валюте</option>
           <option value="free_months">Бесплатные месяцы</option>
            </Select>
          </div>
          <div>
             <Label>{reward.type === 'free_months' ? 'Месяцы' : 'Значение'}</Label>
            <Input
              type="number"
              value={reward.value}
              onChange={(e) => update({ value: Number(e.target.value) })}
            />
          </div>
          {reward.type === 'amount_off' ? (
            <div>
               <Label>Валюта</Label>
              <Input
                value={reward.currency ?? ''}
                placeholder="USD"
                onChange={(e) => update({ currency: e.target.value.toUpperCase().slice(0, 3) || undefined })}
              />
            </div>
          ) : (
            <div />
          )}
          {reward.type === 'free_months' ? (
            <span style={{ fontSize: 12, color: theme.textDim, paddingBottom: 8 }}>
              Скидка 100% применяется на заданное количество месяцев в платёжной системе.
            </span>
          ) : (
            <div>
               <Label>Срок действия</Label>
              <Select
                value={reward.duration}
                onChange={(e) => {
                  const duration = e.target.value as CustomerReward['duration'];
                  update({
                    duration,
                    durationInMonths: duration === 'repeating' ? reward.durationInMonths ?? 3 : undefined,
                  });
                }}
              >
                 <option value="once">Только первый счёт</option>
                 <option value="forever">Каждый счёт</option>
                 <option value="repeating">Первые N месяцев</option>
              </Select>
            </div>
          )}
          {reward.type !== 'free_months' && reward.duration === 'repeating' && (
            <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'auto 120px 1fr', gap: 8, alignItems: 'center' }}>
               <span style={{ fontSize: 12, color: theme.textMuted }}>Применять</span>
              <Input
                type="number"
                value={reward.durationInMonths ?? ''}
                onChange={(e) => update({ durationInMonths: e.target.value ? Number(e.target.value) : undefined })}
              />
               <span style={{ fontSize: 12, color: theme.textDim }}>месяцев с первого счёта клиента.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Field label with a hover-to-explain question-mark icon. Uses the
 *  native `title` attribute so we don't need a tooltip library — the
 *  browser handles positioning, multi-line via \n. Help text should be
 *  plain prose; no HTML. */
/** Mirror of the API's z.string().url() so the form explains the rule
 *  instead of bouncing a 400. Null = fine (empty is gated separately). */
function destinationUrlProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    const url = new URL(v);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return 'Укажите адрес http(s).';
    }
    return null;
  } catch {
    return 'Укажите полный URL, начинающийся с https:// — например, https://syntolk.ru/landing.';
  }
}

function LabelWithHelp({ label, help }: { label: string; help: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Label>{label}</Label>
      <span
        title={help}
        aria-label={help}
        style={{ display: 'inline-flex', alignItems: 'center', color: theme.textDim, cursor: 'help', marginBottom: 4 }}
      >
        <HelpCircle size={14} />
      </span>
    </div>
  );
}

function ProgramStatusPill({ campaign }: { campaign: Pick<Program, 'startsAt' | 'endsAt'> }) {
  const status = statusOf(campaign);
  const palette: Record<ProgramStatus, { bg: string; fg: string; label: string }> = {
    active: { bg: theme.successSoft, fg: theme.success, label: 'Активна' },
    scheduled: { bg: `${theme.accentA15}`, fg: theme.accent, label: 'Запланирована' },
    ended: { bg: theme.surface2, fg: theme.textMuted, label: 'Завершена' },
  };
  const { bg, fg, label } = palette[status];
  return (
    <span style={{ background: bg, color: fg, fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 600 }}>
      {label}
    </span>
  );
}

function modelLabel(model: string): string {
  if (model === 'last_click') return 'последний клик';
  if (model === 'first_click') return 'первый клик';
  if (model === 'linear') return 'линейная';
  if (model === 'position') return 'позиционная';
  return model;
}
