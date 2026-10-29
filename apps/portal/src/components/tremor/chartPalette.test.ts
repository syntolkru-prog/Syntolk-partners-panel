import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {AvailableChartColors} from './raw/utils/chartColors.js';
import {chartPalette,metricPalette,sourcePalette} from './chartPalette.js';
import {chartColors} from '../../pages/ResultsChart.js';

const css=readFileSync(new URL('./partner.css',import.meta.url),'utf8');
describe('partner palette based on admin Results',()=>{
  it('uses the same metric colors for chart marks and legends',()=>{
    expect(chartPalette.map(([name])=>name)).toEqual(AvailableChartColors);
    for(const [name,value] of [...chartPalette,...Object.values(metricPalette)])expect(value).toBe(`var(--op-chart-${name})`);
    for(const [metric,[name]] of Object.entries(metricPalette)){
      expect(css).toContain(`--op-chart-${name}:${chartColors[metric as keyof typeof chartColors]}`);
      expect(css).toContain(`--color-${name}-500:var(--op-chart-${name})`);
    }
    expect(sourcePalette('telegram')).toEqual(sourcePalette('telegram'));
  });
  it('scopes neutral UI colors to partners and leaves tenant branding in control',()=>{
    const scope=css.slice(css.indexOf('html[data-portal-visual="tremor-partner"] {'),css.indexOf('  background: var(--op-bg);'));
    expect(scope).toContain('--op-bg:#0b0d10; --op-surface:#14191f;');
    expect(scope).toContain('--color-blue-500:#e6e8eb;');
    expect(scope).toContain('--op-accent-ink:#0b0d10;');
    expect(scope).not.toMatch(/--op-accent[^:]*:[^;]*!important/);
    expect(css).not.toMatch(/#(?:090e1a|3b82f6|2563eb)\b/i);
    expect(css).toContain('[role=checkbox]:is([data-state=checked],[data-state=indeterminate])');
  });
});
