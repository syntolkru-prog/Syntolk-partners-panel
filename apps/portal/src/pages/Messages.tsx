import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, Download, File as FileIcon, MessageCircle, Paperclip, SendHorizontal, X } from 'lucide-react';
import { api, apiBlob, currentTenantSlug, type Principal } from '../api.js';
import { Button, ErrorBanner, Page } from '../ui.js';
import { theme } from '../theme.js';
import './messages.css';

type Attachment = { id: string; name: string; contentType: string; size: number };
type Message = { id: string; body: string; senderRole: 'admin' | 'partner'; createdAt: string; readAt: string | null; attachments?: Attachment[] };
type Thread = { partner: { id: string; name: string; email: string }; messages: Message[]; nextCursor: string | null };
type Conversation = { partnerId: string; name: string; email: string; body: string; senderRole: string; createdAt: string; unread: number };
type Inbox = { conversations: Conversation[]; nextCursor: string | null };

function unique<T>(rows: T[], id: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter(row => { const key = id(row); if (seen.has(key)) return false; seen.add(key); return true; });
}

function useMessageKey(principal: Principal) {
  const slug = currentTenantSlug(), role = principal.role, identity = principal.partnerId ?? principal.admin?.id ?? 'admin';
  return useMemo(() => ['partner-messages', slug, role, identity] as const, [slug, role, identity]);
}

export function MessageUnread({ principal }: { principal: Principal }) {
  const key = useMessageKey(principal);
  const unread = useQuery({ queryKey: [...key, 'unread'], queryFn: () => api<{ unread: number }>('/messages/unread'), refetchInterval: 10_000 });
  return unread.data?.unread ? <span className="message-unread" aria-label={`${unread.data.unread} непрочитанных`}>{unread.data.unread}</span> : null;
}

const colors = {
  '--messages-surface': theme.surface, '--messages-surface2': theme.surface2,
  '--messages-border': theme.border, '--messages-muted': theme.textMuted,
  '--messages-accent': theme.accent, '--messages-accent-soft': theme.accentSoft,
  '--messages-text': theme.text,
} as CSSProperties;

function timestamp(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function PartnerMessages({ principal }: { principal: Principal }) {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const panelId = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  useEffect(() => { if (started && !open) launcher.current?.focus(); }, [started, open]);
  return <div className="partner-message-widget" style={colors}>
    {started && <section id={panelId} className="partner-message-panel" role="dialog" aria-label="Тех. поддержка" hidden={!open} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
    }}>
      <header className="partner-message-panel__header">
        <strong>Тех. поддержка</strong>
        <button type="button" onClick={close} aria-label="Закрыть переписку"><X size={18} /></button>
      </header>
      <MessageThread principal={principal} partnerId={principal.partnerId!} active={open} embedded />
    </section>}
    <button type="button" ref={launcher} className="partner-message-launcher" hidden={open} aria-label="Написать в тех. поддержку" title="Написать в тех. поддержку" aria-expanded={open} aria-controls={started ? panelId : undefined} onClick={() => {
      setStarted(true); setOpen(true);
    }}>
      <MessageCircle size={23} />
      <MessageUnread principal={principal} />
    </button>
  </div>;
}

