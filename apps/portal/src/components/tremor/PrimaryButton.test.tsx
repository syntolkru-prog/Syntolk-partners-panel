// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Button as RawButton} from './raw/components/Button/Button.js';
import {Button} from '../../ui.js';
import {PartnerVisualProvider} from './PartnerVisual.js';
afterEach(cleanup);
describe('shared partner primary action states',()=>{
  it('marks primary controls consistently without changing their actions',()=>{
    const action=vi.fn();render(<PartnerVisualProvider active><Button onClick={action}>Сохранить</Button><RawButton>Создать</RawButton><RawButton variant="secondary">Отмена</RawButton><RawButton variant="destructive">Удалить</RawButton></PartnerVisualProvider>);
    expect(screen.getByRole('button',{name:'Сохранить'}).getAttribute('data-tremor-variant')).toBe('primary');
    expect(screen.getByRole('button',{name:'Создать'}).getAttribute('data-tremor-variant')).toBe('primary');
    expect(screen.getByRole('button',{name:'Отмена'}).getAttribute('data-tremor-variant')).toBe('secondary');
    expect(screen.getByRole('button',{name:'Удалить'}).getAttribute('data-tremor-variant')).toBe('destructive');
    fireEvent.click(screen.getByRole('button',{name:'Сохранить'}));expect(action).toHaveBeenCalledOnce();
  });
  it('preserves disabled and loading protection',()=>{
    const action=vi.fn();render(<><RawButton disabled onClick={action}>Отключено</RawButton><RawButton isLoading loadingText="Сохраняем" onClick={action}>Готово</RawButton></>);
    for(const button of screen.getAllByRole('button')){expect((button as HTMLButtonElement).disabled).toBe(true);fireEvent.click(button);}expect(action).not.toHaveBeenCalled();
  });
  it('shares the same non-moving blue hover and pressed palette with legacy calculator actions',()=>{
    const css=readFileSync(resolve('src/components/tremor/partner.css'),'utf8');
    const shared=css.slice(css.indexOf('/* One primary-action contract'));
    for(const selector of ['[data-op-variant=primary]','[data-tremor-variant=primary]','#pf-reset','#pf-format-menu-toggle','#pf-add-format','.publication-create__primary'])expect(shared).toContain(selector);
    expect(shared).toContain('background-color:var(--color-blue-600) !important');expect(shared).toContain('background-color:var(--color-blue-700) !important');
    expect(shared).toContain('transform:none !important');expect(shared).toContain('prefers-reduced-motion:reduce');expect(shared).toContain(':not(:disabled,[aria-disabled=true]):hover');
  });
});
