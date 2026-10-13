import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, currentTenantSlug } from '../../api.js';
import { Button, Card, ErrorBanner, Input, Select, Stat, Textarea } from '../../ui.js';
import { ManagementFields, defaultManagement, defaultQuestions, type ManagementPolicy, type InterviewQuestion } from './CoachManagement.js';

export type CoachTone = 'warm' | 'energetic' | 'business';
export type CoachAddress = 'ty' | 'vy';
export type CoachReplyLength = 'brief' | 'balanced' | 'detailed';

export interface CoachBehavior {
  name: string;
  tone: CoachTone;
  address: CoachAddress;
  replyLength: CoachReplyLength;
  systemPrompt: string;
  greeting: string;
  mascotEnabled: boolean;
  management: ManagementPolicy;
  interviewQuestions: InterviewQuestion[];
}

export interface CoachDirectives {
  prompt: string;
  strengths: string;
  focus: string;
  dailyReviewEnabled: boolean;
  dailyReviewHour: number;
  tone?: CoachTone;
  address?: CoachAddress;
  replyLength?: CoachReplyLength;
  management?: ManagementPolicy;
}

interface BehaviorResponse {
  behavior: CoachBehavior;
  version: number;
}

interface DirectivesResponse {
  directives: CoachDirectives;
  version: number;
  schedulerEnabled: boolean;
}

interface DirectivesPatchResponse {
  directives: CoachDirectives;
  version: number;
  schedulerEnabled?: boolean;
}

interface SettingsProps {
  partnerId?: string;
  onChanged?: () => void;
}

interface ContextCounts {
  clicks?: number;
  registrations?: number;
  payments?: number;
  paymentCount?: number;
  payingCustomers?: number;
  [key: string]: number | undefined;
}

interface ContextLink {
  id?: string;
  linkId?: string;
  key?: string;
  linkKey?: string;
  label?: string | null;
  url?: string | null;
  fullUrl?: string | null;
  href?: string | null;
  clicks?: number;
  registrations?: number;
  payments?: number;
  payingCustomers?: number;
}

interface CoachContextPayload {
  generatedAt: string;
  context: {
    partner?: { name?: string };
    profile?: unknown;
    links?: ContextLink[];
    metrics?: {
      counts?: ContextCounts;
      links?: ContextLink[];
      period?: { from?: string; to?: string; since?: string; until?: string } | null;
    };
    currentTasks?: unknown[];
    recentActivity?: unknown[];
    forecast?: unknown;
    messages?: unknown[];
    program?: { name?: string } | null;
  };
  capabilities?: Record<string, boolean>;
  limits?: string[];
}

const DEFAULT_BEHAVIOR: CoachBehavior = {
  name: 'Syntolk',
  tone: 'warm',
  address: 'vy',
  replyLength: 'balanced',
  systemPrompt: '',
  greeting: '',
  mascotEnabled: true,
  management: defaultManagement,
  interviewQuestions: defaultQuestions,
};

const DEFAULT_DIRECTIVES: CoachDirectives = {
  prompt: '',
  strengths: '',
  focus: '',
  dailyReviewEnabled: false,
  dailyReviewHour: 10,
};

const CAPABILITY_LABELS: Record<string, string> = {
  profile: 'Анкета',
  links: 'Ссылки',
  metrics: 'Показатели',
  tasks: 'Задания',
  submittedText: 'Присланный текст',
  calculatorSnapshot: 'Снимок калькулятора',
  externalVideo: 'Видео соцсетей',
  browserScreen: 'Экран',
  financialActions: 'Управление выплатами',
};

const errorIsConflict = (error: unknown): boolean =>
  error instanceof ApiError
    ? error.status === 409
    : error instanceof Error && /409|изменил|конфликт|устарел/i.test(error.message);

const partnerPath = (partnerId: string, suffix: string): string =>
  `/admin/coach/partners/${encodeURIComponent(partnerId)}${suffix}`;

