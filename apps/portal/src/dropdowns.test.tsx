// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {Select} from './ui.js';
import {ResultsMultiSelect} from './pages/ResultsMultiSelect.js';
const dropdownStyles=readFileSync(resolve(process.cwd(),'src/dropdowns.css'),'utf8');

let style:HTMLStyleElement;
beforeEach(()=>{style=document.createElement('style');style.textContent=dropdownStyles;document.head.append(style);});
afterEach(()=>{cleanup();style.remove();});
// jsdom does not calculate color-scheme. Check the parsed rules against real
// elements here; the native picker is also checked in the running browser.
function sharedRule(element:Element,property:string){
  return [...style.sheet!.cssRules].filter((rule):rule is CSSStyleRule=>rule.type===1)
    .filter(rule=>element.matches(rule.selectorText)&&rule.style.getPropertyValue(property))
    .at(-1)?.style.getPropertyValue(property);
}

describe('shared dropdown presentation without replacing native controls',()=>{
  it('skins both the shared Select and raw page controls, preserving their options and change events',()=>{
    const change=vi.fn();
    render(<><Select aria-label="Программа" defaultValue="first" onChange={change}><option value="first">Первая</option><option value="second">Вторая</option></Select><select aria-label="Площадка" defaultValue="all"><option value="all">Все площадки</option><option value="vk">ВКонтакте</option></select></>);
    for(const label of ['Программа','Площадка']){
      const field=screen.getByRole('combobox',{name:label});
      expect(field.tagName).toBe('SELECT');expect(sharedRule(field,'color-scheme')).toBe('dark');
      expect(within(field).getAllByRole('option')).toHaveLength(2);
    }
    fireEvent.change(screen.getByLabelText('Программа'),{target:{value:'second'}});
    expect(change).toHaveBeenCalledOnce();expect((screen.getByLabelText('Программа') as HTMLSelectElement).value).toBe('second');
  });
  it('also skins dynamically inserted calculator controls and preserves disabled fields and optgroups',()=>{
    render(<div className="calculator-page"><div className="pf-section" data-testid="calculator"/></div>);
    const calculator=screen.getByTestId('calculator');
    calculator.innerHTML='<select aria-label="Месяц" disabled><optgroup label="Месяцы"><option value="1">1</option><option value="2" selected>2</option></optgroup></select>';
    const field=screen.getByRole('combobox',{name:'Месяц'}) as HTMLSelectElement;
    expect(sharedRule(field,'color-scheme')).toBe('dark');expect(sharedRule(field,'cursor')).toBe('not-allowed');
    expect(field.disabled).toBe(true);expect(field.value).toBe('2');expect(field.options).toHaveLength(2);
  });
  it('applies the same dark menu surface to period menus and custom multi-selection popups',()=>{
    render(<><div role="menu" className="results-calendar results-calendar--periods"><button role="menuitemradio" aria-checked>Сегодня</button></div><div data-testid="identity-menu" className="op-dropdown-menu"/></>);
    for(const field of [screen.getByRole('menu'),screen.getByTestId('identity-menu')])expect(sharedRule(field,'color-scheme')).toBe('dark');
    const change=vi.fn();render(<ResultsMultiSelect label="Форматы" allLabel="Все форматы" options={[{id:'post',name:'Посты'},{id:'short',name:'Короткие видео'}]} value={[]} onChange={change}/>);
    fireEvent.click(screen.getByRole('button',{name:'Форматы'}));
    const popup=screen.getByRole('dialog',{name:'Форматы'});expect(sharedRule(popup,'color-scheme')).toBe('dark');
    expect(within(popup).getByRole('button',{name:'Все форматы'}).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(popup).getByRole('checkbox',{name:'Посты'}));
    expect(within(popup).getByRole('button',{name:'Все форматы'}).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(within(popup).getByRole('button',{name:'Применить'}));expect(change).toHaveBeenCalledWith(['post']);
  });
  it('keeps Escape cancellation and focus return for a multi-select without applying its draft',()=>{
    const change=vi.fn();render(<ResultsMultiSelect label="Площадки" allLabel="Все площадки" options={[{id:'vk',name:'ВКонтакте'}]} value={[]} onChange={change}/>);
    const trigger=screen.getByRole('button',{name:'Площадки'});fireEvent.click(trigger);
    const popup=screen.getByRole('dialog',{name:'Площадки'});fireEvent.click(within(popup).getByRole('checkbox',{name:'ВКонтакте'}));
    fireEvent.keyDown(popup,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(change).not.toHaveBeenCalled();expect(document.activeElement).toBe(trigger);
  });
});
