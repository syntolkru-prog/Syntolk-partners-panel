// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Button} from './ui.js';

const source = readFileSync(resolve(process.cwd(), 'src/interactions.css'), 'utf8');
afterEach(cleanup);

// Test eligibility without synthesizing a pointer: jsdom does not render hover.
function hoverRule() {
  const style = document.createElement('style');
  style.textContent = source;
  document.head.append(style);
  const media = [...style.sheet!.cssRules].filter(rule => rule.type === 4) as CSSMediaRule[];
  const rule = media.flatMap(group => [...group.cssRules]).find(rule =>
    rule instanceof CSSStyleRule && rule.selectorText.startsWith('body :is(button')
  ) as CSSStyleRule;
  const selector = rule.selectorText.replaceAll(':hover', '');
  style.remove();
  return {selector, rule};
}

describe('neutral hover across both cabinets', () => {
  it('covers navigation, calculator controls, forms, menus, messages and portal overlays', () => {
    render(<><nav><a href="/results">Результаты</a></nav>
      <div className="calculator-page"><button>Формат</button></div>
      <details><summary>Условия</summary></details><select aria-label="Площадка"><option>Все</option></select>
      <div className="op-dropdown-option">Профиль</div>
      <label className="results-multiselect__option"><input type="checkbox"/>Посты</label>
      <button className="message-directory-row">Партнёр</button>
      <div role="dialog"><button>Закрыть</button></div></>);
    const {selector, rule} = hoverRule();
    for (const text of ['Результаты', 'Формат', 'Условия', 'Профиль', 'Посты', 'Партнёр', 'Закрыть']) {
      expect(screen.getByText(text).matches(selector), text).toBe(true);
    }
    expect(screen.getByLabelText('Площадка').matches(selector)).toBe(true);
    expect(rule.style.getPropertyValue('background-color')).toBe('var(--op-card-hover-surface)');
    expect(rule.style.getPropertyValue('transform')).toBe('none');
    expect(rule.style.getPropertyValue('box-shadow')).toBe('none');
  });

  it('does not repaint selections, disabled controls, calendar ranges or graph bars', () => {
    render(<><button disabled>Недоступно</button><fieldset disabled><button>В поле</button></fieldset>
      <button aria-disabled="true">Отключено</button><a aria-current="page" href="/">Главная</a>
      <button aria-selected="true">Вкладка</button><button aria-pressed="true">Режим</button>
      <button aria-checked="true">Выбрано</button><button data-selected="true">Аккаунт</button>
      <button className="is-active">Применить</button><button className="is-in-range">Диапазон</button>
      <button className="is-edge">Граница</button><button className="pf-chart-month">Столбец</button>
      <button className="results-metric-card__inspect">Заголовок карточки</button>
      <label className="results-multiselect__option"><input type="checkbox" defaultChecked/>Фильтр</label></>);
    const {selector} = hoverRule();
    for (const element of document.querySelectorAll('button, a, label')) expect(element.matches(selector), element.textContent ?? '').toBe(false);
  });

  it('preserves click handlers, disabled semantics and primary/danger variants without inline hover mutations', () => {
    const click = vi.fn();
    render(<><Button onClick={click}>Создать</Button><Button variant="danger">Удалить</Button><Button disabled onClick={click}>Ожидание</Button><Button aria-pressed>Пн</Button></>);
    const primary = screen.getByRole('button', {name: 'Создать'});
    const before = primary.getAttribute('style');
    fireEvent.mouseEnter(primary);
    expect(primary.getAttribute('style')).toBe(before);
    fireEvent.click(primary); fireEvent.click(screen.getByRole('button', {name: 'Ожидание'}));
    expect(click).toHaveBeenCalledOnce();
    expect(primary.getAttribute('data-op-variant')).toBe('primary');
    expect(screen.getByRole('button', {name: 'Удалить'}).getAttribute('data-op-variant')).toBe('danger');
    expect(screen.getByRole('button', {name: 'Пн'}).getAttribute('aria-pressed')).toBe('true');
  });

  it('honours reduced motion and keeps persistent dropdown selection separate from hover', () => {
    const dropdowns = readFileSync(resolve(process.cwd(), 'src/dropdowns.css'), 'utf8');
    expect(source).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition: none !important/);
    expect(source).not.toMatch(/scale\(|translate/);
    expect(dropdowns).toContain('background-color: var(--op-card-hover-surface, #202328) !important;');
    expect(dropdowns).toContain('.op-dropdown-option[data-selected=true] {');
    expect(dropdowns).not.toContain('button:is(:hover, :focus-visible, [aria-checked=true])');
  });

  it('keeps standard selected switches and checkboxes on theme without a neutral override', () => {
    render(<Button aria-pressed variant="primary">Неделя</Button>);
    expect(screen.getByRole('button', {name: 'Неделя'}).style.background).toContain('var(--op-accent,');
    expect(source).not.toContain('background-color: var(--op-control-selected-surface) !important;');
    expect(source).not.toContain('accent-color:');
    const publications = readFileSync(resolve(process.cwd(), 'src/pages/publications.css'), 'utf8');
    expect(publications).toMatch(/button\[aria-pressed=true\]\{border-color:var\(--pub-accent\)/);
    const dropdowns = readFileSync(resolve(process.cwd(), 'src/dropdowns.css'), 'utf8');
    expect(dropdowns).toContain('--op-dropdown-selected: var(--op-accent,');
  });

  it('provides a neutral visible focus on publication fields, menus and calculator inputs', () => {
    render(<><input aria-label="Название материала"/><textarea aria-label="Текст"/><select aria-label="Тип контента"><option>Пост</option></select><button>Меню</button><details><summary>Дополнительно</summary></details></>);
    const style = document.createElement('style'); style.textContent = source; document.head.append(style);
    try {
      const rules = [...style.sheet!.cssRules].filter(rule => rule.type === 1) as CSSStyleRule[];
      const focus = rules.find(rule => rule.selectorText.startsWith('body :is(input, textarea, select, button'))!;
      for (const element of document.querySelectorAll('input, textarea, select, button, summary')) {
        expect(element.matches(focus.selectorText.replaceAll(':focus-visible', ''))).toBe(true);
      }
      expect(focus.style.getPropertyValue('outline')).toBe('2px solid var(--op-card-focus-ring)');
      expect(source).toContain('outline: 2px solid var(--op-card-focus-ring) !important;');
    } finally {style.remove();}
  });
});
