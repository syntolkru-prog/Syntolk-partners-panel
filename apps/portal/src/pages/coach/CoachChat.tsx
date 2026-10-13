import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, currentTenantSlug } from '../../api.js';
import { useTenantBase } from '../../tenant-base.js';
import './companion.css';

type CoachProfile = {
  status?: string;
  data?: Record<string, unknown>;
} | null;

type CoachMe = {
  enabled: boolean;
  takeover?: boolean;
  configured?: boolean;
  profile: CoachProfile;
  programs: Array<{ id: string; name: string }>;
  assistant?: {
    name?: string;
    greeting?: string;
    mascotEnabled?: boolean;
  };
};

type CoachWelcome = {
  enabled: boolean;
  paused: boolean;
  needsOnboarding: boolean;
  takeover: boolean;
  message: string;
};

type CoachMessage = {
  id: string;
  role: string;
  createdAt: string;
  data: { body?: string; model?: string };
};

type CoachRun = {
  id: string;
  status: string;
  kind?: string;
  data?: { error?: string | { code?: string; message?: string }; message?: string };
};

type QueryKey = readonly unknown[];

export interface CoachChatProps {
  partnerId: string;
  prefix?: string;
  programId?: string;
  draft?: string;
  onDraftChange?: (draft: string) => void;
}

const activeRunStatuses = new Set(['queued', 'processing']);

function endpoint(prefix: string, child?: string): string {
  const cleanPrefix = prefix.replace(/\/$/, '');
  return child ? `${cleanPrefix}/${child}` : cleanPrefix;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Не удалось связаться с помощником. Попробуйте ещё раз.';
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function isJob(run: CoachRun): boolean {
  return activeRunStatuses.has(run.status);
}

function isChatJob(run: CoachRun): boolean {
  return (run.kind === 'message' || run.kind === 'daily') && isJob(run);
}

function runErrorText(run: CoachRun): string {
  const error = run.data?.error;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message) return error.message;
  return 'Не удалось подготовить ответ.';
}