export function MessagesPage({ principal }: { principal: Principal }) {
  const admin = principal.role === 'admin';
  const [params, setParams] = useSearchParams();
  const partnerId = admin ? params.get('partnerId') ?? '' : principal.partnerId ?? '';
  const key = useMessageKey(principal);
  const inbox = useInfiniteQuery({
    queryKey: [...key, 'inbox'],
    queryFn: ({ pageParam }) => api<Inbox>(`/admin/messages${pageParam ? `?before=${pageParam}` : ''}`),
    initialPageParam: '', getNextPageParam: last => last.nextCursor ?? undefined,
    enabled: admin, refetchInterval: 10_000,
  });
  const conversations = unique(inbox.data?.pages.flatMap(page => page.conversations) ?? [], row => row.partnerId);
  return (
    <Page title="Сообщения" subtitle={admin ? 'Переписка с партнёрами' : 'Переписка с тех. поддержкой'}>
      <div className={`partner-messages${admin ? ' partner-messages--admin' : ''}`} style={colors}>
        {admin && <aside className="message-inbox" aria-label="Переписки с партнёрами">
          <ErrorBanner error={inbox.error} />
          {inbox.isLoading ? <p className="message-empty">Загрузка…</p> : !conversations.length && !inbox.error ? <p className="message-empty">Сообщений от партнёров пока нет.</p> : null}
          {conversations.map(row => <button key={row.partnerId} type="button" className={`message-inbox-row${partnerId === row.partnerId ? ' is-selected' : ''}`} aria-pressed={partnerId === row.partnerId} onClick={() => setParams({ partnerId: row.partnerId })}>
            <span className="message-inbox-row__top"><strong>{row.name}</strong>{row.unread > 0 && <span className="message-unread" aria-label={`${row.unread} непрочитанных`}>{row.unread}</span>}</span>
            <span className="message-muted">{row.email}</span>
            <span className="message-inbox-row__preview">{row.senderRole === 'admin' ? 'Вы: ' : ''}{row.body || 'Файл'}</span>
            <time className="message-muted" dateTime={row.createdAt}>{timestamp(row.createdAt)}</time>
          </button>)}
          {inbox.hasNextPage && <Button variant="ghost" size="sm" disabled={inbox.isFetchingNextPage} onClick={() => void inbox.fetchNextPage()}>Показать ещё</Button>}
        </aside>}
        {partnerId ? <MessageThread key={`${key.join(':')}:${partnerId}`} principal={principal} partnerId={partnerId} /> : <div className="message-thread message-empty">Выберите партнёра, чтобы прочитать сообщение и ответить.</div>}
      </div>
    </Page>
  );
}

