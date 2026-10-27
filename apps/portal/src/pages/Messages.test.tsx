// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { api, apiBlob, type Principal } from '../api.js';
import { MessagesPage, MessageUnread, PartnerMessages } from './Messages.js';

vi.mock('../api.js', () => ({ api: vi.fn(), apiBlob: vi.fn(), currentTenantSlug: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
const partner: Principal = { role: 'partner', partnerId: 'p1' };
const admin: Principal = { role: 'admin' };
const received = { id: '01M40000000000000000000001', body: '<script>alert(1)</script>\nОтвет администратора', senderRole: 'admin', createdAt: '2026-10-14T10:00:00Z', readAt: null };
const thread = { partner: { id: 'p1', name: 'Локальный партнёр', email: 'partner@example.test' }, messages: [received], nextCursor: null };
function setup(principal = partner, url = '/messages', widget = false, history: unknown = thread) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path === '/messages/unread') return { unread: 2 } as never;
    if (path === '/admin/messages') return { conversations: [{ partnerId: 'p1', name: 'Локальный партнёр', email: 'partner@example.test', body: 'Нужна помощь', senderRole: 'partner', createdAt: received.createdAt, unread: 1 }], nextCursor: null } as never;
    if (path.startsWith('/partners?')) return { partners: [
      { id: 'p1', name: 'Локальный партнёр', email: 'partner@example.test', activatedAt: received.createdAt, revokedAt: null, createdAt: received.createdAt },
      { id: 'p-new', name: 'Новый партнёр', email: 'new@example.test', activatedAt: null, revokedAt: null, createdAt: received.createdAt },
    ], nextCursor: null } as never;
    if (path.startsWith('/admin/messages/partners?')) {
      const partners = [
        { partnerId: 'p1', name: 'Локальный партнёр', email: 'partner@example.test', activatedAt: received.createdAt, revokedAt: null, lastMessageId: received.id, lastMessage: 'Нужна помощь', lastSenderRole: 'partner', lastMessageAt: received.createdAt, unread: 1, hasConversation: true },
        { partnerId: 'p-new', name: 'Новый партнёр', email: 'new@example.test', activatedAt: null, revokedAt: null, lastMessageId: null, lastMessage: null, lastSenderRole: null, lastMessageAt: null, unread: 0, hasConversation: false },
      ];
      const search = new URLSearchParams(path.split('?')[1]).get('search')?.toLocaleLowerCase('ru-RU');
      return { partners: search ? partners.filter(row => `${row.name} ${row.email}`.toLocaleLowerCase('ru-RU').includes(search)) : partners, nextCursor: null } as never;
    }
    if (path === '/admin/messages/p-new') return { partner: { id: 'p-new', name: 'Новый партнёр', email: 'new@example.test' }, messages: [], nextCursor: null } as never;
    if (path.endsWith('/read')) return { ok: true } as never;
    if (init?.method === 'POST') return { message: received } as never;
    return history as never;
  });
  render(<MemoryRouter initialEntries={[url]}><QueryClientProvider client={client}>{widget ? <PartnerMessages principal={principal} /> : <><MessageUnread principal={principal} /><MessagesPage principal={principal} /></>}</QueryClientProvider></MemoryRouter>);
  return client;
}
describe('partner correspondence', () => {
  it('keeps a small attachment control and a send control inside the message field',async()=>{
    setup(partner,'/',true);fireEvent.click(screen.getByRole('button',{name:'Написать в тех. поддержку'}));
    const composer=await screen.findByRole('textbox',{name:'Сообщение'}),attach=screen.getByRole('button',{name:'Прикрепить файл'}),send=screen.getByRole('button',{name:'Отправить'});
    expect(attach.parentElement).toBe(composer.parentElement);expect(send.parentElement).toBe(composer.parentElement);expect(attach.querySelector('svg')?.getAttribute('width')).toBe('14');
  });
  it('grows the composer for multiline text and resets its height after sending', async () => {
    setup(partner, '/', true);
    fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
    const input = await screen.findByRole('textbox', { name: 'Сообщение' }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => input.value ? 180 : 30 });
    fireEvent.change(input, { target: { value: 'Первая строка\nВторая строка\nТретья строка' } });
    expect(input.style.height).toBe('104px');
    expect(input.getAttribute('enterkeyhint')).toBe('send');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe(''));
    expect(input.style.height).toBe('30px');
  });
  it('preserves the reading position and unread replies until the user returns to the latest messages', async () => {
    const client = setup(partner, '/', true, { ...thread, messages: [{ ...received, readAt: received.createdAt }] });
    fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
    await screen.findByText(/Ответ администратора/);
    const history = screen.getByRole('log');
    Object.defineProperties(history, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 300 } });
    history.scrollTop = 120; fireEvent.scroll(history);
    expect(screen.getByRole('button', { name: 'К последним' })).toBeTruthy();
    const next = { ...received, id: '01M40000000000000000000002', body: 'Новый ответ' };
    await act(async () => {
      client.setQueryData(['partner-messages', null, 'partner', 'p1', 'thread', 'p1'], { pages: [{ ...thread, messages: [{ ...received, readAt: received.createdAt }, next] }], pageParams: [''] });
    });
    await screen.findByText('Новый ответ');
    expect(history.scrollTop).toBe(120);
    expect(vi.mocked(api).mock.calls.some(([path]) => path === '/messages/read')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Новые сообщения' }));
    expect(history.scrollTop).toBe(1000);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/messages/read', expect.objectContaining({ body: { messageId: next.id } })));
  });
  it('keeps the same visible position when previous messages are prepended', async () => {
    setup(partner, '/', true, { ...thread, nextCursor: received.id });
    const original = vi.mocked(api).getMockImplementation()!;
    let finishOlder!: (result: unknown) => void;
    vi.mocked(api).mockImplementation(async (path, init) => path.startsWith('/messages?before=') ? new Promise(resolve => { finishOlder = resolve; }) as never : original(path, init));
    fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
    const button = await screen.findByRole('button', { name: 'Предыдущие сообщения' });
    const history = screen.getByRole('log'); let height = 1000;
    Object.defineProperties(history, { scrollHeight: { configurable: true, get: () => height }, clientHeight: { configurable: true, value: 300 } });
    history.scrollTop = 50; fireEvent.scroll(history); fireEvent.click(button);
    await waitFor(() => expect(finishOlder).toBeTypeOf('function'));
    await act(async () => {
      height = 1300;
      finishOlder({ ...thread, messages: [{ ...received, id: '01M40000000000000000000000', body: 'Предыдущее сообщение', createdAt: '2026-10-13T10:00:00Z' }], nextCursor: null });
    });
    await screen.findByText('Предыдущее сообщение');
    expect(history.scrollTop).toBe(350);
    expect(screen.getByText('13 октября')).toBeTruthy();
    expect(screen.getByText('14 октября')).toBeTruthy();
  });
  it('follows resized image previews only while the user is at the bottom', async () => {
    let onResize!: ResizeObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { onResize = callback; } observe() {} disconnect = disconnect; });
    setup(partner, '/', true);
    fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
    await screen.findByText(/Ответ администратора/);
    const history = screen.getByRole('log'); let height = 1000;
    Object.defineProperties(history, { scrollHeight: { configurable: true, get: () => height }, clientHeight: { configurable: true, value: 300 } });
    act(() => onResize([], {} as ResizeObserver));
    expect(history.scrollTop).toBe(1000);
    history.scrollTop = 150; fireEvent.scroll(history);
    height = 1200; act(() => onResize([], {} as ResizeObserver));
    expect(history.scrollTop).toBe(150);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть переписку' }));
    expect(disconnect).toHaveBeenCalled();
  });
  it('does not send an attachment while it is being removed from the draft', async () => {
    setup(partner, '/', true);
    const original = vi.mocked(api).getMockImplementation()!;
    let finishRemove!: (result: unknown) => void;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.startsWith('/messages/attachments?')) return { attachment: { id: 'file-1', name: 'note.txt', contentType: 'application/octet-stream', size: 4 } } as never;
      if (init?.method === 'DELETE') return new Promise(resolve => { finishRemove = resolve; }) as never;
      return original(path, init);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
    const input = await screen.findByRole('textbox', { name: 'Сообщение' }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: 'Текст без файла' } });
    fireEvent.change(screen.getByLabelText('Выбрать файлы'), { target: { files: [new File(['test'], 'note.txt')] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Убрать note.txt' }));
    await waitFor(() => expect(finishRemove).toBeTypeOf('function'));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(vi.mocked(api).mock.calls.some(([path, init]) => path === '/messages' && init?.method === 'POST')).toBe(false);
    await act(async () => { finishRemove({ ok: true }); });
    await waitFor(() => expect(screen.queryByText('note.txt')).toBeNull());
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api).toHaveBeenCalledWith('/messages', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ text: 'Текст без файла', attachmentIds: [] }) })));
  });
  it.each([
    { principal: partner, url: '/', widget: true, inputName: 'Сообщение', endpoint: '/messages' },
    { principal: admin, url: '/admin/messages?partnerId=p1', widget: false, inputName: 'Ответ партнёру', endpoint: '/admin/messages/p1' },
  ])('returns focus after uploading multiple files and sends them with Enter for $principal.role', async ({ principal, url, widget, inputName, endpoint }) => {
    setup(principal, url, widget);
    const original = vi.mocked(api).getMockImplementation()!;
    let fileNumber = 0;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.startsWith(`${endpoint}/attachments?`)) return { attachment: { id: `file-${++fileNumber}`, name: (init!.body as File).name, contentType: 'application/octet-stream', size: 4 } } as never;
      return original(path, init);
    });
    if (widget) fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
    const input = await screen.findByRole('textbox', { name: inputName }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: 'Сообщение с файлами' } });
    screen.getByRole('button', { name: 'Прикрепить файл' }).focus();
    fireEvent.change(screen.getByLabelText('Выбрать файлы'), { target: { files: [new File(['test'], 'one.txt'), new File(['test'], 'two.txt')] } });
    await screen.findByText('two.txt');
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'POST', body: expect.objectContaining({ text: 'Сообщение с файлами', attachmentIds: ['file-1', 'file-2'] }) })));
    await waitFor(() => {
      expect(input.value).toBe('');
      expect(document.activeElement).toBe(input);
      expect(input.disabled).toBe(false);
    });
    expect(screen.queryByText('one.txt')).toBeNull();
    expect(screen.queryByText('two.txt')).toBeNull();
  });
  it('blocks Enter during upload without adding a newline and sends the completed attachment', async () => {
    setup(partner, '/', true);
    const original = vi.mocked(api).getMockImplementation()!;
    let finishUpload!: (result: unknown) => void;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.startsWith('/messages/attachments?')) return new Promise(resolve => { finishUpload = resolve; }) as never;
      return original(path, init);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
    const input = await screen.findByRole('textbox', { name: 'Сообщение' }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: 'Дождаться файла' } });
    fireEvent.change(screen.getByLabelText('Выбрать файлы'), { target: { files: [new File(['test'], 'note.txt')] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Прикрепить файл' }).hasAttribute('disabled')).toBe(true));
    input.focus();
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(vi.mocked(api).mock.calls.some(([path, init]) => path === '/messages' && init?.method === 'POST')).toBe(false);
    await act(async () => { finishUpload({ attachment: { id: 'file-1', name: 'note.txt', contentType: 'application/octet-stream', size: 4 } }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отправить' }).hasAttribute('disabled')).toBe(false));
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/messages', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ text: 'Дождаться файла', attachmentIds: ['file-1'] }) })));
  });
  it('returns focus after a failed upload and permits selecting the same file again', async () => {
    setup(partner, '/', true);
    const original = vi.mocked(api).getMockImplementation()!;
    let uploads = 0;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.startsWith('/messages/attachments?')) {
        if (++uploads === 1) throw new Error('Не удалось загрузить файл');
        return { attachment: { id: 'file-1', name: 'note.txt', contentType: 'application/octet-stream', size: 4 } } as never;
      }
      return original(path, init);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
    const input = await screen.findByRole('textbox', { name: 'Сообщение' }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: 'Не потерять текст' } });
    const files = [new File(['test'], 'note.txt')];
    screen.getByRole('button', { name: 'Прикрепить файл' }).focus();
    fireEvent.change(screen.getByLabelText('Выбрать файлы'), { target: { files } });
    await screen.findByText('Не удалось загрузить файл');
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.value).toBe('Не потерять текст');
    screen.getByRole('button', { name: 'Прикрепить файл' }).focus();
    fireEvent.change(screen.getByLabelText('Выбрать файлы'), { target: { files } });
    await screen.findByText('note.txt');
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/messages', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ text: 'Не потерять текст', attachmentIds: ['file-1'] }) })));
  });
  it('keeps a finished upload in the closed chat and restores focus when reopened', async () => {
    setup(partner, '/', true);
    const original = vi.mocked(api).getMockImplementation()!;
    let finishUpload!: (result: unknown) => void;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.startsWith('/messages/attachments?')) return new Promise(resolve => { finishUpload = resolve; }) as never;
      return original(path, init);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
    const input = await screen.findByRole('textbox', { name: 'Сообщение' }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Выбрать файлы'), { target: { files: [new File(['test'], 'note.txt')] } });
    await waitFor(() => expect(finishUpload).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть переписку' }));
    const launcher = screen.getByRole('button', { name: 'Написать в тех. поддержку' });
    await act(async () => { finishUpload({ attachment: { id: 'file-1', name: 'note.txt', contentType: 'application/octet-stream', size: 4 } }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отправить', hidden: true }).hasAttribute('disabled')).toBe(false));
    expect(document.activeElement).toBe(launcher);
    fireEvent.click(launcher);
    expect(await screen.findByText('note.txt')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
  it('does not send on held Enter, Shift+Enter or composition and prevents simultaneous submissions', async () => {
    setup(partner, '/', true);
    const original = vi.mocked(api).getMockImplementation()!;
    let finishSend!: (result: unknown) => void;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === '/messages' && init?.method === 'POST') return new Promise(resolve => { finishSend = resolve; }) as never;
      return original(path, init);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
    const input = await screen.findByRole('textbox', { name: 'Сообщение' }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: 'Только один раз' } });
    fireEvent.keyDown(input, { key: 'Enter', repeat: true });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(vi.mocked(api).mock.calls.some(([path, init]) => path === '/messages' && init?.method === 'POST')).toBe(false);
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.submit(input.closest('form')!);
    });
    await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([path, init]) => path === '/messages' && init?.method === 'POST')).toHaveLength(1));
    await act(async () => { finishSend({ message: received }); });
    await waitFor(() => expect(input.disabled).toBe(false));
  });
  it('uploads a file from the paperclip and can send it without text', async () => {
    setup(partner, '/', true);
    const original = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.startsWith('/messages/attachments?')) return { attachment: { id: 'file-1', name: 'note.txt', contentType: 'application/octet-stream', size: 4 } } as never;
      return original(path, init);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
    const input = await screen.findByRole('textbox', { name: 'Сообщение' }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Выбрать файлы'), { target: { files: [new File(['test'], 'note.txt', { type: 'text/plain' })] } });
    await screen.findByText('note.txt');
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/messages', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ text: '', attachmentIds: ['file-1'] }) })));
  });
  it('loads image previews through authenticated requests', async () => {
    const create = vi.fn(() => 'blob:private-image'), revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
    vi.mocked(apiBlob).mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    setup(partner, '/messages', false, { ...thread, messages: [{ ...received, attachments: [{ id: 'image-1', name: 'picture.png', contentType: 'image/png', size: 5 }] }] });
    expect(await screen.findByRole('img', { name: 'picture.png' })).toBeTruthy();
    expect(vi.mocked(apiBlob)).toHaveBeenCalledWith('/messages/attachments/image-1');
    expect(create).toHaveBeenCalled();
  });
  it('opens the floating chat, preserves the draft when closed and returns keyboard focus', async () => {
    setup(partner, '/', true);
    const launcher = screen.getByRole('button', { name: 'Написать в тех. поддержку' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(launcher);
    expect(screen.getByRole('dialog', { name: 'Тех. поддержка' })).toBeTruthy();
    const input = await screen.findByRole('textbox', { name: 'Сообщение' }) as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: 'Черновик вопроса' } });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть переписку' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(launcher);
    fireEvent.click(launcher);
    expect((screen.getByRole('textbox', { name: 'Сообщение' }) as HTMLTextAreaElement).value).toBe('Черновик вопроса');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });
  it('does not mark replies as read while the floating chat is closed', async () => {
    const client = setup(partner, '/', true);
    await screen.findByLabelText('2 непрочитанных');
    expect(vi.mocked(api).mock.calls.some(([path]) => path === '/messages/read')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/messages/read', expect.objectContaining({ body: { messageId: received.id } })));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть переписку' }));
    const next = { ...received, id: '01M40000000000000000000002', body: 'Новый ответ' };
    await act(async () => {
      client.setQueryData(['partner-messages', null, 'partner', 'p1', 'thread', 'p1'], { pages: [{ ...thread, messages: [received, next] }], pageParams: [''] });
    });
    expect(vi.mocked(api).mock.calls.some(([path, init]) => path === '/messages/read' && (init?.body as { messageId?: string })?.messageId === next.id)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/messages/read', expect.objectContaining({ body: { messageId: next.id } })));
  });
  it('opens a partner composer without requesting any coach or scenario data and renders text safely', async () => {
    setup();
    const input = await screen.findByLabelText('Сообщение в тех. поддержку') as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(await screen.findByText(/Ответ администратора/)).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
    expect(vi.mocked(api).mock.calls.some(([path]) => /coach|calculator/.test(path))).toBe(false);
    expect(await screen.findByLabelText('2 непрочитанных')).toBeTruthy();
  });
  it('sends a trimmed question and clears the successful draft', async () => {
    setup();
    const input = await screen.findByLabelText('Сообщение в тех. поддержку') as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: '  Мой вопрос  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/messages', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ text: 'Мой вопрос', requestId: expect.any(String) }) })));
    await waitFor(() => expect(input.value).toBe(''));
  });
  it('preserves draft and request ID on a failed send so retry cannot duplicate a message', async () => {
    setup();
    const input = await screen.findByLabelText('Сообщение в тех. поддержку') as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    const original = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === '/messages' && init?.method === 'POST') throw new Error('Связь потеряна');
      return original(path, init);
    });
    fireEvent.change(input, { target: { value: 'Не потерять вопрос' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await screen.findByText('Связь потеряна'); expect(input.value).toBe('Не потерять вопрос');
    await waitFor(() => expect(document.activeElement).toBe(input));
    const first = vi.mocked(api).mock.calls.find(([path, init]) => path === '/messages' && init?.method === 'POST')![1]!.body;
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([path, init]) => path === '/messages' && init?.method === 'POST')).toHaveLength(2));
    expect(vi.mocked(api).mock.calls.filter(([path, init]) => path === '/messages' && init?.method === 'POST')[1]![1]!.body).toEqual(first);
  });
  it('shows who wrote in the admin inbox and opens the correct reply destination', async () => {
    setup(admin, '/admin/messages');
    fireEvent.click(await screen.findByRole('button', { name: /Локальный партнёр/ }));
    const input = await screen.findByLabelText('Ответ партнёру') as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(screen.getAllByText('partner@example.test').length).toBeGreaterThan(0);
    fireEvent.change(input, { target: { value: 'Отвечаю партнёру' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/admin/messages/p1', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ text: 'Отвечаю партнёру' }) })));
  });
  it('closes the selected admin chat without removing the partner list', async () => {
    setup(admin, '/admin/messages?partnerId=p1');
    await screen.findByLabelText('Ответ партнёру');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть сообщение' }));
    expect(screen.queryByLabelText('Ответ партнёру')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Партнёры' })).toBeTruthy();
  });
  it('keeps the partner list visible and starts a chat with a partner who has no conversation yet', async () => {
    setup(admin, '/admin/messages');
    expect(await screen.findByRole('heading', { name: 'Партнёры' })).toBeTruthy();
    const search = await screen.findByRole('textbox', { name: 'Найти партнёра' });
    fireEvent.change(search, { target: { value: 'Новый партнёр' } });
    const recipient = await screen.findByRole('button', { name: /new@example\.test/ });
    fireEvent.click(recipient);
    const input = await screen.findByLabelText('Ответ партнёру') as HTMLTextAreaElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(screen.getByText('Сообщений пока нет.')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Первое сообщение партнёру' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/admin/messages/p-new', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ text: 'Первое сообщение партнёру' }) })));
  });
});

