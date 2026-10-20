// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ResultsDatePicker, applyResultsPeriods, clearResultsComparison, reportRange } from './ResultsDatePicker.js';

afterEach(cleanup);
describe('independent analytics date ranges',()=>{
  it('clears active comparison directly without opening a calendar, including during report loading',()=>{
    const clear=vi.fn();render(<ResultsDatePicker label="Сравнить периоды" comparison active disabled value={{from:'2025-04-01',to:'2025-04-30'}} onChange={vi.fn()} onClear={clear}/>);
    fireEvent.click(screen.getByRole('button',{name:'Сбросить сравнение'}));
    expect(clear).toHaveBeenCalledOnce();expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('does not show a reset button when comparison is off',()=>{
    render(<ResultsDatePicker label="Сравнить периоды" comparison active={false} value={{from:'',to:''}} onChange={vi.fn()} onClear={vi.fn()}/>);
    expect(screen.queryByRole('button',{name:'Сбросить сравнение'})).toBeNull();
  });
  it('removes only comparison parameters, preserving all main period and source settings',()=>{
    for(const period of ['today','7d','30d','all','custom']){
      const main=new URLSearchParams({period,from:'2026-10-01',to:'2026-10-19',since:'2026-10-01T00:00:00Z',until:'2026-10-19T00:00:00Z',platformIds:'vk',formatIds:'circle',partnerIds:'partner-a',page:'2',timezone:'UTC'});
      const compared=new URLSearchParams(main);compared.set('compare','true');compared.set('includeComparison','true');compared.set('compareFrom','2025-04-01');compared.set('compareTo','2025-04-30');
      expect(clearResultsComparison(compared).toString()).toBe(main.toString());expect(compared.get('compare')).toBe('true');
    }
  });
  it('shows one compact month and no duplicate presets, instructions or repeated date summary',()=>{
    const change=vi.fn();render(<ResultsDatePicker label="Даты аналитики" value={{from:'2025-04-01',to:'2025-04-30'}} onChange={change}/>);
    fireEvent.click(screen.getByRole('button',{name:'Даты аналитики'}));
    const calendar=screen.getByRole('dialog',{name:'Даты аналитики'});
    expect(calendar.classList.contains('results-calendar--compact')).toBe(true);
    expect(calendar.style.width).toBe('320px');
    expect(calendar.querySelectorAll('.results-calendar__months>section')).toHaveLength(1);
    expect(calendar.querySelector('.results-calendar__presets')).toBeNull();
    expect(calendar.querySelector('.results-calendar__instruction')).toBeNull();
    expect(within(calendar).queryByRole('status')).toBeNull();
    for(const name of ['Сегодня','7 дней','30 дней','Этот месяц'])expect(within(calendar).queryByRole('button',{name})).toBeNull();
    fireEvent.click(within(calendar).getByRole('button',{name:/^10 апр/}));fireEvent.click(within(calendar).getByRole('button',{name:/^12 апр/}));
    fireEvent.click(within(calendar).getByRole('button',{name:'Применить'}));
    expect(change).toHaveBeenCalledExactlyOnceWith({from:'2025-04-10',to:'2025-04-12'});
  });
  it('opens custom dates even when custom is already active and reopens after cancellation',()=>{
    const periodChange=vi.fn(),change=vi.fn();
    render(<ResultsDatePicker label="Период аналитики" calendarLabel="Свои даты" period="custom" value={{from:'2025-04-01',to:'2025-04-30'}} onChange={change} onPeriodChange={periodChange}/>);
    for(let i=0;i<2;i++){
      fireEvent.click(screen.getByRole('button',{name:'Период аналитики'}));
      fireEvent.click(screen.getByRole('menuitemradio',{name:'Свои даты'}));
      const calendar=screen.getByRole('dialog',{name:'Свои даты'});
      fireEvent.click(within(calendar).getByRole('button',{name:'Отмена'}));
      expect(screen.queryByRole('dialog')).toBeNull();
    }
    expect(periodChange).toHaveBeenCalledTimes(2);expect(periodChange).toHaveBeenLastCalledWith('custom');expect(change).not.toHaveBeenCalled();
  });
  it('keeps presets in the period menu and supports keyboard navigation and closing',()=>{
    const periodChange=vi.fn();render(<ResultsDatePicker label="Период аналитики" period="30d" value={{from:'2025-04-01',to:'2025-04-30'}} onChange={vi.fn()} onPeriodChange={periodChange}/>);
    fireEvent.click(screen.getByRole('button',{name:'Период аналитики'}));
    const menu=screen.getByRole('menu',{name:'Период аналитики'});expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(5);
    fireEvent.keyDown(menu,{key:'Home'});expect(document.activeElement).toBe(within(menu).getByRole('menuitemradio',{name:'Сегодня'}));
    fireEvent.click(within(menu).getByRole('menuitemradio',{name:'Последние 7 дней'}));
    expect(periodChange).toHaveBeenCalledExactlyOnceWith('7d');expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('selects three days and seven different days with the calendar itself',()=>{
    const apply=vi.fn();
    render(<ResultsDatePicker label="Сравнить периоды" comparison active={false} value={{from:'',to:''}} primaryValue={{from:'2025-04-01',to:'2025-04-30'}} onChange={vi.fn()} onApply={apply}/>);
    fireEvent.click(screen.getByRole('button',{name:'Сравнить периоды'}));
    const menu=screen.getByRole('dialog',{name:'Сравнить периоды'});
    fireEvent.focus(within(menu).getByLabelText('Основной период: начало'));
    fireEvent.change(within(menu).getByLabelText('Месяц календаря'),{target:{value:'2025-04'}});
    fireEvent.click(within(menu).getByRole('button',{name:/^10 апр/}));
    fireEvent.click(within(menu).getByRole('button',{name:/^12 апр/}));
    fireEvent.focus(within(menu).getByLabelText('Сравнить периоды: начало'));
    fireEvent.change(within(menu).getByLabelText('Месяц календаря'),{target:{value:'2025-05'}});
    fireEvent.click(within(menu).getByRole('button',{name:/^5 мая/}));
    fireEvent.click(within(menu).getByRole('button',{name:/^11 мая/}));
    fireEvent.click(within(menu).getByRole('button',{name:'Применить'}));
    expect(apply).toHaveBeenCalledExactlyOnceWith({from:'2025-04-10',to:'2025-04-12'},{from:'2025-05-05',to:'2025-05-11'});
  });
  it('blocks reversed dates and cancels without changing the active report',()=>{
    const apply=vi.fn();
    render(<ResultsDatePicker label="Сравнить периоды" comparison value={{from:'2025-04-01',to:'2025-04-30'}} primaryValue={{from:'2025-05-01',to:'2025-05-07'}} onChange={vi.fn()} onApply={apply}/>);
    fireEvent.click(screen.getByRole('button',{name:'Сравнить периоды'}));
    const menu=screen.getByRole('dialog',{name:'Сравнить периоды'});
    fireEvent.change(within(menu).getByLabelText('Основной период: конец'),{target:{value:'2025-04-30'}});
    expect((within(menu).getByRole('button',{name:'Применить'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(menu).getByRole('button',{name:'Отмена'}));
    expect(apply).not.toHaveBeenCalled();
  });
  it('has one label per comparison range and a fixed six-week grid in every month',()=>{
    render(<ResultsDatePicker label="Сравнить периоды" comparison active={false} value={{from:'2025-04-01',to:'2025-04-30'}} primaryValue={{from:'2025-02-01',to:'2025-02-28'}} onChange={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Сравнить периоды'}));
    const menu=screen.getByRole('dialog');
    expect(within(menu).getAllByText('Основной период',{exact:true})).toHaveLength(1);
    expect(within(menu).getAllByText('Период сравнения',{exact:true})).toHaveLength(1);
    expect(menu.querySelector('aside')).toBeNull();expect(within(menu).queryByRole('status')).toBeNull();
    for(const month of ['2025-02','2025-03','2025-08']){
      fireEvent.change(within(menu).getByLabelText('Месяц календаря'),{target:{value:month}});
      for(const grid of menu.querySelectorAll('.results-calendar__days'))expect(grid.children).toHaveLength(49);
    }
    fireEvent.focus(within(menu).getByLabelText('Основной период: начало'));
    expect(menu.querySelector('.results-calendar__period-block[data-active=true]')?.textContent).toContain('Основной период');
    fireEvent.focus(within(menu).getByLabelText('Сравнить периоды: начало'));
    expect(menu.querySelector('.results-calendar__period-block[data-active=true]')?.textContent).toContain('Период сравнения');
  });
  it('commits native date input events instead of submitting the previous rendered dates',()=>{
    const apply=vi.fn();
    render(<ResultsDatePicker label="Сравнить периоды" comparison value={{from:'2026-09-20',to:'2026-10-19'}} primaryValue={{from:'2026-09-20',to:'2026-10-19'}} onChange={vi.fn()} onApply={apply}/>);
    fireEvent.click(screen.getByRole('button',{name:'Сравнить периоды'}));
    const menu=screen.getByRole('dialog',{name:'Сравнить периоды'});
    fireEvent.input(within(menu).getByLabelText('Сравнить периоды: начало'),{target:{value:'2025-04-01'}});
    fireEvent.input(within(menu).getByLabelText('Сравнить периоды: конец'),{target:{value:'2025-04-30'}});
    expect(within(menu).queryByRole('status')).toBeNull();
    fireEvent.click(within(menu).getByRole('button',{name:'Применить'}));
    expect(apply).toHaveBeenCalledWith({from:'2026-09-20',to:'2026-10-19'},{from:'2025-04-01',to:'2025-04-30'});
  });
  it('replaces stale drilldown bounds while retaining every source filter',()=>{
    const query=applyResultsPeriods(new URLSearchParams('period=custom&since=2026-10-01T00:00:00Z&until=2026-10-02T00:00:00Z&from=2026-10-01&to=2026-10-01&platformIds=vk&platformIds=youtube&formatIds=post&scenarioIds=a&bucket=week'),{from:'2025-04-01',to:'2025-04-03'},{from:'2026-10-12',to:'2026-10-18'});
    expect(query.has('since')).toBe(false);expect(query.has('until')).toBe(false);
    expect(query.get('from')).toBe('2025-04-01');expect(query.get('compareTo')).toBe('2026-10-18');
    expect(query.getAll('platformIds')).toEqual(['vk','youtube']);expect(query.get('formatIds')).toBe('post');expect(query.get('scenarioIds')).toBe('a');expect(query.get('bucket')).toBe('week');
    const cleared=applyResultsPeriods(query,{from:'2025-04-01',to:'2025-04-03'},null);
    expect(cleared.has('compareFrom')).toBe(false);expect(cleared.has('compare')).toBe(false);
  });
  it('displays inclusive civil dates without adding a day at the exclusive API boundary',()=>{
    expect(reportRange({since:'2025-03-31T21:00:00Z',until:'2025-04-30T21:00:00Z'},'Europe/Moscow')).toEqual({from:'2025-04-01',to:'2025-04-30'});
  });
});
