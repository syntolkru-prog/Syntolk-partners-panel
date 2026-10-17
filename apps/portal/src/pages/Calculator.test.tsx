// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CalculatorPage } from './Calculator.js';
import { theme } from '../theme.js';

const modelSource = readFileSync(resolve(process.cwd(), 'public/calculator/forecast-model.js'), 'utf8');
const uiSource = readFileSync(resolve(process.cwd(), 'public/calculator/forecast-ui.js'), 'utf8');

function initialize(mobile = false, seedExample = true) {
  // Run the actual standalone assets against the real portal markup, rather
  // than mocking calculations. No API, external model or payments are used.
  const context = {
    document,
    localStorage,
    setTimeout,
    clearTimeout,
    URL,
    CustomEvent,
    matchMedia: () => ({ matches: mobile, addEventListener: vi.fn() }),
  };
  runInNewContext(modelSource, context);
  const root=document.getElementById('partner-forecast')!;
  const key=root.dataset.storageKey||'syntolk-partner-forecast-v1';
  if(seedExample&&!localStorage.getItem(key)&&!root.dataset.initialState){
    const model=context as typeof context & {SyntolkForecast:{defaults():unknown}};
    localStorage.setItem(key,JSON.stringify({version:1,settings:model.SyntolkForecast.defaults()}));
  }
  runInNewContext(uiSource, context);
}

function income() {
  return document.querySelector('#pf-income')!.textContent!.replace(/\s/g, '');
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  cleanup();
  document.head.querySelectorAll('script[src*="/calculator/"]').forEach((script) => script.remove());
  vi.useRealTimers();
});