describe('attachment preview and separate download', () => {
  beforeEach(() => {
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
      close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
    });
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:private-preview');
      static revokeObjectURL = vi.fn();
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks(); vi.useRealTimers();
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  });
  function setupFile(name: string, data: string, contentType = 'application/octet-stream', principal = partner, widget = false) {
    vi.mocked(apiBlob).mockResolvedValue(new Blob([data], { type: contentType }));
    setup(principal, principal.role === 'admin' ? '/admin/messages?partnerId=p1' : '/messages', widget, {
      ...thread, messages: [{ ...received, body: '', attachments: [{ id: 'file-1', name, contentType, size: data.length }] }],
    });
    if (widget) fireEvent.click(screen.getByRole('button', { name: 'Написать в тех. поддержку' }));
  }
  it.each([partner, admin])('opens text as a private preview without downloading for $role', async principal => {
    setupFile('report.csv', 'name,result\n<script>alert(1)</script>,42', 'application/octet-stream', principal);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть report.csv' }));
    const dialog = await screen.findByRole('dialog', { name: 'Просмотр report.csv' });
    await waitFor(() => expect(dialog.querySelector('pre')?.textContent).toBe('name,result\n<script>alert(1)</script>,42'));
    expect(document.querySelector('script')).toBeNull();
    expect(click).not.toHaveBeenCalled();
    expect(vi.mocked(apiBlob)).toHaveBeenCalledWith(`${principal.role === 'admin' ? '/admin/messages/p1' : '/messages'}/attachments/file-1`);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть просмотр' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('downloads only from the separate button and preserves the original filename', async () => {
    setupFile('report.csv', 'name,result\none,42');
    const downloads: Array<{ name: string; url: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push({ name: this.download, url: this.href }); });
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть report.csv' }));
    await waitFor(() => expect(screen.getByRole('dialog').querySelector('pre')).not.toBeNull());
    expect(downloads).toHaveLength(0);
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Скачать файл' })); });
    expect(downloads).toEqual([{ name: 'report.csv', url: 'blob:private-preview' }]);
    expect(vi.mocked(apiBlob)).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-preview');
  });
  it('opens an image viewer and closes it without closing the partner chat', async () => {
    setupFile('picture.png', 'image', 'image/png', partner, true);
    fireEvent.click(await screen.findByRole('button', { name: 'Посмотреть изображение picture.png' }));
    const dialog = await screen.findByRole('dialog', { name: 'Просмотр picture.png' });
    await waitFor(() => expect(dialog.querySelector('img')?.getAttribute('src')).toBe('blob:private-preview'));
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog', { name: 'Просмотр picture.png' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Тех. поддержка' })).toBeTruthy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-preview');
  });
  it('recognizes a PDF stored as a binary attachment and gives the browser a PDF blob', async () => {
    setupFile('document.pdf', '%PDF-1.4\nexample');
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть document.pdf' }));
    const dialog = await screen.findByRole('dialog', { name: 'Просмотр document.pdf' });
    await waitFor(() => expect(dialog.querySelector('iframe')?.getAttribute('src')).toBe('blob:private-preview'));
    expect(vi.mocked(URL.createObjectURL).mock.calls.some(([blob]) => blob instanceof Blob && blob.type === 'application/pdf')).toBe(true);
  });
  it.each(['archive.zip', 'document.docx', 'unsafe.html', 'fake.pdf'])('does not automatically download or execute unsupported file %s', async name => {
    setupFile(name, '<html><script>alert(1)</script></html>');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(await screen.findByRole('button', { name: `Открыть ${name}` }));
    await screen.findByText('Предпросмотр недоступен');
    expect(screen.getByRole('button', { name: 'Скачать' })).toBeTruthy();
    expect(screen.getByRole('dialog').querySelector('iframe,script')).toBeNull();
    expect(click).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('keeps failed private file requests in the viewer without starting a download', async () => {
    setupFile('report.csv', '');
    vi.mocked(apiBlob).mockRejectedValue(new Error('Вложение недоступно'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть report.csv' }));
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('Вложение недоступно'));
    expect(click).not.toHaveBeenCalled();
  });
});
