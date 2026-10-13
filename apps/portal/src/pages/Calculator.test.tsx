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

function initialize(mobile = false) {
  // Run the actual standalone assets against the real portal markup, rather
  // than mocking calculations. No API, external model or payments are used.
  const context = {
    document,
    localStorage,
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: mobile, addEventListener: vi.fn() }),
  };
  runInNewContext(modelSource, context);
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

  it('initializes without the landing header and preserves the baseline 12-month calculation', () => {
    render(<CalculatorPage principal={{ role: 'admin' }} />);
    expect(() => initialize()).not.toThrow();
    expect(screen.queryByRole('link', { name: /Стать партнёром/ })).toBeNull();
    expect(income()).toBe('3965₽');
    expect(document.querySelectorAll('#pf-chart button')).toHaveLength(12);
    fireEvent.change(screen.getByRole('combobox', { name: 'Месяц' }), { target: { value: '12' } });
    expect(income()).toBe('11400₽');
    expect(document.querySelector('#pf-chart .pf-active-month')?.getAttribute('data-month')).toBe('12');
  });

  it('preserves all three scenarios and recalculates when content changes', () => {
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    fireEvent.click(screen.getByRole('button', { name: 'Ниже ожиданий' }));
    expect(income()).toBe('1110₽');
    fireEvent.click(screen.getByRole('button', { name: 'Выше ожиданий' }));
    expect(income()).toBe('10277₽');
    fireEvent.click(screen.getByRole('button', { name: 'Мой сценарий' }));
    fireEvent.input(screen.getByRole('spinbutton', { name: 'Посты: оригиналов в неделю' }), { target: { value: '0' } });
    expect(income()).not.toBe('3965₽');
    const saved = JSON.parse(localStorage.getItem('syntolk-partner-forecast-v1')!);
    expect(saved.settings.frequency.post).toBe(0);
  });

  it('retains platform and sales tabs and their keyboard navigation', () => {
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Контент' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Площадки' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Показать площадки' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Продажи' }));
    expect(screen.getByRole('spinbutton', { name: 'Регистрация из посетителя' })).toBeTruthy();
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
    expect(income()).toBe('3965₽');
    expect(screen.getAllByRole('heading', { name: 'Калькулятор' })).toHaveLength(1);
  });

  it('reloads the saved scenario without resetting the user draft', () => {
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    fireEvent.change(screen.getByRole('combobox', { name: 'Месяц' }), { target: { value: '12' } });
    cleanup();
    render(<CalculatorPage principal={{ role: 'partner' }} />);
    initialize();
    expect(income()).toBe('11400₽');
    expect((screen.getByRole('combobox', { name: 'Месяц' }) as HTMLSelectElement).value).toBe('12');
  });
});
