// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {BrandDocument} from '../lib/BrandDocument.js';

const brand=vi.hoisted(()=>({brandColor:'#9333ea' as string|null}));
vi.mock('../lib/useBrand.js',()=>({DEFAULT_BRAND:'Syntolk',usePublicBrand:()=>({
  ...brand,programName:'Syntolk',logoUrl:null,faviconUrl:null,whiteLabel:false,isLoading:false,
})}));
const css=(path:string)=>readFileSync(resolve(process.cwd(),'src',path),'utf8');
const view=()=> <MemoryRouter><BrandDocument/></MemoryRouter>;
afterEach(()=>{cleanup();document.documentElement.removeAttribute('style');});

describe('brand colour contract for new portal features',()=>{
  it.each(['#9333ea','#f97316','#10cadb'])('updates all accent derivatives for %s',color=>{
    brand.brandColor=color;render(view());const style=document.documentElement.style;
    expect(style.getPropertyValue('--op-accent')).toBe(color);
    expect(style.getPropertyValue('--op-accent-soft')).toBe(color+'26');
    for(const alpha of ['10','15','22','25','55','88'])expect(style.getPropertyValue('--op-accent-a'+alpha)).toBe(color+alpha);
    expect(style.getPropertyValue('--op-accent-hover')).toMatch(/^#[\da-f]{6}$/);
  });
  it('changes an already mounted document and clears the previous brand on reset',()=>{
    brand.brandColor='#9333ea';const instance=render(view());
    brand.brandColor='#ffffff';instance.rerender(view());
    expect(document.documentElement.style.getPropertyValue('--op-accent')).toBe('#ffffff');
    expect(document.documentElement.style.getPropertyValue('--op-accent-ink')).toBe('#0b0d10');
    brand.brandColor='#000000';instance.rerender(view());
    expect(document.documentElement.style.getPropertyValue('--op-accent-ink')).toBe('#ffffff');
    brand.brandColor=null;instance.rerender(view());
    expect(Array.from(document.documentElement.style).filter(name=>name.startsWith('--op-accent'))).toEqual([]);
  });
  it('keeps calendar selections, counters, filters and dropdown highlights on brand',()=>{
    const results=css('pages/results.css'),calendar=css('pages/results-explorer.css'),dropdowns=css('dropdowns.css');
    expect(results).toMatch(/\.results-count\s*\{[^}]*background:var\(--op-accent-soft[^}]*color:var\(--op-accent/);
    expect(results).toMatch(/\.results-multiselect__actions button:last-child\s*\{[^}]*background:var\(--op-accent,[^}]*color:var\(--op-accent-ink/);
    expect(calendar).toMatch(/\.results-calendar__days button.is-edge\s*\{[^}]*background:var\(--op-accent,[^}]*color:var\(--op-accent-ink/);
    expect(calendar).toMatch(/\.results-calendar__days button.is-in-range\s*\{[^}]*background:var\(--op-accent-soft/);
    expect(dropdowns).toContain('--op-dropdown-selected: var(--op-accent,');
    expect(dropdowns).toContain('--op-dropdown-selected-text: var(--op-accent-ink,');
  });
  it('connects calculator, publications, messages, quick actions and coach to the same accent',()=>{
    for(const file of ['pages/PartnerQuickActions.tsx','pages/Calculator.tsx','pages/PublicationsPage.tsx','pages/Messages.tsx']){
      const content=css(file);
      expect(content).toMatch(/theme\.accent|partner-quick-actions\.css/);
    }
    const coach=css('pages/coach/coach.css'),companion=css('pages/coach/companion.css');
    expect(coach).toMatch(/\.coach-home-task-view button.is-selected\s*\{[^}]*background:var\(--op-accent-soft/);
    expect(coach).toMatch(/\.scenario-picker__menu button\[aria-checked=true\]\s*\{[^}]*background:var\(--op-accent-soft/);
    expect(companion).toContain('--coach-teal: var(--op-accent,');
    expect(companion).not.toMatch(/(?:color|stroke|fill): #(35d5c1|65f2dc|072b2d|062b2d)/);
  });
  it('uses one hover transition for actionable cards, with reduced-motion support',()=>{
    const styles=css('interactions.css');
    for(const selector of ['.partner-quick-action','.coach-home-task-card','.results-metric-card:has(.results-metric-card__inspect)','.publications-creation-types > button'])expect(styles).toContain(selector);
    expect(styles).toContain('--op-card-transition: border-color 160ms ease, background-color 160ms ease;');
    expect(styles).toContain('border-color: var(--op-card-hover-border) !important;');
    expect(styles).toContain('background: var(--op-card-hover-surface) !important;');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).not.toMatch(/translate|scale\(/);
  });
});
