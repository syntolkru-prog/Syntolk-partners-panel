import {describe,it,expect} from 'vitest';
import {homeQueries,homeDelta,homeTraffic,homeConversion} from './partner-workday-data.js';
describe('workday real-data mapping',()=>{
  it('uses Moscow calendar dates at a UTC day boundary',()=>{
    const range=homeQueries('7d',null,'Europe/Moscow',new Date('2026-10-21T22:30:00Z'));
    expect(range.to).toBe('2026-10-22');expect(range.from).toBe('2026-10-16');
    expect(range.previous?.get('from')).toBe('2026-10-09');expect(range.previous?.get('to')).toBe('2026-10-15');
  });
  it('compares equal non-overlapping calendar ranges across month/year changes',()=>{
    const range=homeQueries('30d','2026-01-10','Europe/Moscow');
    expect(range.current.get('from')).toBe('2025-12-12');expect(range.previous?.get('to')).toBe('2025-12-11');
  });
  it('does not invent a baseline or a percentage from zero',()=>{
    expect(homeQueries('all',null,'Europe/Moscow').previous).toBeNull();
    expect(homeDelta(10,0)).toBeNull();expect(homeDelta(undefined,5)).toBeNull();expect(homeDelta(0,0)).toBe(0);expect(homeDelta(4,8)).toBe(-50);
  });
  it('supports an arbitrary inclusive range and an equally long previous period',()=>{
    const range=homeQueries('custom',null,'Europe/Moscow',new Date('2026-10-23'),{from:'2026-09-10',to:'2026-09-20'});
    expect(range.current.get('from')).toBe('2026-09-10');expect(range.current.get('to')).toBe('2026-09-20');expect(range.days).toBe(11);
    expect(range.previous?.get('from')).toBe('2026-08-30');expect(range.previous?.get('to')).toBe('2026-09-09');
  });
  it('preserves traffic totals and unknown sources without guessing social/search categories',()=>{
    const rows=[{name:'Источник не передан',count:40},{name:'vk.com',count:30},{name:'a.com',count:20},{name:'b.com',count:8},{name:'c.com',count:2}];
    const result=homeTraffic(rows);expect(result).toHaveLength(4);expect(result.reduce((sum,row)=>sum+row.count,0)).toBe(100);
    expect(result[0]!.name).toBe('Источник не передан');expect(result[3]).toEqual({name:'Остальные',count:10});expect(rows).toHaveLength(5);
  });
  it('does not turn missing conversion into zero',()=>{expect(homeConversion()).toBeNull();});
});
