import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { type Principal } from '../api.js';
import { theme } from '../theme.js';
import { ErrorBanner, Page } from '../ui.js';
import '../calculator/forecast.css';
import '../calculator/portal-theme.css';

const CALCULATOR_VERSION = 'portal-theme-2026-10-13';
let calculatorInstance = 0;

// Share the portal's tokens, including tenant-specific accent colors. Keep the
// standalone calculator's formulas, state and original stylesheet untouched.
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

const calculatorMarkup = String.raw`
  <section class="pf-section" id="rewards" aria-label="Сценарный расчёт партнёрского дохода">
    <div class="pf-container">
      <div class="pf-app" id="partner-forecast">
        <div class="pf-toolbar"><div class="pf-toolbar-actions"><a class="pf-text-button" href="https://docs.google.com/document/d/1-63P13R7v3RpC1vsiap2JVCTujYxVEN2hzekUKvo6k8/edit" target="_blank" rel="noopener noreferrer" aria-label="Инструкция к калькулятору (откроется в новой вкладке)">Инструкция <span aria-hidden="true">↗</span></a><button class="pf-text-button" type="button" id="pf-reset">Сбросить</button></div></div>
        <div class="pf-mode-bar"><button class="pf-mode-toggle" type="button" id="pf-mode-toggle" aria-expanded="false" aria-controls="pf-tabs pf-more-settings pf-result-analysis">Открыть полный калькулятор <span aria-hidden="true">↓</span></button></div>
        <div class="pf-workspace">
          <div class="pf-controls">
            <div class="pf-quick-only" id="pf-quick-profile"></div>
            <div class="pf-tabs pf-full-only" id="pf-tabs" role="tablist" aria-label="Настройки партнёрского сценария">
              <button class="pf-tab" type="button" role="tab" id="pf-tab-content" data-pf-tab="content" aria-controls="pf-panel-content" aria-selected="true">Контент</button>
              <button class="pf-tab" type="button" role="tab" id="pf-tab-platforms" data-pf-tab="platforms" aria-controls="pf-panel-platforms" aria-selected="false" tabindex="-1">Площадки</button>
              <button class="pf-tab" type="button" role="tab" id="pf-tab-sales" data-pf-tab="sales" aria-controls="pf-panel-sales" aria-selected="false" tabindex="-1">Продажи</button>
            </div>
            <div class="pf-panel" id="pf-panel-content" role="tabpanel" data-pf-panel="content" aria-labelledby="pf-tab-content" tabindex="0"></div>
            <div class="pf-panel" id="pf-panel-platforms" role="tabpanel" data-pf-panel="platforms" aria-labelledby="pf-tab-platforms" tabindex="0" hidden></div>
            <div class="pf-panel" id="pf-panel-sales" role="tabpanel" data-pf-panel="sales" aria-labelledby="pf-tab-sales" tabindex="0" hidden></div>
            <details class="pf-details pf-quick-only pf-quick-assumptions"><summary>Площадки и допущения</summary><p class="pf-help" id="pf-quick-assumptions"></p><p class="pf-help">Изменить площадки, просмотры и конверсии можно в полном калькуляторе. Все введённые значения сохранятся.</p></details>
            <div class="pf-work pf-full-only" id="pf-work"></div><p class="pf-help pf-full-only" id="pf-budget-note"></p><p class="pf-warning" id="pf-unplaced" hidden></p><button class="pf-fit" type="button" id="pf-fit" hidden>Сократить план под моё время</button>
          </div>
          <div class="pf-result" aria-label="Результаты сценарного расчёта">
            <p class="pf-quick-only pf-quick-scenario" id="pf-quick-scenario"></p>
            <div class="pf-scenarios pf-full-only" role="group" aria-label="Сравнить сценарии">
              <button type="button" data-scenario="low" aria-pressed="false">Ниже ожиданий</button><button type="button" data-scenario="base" aria-pressed="true">Мой сценарий</button><button type="button" data-scenario="high" aria-pressed="false">Выше ожиданий</button>
            </div>
            <p class="pf-scenario-note pf-full-only" id="pf-scenario-note"></p>
            <div class="pf-income-top"><div><p id="pf-income-label">Начисления за 3-й месяц</p><output id="pf-income" aria-labelledby="pf-income-label">—</output></div><label class="pf-month-select" for="pf-month">Месяц<select id="pf-month"><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option><option value="7">7</option><option value="8">8</option><option value="9">9</option><option value="10">10</option><option value="11">11</option><option value="12">12</option></select></label></div>
            <p class="pf-income-range" id="pf-income-range"></p>
            <div class="pf-year-totals"><div><span>Всего за 12 месяцев</span><strong id="pf-year">—</strong></div><div><span>Накоплено к выбранному месяцу</span><strong id="pf-cumulative">—</strong></div><div><span>Работы за год</span><strong id="pf-hours">—</strong></div></div>
            <div class="pf-result-analysis pf-full-only" id="pf-result-analysis">
              <div class="pf-chart-caption"><span>Начисления по месяцам</span><span>Нажмите на столбец</span></div><div class="pf-chart" id="pf-chart" role="group" aria-label="Начисления за каждый из 12 месяцев"></div>
              <div class="pf-funnel"><div><strong id="pf-views">—</strong><span>Просмотры</span></div><div><strong id="pf-clicks">—</strong><span>Переходы</span></div><div><strong id="pf-signups">—</strong><span>Регистрации</span></div><div><strong id="pf-paid">—</strong><span>Первые оплаты</span></div></div>
              <div class="pf-repeat-bar" id="pf-repeat-bar" aria-hidden="true"><span></span></div><div class="pf-repeat-labels"><div>Первые оплаты<strong id="pf-new-income">—</strong></div><div>Повторные оплаты<strong id="pf-repeat-income">—</strong></div></div>
              <details class="pf-details"><summary id="pf-result-details-title">Клиенты, тарифы и источники</summary><div class="pf-extra-metrics"><div>Активных клиентов<strong id="pf-active-clients">—</strong></div><div>Просмотры старого контента<strong id="pf-old-share">—</strong></div><div>Новых посетителей<strong id="pf-new-visitors">—</strong></div><div>Повысили тариф<strong id="pf-upgrades">—</strong></div><div>Перестали оплачивать<strong id="pf-churned">—</strong></div><div>После заданных расходов<strong id="pf-net">—</strong></div></div><h4>На каких тарифах</h4><div id="pf-plan-output"></div><h4>Какие площадки приносят результат</h4><div id="pf-channel-output"></div><h4>Как сохраняются группы клиентов</h4><div id="pf-cohort-output"></div><p class="pf-help">Количество людей — расчётное ожидание, поэтому возможны дроби. Начисления до налогов; расходы и оценка времени задаются вами.</p></details>
            </div>
            <p class="pf-quick-only pf-quick-disclaimer">Оценка по заданным допущениям, не гарантия дохода.</p>
            <div class="pf-result-footer"><a class="pf-cta" href="/join" id="pf-register">Стать партнёром <span aria-hidden="true">→</span></a><button class="pf-export pf-full-only" type="button" id="pf-export">Скачать расчёт CSV ↓</button></div>
          </div>
        </div>
        <div class="pf-under"><details class="pf-details"><summary>Все месяцы в таблице</summary><div id="pf-monthly-output"></div></details><details class="pf-details"><summary>Методика и источники расчёта</summary><div class="pf-method"><ul><li>Оригинал создаётся один раз; для каждой площадки учитывается время размещения. Средний месяц — 52/12 недель. После остановки публикаций заданное время общения и аналитики сохраняется.</li><li>Просмотры включают повторы. Доля новых посетителей после пересечения аудиторий задаётся во вкладке «Контент».</li><li>Клиенты учитываются по месяцу первой оплаты: удержание, затем повышение тарифа и новые оплаты. Суммы на экране округлены до рублей; расчёт ведётся без промежуточного округления. Начисляется 20% от расчётных платежей после заданных возвратов. Срок перечисления определяется условиями программы.</li><li>Переход на бизнес-тариф из личного автоматически не предполагается. Бонусный баланс моделей не считается оплатой.</li></ul><p><a href="https://syntolk.ru/" target="_blank" rel="noopener">Тарифы Syntolk</a> проверены 11.10.2026. <a href="https://support.google.com/youtube/answer/13748639?hl=ru" target="_blank" rel="noopener">Ссылки в YouTube Shorts</a> · <a href="https://telegram.org/tour/channels" target="_blank" rel="noopener">Telegram</a> · <a href="https://vkclips.app/special/authors" target="_blank" rel="noopener">VK Клипы</a> · <a href="https://rutube.ru/info/shorts/" target="_blank" rel="noopener">RUTUBE Shorts</a> · <a href="https://yandex.ru/support/metrica/ru/reports/tags-utm.html" target="_blank" rel="noopener">Учёт переходов по UTM</a>. Условия публикации остальных площадок указаны в их карточках.</p><p>Настройки сохраняются только в вашем браузере и не отправляются на сервер. CSV содержит параметры и результаты всех трёх сценариев.</p></div></details></div>
        <p id="pf-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
        <noscript><p class="pf-method">Для интерактивного расчёта включите JavaScript. Партнёр получает 20% с оплат привлечённых клиентов. <a href="/join">Стать партнёром</a>.</p></noscript>
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

export function CalculatorPage(_: { principal: Principal }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const root = rootRef.current?.querySelector<HTMLElement>('#partner-forecast');
    if (!root) return;
    const instance = ++calculatorInstance;
    root.dataset.storageKey = 'syntolk-partner-forecast-v1';
    const assetBase = String(import.meta.env.BASE_URL) + 'calculator/';
    let active = true;
    const scripts: HTMLScriptElement[] = [];
    loadScript(assetBase + 'forecast-model.js?v=' + CALCULATOR_VERSION + '&instance=' + instance)
      .then((script) => {
        scripts.push(script);
        return loadScript(assetBase + 'forecast-ui.js?v=' + CALCULATOR_VERSION + '&instance=' + instance);
      })
      .then((script) => scripts.push(script))
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError : new Error('Калькулятор недоступен'));
      });
    return () => {
      active = false;
      scripts.forEach((script) => script.remove());
    };
  }, []);

  return (
    <div className="calculator-page" style={calculatorTheme}>
      <Page title="Калькулятор">
        <ErrorBanner error={error} />
        <div ref={rootRef} dangerouslySetInnerHTML={{ __html: calculatorMarkup }} />
      </Page>
    </div>
  );
}