const displayNumber = (value: number | undefined): string =>
  typeof value === 'number' ? value.toLocaleString('ru-RU') : '—';

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
};

const formatDate = (value: string): string => {
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ru-RU');
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? value as Record<string, unknown> : null;

const readText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

const taskTitle = (task: unknown, index: number): string => {
  const record = readRecord(task);
  return readText(record?.title) ?? readText(record?.name) ?? `Задание ${index + 1}`;
};

const taskSubmission = (task: unknown): string | null => {
  const record = readRecord(task);
  return readText(record?.submission) ?? readText(record?.submittedText) ?? readText(record?.text);
};

const mergeLinks = (metricsLinks: ContextLink[] = [], contextLinks: ContextLink[] = []): ContextLink[] => {
  const merged = new Map<string, ContextLink>();
  [...metricsLinks, ...contextLinks].forEach((link, index) => {
    const key = link.id ?? link.linkId ?? link.key ?? link.linkKey ?? link.url ?? link.fullUrl ?? `link-${index}`;
    merged.set(key, { ...merged.get(key), ...link });
  });
  return [...merged.values()];
};

function ErrorState({ error, conflict, onRefresh }: { error: unknown; conflict?: boolean; onRefresh: () => void }) {
  return (
    <>
      <ErrorBanner error={error} />
      {conflict && (
        <div className="coach-connection-info" role="alert">
          <strong>Настройки изменились в другом окне</strong>
          <p className="coach-muted">Загрузите актуальную версию, проверьте свой черновик и повторите сохранение. Текущие поля не будут перезаписаны.</p>
          <Button variant="secondary" onClick={onRefresh}>Обновить версию и сохранить черновик</Button>
        </div>
      )}
    </>
  );
}

export function CoachBehaviorSettings({ partnerId, onChanged }: SettingsProps) {
  const scope = currentTenantSlug();
  const cache = useQueryClient();
  const isGlobal = !partnerId;
  const queryKey = ['coach-behavior-settings', scope, partnerId ?? 'global'];
  const endpoint = isGlobal ? '/admin/coach/behavior' : partnerPath(partnerId, '/directives');
  const settings = useQuery<BehaviorResponse | DirectivesResponse>({
    queryKey,
    queryFn: () => api<BehaviorResponse | DirectivesResponse>(endpoint),
    retry: false,
  });
  const [behavior, setBehavior] = useState<CoachBehavior>(DEFAULT_BEHAVIOR);
  const [directives, setDirectives] = useState<CoachDirectives>(DEFAULT_DIRECTIVES);
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const [notice, setNotice] = useState('');
  const initializedScope = useRef<string | null>(null);
  const draftScope = `${scope??'default'}:${partnerId??'global'}`;

  const applySettings = useCallback((data: BehaviorResponse | DirectivesResponse | DirectivesPatchResponse) => {
    setVersion(data.version);
    if (isGlobal && 'behavior' in data) {
      setBehavior({ ...DEFAULT_BEHAVIOR, ...data.behavior });
    }
    if (!isGlobal && 'directives' in data) {
      setDirectives({ ...DEFAULT_DIRECTIVES, ...data.directives });
    }
  }, [isGlobal]);

  useEffect(() => {
    if (!settings.data || initializedScope.current === draftScope) return;
    // Only the first load for this partner/global scope populates the draft.
    // Background refetches must not erase text the administrator is editing.
    initializedScope.current = draftScope;
    applySettings(settings.data);
  }, [settings.data, draftScope, applySettings]);

  const schedulerEnabled = !isGlobal && settings.data && 'schedulerEnabled' in settings.data
    ? settings.data.schedulerEnabled
    : false;
  const conflict = errorIsConflict(saveError);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setNotice('');
    try {
      if (isGlobal) {
        const next = await api<BehaviorResponse>(endpoint, { method: 'PATCH', body: { version, behavior } });
        setVersion(next.version);
        cache.setQueryData(queryKey, next);
      } else {
        const next = await api<DirectivesPatchResponse>(endpoint, { method: 'PATCH', body: { version, directives } });
        // The PATCH response intentionally omits schedulerEnabled. Keep the
        // GET value in the cache so a successful save does not show a false
        // "выключен" status until the next explicit refresh.
        cache.setQueryData<DirectivesResponse>(queryKey, {
          ...next,
          schedulerEnabled: next.schedulerEnabled ?? schedulerEnabled,
        });
        setVersion(next.version);
      }
      onChanged?.();
      setNotice('Настройки сохранены.');
    } catch (error) {
      setSaveError(error as Error);
    } finally {
      setSaving(false);
    }
  };

  const rebaseSettings = async () => {
    setSaveError(null);
    try {
      const result = await settings.refetch();
      if (result.error) throw result.error;
      if (result.data) {
        // Refresh only the optimistic-lock version. Keep the edited fields so
        // the administrator can review/rebase the draft explicitly.
        setVersion(result.data.version);
        setNotice('Актуальная версия загружена. Черновик сохранён — проверьте его и повторите сохранение.');
      }
    } catch (error) {
      setSaveError(error as Error);
    }
  };

  const changeOptionalStyle = (field: 'tone' | 'address' | 'replyLength', value: string) => {
    const next = { ...directives };
    if (!value) {
      delete next[field];
    } else if (field === 'tone') {
      next.tone = value as CoachTone;
    } else if (field === 'address') {
      next.address = value as CoachAddress;
    } else {
      next.replyLength = value as CoachReplyLength;
    }
    setDirectives(next);
  };

  return (
    <Card>
      <section className="coach" aria-label={isGlobal ? 'Поведение и промпт' : 'Индивидуальные указания'}>
        <div className="coach-row">
          <div>
            <h2>{isGlobal ? 'Поведение и промпт' : 'Индивидуальные указания'}</h2>
            <p className="coach-muted">
              {isGlobal
                ? 'Эти параметры задают общий стиль ответов и приветствие куратора для партнёрской программы.'
                : 'Эти указания уточняют работу куратора для выбранного партнёра и не меняют настройки остальных.'}
            </p>
          </div>
          {!isGlobal && <span className="coach-badge">{schedulerEnabled ? 'Планировщик включён' : 'Планировщик выключен'}</span>}
        </div>
        <ErrorState error={saveError ?? settings.error} conflict={conflict} onRefresh={() => { void rebaseSettings(); }} />
        {settings.isLoading && <p role="status">Загружаем настройки…</p>}
        {settings.data && isGlobal && (
          <>
            <div className="coach-grid">
              <label className="coach-field"><span>Имя помощника</span><Input value={behavior.name} disabled={saving} onChange={(event) => setBehavior({ ...behavior, name: event.target.value })} /></label>
              <label className="coach-field"><span>Тон общения</span><Select value={behavior.tone} disabled={saving} onChange={(event) => setBehavior({ ...behavior, tone: event.target.value as CoachTone })}><option value="warm">Тёплый</option><option value="energetic">Энергичный</option><option value="business">Деловой</option></Select></label>
              <label className="coach-field"><span>Обращение к партнёру</span><Select value={behavior.address} disabled={saving} onChange={(event) => setBehavior({ ...behavior, address: event.target.value as CoachAddress })}><option value="vy">На «вы»</option><option value="ty">На «ты»</option></Select></label>
              <label className="coach-field"><span>Длина ответа</span><Select value={behavior.replyLength} disabled={saving} onChange={(event) => setBehavior({ ...behavior, replyLength: event.target.value as CoachReplyLength })}><option value="brief">Краткий</option><option value="balanced">Сбалансированный</option><option value="detailed">Подробный</option></Select></label>
            </div>
            <label className="coach-field"><span>Системный промпт</span><Textarea aria-label="Системный промпт" rows={6} value={behavior.systemPrompt} disabled={saving} placeholder="Общие правила, цели и ограничения для куратора" onChange={(event) => setBehavior({ ...behavior, systemPrompt: event.target.value })} /></label>
            <label className="coach-field"><span>Приветствие</span><Textarea aria-label="Приветствие" rows={3} value={behavior.greeting} disabled={saving} placeholder="Текст первого сообщения партнёру" onChange={(event) => setBehavior({ ...behavior, greeting: event.target.value })} /></label>
            <p className="coach-muted">В приветствии можно использовать плейсхолдеры: {'{name}'} — имя партнёра, {'{assistant}'} — имя помощника, {'{goal}'} — цель партнёра.</p>
            <label><input type="checkbox" checked={behavior.mascotEnabled} disabled={saving} onChange={(event) => setBehavior({ ...behavior, mascotEnabled: event.target.checked })} /> Показывать анимированного помощника в чате</label>
            <ManagementFields value={behavior.management} disabled={saving} onChange={management=>setBehavior({...behavior,management})}/>
            <h3>Вопросы первого знакомства</h3><p className="coach-muted">Партнёр отвечает свободным текстом. Вопросы, ответы и расписание получает ИИ. Изменения применяются к следующим подтверждениям анкеты; старые ответы сохраняются.</p>
            {behavior.interviewQuestions.map((question,index)=><div className="coach-channel" key={question.id}><label className="coach-field"><span>Вопрос {index+1}</span><Textarea rows={2} maxLength={500} value={question.question} disabled={saving} onChange={e=>setBehavior({...behavior,interviewQuestions:behavior.interviewQuestions.map(q=>q.id===question.id?{...q,question:e.target.value}:q)})}/></label><label><input type="checkbox" checked={question.required} disabled={saving} onChange={e=>setBehavior({...behavior,interviewQuestions:behavior.interviewQuestions.map(q=>q.id===question.id?{...q,required:e.target.checked}:q)})}/> Обязательный ответ</label><Button variant="ghost" disabled={saving||behavior.interviewQuestions.length<=1} onClick={()=>setBehavior({...behavior,interviewQuestions:behavior.interviewQuestions.filter(q=>q.id!==question.id)})}>Убрать вопрос {index+1}</Button></div>)}
            <Button variant="secondary" disabled={saving||behavior.interviewQuestions.length>=12} onClick={()=>setBehavior({...behavior,interviewQuestions:[...behavior.interviewQuestions,{id:`q-${crypto.randomUUID().slice(0,8)}`,question:'Что ещё важно учитывать вашему менеджеру?',required:false}]})}>Добавить вопрос</Button>
          </>
        )}
        {settings.data && !isGlobal && (
          <>
            <p className="coach-muted">Индивидуальные указания и выбранные ниже параметры стиля имеют приоритет над общими настройками. Пустое значение наследует общие настройки.</p>
            <label><input type="checkbox" checked={!!directives.management} disabled={saving} onChange={e=>{const next={...directives};if(e.target.checked)next.management={...defaultManagement};else delete next.management;setDirectives(next);}}/> Индивидуальные правила контроля</label>
            {directives.management&&<ManagementFields value={directives.management} disabled={saving} onChange={management=>setDirectives({...directives,management})}/>}
            <div className="coach-grid">
              <label className="coach-field"><span>Индивидуальный тон</span><Select value={directives.tone ?? ''} disabled={saving} onChange={(event) => changeOptionalStyle('tone', event.target.value)}><option value="">Как в общих настройках</option><option value="warm">Тёплый</option><option value="energetic">Энергичный</option><option value="business">Деловой</option></Select></label>
              <label className="coach-field"><span>Индивидуальное обращение</span><Select value={directives.address ?? ''} disabled={saving} onChange={(event) => changeOptionalStyle('address', event.target.value)}><option value="">Как в общих настройках</option><option value="vy">На «вы»</option><option value="ty">На «ты»</option></Select></label>
              <label className="coach-field"><span>Индивидуальная длина ответа</span><Select value={directives.replyLength ?? ''} disabled={saving} onChange={(event) => changeOptionalStyle('replyLength', event.target.value)}><option value="">Как в общих настройках</option><option value="brief">Краткий</option><option value="balanced">Сбалансированный</option><option value="detailed">Подробный</option></Select></label>
            </div>
            <label className="coach-field"><span>Индивидуальный промпт</span><Textarea aria-label="Индивидуальный промпт" rows={6} value={directives.prompt} disabled={saving} placeholder="Что куратор должен учитывать при работе с этим партнёром" onChange={(event) => setDirectives({ ...directives, prompt: event.target.value })} /></label>
            <div className="coach-grid">
              <label className="coach-field"><span>Сильные стороны партнёра</span><Textarea aria-label="Сильные стороны партнёра" rows={4} value={directives.strengths} disabled={saving} placeholder="Например: сильный блог, активная аудитория" onChange={(event) => setDirectives({ ...directives, strengths: event.target.value })} /></label>
              <label className="coach-field"><span>Главный фокус</span><Textarea aria-label="Главный фокус" rows={4} value={directives.focus} disabled={saving} placeholder="На чём сосредоточить ближайшие рекомендации" onChange={(event) => setDirectives({ ...directives, focus: event.target.value })} /></label>
            </div>
            <label><input type="checkbox" checked={directives.dailyReviewEnabled} disabled={saving} onChange={(event) => setDirectives({ ...directives, dailyReviewEnabled: event.target.checked })} /> Включить ежедневные обзоры для этого партнёра</label>
            {directives.dailyReviewEnabled && <><label className="coach-field"><span>Час ежедневного обзора (0–23)</span><Input type="number" min={0} max={23} value={directives.dailyReviewHour} disabled={saving} onChange={(event) => setDirectives({ ...directives, dailyReviewHour: Math.min(23, Math.max(0, Number(event.target.value) || 0)) })} /></label><p className="coach-muted">Время берётся из часового пояса профиля. Обзор запускается при включённой настройке администратора, если режим партнёра не «Пауза» и не «Отключено», с учётом тихих часов профиля. Согласие на личные напоминания и режим «Мягкие напоминания» для обзора не нужны.</p></>}
            {directives.dailyReviewEnabled && !schedulerEnabled && <p className="coach-warning">Настройка сохранена, но планировщик фоновых запусков сейчас неактивен.</p>}
          </>
        )}
        {settings.data && <div className="coach-actions"><Button disabled={saving} onClick={() => { void save(); }}>{saving ? 'Сохраняем…' : 'Сохранить настройки'}</Button></div>}
        {notice && <p role="status" className="coach-badge">{notice}</p>}
      </section>
    </Card>
  );
}

