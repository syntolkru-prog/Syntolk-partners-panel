import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { type Principal } from '../api.js';
import { theme } from '../theme.js';
import { ErrorBanner, Page } from '../ui.js';
import '../calculator/forecast.css';
import '../calculator/portal-theme.css';
import '../calculator/blueprint.css';
import { CalculatorCharts } from '../components/tremor/CalculatorCharts.js';

const CALCULATOR_VERSION = 'calculator-three-metrics-v9-2026-10-22';
let calculatorInstance = 0;

// Share the portal's tokens, including tenant-specific accent colors.
const calculatorTheme = {
  '--pf-bg': theme.bg,
  '--pf-surface': theme.surface,
  '--pf-surface-raised': theme.surface2,
  '--pf-border': theme.border,
  '--pf-border-subtle': theme.borderSubtle,
  '--pf-text': theme.text,
  '--pf-muted': theme.textMuted,
  '--pf-accent': theme.accent,
  '--pf-accent-hover': theme.accentHover,
  '--pf-accent-soft': theme.accentSoft,
  '--pf-accent-ink': theme.accentInk,
  '--pf-info': theme.info,
  '--pf-info-soft': theme.infoSoft,
  '--pf-warning': theme.warn,
  '--pf-warning-soft': theme.warnSoft,
  '--pf-radius': `${theme.radiusMd}px`,
  '--pf-radius-sm': `${theme.radiusSm}px`,
} as CSSProperties;

