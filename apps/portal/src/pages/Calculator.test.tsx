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

const actualCounts={clicks:133,registrations:22,payingCustomers:9,paymentCount:15,firstPaymentCount:9,repeatPaymentCount:6};
const actualConversions={clickToRegistration:22/133,registrationToPayment:8/22,clickToPayment:9/133,cohortRegistrations:22,cohortPaidRegistrations:8};
const actualContent={preparedMaterials:8,publishedMaterials:5,publishedPlacements:12};
const actualAmounts={observedPayments:9703500,netPayments:9703500,refunds:0,netAccrued:1940700};
const actualPost={id:'post',name:'Посты',counts:actualCounts,conversions:actualConversions,content:actualContent,amountsMinor:actualAmounts};
const actualDzen={...actualPost,id:'dzen',name:'Дзен',counts:{...actualCounts,clicks:24,registrations:3},content:{preparedMaterials:2,publishedMaterials:2,publishedPlacements:2},conversions:{...actualConversions,clickToRegistration:3/24,registrationToPayment:1/3},formats:[actualPost]};
const actualReport={currency:'RUB',counts:actualCounts,conversions:actualConversions,content:actualContent,amountsMinor:actualAmounts,series:{bucket:'day',points:[{date:'2026-10-01',clicks:133,registrations:22,firstPayments:9,payments:15,earningsMinor:1940700}]},breakdown:{formats:[actualPost],platforms:[actualDzen]}};
function sendFacts(active:boolean,report:unknown=actualReport,storageKey='syntolk-fact-test',extra:Record<string,unknown>={}){
  document.getElementById('partner-forecast')!.dispatchEvent(new CustomEvent('syntolk-calculator-current-values',{detail:{active,report,filter:{period:'30d',from:'',to:'',allContent:true},storageKey,scenarioName:'Сценарий 1',error:'',...extra}}));
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
  it('emits the three displayed event counts, never revenue or repeat payments in their place',()=>{
    render(<CalculatorPage principal={{role:'partner'}}/>);
    const chart=vi.fn();document.getElementById('partner-forecast')!.addEventListener('syntolk-calculator-chart',event=>chart((event as CustomEvent).detail));
    initialize();
    const forecast=chart.mock.lastCall![0];
    expect(forecast.facts).toBe(false);
    expect(forecast.points).toHaveLength(12);
    const current=forecast.points[2];
    expect(current.clicks).toBe(Number(document.getElementById('pf-clicks')!.textContent!.replace(/\s/g,'')));
    expect(current.registrations).toBe(Number(document.getElementById('pf-signups')!.textContent!.replace(',','.')));
    expect(current.firstPayments).toBe(Number(document.getElementById('pf-paid')!.textContent!.replace(',','.')));
    expect(document.getElementById('pf-views')).toBeNull();
    expect(document.querySelectorAll('.pf-funnel > div')).toHaveLength(3);
    sendFacts(true);
    const facts=chart.mock.lastCall![0];
    expect(facts.points[0].value).toBe(19407);
    expect(facts.points[0]).toMatchObject({clicks:133,registrations:22,firstPayments:9});
    expect(facts.points[0].firstPayments).not.toBe(actualCounts.paymentCount);
  });
  it('steps existing frequency inputs within their limits and never edits factual counts',()=>{
    render(<CalculatorPage principal={{role:'partner'}} currentValues={<span/>}/>);initialize();
    const field=()=>screen.getByRole('spinbutton',{name:'Посты: оригиналов в неделю'}) as HTMLInputElement;
    const before=income(),initial=Number(field().value);
    fireEvent.click(screen.getByRole('button',{name:'Увеличить количество: Посты'}));
    expect(Number(field().value)).toBe(initial+1);expect(income()).not.toBe(before);
    fireEvent.click(screen.getByRole('button',{name:'Уменьшить количество: Посты'}));
    expect(Number(field().value)).toBe(initial);expect(income()).toBe(before);
    fireEvent.input(field(),{target:{value:'35'}});
    fireEvent.click(screen.getByRole('button',{name:'Увеличить количество: Посты'}));expect(field().value).toBe('35');
    fireEvent.input(field(),{target:{value:'0.25'}});
    fireEvent.click(screen.getByRole('button',{name:'Уменьшить количество: Посты'}));expect(field().value).toBe('0');
    sendFacts(true);
    const add=screen.getByRole('button',{name:'Увеличить количество: Посты'}) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    const fact=screen.getByRole('spinbutton',{name:'Посты: создано за период'}) as HTMLInputElement;
    const value=fact.value;fireEvent.click(add);expect(fact.value).toBe(value);
    sendFacts(false);expect((screen.getByRole('button',{name:'Увеличить количество: Посты'}) as HTMLButtonElement).disabled).toBe(false);
  });
  it('uses the same calculator panels, inputs and chart for facts, and restores the unchanged original forecast on return',()=>{
    render(<CalculatorPage principal={{role:'partner'}} currentValues={null}/>);initialize();const original=income(),root=document.getElementById('partner-forecast')!,settings=root.dataset.currentSettings,stored=localStorage.getItem('syntolk-partner-forecast-v1');
    const frame=()=>[...document.querySelectorAll('.pf-controls > *, .pf-result > *')].map(element=>[element.tagName,element.id,element.className]);const before=frame();
    expect(screen.queryByRole('button',{name:'Выше ожиданий'})).toBeNull();expect(screen.queryByRole('button',{name:'Ниже ожиданий'})).toBeNull();expect(screen.getByRole('button',{name:'Обновить'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Текущие значения'}));sendFacts(true);
    expect(frame()).toEqual(before);expect(document.getElementById('pf-current-values')).toBeNull();expect(document.getElementById('pf-current-controls')).toBeNull();
    expect(document.getElementById('pf-income')!.closest<HTMLElement>('.pf-income-top')!.hidden).toBe(false);expect(income()).toBe('19407,00₽');
    expect((screen.getByLabelText('Посты: создано за период') as HTMLInputElement).value).toBe('8');expect((screen.getByLabelText('Посты: создано за период') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByRole('button',{name:'Текущие значения'}).getAttribute('aria-pressed')).toBe('true');expect(root.dataset.currentSettings).toBe(settings);
    expect(document.getElementById('pf-panel-content')!.hidden).toBe(false);expect(document.getElementById('pf-work')!.hidden).toBe(false);
    fireEvent.click(screen.getByRole('tab',{name:'Площадки'}));expect(document.getElementById('pf-panel-platforms')!.hidden).toBe(false);
    expect((screen.getByRole('button',{name:'Выбрать все подходящие площадки'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('tab',{name:'Площадки'}),{key:'ArrowRight'});expect(document.getElementById('pf-panel-sales')!.hidden).toBe(false);
    expect(Number((screen.getByRole('spinbutton',{name:'Регистрация из переходов'}) as HTMLInputElement).value)).toBeCloseTo(22/133*100);
    expect(localStorage.getItem('syntolk-partner-forecast-v1')).toBe(stored);
    fireEvent.click(screen.getByRole('button',{name:'Мой сценарий'}));sendFacts(false);expect(income()).toBe(original);expect(frame()).toEqual(before);expect(root.dataset.currentSettings).toBe(settings);
    expect((screen.getByRole('spinbutton',{name:'Регистрация из переходов'}) as HTMLInputElement).readOnly).toBe(false);
  });
  it('removes factual views and CTR while preserving forecast assumptions and stored data',()=>{
    render(<CalculatorPage principal={{role:'partner'}} currentValues={null}/>);initialize();const root=document.getElementById('partner-forecast')!,settings=root.dataset.currentSettings;sendFacts(true);
    fireEvent.click(screen.getByRole('tab',{name:'Площадки'}));fireEvent.click(document.querySelector('[data-channel-group="dzen"] > summary')!);
    localStorage.setItem('syntolk-fact-test',JSON.stringify({dzen:1000}));
    expect(document.getElementById('pf-channels-dzen-views')).toBeNull();expect(document.getElementById('pf-channels-dzen-ctr')).toBeNull();expect(document.getElementById('pf-views')).toBeNull();
    expect(document.getElementById('pf-scenario-note')!.textContent).not.toMatch(/просмотр/i);
    expect(document.querySelector('[data-source-help="dzen"]')!.textContent).not.toMatch(/просмотр/i);
    expect(document.getElementById('pf-more-settings')!.hidden).toBe(true);
    const option=document.querySelector('#pf-horizon option'),bar=document.querySelector('#pf-chart > button');
    sendFacts(true,{...actualReport,counts:{...actualCounts,clicks:134}});expect(document.getElementById('pf-channels-dzen-views')).toBeNull();expect(document.getElementById('pf-clicks')!.textContent).toBe('134');
    expect(document.querySelector('#pf-horizon option')).toBe(option);expect(document.querySelector('#pf-chart > button')).toBe(bar);
    sendFacts(true,actualReport,'syntolk-fact-other-period');expect(document.getElementById('pf-channels-dzen-views')).toBeNull();
    sendFacts(false);expect(root.dataset.currentSettings).toBe(settings);
    expect(document.getElementById('pf-channels-dzen-views')).not.toBeNull();expect(document.getElementById('pf-more-settings')!.hidden).toBe(false);
    expect(JSON.parse(localStorage.getItem('syntolk-fact-test')!).dzen).toBe(1000);
  });
  it('shows unknown facts as blank rather than plan values and updates new custom formats and platforms without changing the draft',()=>{
    render(<CalculatorPage principal={{role:'partner'}} currentValues={null}/>);initialize();const root=document.getElementById('partner-forecast')!,settings=root.dataset.currentSettings;sendFacts(true,null);
    expect(income()).toBe('—');expect((document.getElementById('pf-frequency-post') as HTMLInputElement).value).toBe('');
    const custom={...actualPost,id:'custom-format',name:'Мой новый контент'};
    sendFacts(true,{...actualReport,breakdown:{formats:[actualPost,custom],platforms:[actualDzen,{...actualDzen,id:'custom-place',name:'Моя площадка',formats:[custom]}]}});
    expect((screen.getByLabelText('Мой новый контент: создано за период') as HTMLInputElement).value).toBe('8');fireEvent.click(screen.getByRole('tab',{name:'Площадки'}));expect(screen.getByText('Моя площадка')).toBeTruthy();
    expect(root.dataset.currentSettings).toBe(settings);sendFacts(false);expect(document.getElementById('pf-frequency-custom-format')).toBeNull();expect(root.dataset.currentSettings).toBe(settings);
  });
  it('keeps the administrator three-scenario calculator unchanged',()=>{
    render(<CalculatorPage principal={{role:'admin'}} currentValues={<p>Факт партнёра</p>}/>);initialize();
    expect(screen.getByRole('button',{name:'Выше ожиданий'})).toBeTruthy();expect(screen.getByRole('button',{name:'Ниже ожиданий'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Обновить'})).toBeNull();expect(screen.queryByRole('button',{name:'Текущие значения'})).toBeNull();expect(document.getElementById('pf-current-values')).toBeNull();
  });
  it('refreshes facts without switching modes or saving plan changes',()=>{
    const onMode=vi.fn();render(<CalculatorPage principal={{role:'partner'}} currentValues={null} onCurrentValuesChange={onMode}/>);initialize();
    const root=document.getElementById('partner-forecast')!,refresh=vi.fn(),settings=root.dataset.currentSettings,stored=localStorage.getItem('syntolk-partner-forecast-v1'),original=income();
    root.addEventListener('syntolk-calculator-refresh',refresh);
    const button=screen.getByRole('button',{name:'Обновить'});
    expect(button.getAttribute('type')).toBe('button');expect(button.hasAttribute('aria-pressed')).toBe(false);
    expect(button.textContent).toBe('');expect(button.querySelector('svg')).not.toBeNull();expect(button.parentElement!.lastElementChild).toBe(button);
    expect(button.querySelector('svg')!.getAttribute('width')).toBe('16');expect(button.querySelector('svg')!.getAttribute('height')).toBe('16');
    fireEvent.click(button);expect(refresh).toHaveBeenCalledTimes(1);expect(onMode).not.toHaveBeenCalled();expect(income()).toBe(original);
    sendFacts(true);fireEvent.click(screen.getByRole('tab',{name:'Площадки'}));fireEvent.click(document.querySelector('[data-channel-group="dzen"] > summary')!);
    expect(document.getElementById('pf-channels-dzen-views')).toBeNull();
    fireEvent.click(button);sendFacts(true);
    expect(refresh).toHaveBeenCalledTimes(2);expect(document.getElementById('pf-channels-dzen-views')).toBeNull();expect(income()).toBe('19407,00₽');expect(onMode).not.toHaveBeenCalled();
    expect(root.dataset.currentSettings).toBe(settings);expect(localStorage.getItem('syntolk-partner-forecast-v1')).toBe(stored);
  });
  it('does not keep a hidden lower-expectation mode after replacing its button',()=>{
    render(<CalculatorPage principal={{role:'partner'}} currentValues={null}/>);initialize();const saved=JSON.parse(localStorage.getItem('syntolk-partner-forecast-v1')!);const original=income();
    cleanup();localStorage.setItem('syntolk-partner-forecast-v1',JSON.stringify({...saved,scenario:'low'}));
    render(<CalculatorPage principal={{role:'partner'}} currentValues={null}/>);initialize();
    expect(income()).toBe(original);expect(screen.getByRole('button',{name:'Мой сценарий'}).getAttribute('aria-pressed')).toBe('true');
  });
  it('inspects factual bars, preserves the full chart and selects zero days with keyboard support',()=>{
    render(<CalculatorPage principal={{role:'partner'}} currentValues={null}/>);initialize();const root=document.getElementById('partner-forecast')!,settings=root.dataset.currentSettings,inspect=vi.fn();
    root.addEventListener('syntolk-calculator-fact-point',inspect);
    const chartReport={...actualReport,series:{bucket:'day',points:[{date:'2026-09-30',clicks:0,registrations:0,payments:0,earningsMinor:0},...actualReport.series.points,{date:'2026-10-02',clicks:0,registrations:0,payments:0,earningsMinor:0}]}};
    sendFacts(true,chartReport);const bars=[...document.querySelectorAll<HTMLButtonElement>('[data-fact-point]')];expect(bars).toHaveLength(3);
    fireEvent.click(bars[1]!);expect((inspect.mock.calls.at(-1)![0] as CustomEvent).detail).toBe('2026-10-01');
    const selectedPoint={date:'2026-10-01',from:'2026-10-01',to:'2026-10-01'};
    sendFacts(true,actualReport,'selected-day',{chartReport,selectedPoint});
    const clear=screen.getByRole('button',{name:'Весь период'});sendFacts(true,actualReport,'selected-day',{chartReport,selectedPoint});expect(screen.getByRole('button',{name:'Весь период'})).toBe(clear);
    expect(document.querySelectorAll('[data-fact-point]')).toHaveLength(3);expect(bars[1]!.getAttribute('aria-pressed')).toBe('true');expect(bars[1]!.classList.contains('pf-active-month')).toBe(true);
    expect(document.getElementById('pf-income-label')!.textContent).toContain('2026-10-01');
    fireEvent.keyDown(bars[1]!,{key:'ArrowRight'});expect((inspect.mock.calls.at(-1)![0] as CustomEvent).detail).toBe('2026-10-02');
    const zero={...actualReport,counts:{...actualCounts,clicks:0,registrations:0,firstPaymentCount:0,repeatPaymentCount:0,paymentCount:0},amountsMinor:{...actualAmounts,netAccrued:0},content:{preparedMaterials:0,publishedMaterials:0,publishedPlacements:0},breakdown:{formats:[],platforms:[]}};
    sendFacts(true,zero,'zero-day',{chartReport,selectedPoint:{date:'2026-10-02',from:'2026-10-02',to:'2026-10-02'}});
    expect(income()).toBe('0,00₽');expect(document.getElementById('pf-clicks')!.textContent).toBe('0');expect((document.getElementById('pf-frequency-post') as HTMLInputElement).value).toBe('0');
    fireEvent.keyDown(bars[2]!,{key:'Home'});expect((inspect.mock.calls.at(-1)![0] as CustomEvent).detail).toBe('2026-09-30');
    fireEvent.keyDown(bars[0]!,{key:'End'});expect((inspect.mock.calls.at(-1)![0] as CustomEvent).detail).toBe('2026-10-02');
    fireEvent.keyDown(bars[2]!,{key:'Escape'});expect((inspect.mock.calls.at(-1)![0] as CustomEvent).detail).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Весь период'}));expect((inspect.mock.calls.at(-1)![0] as CustomEvent).detail).toBeNull();expect(root.dataset.currentSettings).toBe(settings);
    sendFacts(false);sendFacts(true,actualReport,'selected-day',{chartReport,selectedPoint});expect(screen.getByRole('button',{name:'Весь период'})).toBeTruthy();
  });
  it('indicates manual refresh progress and completion without changing the plan',()=>{
    render(<CalculatorPage principal={{role:'partner'}} currentValues={null}/>);initialize();const original=income(),button=screen.getByRole('button',{name:'Обновить'}) as HTMLButtonElement;
    expect(document.getElementById('pf-scenario-note')!.textContent).toContain('не фактический заработок');
    sendFacts(false,actualReport,'syntolk-fact-test',{refreshState:'loading'});expect(button.disabled).toBe(true);expect(button.getAttribute('aria-busy')).toBe('true');
    sendFacts(false,actualReport,'syntolk-fact-test',{refreshState:'success'});expect(button.disabled).toBe(false);expect(button.title).toBe('Фактические данные обновлены');expect(income()).toBe(original);
    sendFacts(false,actualReport,'syntolk-fact-test',{refreshState:'error'});expect(button.title).toContain('Не удалось обновить');expect(button.disabled).toBe(false);
  });
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
    expect(document.getElementById('pf-chart-hint')!.textContent).toBe('Нет событий');
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