export interface CoachContextInspectorProps {
  partnerId: string;
  programId?: string;
}

export function CoachContextInspector({ partnerId, programId }: CoachContextInspectorProps) {
  const scope = currentTenantSlug();
  const endpoint = useMemo(() => {
    const query = programId ? `?programId=${encodeURIComponent(programId)}` : '';
    return partnerPath(partnerId, `/context${query}`);
  }, [partnerId, programId]);
  const context = useQuery<CoachContextPayload>({
    queryKey: ['coach-context-inspector', scope, partnerId, programId ?? 'all'],
    queryFn: () => api<CoachContextPayload>(endpoint),
    retry: false,
  });
  const data = context.data;
  const metrics = data?.context.metrics;
  const counts = metrics?.counts ?? {};
  const links = useMemo(() => mergeLinks(metrics?.links, data?.context.links), [metrics?.links, data?.context.links]);
  const forecastAvailable = data?.context.forecast !== null && data?.context.forecast !== undefined;
  const period = metrics?.period;
  const periodText = period && (period.from || period.since || period.to || period.until)
    ? `${formatDate(period.from ?? period.since ?? '—')} — ${formatDate(period.to ?? period.until ?? '—')}`
    : 'Период не указан';

  return (
    <Card>
      <section className="coach" aria-label="Фактический контекст партнёра">
        <div className="coach-row">
          <div>
            <h2>Фактические данные партнёра</h2>
            <p className="coach-muted">Снимок данных, который куратор может использовать в ответах и ежедневных разборах.</p>
          </div>
          <div className="coach-actions">
            {data?.context.partner?.name && <span className="coach-badge">{data.context.partner.name}</span>}
            <Button variant="secondary" disabled={context.isFetching} onClick={() => { void context.refetch(); }}>{context.isFetching ? 'Обновляем…' : 'Обновить данные'}</Button>
          </div>
        </div>
        <ErrorBanner error={context.error} />
        {context.isLoading && <p role="status">Загружаем фактические данные…</p>}
        {data && (
          <>
            <div className="coach-connection-info">
              <strong>Снимок контекста</strong>
              <p className="coach-muted">Сформирован: {formatDateTime(data.generatedAt)} · Период: {periodText}</p>
              {data.context.program?.name && <p className="coach-muted">Программа: {data.context.program.name}</p>}
            </div>
            <div className="coach-grid">
              <Stat label="Переходы" value={displayNumber(counts.clicks)} />
              <Stat label="Регистрации" value={displayNumber(counts.registrations)} />
              <Stat label="Оплаты" value={displayNumber(counts.payments ?? counts.paymentCount)} />
              <Stat label="Платящие клиенты" value={displayNumber(counts.payingCustomers)} />
            </div>
            <div className="coach-row"><h3>Доступность снимка</h3><span className={forecastAvailable ? 'coach-badge' : 'coach-warning'}>{forecastAvailable ? 'Прогноз доступен' : 'Подтверждённого прогноза нет'}</span></div>
            <h3>Ссылки и их результаты</h3>
            {links.length === 0 ? <p className="coach-muted">Ссылки пока не зафиксированы в контексте.</p> : <div className="coach-channel"><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={{ textAlign: 'left' }}>Ссылка</th><th style={{ textAlign: 'right' }}>Переходы</th><th style={{ textAlign: 'right' }}>Регистрации</th></tr></thead><tbody>{links.map((link, index) => { const key = link.key ?? link.linkKey ?? link.id ?? link.linkId; const url = link.url ?? link.fullUrl ?? link.href; return <tr key={key ?? index}><td style={{ padding: '10px 0' }}><strong>{link.label ?? key ?? 'Без названия'}</strong>{key && link.label && <><br /><code>{key}</code></>}{url && <><br /><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></>}</td><td style={{ textAlign: 'right' }}>{displayNumber(link.clicks)}</td><td style={{ textAlign: 'right' }}>{displayNumber(link.registrations)}</td></tr>; })}</tbody></table></div>}
            {data.capabilities && <><h3>Возможности контекста</h3><div className="coach-grid">{Object.entries(data.capabilities).map(([name, available]) => <div className="coach-connection-info" key={name}><strong>{CAPABILITY_LABELS[name] ?? name}</strong><p className="coach-muted">{available ? 'Доступно' : 'Недоступно'}</p></div>)}</div></>}
            {(data.context.currentTasks?.length ?? 0) > 0 && <details><summary>Текущие задания ({data.context.currentTasks?.length})</summary><div className="coach-channel">{data.context.currentTasks?.map((task, index) => <div key={index}><strong>{taskTitle(task, index)}</strong>{taskSubmission(task) && <p className="coach-pre">Присланный текст: {taskSubmission(task)}</p>}</div>)}</div></details>}
            <p className="coach-muted">В контексте: заданий — {data.context.currentTasks?.length ?? 0}, событий — {data.context.recentActivity?.length ?? 0}, сообщений — {data.context.messages?.length ?? 0}.</p>
            {data.limits && data.limits.length > 0 ? <details><summary>Ограничения контекста ({data.limits.length})</summary><ul>{data.limits.map((limit, index) => <li key={`${limit}-${index}`}>{limit}</li>)}</ul></details> : <p className="coach-muted">Ограничений не передано.</p>}
          </>
        )}
      </section>
    </Card>
  );
}