const chartIcon = (paths:string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const contentIcon=chartIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>');
const barsIcon=chartIcon('<path d="M4 14h4v7H4zM10 8h4v13h-4zM16 3h4v18h-4z"/>');
const horizonMarkup=`<label class="pf-field pf-horizon">Период прогноза<select id="pf-horizon">${Array.from({length:12},(_,i)=>`<option value="${i+1}"${i===11?' selected':''}>${i+1} мес.</option>`).join('')}</select></label>`;
const calculatorMarkup = (withCurrentValues:boolean,partner:boolean) => String.raw`
  <section class="pf-section" id="rewards" aria-label="Сценарный расчёт партнёрского дохода">
    <div class="pf-container">
      <div class="pf-app" id="partner-forecast" data-chart-kind="${partner?'funnel':'income'}">
        ${partner?'':'<div class="pf-toolbar"><div class="pf-toolbar-actions"><button class="pf-text-button" type="button" id="pf-reset" title="Обнулить контент и выбор площадок, сохранив тарифы, конверсии и хвосты">Создать сценарий</button></div></div>'}
        <div class="pf-mode-bar"><button class="pf-mode-toggle" type="button" id="pf-mode-toggle" aria-expanded="false" aria-controls="pf-tabs pf-more-settings pf-result-analysis">Открыть полный калькулятор <span aria-hidden="true">↓</span></button></div>
        <div class="pf-workspace">
          <div class="pf-controls">
            ${partner?`<div class="pf-toolbar"><h2 class="pf-blueprint-heading"><span class="pf-heading-icon">${contentIcon}</span>План контента</h2><div class="pf-toolbar-actions"><button class="pf-text-button" type="button" id="pf-reset" title="Обнулить контент и выбор площадок, сохранив тарифы, конверсии и хвосты">Создать сценарий</button></div></div>`:''}
            <div class="pf-tabs pf-full-only" id="pf-tabs" role="tablist" aria-label="Настройки партнёрского сценария">
              <button class="pf-tab" type="button" role="tab" id="pf-tab-content" data-pf-tab="content" aria-controls="pf-panel-content" aria-selected="true">Контент</button>
              <button class="pf-tab" type="button" role="tab" id="pf-tab-platforms" data-pf-tab="platforms" aria-controls="pf-panel-platforms" aria-selected="false" tabindex="-1">Площадки</button>
              <button class="pf-tab" type="button" role="tab" id="pf-tab-sales" data-pf-tab="sales" aria-controls="pf-panel-sales" aria-selected="false" tabindex="-1">Продажи</button>
            </div>
            <div class="pf-panel" id="pf-panel-content" role="tabpanel" data-pf-panel="content" aria-labelledby="pf-tab-content" tabindex="0"></div>
            <div class="pf-panel" id="pf-panel-platforms" role="tabpanel" data-pf-panel="platforms" aria-labelledby="pf-tab-platforms" tabindex="0" hidden></div>
            <div class="pf-panel" id="pf-panel-sales" role="tabpanel" data-pf-panel="sales" aria-labelledby="pf-tab-sales" tabindex="0" hidden></div>
            <details class="pf-details pf-quick-only pf-quick-assumptions"><summary>Площадки и допущения</summary><p class="pf-help" id="pf-quick-assumptions"></p><p class="pf-help">Изменить площадки, просмотры и конверсии можно в полном калькуляторе. Все введённые значения сохранятся.</p></details>
            <div class="pf-work pf-full-only" id="pf-work"></div>
          </div>
          <div class="pf-result" aria-label="Результаты сценарного расчёта">
            <p class="pf-quick-only pf-quick-scenario" id="pf-quick-scenario"></p>
            ${partner?`<div class="pf-result-heading"><h2 class="pf-blueprint-heading"><span class="pf-heading-icon">${barsIcon}</span><span id="pf-result-title">Прогноз дохода</span></h2>`:''}
            <div class="pf-scenarios pf-full-only${withCurrentValues?' pf-scenarios--with-refresh':''}" role="group" aria-label="Сравнить сценарии">
              ${withCurrentValues?'':'<button type="button" data-scenario="low" aria-pressed="false">Ниже ожиданий</button>'}<button type="button" data-scenario="base" aria-pressed="true">Мой сценарий</button>${withCurrentValues?'<button type="button" data-current-values aria-pressed="false">Текущие значения</button><button type="button" class="pf-refresh" data-current-refresh aria-label="Обновить" title="Обновить фактические данные"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg></button>':'<button type="button" data-scenario="high" aria-pressed="false">Выше ожиданий</button>'}
            </div>
            ${partner?'</div>':''}
            <p class="pf-scenario-note pf-full-only" id="pf-scenario-note"></p>
            ${partner?'<div class="pf-result-metrics">':horizonMarkup}
            <div class="pf-income-top"><div><p id="pf-income-label">Начисления за 3-й месяц</p><output id="pf-income" aria-labelledby="pf-income-label">—</output></div><label class="pf-month-select" for="pf-month">Месяц<select id="pf-month"><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option><option value="7">7</option><option value="8">8</option><option value="9">9</option><option value="10">10</option><option value="11">11</option><option value="12">12</option></select></label></div>
            <p class="pf-income-range" id="pf-income-range"></p>
            <div class="pf-year-totals"><div><span id="pf-total-label">Всего за 12 месяцев</span><strong id="pf-year">—</strong></div><div><span>Накоплено к выбранному месяцу</span><strong id="pf-cumulative">—</strong></div></div>
            ${partner?horizonMarkup+'</div>':''}
            <div class="pf-result-analysis pf-full-only" id="pf-result-analysis">
              <div class="pf-chart-caption"><span>Начисления по месяцам</span><span id="pf-chart-hint">Нажмите на столбец</span></div><div class="pf-chart" id="pf-chart" role="group" aria-label="Начисления за каждый из 12 месяцев"></div>
              <div class="pf-funnel">${partner?'':'<div><strong id="pf-views">—</strong><span>Просмотры</span></div>'}<div>${partner?chartIcon('<path d="m4 3 7 18 3-7 7-3Z"/>'):''}<strong id="pf-clicks">—</strong><span>Переходы</span></div><div>${partner?chartIcon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'):''}<strong id="pf-signups">—</strong><span>Регистрации</span></div><div>${partner?chartIcon('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20"/>'):''}<strong id="pf-paid">—</strong><span>Первые оплаты</span></div></div>
              ${partner?'<div class="pf-payment-summary">':''}<div class="pf-repeat-bar" id="pf-repeat-bar" aria-hidden="true"${partner?' hidden':''}><span></span></div><div class="pf-repeat-labels"><div>Первые оплаты<strong id="pf-new-income">—</strong></div><div>Повторные оплаты<strong id="pf-repeat-income">—</strong></div></div>${partner?'</div>':''}
            </div>
            <p class="pf-quick-only pf-quick-disclaimer">Оценка по заданным допущениям, не гарантия дохода.</p>
          </div>
        </div>
        <p id="pf-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
        <noscript><p>Для интерактивного расчёта включите JavaScript.</p></noscript>
      </div>
    </div>
  </section>`;

function loadScript(src: string): Promise<HTMLScriptElement> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => resolve(script);
    script.onerror = () => reject(new Error('Не удалось загрузить калькулятор: ' + src));
    document.head.appendChild(script);
  });
}