function MessageThread({ principal, partnerId, active = true, embedded = false }: { principal: Principal; partnerId: string; active?: boolean; embedded?: boolean }) {
  const admin = principal.role === 'admin', key = useMessageKey(principal);
  const endpoint = admin ? `/admin/messages/${encodeURIComponent(partnerId)}` : '/messages';
  const threadKey = useMemo(() => [...key, 'thread', partnerId], [key, partnerId]);
  const client = useQueryClient();
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fileError, setFileError] = useState<Error | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<{ text: string; attachmentIds: string[]; requestId: string } | null>(null);
  const sending = useRef(false);
  const removingFile = useRef(false);
  const reading = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const historyContent = useRef<HTMLDivElement>(null);
  const olderPosition = useRef<{ height: number; top: number } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerId = useId();
  const atBottom = useRef(true);
  const previousLatest = useRef<string | undefined>(undefined);
  const thread = useInfiniteQuery({
    queryKey: threadKey,
    queryFn: ({ pageParam }) => api<Thread>(`${endpoint}${pageParam ? `?before=${pageParam}` : ''}`),
    initialPageParam: '', getNextPageParam: last => last.nextCursor ?? undefined,
    enabled: active, refetchInterval: active ? 5_000 : false,
  });
  const messages = unique(thread.data?.pages.flatMap(page => page.messages) ?? [], message => message.id).sort((a, b) => a.id.localeCompare(b.id));
  const partner = thread.data?.pages[0]?.partner;
  const latestId = messages.at(-1)?.id;
  const lastUnread = messages.filter(message => message.senderRole !== principal.role && !message.readAt).at(-1)?.id;
  const scrollToLatest = () => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    atBottom.current = true; setNearBottom(true); setHasNewMessages(false);
  };
  useLayoutEffect(() => {
    if (!active || !scroller.current) return;
    if (olderPosition.current && !thread.isFetchingNextPage) {
      scroller.current.scrollTop = olderPosition.current.top + scroller.current.scrollHeight - olderPosition.current.height;
      olderPosition.current = null;
    } else if (atBottom.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    if (previousLatest.current && previousLatest.current !== latestId && !atBottom.current) setHasNewMessages(true);
    previousLatest.current = latestId;
  }, [latestId, messages[0]?.id, active, thread.isFetchingNextPage]);
  useEffect(() => {
    if (!active || !historyContent.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    });
    observer.observe(historyContent.current);
    if (scroller.current) observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [active]);
  useLayoutEffect(() => {
    const input = composer.current;
    if (!input || !active) return;
    input.style.height = '0px';
    input.style.height = `${Math.min(input.scrollHeight, 104)}px`;
    if (atBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [draft, active]);
  useEffect(() => {
    const read = () => {
      if (!active || !atBottom.current || !lastUnread || document.visibilityState === 'hidden' || reading.current === lastUnread) return;
      reading.current = lastUnread;
      void api(`${endpoint}/read`, { method: 'POST', body: { messageId: lastUnread } }).then(async () => {
        await Promise.all([
          client.invalidateQueries({ queryKey: [...key, 'unread'] }),
          client.invalidateQueries({ queryKey: [...key, 'inbox'] }),
          client.invalidateQueries({ queryKey: threadKey }),
        ]);
      }).catch(() => { reading.current = null; });
    };
    read();
    document.addEventListener('visibilitychange', read);
    return () => document.removeEventListener('visibilitychange', read);
  // The update timestamp permits a retry after a failed read receipt.
  }, [lastUnread, thread.dataUpdatedAt, endpoint, client, key, threadKey, active, nearBottom]);
  const send = useMutation({
    mutationFn: async () => {
      const text = draft.trim(), attachmentIds = attachments.map(file => file.id);
      if (!request.current || request.current.text !== text || request.current.attachmentIds.join(',') !== attachmentIds.join(',')) request.current = { text, attachmentIds, requestId: crypto.randomUUID() };
      return api<{ message: Message }>(endpoint, { method: 'POST', body: request.current });
    },
    onSuccess: async () => {
      setDraft(''); setAttachments([]); request.current = null; scrollToLatest();
      await Promise.all([client.invalidateQueries({ queryKey: threadKey }), client.invalidateQueries({ queryKey: [...key, 'inbox'] })]);
    },
    onSettled: () => { sending.current = false; },
  });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      if (files.length + attachments.length > 5) throw new Error('Максимум 5 файлов.');
      if (files.some(file => file.size === 0)) throw new Error('Файл пуст.');
      if (files.some(file => file.size > 10 * 1024 * 1024)) throw new Error('Максимум 10 МБ на файл.');
      setFileError(null);
      for (const file of files) {
        const result = await api<{ attachment: Attachment }>(`${endpoint}/attachments?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
        setAttachments(previous => [...previous, result.attachment]);
      }
    },
  });
  const canSend = Boolean(partner && (draft.trim() || attachments.length) && !send.isPending && !upload.isPending && !removing);
  const submitMessage = () => {
    if (!canSend || sending.current || removingFile.current) return;
    sending.current = true;
    send.mutate();
  };
  useEffect(() => {
    if (active && partner && !send.isPending && !upload.isPending && !removing && (embedded || send.status !== 'idle' || upload.status !== 'idle')) composer.current?.focus();
  }, [active, embedded, partner?.id, send.status, upload.status, removing]);
  return <section className="message-thread" aria-label={admin ? 'Переписка с партнёром' : 'Переписка с тех. поддержкой'}>
    {!embedded && <header className="message-thread__header">
      <strong>{admin ? partner?.name ?? 'Партнёр' : 'Тех. поддержка'}</strong>
      {admin && partner && <span className="message-muted">{partner.email}</span>}
    </header>}
    <ErrorBanner error={thread.error} />
    <div className="message-history-wrap">
    <div className="message-history" ref={scroller} role="log" aria-label="История переписки" aria-live="polite" onScroll={event => {
      const el = event.currentTarget, bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
      atBottom.current = bottom; setNearBottom(bottom); if (bottom) setHasNewMessages(false);
    }}><div className="message-history__items" ref={historyContent}>
      {thread.hasNextPage && <Button variant="ghost" size="sm" disabled={thread.isFetchingNextPage} onClick={() => {
        if (scroller.current) olderPosition.current = { height: scroller.current.scrollHeight, top: scroller.current.scrollTop };
        atBottom.current = false; setNearBottom(false); void thread.fetchNextPage();
      }}>{thread.isFetchingNextPage ? 'Загрузка…' : 'Предыдущие сообщения'}</Button>}
      {thread.isLoading ? <p className="message-empty">Загрузка…</p> : null}
      {!thread.isLoading && !thread.error && !messages.length && <p className="message-empty">Сообщений пока нет.</p>}
      {messages.map((message, index) => <Fragment key={message.id}>
        {(!index || new Date(message.createdAt).toDateString() !== new Date(messages[index - 1]!.createdAt).toDateString()) && <time className="message-day" dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: new Date(message.createdAt).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}</time>}
        <article className={`message-bubble${message.senderRole === principal.role ? ' message-bubble--own' : ''}`}>
        {!embedded && <div className="message-bubble__meta"><strong>{message.senderRole === principal.role ? 'Вы' : message.senderRole === 'admin' ? 'Тех. поддержка' : partner?.name}</strong></div>}
        {message.body && <p>{message.body}</p>}
        {message.attachments?.map(file => <MessageAttachment key={file.id} attachment={file} endpoint={endpoint} active={active} queryKey={[...key, 'file', file.id]} />)}
        <time className="message-bubble__time" dateTime={message.createdAt}>{embedded ? new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : timestamp(message.createdAt)}</time>
      </article></Fragment>)}
    </div></div>
    {!nearBottom && <button type="button" className="message-latest" onClick={scrollToLatest}><ArrowDown size={13}/>{hasNewMessages ? 'Новые сообщения' : 'К последним'}</button>}
    </div>
    <form className={`message-composer${embedded ? ' message-composer--compact' : ''}`} onSubmit={event => { event.preventDefault(); submitMessage(); }}>
      <ErrorBanner error={send.error ?? upload.error ?? fileError} />
      {upload.isPending && <span className="message-uploading" role="status">Загрузка файла…</span>}
      {attachments.length > 0 && <div className="message-draft-files">{attachments.map(file => <span key={file.id}><span title={file.name}>{file.name}</span><button type="button" aria-label={`Убрать ${file.name}`} disabled={send.isPending || upload.isPending || !!removing} onClick={() => {
        if (sending.current || removingFile.current) return;
        removingFile.current = true; setRemoving(file.id); setFileError(null);
        void api(`${endpoint}/attachments/${file.id}`, { method: 'DELETE' }).then(() => setAttachments(previous => previous.filter(item => item.id !== file.id))).catch(error => setFileError(error)).finally(() => { removingFile.current = false; setRemoving(null); });
      }}><X size={12} /></button></span>)}</div>}
      {!embedded && <label htmlFor={composerId}>{admin ? 'Ответ партнёру' : 'Сообщение в тех. поддержку'}</label>}
      <div className="message-input-row">
        <input type="file" ref={fileInput} multiple hidden aria-label="Выбрать файлы" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) upload.mutate(files); }} />
        <button type="button" className="message-attach" aria-label="Прикрепить файл" title="Прикрепить файл" disabled={!partner || upload.isPending || send.isPending} onClick={() => fileInput.current?.click()}><Paperclip size={19} /></button>
        <textarea id={composerId} ref={composer} rows={1} maxLength={8000} enterKeyHint="send" aria-label={embedded ? 'Сообщение' : undefined} placeholder="Сообщение" value={draft} disabled={!partner || send.isPending} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!event.repeat) submitMessage(); }
        }} />
        <button type="submit" className="message-send" aria-label="Отправить" disabled={!canSend} aria-busy={send.isPending || upload.isPending}><SendHorizontal size={19} /></button>
      </div>
    </form>
  </section>;
}

function MessageAttachment({ attachment, endpoint, active, queryKey }: { attachment: Attachment; endpoint: string; active: boolean; queryKey: readonly unknown[] }) {
  const client = useQueryClient();
  const path = `${endpoint}/attachments/${attachment.id}`;
  const [imageUrl, setImageUrl] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isImage = attachment.contentType.startsWith('image/');
  const file = useQuery({ queryKey, queryFn: () => apiBlob(path), enabled: active && (isImage || previewOpen), staleTime: Infinity });
  useEffect(() => {
    if (!file.data || !isImage) return;
    const url = URL.createObjectURL(file.data); setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file.data, isImage]);
  useEffect(() => { if (!active) setPreviewOpen(false); }, [active]);
  const download = async () => {
    setError(null); setDownloading(true);
    try {
      const blob = await client.fetchQuery({ queryKey, queryFn: () => apiBlob(path), staleTime: Infinity });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = attachment.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause : new Error('Не удалось скачать файл.')); }
    finally { setDownloading(false); }
  };
  return <div className={`message-file${isImage ? ' message-file--image' : ''}`}>
    <div className="message-file__row">
      {isImage
        ? <button type="button" className="message-file__thumbnail" onClick={() => setPreviewOpen(true)} aria-label={`Посмотреть изображение ${attachment.name}`} title={attachment.name}>{imageUrl ? <img src={imageUrl} alt={attachment.name} /> : <FileIcon size={18} />}</button>
        : <button type="button" className="message-file__open" onClick={() => setPreviewOpen(true)} aria-label={`Открыть ${attachment.name}`} title={attachment.name}><FileIcon size={14} /><span>{attachment.name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toUpperCase() ?? 'Файл'}</span></button>}
      <button type="button" className="message-file__download" onClick={() => void download()} aria-label={`Скачать ${attachment.name}`} title="Скачать" disabled={downloading}><Download size={15} /></button>
    </div>
    <ErrorBanner error={error ?? file.error} />
    {previewOpen && active && <MessageAttachmentPreview attachment={attachment} blob={file.data} error={error ?? file.error} downloading={downloading} onDownload={() => void download()} onClose={() => setPreviewOpen(false)} />}
  </div>;
}

function MessageAttachmentPreview({ attachment, blob, error, downloading, onDownload, onClose }: { attachment: Attachment; blob?: Blob; error: Error | null; downloading: boolean; onDownload: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<{ kind: 'image' | 'pdf' | 'text' | 'unsupported'; value: string } | null>(null);
  const [previewError, setPreviewError] = useState<Error | null>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); };
  }, []);
  useEffect(() => {
    if (!blob) return;
    let disposed = false, url = '';
    void (async () => {
      const image = attachment.contentType.startsWith('image/');
      const pdf = !image && (await blob.slice(0, 5).text()) === '%PDF-';
      if (disposed) return;
      if (image || pdf) {
        url = URL.createObjectURL(pdf ? new Blob([blob], { type: 'application/pdf' }) : blob);
        setPreview({ kind: image ? 'image' : 'pdf', value: url });
      } else if (/\.(txt|csv|tsv|json|log|md)$/i.test(attachment.name)) {
        const text = await blob.text();
        if (!disposed) setPreview({ kind: 'text', value: text });
      } else setPreview({ kind: 'unsupported', value: '' });
    })().catch(cause => { if (!disposed) setPreviewError(cause instanceof Error ? cause : new Error('Не удалось открыть файл.')); });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [blob, attachment.contentType, attachment.name]);
  return createPortal(<dialog ref={dialog} className="message-preview" style={colors} aria-label={`Просмотр ${attachment.name}`} onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header className="message-preview__header">
      <strong title={attachment.name}>{attachment.name}</strong>
      <button type="button" onClick={onDownload} aria-label="Скачать файл" title="Скачать" disabled={downloading}><Download size={18} /></button>
      <button type="button" onClick={onClose} aria-label="Закрыть просмотр" title="Закрыть"><X size={18} /></button>
    </header>
    <div className="message-preview__content">
      <ErrorBanner error={error ?? previewError} />
      {!preview && !error && !previewError && <p role="status">Загрузка…</p>}
      {preview?.kind === 'image' && <img src={preview.value} alt={attachment.name} />}
      {preview?.kind === 'pdf' && <iframe src={preview.value} title={attachment.name} />}
      {preview?.kind === 'text' && <pre>{preview.value}</pre>}
      {preview?.kind === 'unsupported' && <div className="message-preview__unsupported"><FileIcon size={32} /><p>Предпросмотр недоступен</p><Button onClick={onDownload} disabled={downloading} icon={<Download size={14} />}>Скачать</Button></div>}
    </div>
  </dialog>, document.body);
}
