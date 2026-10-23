import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {AvailableChartColors} from './raw/utils/chartColors.js';
import {chartPalette,metricPalette,sourcePalette} from './chartPalette.js';

describe('upstream Tremor color contract',()=>{
  it('uses every upstream chart color and its actual Tailwind token without replacement hex values',()=>{
    expect(chartPalette.map(([name])=>name)).toEqual(AvailableChartColors);
    for(const [name,value] of [...chartPalette,...Object.values(metricPalette)])expect(value).toBe(`var(--color-${name}-500)`);
    expect(sourcePalette('telegram')).toEqual(sourcePalette('telegram'));
  });
  it('never aliases Tremor blue to the stored tenant accent',()=>{
    const css=readFileSync(new URL('./partner.css',import.meta.url),'utf8');
    expect(css).not.toMatch(/--color-blue-\d+\s*:/);
    expect(css).toMatch(/--op-accent:\s*var\(--color-blue-500\)\s*!important/);
    expect(css).toMatch(/--op-accent-a10:\s*color-mix\(in oklab, var\(--color-blue-400\) 10%, transparent\)\s*!important/);
    expect(css).not.toMatch(/#(?:14d4e1|2dd4bf|3b82f6|2563eb)\b/i);
  });
});