export function CalculatorPage({principal,scope,connection,actions,intro,planning,onCreateScenario,currentValues,onCurrentValuesChange}: { principal: Principal; scope?: {key:string;settings?:Record<string,unknown>}; connection?:ReactNode;actions?:ReactNode;intro?:ReactNode;planning?:ReactNode;onCreateScenario?: (root: HTMLElement) => void;currentValues?:ReactNode|((root:HTMLElement|null)=>ReactNode);onCurrentValuesChange?:(active:boolean)=>void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const createScenarioRef = useRef(onCreateScenario);
  const [error, setError] = useState<Error | null>(null);
  const withCurrentValues=principal.role==='partner'&&currentValues!==undefined;
  const [calculatorRoot,setCalculatorRoot]=useState<HTMLElement|null>(null);
  createScenarioRef.current = onCreateScenario;

  useEffect(() => {
    const root = rootRef.current?.querySelector<HTMLElement>('#partner-forecast');
    if (!root) return;
    const instance = ++calculatorInstance;
    root.dataset.storageKey = scope?.key??'syntolk-partner-forecast-v1';
    setCalculatorRoot(root);
    if(scope?.settings)root.dataset.initialState=JSON.stringify({version:1,settings:scope.settings});
    else delete root.dataset.initialState;
    const handleCreateScenario = (event: Event) => {
      if(!createScenarioRef.current)return;
      event.preventDefault();
      createScenarioRef.current(root);
    };
    root.addEventListener('syntolk-calculator-create-scenario',handleCreateScenario);
    const assetBase = String(import.meta.env.BASE_URL) + 'calculator/';
    let active = true;
    const scripts: HTMLScriptElement[] = [];
    loadScript(assetBase + 'forecast-model.js?v=' + CALCULATOR_VERSION + '&instance=' + instance)
      .then((script) => {
        scripts.push(script);
        if(!active)throw new Error('Калькулятор закрыт');
        return loadScript(assetBase + 'forecast-ui.js?v=' + CALCULATOR_VERSION + '&instance=' + instance);
      })
      .then((script) => scripts.push(script))
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError : new Error('Калькулятор недоступен'));
      });
    return () => {
      active = false;
      root.removeEventListener('syntolk-calculator-create-scenario',handleCreateScenario);
      scripts.forEach((script) => script.remove());
    };
  // Settings are a seed only. Do not overwrite an edited draft on refetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope?.key]);

  return (
    <div className={`calculator-page${principal.role==='partner'?' calculator-blueprint':''}`} style={calculatorTheme}>
      <Page title="Калькулятор" subtitle="Сценарий — ваш план публикаций. Укажите количество материалов и выберите площадки: появится прогноз дохода, после сохранения — задачи в календаре." actions={actions}>
        <ErrorBanner error={error} />
      {principal.role==='partner'&&(intro||planning)?<section className="calculator-setup" aria-label="Параметры сценария"><div className="calculator-setup-scenario"><h2>Параметры сценария</h2>{intro}</div>{planning}</section>:<>{intro}{planning}</>}
        <div ref={rootRef} onClickCapture={event=>{
          if(!withCurrentValues)return;
          const button=(event.target as Element).closest('button');
          if(button?.hasAttribute('data-current-values'))onCurrentValuesChange?.(true);
          else if(button?.hasAttribute('data-scenario'))onCurrentValuesChange?.(false);
        }} dangerouslySetInnerHTML={{ __html: calculatorMarkup(withCurrentValues,principal.role==='partner') }} />
        {withCurrentValues&&(typeof currentValues==='function'?currentValues(calculatorRoot):currentValues)}
        <CalculatorCharts root={calculatorRoot}/>
        {connection}
      </Page>
    </div>
  );
}