describe('calculator portal integration', () => {
  it('filters platforms by active content and explicitly selects every compatible platform',()=>{
    render(<CalculatorPage principal={{role:'partner'}}/>);initialize(false,false);
    fireEvent.input(screen.getByRole('spinbutton',{name:'Посты: оригиналов в неделю'}),{target:{value:'10'}});
    expect(screen.queryByText(/Не выбраны площадки для форматов/)).toBeNull();
    fireEvent.click(screen.getByRole('tab',{name:'Площадки'}));
    const visible=()=>[...document.querySelectorAll<HTMLDetailsElement>('[data-channel-group]')].filter(card=>!card.hidden).map(card=>card.dataset.channelGroup);
    expect(visible()).toEqual(['telegram-post','vk','dzen','ok','tenchat','email']);
    let settings=JSON.parse(document.getElementById('partner-forecast')!.dataset.currentSettings!);
    expect(Object.values(settings.channels).some((channel:any)=>channel.enabled)).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Выбрать все подходящие площадки'}));
    settings=JSON.parse(document.getElementById('partner-forecast')!.dataset.currentSettings!);
    expect(Object.entries(settings.channels).filter(([,channel]:any)=>channel.enabled).map(([id])=>id)).toEqual(visible());
    expect(settings.frequency.post).toBe(10);
    expect(Object.values(settings.channels).filter((channel:any)=>channel.enabled).every((channel:any)=>channel.formats.join(',')==='post')).toBe(true);
    expect(document.getElementById('pf-unplaced')).toBeNull();
    fireEvent.click(screen.getByRole('tab',{name:'Контент'}));
    fireEvent.input(screen.getByRole('spinbutton',{name:'Посты: оригиналов в неделю'}),{target:{value:'0'}});
    fireEvent.input(screen.getByRole('spinbutton',{name:'Короткие видео: оригиналов в неделю'}),{target:{value:'2'}});
    fireEvent.click(screen.getByRole('tab',{name:'Площадки'}));
    expect(visible()).toEqual(['telegram-short','vkclips','dzen','ytshorts','rutubeshorts','ok','tiktok']);
    fireEvent.click(screen.getByRole('button',{name:'Выбрать все подходящие площадки'}));
    settings=JSON.parse(document.getElementById('partner-forecast')!.dataset.currentSettings!);
    expect(settings.channels.youtube.enabled).toBe(false);expect(settings.channels['telegram-post'].enabled).toBe(false);
    expect(settings.channels.ytshorts.formats).toEqual(['short']);
  });
  it('starts a new partner with no content, selected platforms or analytics tasks',()=>{
    render(<CalculatorPage principal={{role:'partner'}}/>);
    initialize(false,false);
    const settings=JSON.parse(document.getElementById('partner-forecast')!.dataset.currentSettings!);
    expect(Object.values(settings.frequency).every(value=>value===0)).toBe(true);
    expect(Object.values(settings.channels).every(channel=>{
      const config=channel as {enabled:boolean;formats:string[]};
      return !config.enabled&&config.formats.length===0;
    })).toBe(true);
    expect(settings).not.toHaveProperty('adminMinutes');
    expect(settings.registration).toBe(18);
    expect(settings.prices[0]).toBe(990);
    expect(income()).toBe('0₽');
    expect(document.getElementById('pf-chart-hint')!.textContent).toBe('Все месяцы — 0 ₽');
    fireEvent.change(screen.getByRole('combobox', { name: 'Месяц' }), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Период прогноза'), { target: { value: '3' } });
    expect(document.querySelectorAll('#pf-chart button')).toHaveLength(3);
    expect(document.querySelector('#pf-chart .pf-active-month')?.getAttribute('data-month')).toBe('3');
    expect(income()).toBe('0₽');
    expect(screen.getByRole('button',{name:'Создать сценарий'})).toBeTruthy();
  });

  it('clears only task-driving inputs and does not resurrect them from a saved snapshot on reload',()=>{
    render(<CalculatorPage principal={{role:'partner'}}/>);
    initialize();
    const root=document.getElementById('partner-forecast')!;
    const original=JSON.parse(root.dataset.currentSettings!);
    original.registration=23;original.paidConversion=7;original.tail.post=17;original.prices[0]=1234;
    original.customFormats=[{id:'format-own',name:'Мой формат',base:'post',minutes:12}];
    original.frequency['format-own']=2;original.tail['format-own']=9;
    original.channels['telegram-post'].formats.push('format-own');
    root.dispatchEvent(new CustomEvent('syntolk-calculator-load',{detail:{settings:original}}));
    const before=JSON.parse(root.dataset.currentSettings!);
    root.dataset.initialState=JSON.stringify({version:1,settings:before});
    fireEvent.click(screen.getByRole('button',{name:'Создать сценарий'}));
    const cleared=JSON.parse(root.dataset.currentSettings!);
    expect(Object.values(cleared.frequency).every(value=>value===0)).toBe(true);
    expect(Object.values(cleared.channels).every(channel=>{
      const config=channel as {enabled:boolean;formats:string[]};
      return !config.enabled&&config.formats.length===0;
    })).toBe(true);
    expect(cleared).not.toHaveProperty('adminMinutes');
    for(const field of ['registration','paidConversion','prices','mix','tail','growth','personalRetention','businessRetention','customFormats'])expect(cleared[field]).toEqual(before[field]);
    expect(income()).toBe('0₽');
    cleanup();
    render(<CalculatorPage principal={{role:'partner'}}/>);
    document.getElementById('partner-forecast')!.dataset.initialState=JSON.stringify({version:1,settings:before});
    initialize();
    expect(JSON.parse(document.getElementById('partner-forecast')!.dataset.currentSettings!)).toEqual(cleared);
    expect(income()).toBe('0₽');
  });

  it.each(['admin', 'partner'] as const)('uses the shared page header and brand tokens for %s', (role) => {
    const { container } = render(<CalculatorPage principal={{ role }} />);
    expect(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)).toEqual(['Калькулятор']);
    expect(screen.queryByRole('heading', { name: 'Соберите свой сценарий' })).toBeNull();
    expect(screen.queryByText('Сколько может приносить ваш контент')).toBeNull();
    const wrapper = container.querySelector<HTMLElement>('.calculator-page')!;
    expect(wrapper.style.getPropertyValue('--pf-surface')).toBe(theme.surface);
    expect(wrapper.style.getPropertyValue('--pf-accent')).toBe(theme.accent);
    expect(wrapper.style.getPropertyValue('--pf-border')).toBe(theme.border);
  });

  it('initializes without the landing header and calculates the direct payment funnel', () => {
    render(<CalculatorPage principal={{ role: 'admin' }} />);
    expect(() => initialize()).not.toThrow();
    expect(screen.queryByRole('link', { name: /Стать партнёром/ })).toBeNull();
    expect(screen.getAllByRole('spinbutton', { name: /оригиналов в неделю/ }).map(input => input.getAttribute('aria-label'))).toEqual([
      'Посты: оригиналов в неделю',
      'Короткие видео: оригиналов в неделю',
      'Длинные видео: оригиналов в неделю',
      'Статьи: оригиналов в неделю',
      'Кружочки: оригиналов в неделю',
    ]);
    expect(screen.queryByText('Текст и изображение')).toBeNull();
    expect(screen.queryByText('Один ролик → несколько площадок')).toBeNull();
    expect(screen.queryByText('Обзоры и разборы продукта')).toBeNull();
    expect(screen.queryByText('Кейсы, инструкции, сравнения')).toBeNull();
    expect(screen.queryByText('Отдельные видео для Telegram')).toBeNull();
    expect(screen.queryByLabelText('Ваша аудитория')).toBeNull();
    expect(screen.queryByLabelText('Кому вы рекомендуете Syntolk')).toBeNull();
    expect(screen.queryByText('Обычный блог')).toBeNull();
    expect(screen.queryByText('Образование')).toBeNull();
    expect(screen.queryByText('Бизнес / интеграции')).toBeNull();
    expect(income()).toBe('6158₽');
    expect(document.querySelectorAll('#pf-chart button')).toHaveLength(12);
    fireEvent.change(screen.getByRole('combobox', { name: 'Месяц' }), { target: { value: '12' } });
    expect(income()).toBe('16480₽');
    expect(document.querySelector('#pf-chart .pf-active-month')?.getAttribute('data-month')).toBe('12');
  });

  it('preserves all three scenarios and recalculates when content changes', () => {
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    fireEvent.click(screen.getByRole('button', { name: 'Ниже ожиданий' }));
    expect(income()).toBe('1724₽');
    fireEvent.click(screen.getByRole('button', { name: 'Выше ожиданий' }));
    expect(income()).toBe('15962₽');
    fireEvent.click(screen.getByRole('button', { name: 'Мой сценарий' }));
    fireEvent.input(screen.getByRole('spinbutton', { name: 'Посты: оригиналов в неделю' }), { target: { value: '0' } });
    expect(income()).not.toBe('6158₽');
    const saved = JSON.parse(localStorage.getItem('syntolk-partner-forecast-v1')!);
    expect(saved.settings.frequency.post).toBe(0);
  });

  it('retains platform and sales tabs and their keyboard navigation', () => {
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Контент' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Площадки' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Показать площадки' })).toBeTruthy();
    expect(document.querySelectorAll('[data-channel-format]').length).toBeGreaterThan(0);
    const telegramCard = document.querySelector('details[data-channel-group="telegram-short"]')!;
    const telegramUse = telegramCard.querySelector<HTMLInputElement>('[data-channel-enable="telegram-short"]')!;
    const telegramShort = telegramCard.querySelector<HTMLInputElement>('[data-channel-format="telegram-short"][value="short"]')!;
    expect(telegramUse.checked).toBe(true);
    fireEvent.click(telegramShort);
    expect(telegramShort.checked).toBe(false);
    expect(telegramUse.checked).toBe(true);
    fireEvent.click(telegramUse);
    expect(telegramUse.checked).toBe(false);
    fireEvent.click(telegramUse);
    expect(telegramUse.checked).toBe(true);
    expect(telegramShort.checked).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Продажи' }));
    expect(screen.getByRole('spinbutton', { name: 'Регистрация из переходов' })).toBeTruthy();
  });

  it('keeps platform variants separate with independent switches and one add button each', () => {
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    fireEvent.click(screen.getByRole('tab', { name: 'Площадки' }));

    expect(document.querySelectorAll('[data-channel-group]')).toHaveLength(21);
    for(const id of ['vk','vkclips','vkvideo','youtube','ytshorts','rutube','rutubeshorts','telegram-post','telegram-short','telegram-long','telegram-circle']){
      expect(document.querySelectorAll(`[data-channel-group="${id}"] .pf-channel-add-format`)).toHaveLength(1);
      expect(document.querySelectorAll(`[data-channel-group="${id}"] .pf-channel-variants`)).toHaveLength(0);
    }
    expect(document.querySelector('details[data-channel-group="youtube"] > summary')?.textContent).toContain('YouTube');
    expect(document.querySelector('details[data-channel-group="youtube"] > summary')?.textContent).not.toContain('YouTube Shorts');

    const youtubeUse = document.querySelector<HTMLInputElement>('[data-channel-enable="youtube"]')!;
    const youtubeShort = document.querySelector<HTMLInputElement>('[data-channel-format="ytshorts"][value="short"]')!;
    const youtubeLong = document.querySelector<HTMLInputElement>('[data-channel-format="youtube"][value="long"]')!;
    expect(youtubeUse.checked).toBe(true);
    expect(youtubeShort.checked).toBe(true);
    expect(youtubeLong.checked).toBe(true);

    fireEvent.click(youtubeUse);
    expect(youtubeUse.checked).toBe(false);
    expect(youtubeShort.checked).toBe(true);
    expect(youtubeLong.checked).toBe(true);
    fireEvent.click(youtubeUse);
    expect(youtubeUse.checked).toBe(true);
  });

  it('keeps edited content and nested platform settings open after rebuilding controls', () => {
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    expect(screen.queryByText('Настроить')).toBeNull();
    document.querySelector<HTMLDetailsElement>('#pf-format-settings-post')!.open = true;
    fireEvent.change(screen.getByLabelText('Название формата Посты'), { target: { value: 'Посты для канала' } });
    expect(document.querySelector<HTMLDetailsElement>('#pf-format-settings-post')!.open).toBe(true);
    const count = screen.getByRole('spinbutton', { name: 'Посты для канала: оригиналов в неделю' });
    fireEvent.input(count, { target: { value: '4' } });
    expect(document.querySelector<HTMLDetailsElement>('#pf-format-settings-post')!.open).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: 'Площадки' }));
    document.querySelector<HTMLDetailsElement>('[data-channel-group="youtube"]')!.open = true;
    fireEvent.change(screen.getByLabelText('Название площадки YouTube'), { target: { value: 'Мой YouTube' } });
    expect(document.querySelector<HTMLDetailsElement>('[data-channel-group="youtube"]')!.open).toBe(true);
  });

  it('uses one payment conversion in the form and saves an optional delay separately', () => {
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    const root = document.getElementById('partner-forecast')!;
    const settings = JSON.parse(root.dataset.currentSettings!);
    settings.frequency = { post: 1, short: 0, long: 0, article: 0, circle: 0 };
    settings.growth = 0;
    settings.tail = { post: 0, short: 0, long: 0, article: 0, circle: 0 };
    for (const channel of Object.values(settings.channels) as Array<{ enabled: boolean; formats: string[] }>) {
      channel.enabled = false; channel.formats = [];
    }
    settings.channels['telegram-post'] = { enabled: true, formats: ['post'], views: 200 / (52 / 12), ctr: 100 };
    root.dispatchEvent(new CustomEvent('syntolk-calculator-load', { detail: { settings } }));
    fireEvent.click(screen.getByRole('tab', { name: 'Продажи' }));
    expect(screen.queryByLabelText('Оплата из личной регистрации')).toBeNull();
    expect(screen.queryByLabelText('Оплата из бизнес-регистрации')).toBeNull();
    expect(screen.queryByLabelText('Новых посетителей из переходов')).toBeNull();
    fireEvent.input(screen.getByRole('spinbutton', { name: 'Регистрация из переходов' }), { target: { value: '14' } });
    fireEvent.input(screen.getByRole('spinbutton', { name: 'Первая оплата из регистрации' }), { target: { value: '10.7' } });
    fireEvent.input(screen.getByRole('spinbutton', { name: 'Бизнес среди первых оплат' }), { target: { value: '10' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Месяц' }), { target: { value: '1' } });
    expect(document.getElementById('pf-clicks')!.textContent).toBe('200');
    expect(document.getElementById('pf-signups')!.textContent).toBe('28');
    expect(document.getElementById('pf-paid')!.textContent).toBe('3');
    expect(document.getElementById('pf-result-details-title')).toBeNull();
    expect(document.getElementById('pf-monthly-output')).toBeNull();
    const delay = screen.getByLabelText(/^Доля первых оплат на следующий месяц/) as HTMLInputElement;
    expect(delay.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Учитывать перенос первой оплаты'));
    expect(delay.disabled).toBe(false);
    fireEvent.input(delay, { target: { value: '25' } });
    expect(document.getElementById('pf-paid')!.textContent).toBe('2,2');
    cleanup();
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    fireEvent.click(screen.getByRole('tab', { name: 'Продажи' }));
    expect((screen.getByLabelText('Учитывать перенос первой оплаты') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/^Доля первых оплат на следующий месяц/) as HTMLInputElement).value).toBe('25');
    expect(document.getElementById('pf-paid')!.textContent).toBe('2,2');
    fireEvent.click(screen.getByLabelText('Учитывать перенос первой оплаты'));
    expect(document.getElementById('pf-paid')!.textContent).toBe('3');
  });

  it('adds a custom format to one platform and includes it in the forecast', () => {
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    fireEvent.click(screen.getByRole('tab', { name: 'Площадки' }));
    const telegram = document.querySelector('details[data-channel-group="telegram-post"]')!;
    fireEvent.click(telegram.querySelector(':scope > summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить свой формат для Telegram — Посты' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Название формата' }), { target: { value: 'Сообщение в группе' } });
    fireEvent.input(screen.getByRole('spinbutton', { name: 'Материалов в неделю' }), { target: { value: '2' } });
    expect(screen.queryByRole('spinbutton', { name: 'Минут на материал' })).toBeNull();
    const before = income();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить формат' }));

    const saved = JSON.parse(localStorage.getItem('syntolk-partner-forecast-v1')!);
    const custom = saved.settings.customFormats[0];
    expect(custom.channelId).toBe('telegram-post');
    expect(saved.settings.frequency[custom.id]).toBe(2);
    expect(saved.settings).not.toHaveProperty('minutes');
    expect(saved.settings.channels['telegram-post'].formats).toContain(custom.id);
    expect(saved.settings.channels.youtube.formats).not.toContain(custom.id);
    expect(income()).not.toBe(before);
  });

  it('does not show the discarded free-form task fields in the calculator', () => {
    render(<CalculatorPage principal={{role:'partner'}}/>);
    initialize();
    expect(screen.queryByText('Мои задачи к материалам')).toBeNull();
    expect(screen.queryByLabelText('Мои задачи: Короткие видео')).toBeNull();
    expect(JSON.parse(document.getElementById('partner-forecast')!.dataset.currentSettings!).taskNotes).toBeUndefined();
  });

  it('lets a partner add a custom platform and keeps it in the saved scenario', () => {
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    fireEvent.click(screen.getByRole('tab', { name: 'Площадки' }));
    expect(document.getElementById('pf-custom-name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить площадку' }));
    expect(screen.getByRole('button', { name: 'Скрыть форму' })).toBeTruthy();
    fireEvent.input(document.getElementById('pf-custom-name')!, { target: { value: 'Моё отраслевое сообщество' } });
    fireEvent.input(screen.getByLabelText('Ссылка для регистрации или справки'), { target: { value: 'https://example.test/join' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить площадку' }));
    expect(screen.getAllByText('Моё отраслевое сообщество').length).toBeGreaterThan(0);
    const saved = JSON.parse(localStorage.getItem('syntolk-partner-forecast-v1')!);
    expect(saved.settings.customChannels).toHaveLength(1);
    expect(saved.settings.customChannels[0].url).toBe('https://example.test/join');
    expect(saved.settings.channels[saved.settings.customChannels[0].id].formats).toContain('short');

    const customChannelId = saved.settings.customChannels[0].id;
    const customCard = document.querySelector(`details[data-channel-group="${customChannelId}"]`)!;
    fireEvent.click(customCard.querySelector(':scope > summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить свой формат для Моё отраслевое сообщество' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Название формата' }), { target: { value: 'Партнёрская заметка' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить формат' }));
    const resaved = JSON.parse(localStorage.getItem('syntolk-partner-forecast-v1')!);
    const customFormat = resaved.settings.customFormats.find((format: { name: string }) => format.name === 'Партнёрская заметка');
    expect(customFormat.channelId).toBe(customChannelId);
    expect(resaved.settings.customChannels[0].formats).toContain(customFormat.id);
  });

  it('keeps the quick and full mobile modes functional without a duplicate heading', () => {
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize(true);
    const root = document.querySelector<HTMLElement>('#partner-forecast')!;
    expect(root.dataset.mobileMode).toBe('compact');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть полный калькулятор' }));
    expect(root.dataset.mobileMode).toBe('full');
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть до быстрого расчёта' }));
    expect(root.dataset.mobileMode).toBe('compact');
    expect(income()).toBe('6158₽');
    expect(screen.getAllByRole('heading', { name: 'Калькулятор' })).toHaveLength(1);
  });

  it('uses a custom format in workloads and forecasts and preserves it after reload',()=>{
    render(<CalculatorPage principal={{role:'partner'}}/>);initialize();
    expect(screen.queryByLabelText('Название нового формата')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Добавить формат'}));
    expect(screen.getByRole('button',{name:'Скрыть форму'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Скрыть форму'}));
    expect(screen.queryByLabelText('Название нового формата')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Добавить формат'}));
    const before=income();
    fireEvent.input(screen.getByLabelText('Название нового формата'),{target:{value:'Прямой эфир'}});
    fireEvent.click(document.getElementById('pf-add-format')!);
    const settings=JSON.parse(document.getElementById('partner-forecast')!.dataset.currentSettings!);
    const id=settings.customFormats[0].id;
    expect(settings.frequency[id]).toBe(1);expect(settings).not.toHaveProperty('minutes');
    expect(settings.channels['telegram-post'].formats).toContain(id);expect(income()).not.toBe(before);
    cleanup();render(<CalculatorPage principal={{role:'partner'}}/>);initialize();
    expect(screen.getByRole('spinbutton',{name:'Прямой эфир: оригиналов в неделю'})).toBeTruthy();
  });

  it('edits and removes built-in platforms and formats in the persisted scenario',()=>{
    render(<CalculatorPage principal={{role:'partner'}}/>);initialize();
    fireEvent.change(screen.getByLabelText('Название формата Посты'),{target:{value:'Мои посты'}});
    fireEvent.click(screen.getByRole('tab',{name:'Площадки'}));
    fireEvent.change(screen.getByLabelText('Название площадки Telegram — Посты'),{target:{value:'Мой Telegram'}});
    fireEvent.click(document.querySelector('[data-remove-channel="vkclips"]')!);
    expect(document.querySelector('[data-channel="vkclips"]')).toBeNull();
    const settings=JSON.parse(document.getElementById('partner-forecast')!.dataset.currentSettings!);
    expect(settings.removedChannels).toContain('vkclips');expect(settings.channelOverrides['telegram-post'].name).toBe('Мой Telegram');
    fireEvent.click(screen.getByRole('tab',{name:'Контент'}));
    fireEvent.click(document.querySelector('[data-remove-format="circle"]')!);
    cleanup();render(<CalculatorPage principal={{role:'partner'}}/>);initialize();
    expect(screen.queryByRole('spinbutton',{name:'Кружочки: оригиналов в неделю'})).toBeNull();
    expect(screen.getByRole('spinbutton',{name:'Мои посты: оригиналов в неделю'})).toBeTruthy();
    fireEvent.click(screen.getByRole('tab',{name:'Площадки'}));
    expect(document.querySelector('[data-channel="vkclips"]')).toBeNull();
    fireEvent.change(screen.getByLabelText('Вернуть стандартную площадку'),{target:{value:'vkclips'}});
    expect(document.querySelector('[data-channel="vkclips"]')).toBeTruthy();
  });

  it('changes forecast horizon without changing the baseline formula',()=>{
    render(<CalculatorPage principal={{role:'partner'}}/>);initialize();
    const barHeights = () => [...document.querySelectorAll<HTMLElement>('#pf-chart .pf-chart-track > span')].map(bar=>bar.style.getPropertyValue('--pf-bar'));
    const initialHeights=barHeights();
    expect(initialHeights.every(height=>Number.parseFloat(height)>0)).toBe(true);
    fireEvent.change(screen.getByRole('combobox',{name:'Месяц'}),{target:{value:'12'}});
    fireEvent.change(screen.getByRole('combobox',{name:'Месяц'}),{target:{value:'3'}});
    expect(barHeights()).toEqual(initialHeights);
    fireEvent.change(screen.getByLabelText('Период прогноза'),{target:{value:'3'}});
    expect(barHeights()).toHaveLength(3);
    expect(barHeights().every(height=>Number.parseFloat(height)>0)).toBe(true);
    fireEvent.change(screen.getByLabelText('Период прогноза'),{target:{value:'1'}});
    expect(document.querySelectorAll('#pf-chart [data-month]')).toHaveLength(1);
    expect(document.getElementById('pf-total-label')!.textContent).toBe('Всего за 1 мес.');
    expect(income()).toBe('2026₽');
    fireEvent.change(screen.getByLabelText('Период прогноза'),{target:{value:'12'}});
    fireEvent.change(screen.getByRole('combobox',{name:'Месяц'}),{target:{value:'12'}});
    expect(income()).toBe('16480₽');
  });

  it('reloads the saved scenario without resetting the user draft', () => {
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    fireEvent.change(screen.getByRole('combobox', { name: 'Месяц' }), { target: { value: '12' } });
    cleanup();
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    expect(income()).toBe('16480₽');
    expect((screen.getByRole('combobox', { name: 'Месяц' }) as HTMLSelectElement).value).toBe('12');
  });
});