/** Render the small markdown subset we support without ever interpreting HTML. */
function renderMessageBody(value: string): ReactNode {
  return value.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/** Small code-native SVG mascot shared by the compact invitation and messages. */
export function CoachCreature({ size = 42 }: { size?: number }) {
  const gradientId = `syntolk-coach-creature-fill-${useId().replace(/:/g, '')}`;
  return (
    <svg
      className="syntolk-coach-creature"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Дружелюбный помощник Syntolk"
    >
      <defs>
        <linearGradient id={gradientId} x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#65f2dc" />
          <stop offset="1" stopColor="#159f9a" />
        </linearGradient>
      </defs>
      <path className="syntolk-coach-creature__antenna" d="M32 16V9m0 0c0-4 5-5 7-2" />
      <circle className="syntolk-coach-creature__spark" cx="40" cy="6" r="2" />
      <path
        className="syntolk-coach-creature__body"
        fill={`url(#${gradientId})`}
        d="M13 30c0-11 8-19 19-19s19 8 19 19v11c0 9-8 15-19 15s-19-6-19-15V30Z"
      />
      <path className="syntolk-coach-creature__fin" d="M13 35c-5-1-8 2-8 6 3 0 7-1 9-4m37-2c5-1 8 2 8 6-3 0-7-1-9-4" />
      <circle className="syntolk-coach-creature__eye" cx="25" cy="33" r="3" />
      <circle className="syntolk-coach-creature__eye" cx="39" cy="33" r="3" />
      <path className="syntolk-coach-creature__smile" d="M25 42c4 4 10 4 14 0" />
      <path className="syntolk-coach-creature__belly" d="M25 49c4 2 10 2 14 0" />
    </svg>
  );
}

export function CoachChat({
  partnerId,
  prefix = '/coach/me',
  programId,
  draft,
  onDraftChange,
}: CoachChatProps) {
  const chatTitleId = `syntolk-coach-chat-title-${useId().replace(/:/g, '')}`;
  const tenantSlug = currentTenantSlug();
  const tenantBase = useTenantBase();
  const queryClient = useQueryClient();
  const baseKey = useMemo<QueryKey>(
    () => ['coach', tenantSlug, partnerId, prefix],
    [partnerId, prefix, tenantSlug],
  );
  const messagesKey = useMemo<QueryKey>(() => [...baseKey, 'messages'], [baseKey]);
  const runsKey = useMemo<QueryKey>(() => [...baseKey, 'runs'], [baseKey]);
  const [localDraft, setLocalDraft] = useState(draft ?? '');
  const [selectedProgramId, setSelectedProgramId] = useState(programId ?? '');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSubmittedText = useRef('');
  const wasActive = useRef(false);
  const identityKey = `${tenantSlug ?? 'default'}:${partnerId}:${prefix}`;
  const previousIdentityKey = useRef(identityKey);
  const identityRef = useRef(identityKey);
  const mountedRef = useRef(true);
  const requestSerial = useRef(0);

  // Move the ownership guard during render so a promise resolved between the
  // new render and its effects cannot update the previous partner's chat.
  if (identityRef.current !== identityKey) identityRef.current = identityKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSerial.current += 1;
    };
  }, []);

  const me = useQuery({
    queryKey: [...baseKey, 'me'],
    queryFn: () => api<CoachMe>(prefix),
    enabled: Boolean(partnerId),
    staleTime: 30_000,
  });
  const profileComplete = me.data?.profile?.status === 'complete';
  const selectedProgram = selectedProgramId || programId || me.data?.programs[0]?.id || '';
  const welcome = useQuery({
    queryKey: [...baseKey, 'welcome'],
    queryFn: () => api<CoachWelcome>(endpoint(prefix, 'welcome')),
    enabled: Boolean(me.data),
    staleTime: 30_000,
  });
  const messages = useQuery({
    queryKey: messagesKey,
    queryFn: () => api<{ messages: CoachMessage[] }>(endpoint(prefix, 'messages')),
    enabled: Boolean(me.data?.enabled),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
  const runs = useQuery({
    queryKey: runsKey,
    queryFn: () => api<{ runs: CoachRun[] }>(endpoint(prefix, 'runs')),
    enabled: Boolean(me.data?.enabled),
    refetchInterval: (query) => {
      const rows = query.state.data?.runs ?? [];
      return rows.some(isJob) ? 1_500 : 10_000;
    },
    refetchIntervalInBackground: false,
  });

  const currentDraft = draft ?? localDraft;
  const activeRuns = runs.data?.runs?.filter(isChatJob) ?? [];
  const latestMessageRun = runs.data?.runs?.find((run) => run.kind === 'message');
  const failedRun = latestMessageRun?.status === 'failed' ? latestMessageRun : undefined;
  const failedText = lastSubmittedText.current || failedRun?.data?.message || '';
  const takeover = Boolean(me.data?.takeover || welcome.data?.takeover);
  const paused = Boolean(welcome.data?.paused && !takeover);
  const canCompose = Boolean(me.data?.enabled && !paused && selectedProgram && (profileComplete || takeover));
  const assistantName = me.data?.assistant?.name || 'Синти';
  const greeting = me.data?.assistant?.greeting || 'Я рядом и помогу выбрать следующий посильный шаг.';
  const profileHref = prefix.startsWith('/admin/')
    ? `${tenantBase}/admin/coach?tab=partners&partnerId=${encodeURIComponent(partnerId)}`
    : `${tenantBase}/coach?tab=profile`;

  useEffect(() => {
    if (draft !== undefined) setLocalDraft(draft);
  }, [draft]);

  useEffect(() => {
    if (previousIdentityKey.current === identityKey) return;
    previousIdentityKey.current = identityKey;
    identityRef.current = identityKey;
    requestSerial.current += 1;
    setSending(false);
    setSendError(null);
    lastSubmittedText.current = '';
    wasActive.current = false;
    if (draft === undefined) setLocalDraft('');
    setSelectedProgramId(programId ?? '');
  }, [draft, identityKey, programId]);

  useEffect(() => {
    if (programId !== undefined) setSelectedProgramId(programId);
  }, [programId]);

  useEffect(() => {
    if (!selectedProgramId && !programId && me.data?.programs[0]?.id) {
      setSelectedProgramId(me.data.programs[0].id);
    }
  }, [me.data?.programs, programId, selectedProgramId]);

  useEffect(() => {
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const scrollIntoView = bottomRef.current?.scrollIntoView;
    if (typeof scrollIntoView === 'function') {
      scrollIntoView.call(bottomRef.current, { behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    }
  }, [messages.data?.messages?.length, activeRuns.length]);

  useEffect(() => {
    const active = activeRuns.length > 0;
    if (wasActive.current && !active) {
      void queryClient.invalidateQueries({ queryKey: baseKey });
    }
    wasActive.current = active;
  }, [activeRuns.length, baseKey, queryClient]);

  const changeDraft = (value: string) => {
    if (draft === undefined) setLocalDraft(value);
    onDraftChange?.(value);
  };

  const send = async (override?: string) => {
    const text = (override ?? currentDraft).trim();
    if (!text || !canCompose || sending) return;
    const requestIdentity = identityKey;
    const requestId = ++requestSerial.current;
    const isCurrentRequest = () => mountedRef.current && identityRef.current === requestIdentity && requestSerial.current === requestId;
    lastSubmittedText.current = text;
    setSending(true);
    setSendError(null);
    try {
      await api(endpoint(prefix, 'messages'), {
        method: 'POST',
        body: {
          programId: selectedProgram,
          requestId: crypto.randomUUID(),
          text,
        },
      });
      if (!isCurrentRequest()) return;
      changeDraft('');
      await queryClient.invalidateQueries({ queryKey: messagesKey });
      await queryClient.invalidateQueries({ queryKey: runsKey });
    } catch (error) {
      // Deliberately keep the draft intact so a transient error never loses the request.
      if (isCurrentRequest()) setSendError(errorText(error));
    } finally {
      if (isCurrentRequest()) setSending(false);
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  if (me.isLoading) {
    return <div className="syntolk-coach-chat syntolk-coach-chat--loading" aria-busy="true">Загрузка помощника…</div>;
  }

  if (me.error) {
    return (
      <div className="syntolk-coach-chat syntolk-coach-chat--error" role="alert">
        <CoachCreature size={44} />
        <div>
          <strong>Помощник временно недоступен</strong>
          <p>{errorText(me.error)}</p>
          <button className="syntolk-coach-button syntolk-coach-button--secondary" type="button" onClick={() => void me.refetch()}>
            Повторить
          </button>
        </div>
      </div>
    );
  }

  if (!me.data?.enabled) {
    return (
      <div className="syntolk-coach-chat syntolk-coach-chat--muted">
        <CoachCreature size={44} />
        <p>Помощник пока отключён. Доступ к остальным разделам кабинета не изменён.</p>
      </div>
    );
  }

  return (
    <section className="syntolk-coach-chat" aria-labelledby={chatTitleId}>
      <header className="syntolk-coach-chat__header">
        <div className="syntolk-coach-chat__identity">
          <CoachCreature size={48} />
          <div>
            <h2 id={chatTitleId}>{assistantName}</h2>
            <span className="syntolk-coach-chat__meta">ИИ-помощник Syntolk</span>
          </div>
        </div>
        {takeover && <span className="syntolk-coach-chat__takeover">Менеджер на связи</span>}
      </header>

      {!profileComplete && (
        <div className="syntolk-coach-onboarding">
          <div className="syntolk-coach-onboarding__avatar"><CoachCreature size={58} /></div>
          <h3>{welcome.data?.needsOnboarding ? 'Давайте познакомимся' : 'Сначала настроим сопровождение'}</h3>
          <p>{welcome.data?.message || greeting}</p>
          <a className="syntolk-coach-button" href={profileHref}>Открыть знакомство</a>
          <small>{takeover ? 'Менеджер может продолжить диалог до завершения профиля.' : 'Заполните профиль, чтобы открыть чат.'}</small>
        </div>
      )}

      {paused && (
        <div className="syntolk-coach-chat__paused" role="status">
          <strong>Сопровождение приостановлено</strong>
          <span>Отправка сообщений временно отключена. Настройки можно изменить в профиле.</span>
        </div>
      )}

      {(profileComplete || takeover) && (
        <>
          <div className="syntolk-coach-chat__messages" aria-live="polite" aria-label="История диалога">
            {!messages.data?.messages?.length && (
              <div className="syntolk-coach-empty">
                <CoachCreature size={38} />
                <p>{welcome.data?.message || 'Я рядом и помогу выбрать следующий посильный шаг.'}</p>
              </div>
            )}
            {messages.data?.messages?.map((message) => (
              <article key={message.id} className={`syntolk-coach-message syntolk-coach-message--${message.role}`}>
                <div className="syntolk-coach-message__avatar">
                  {message.role === 'assistant' ? <CoachCreature size={30} /> : <span aria-hidden="true">Вы</span>}
                </div>
                <div className="syntolk-coach-message__bubble">
                  <div className="syntolk-coach-message__topline">
                    <strong>{message.role === 'assistant' ? assistantName : message.role === 'admin' ? 'Менеджер Syntolk' : 'Вы'}</strong>
                    {message.createdAt && <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>}
                  </div>
                  <p>{renderMessageBody(message.data?.body || 'Сообщение без текста.')}</p>
                </div>
              </article>
            ))}
            {activeRuns.length > 0 && (
              <div className="syntolk-coach-typing" role="status" aria-label="Помощник печатает">
                <div className="syntolk-coach-message__avatar"><CoachCreature size={30} /></div>
                <span><i /><i /><i /></span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

        </>
      )}

      {failedRun && (
        <div className="syntolk-coach-chat__run-error" role="alert">
          <span>{runErrorText(failedRun)}</span>
          {!!failedText && (
            <button className="syntolk-coach-button syntolk-coach-button--link" type="button" disabled={sending} onClick={() => void send(failedText)}>
              Повторить
            </button>
          )}
        </div>
      )}

      {sendError && (
        <div className="syntolk-coach-chat__run-error" role="alert">
          <span>{sendError}</span>
          <button className="syntolk-coach-button syntolk-coach-button--link" type="button" disabled={sending} onClick={() => void send()}>
            Повторить
          </button>
        </div>
      )}

      {!paused && <div className="syntolk-coach-composer">
        {me.data.programs.length > 1 && (
          <label className="syntolk-coach-composer__program">
            <span>Программа</span>
            <select value={selectedProgram} onChange={(event) => setSelectedProgramId(event.target.value)} disabled={sending}>
              {me.data.programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
            </select>
          </label>
        )}
        {!selectedProgram && <p className="syntolk-coach-chat__hint">Администратору нужно назначить вам партнёрскую программу.</p>}
        {!canCompose && !paused && <p className="syntolk-coach-chat__hint">Заполните профиль, чтобы отправлять сообщения.</p>}
        <textarea
          value={currentDraft}
          onChange={(event) => changeDraft(event.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder="Помоги с идеей поста или сценарием кружочка"
          aria-label="Сообщение помощнику"
          maxLength={8000}
          rows={3}
          disabled={sending || !canCompose}
        />
        <div className="syntolk-coach-composer__footer">
          <span>Enter — отправить · Shift+Enter — новая строка</span>
          <button className="syntolk-coach-button" type="button" aria-label="Отправить" aria-busy={sending} disabled={sending || !currentDraft.trim() || !canCompose} onClick={() => void send()}>
            Отправить
          </button>
        </div>
      </div>}
    </section>
  );
}
