// @vitest-environment jsdom
import React, {StrictMode} from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {PartnerVisualProvider} from './PartnerVisual.js';
import {Card,Button,Input,Select,StatusPill,Table} from '../../ui.js';
import {MetricPlot,type SeriesPoint} from '../../pages/ResultsChart.js';
import {CalculatorCharts} from './CalculatorCharts.js';
import {ResultsMultiSelect} from '../../pages/ResultsMultiSelect.js';
import {PartnerQuickActions} from '../../pages/PartnerQuickActions.js';

// Give the actual Tremor/Recharts components a deterministic layout in jsdom.
const chartViewport=vi.hoisted(()=>({width:600,height:240}));
vi.mock('recharts',async importOriginal=>{
  const actual=await importOriginal<typeof import('recharts')>();
  return {...actual,ResponsiveContainer:({children,onResize}: {children:React.ReactElement;onResize?:(width:number,height:number)=>void})=>{
    React.useEffect(()=>{onResize?.(chartViewport.width,chartViewport.height);},[onResize]);
    return React.cloneElement(children,{width:chartViewport.width,height:chartViewport.height});
  }};
});
afterEach(()=>{cleanup();chartViewport.width=600;document.querySelectorAll('[data-visual-test]').forEach(element=>element.remove());vi.restoreAllMocks();});
const point:SeriesPoint={date:'2026-10-01',clicks:133,registrations:22,payments:15,earningsMinor:1940700};
const visual=(node:React.ReactNode)=><StrictMode><PartnerVisualProvider active>{node}</PartnerVisualProvider></StrictMode>;

describe('Tremor partner visual integration',()=>{
  it('uses real upstream controls and table while retaining native handlers and values',()=>{
    const action=vi.fn(),input=vi.fn(),select=vi.fn();
    const {container}=render(visual(<><Card><Button onClick={action}>Обновить</Button><Input aria-label="Название" value="Материал" onChange={input}/><Select aria-label="Период" value="30d" onChange={select}><option value="30d">30 дней</option><option value="all">Всё время</option></Select><StatusPill status="active"/></Card><Table columns={['Переходы']} rows={[[133]]}/></>));
    expect(document.documentElement.dataset.portalVisual).toBe('tremor-partner');
    expect(container.querySelectorAll('[tremor-id="tremor-raw"]').length).toBeGreaterThan(3);
    fireEvent.click(screen.getByRole('button',{name:'Обновить'}));expect(action).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('Название'),{target:{value:'Пост'}});expect(input).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('Период'),{target:{value:'all'}});expect(select).toHaveBeenCalledOnce();
    expect(screen.getByRole('cell',{name:'133'})).toBeTruthy();
  });
  it('preserves draft/apply/cancel semantics with real Tremor checkboxes',()=>{
    const onChange=vi.fn();
    render(visual(<ResultsMultiSelect label="Площадки" allLabel="Все площадки" options={[{id:'vk',name:'ВКонтакте'}]} value={[]} onChange={onChange}/>));
    fireEvent.click(screen.getByRole('button',{name:'Площадки'}));
    const checkbox=screen.getByRole('checkbox',{name:'ВКонтакте'});
    expect(checkbox.tagName).toBe('BUTTON');fireEvent.click(checkbox);expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Применить'}));expect(onChange).toHaveBeenCalledWith(['vk']);
    fireEvent.click(screen.getByRole('button',{name:'Площадки'}));fireEvent.click(screen.getByRole('checkbox',{name:'ВКонтакте'}));
    fireEvent.click(screen.getByRole('button',{name:'Отмена'}));expect(onChange).toHaveBeenCalledTimes(1);
  });
  it.each(['clicks','earningsMinor'] as const)('renders the actual %s chart with original units and exact keyboard drilldown',metric=>{
    const inspect=vi.fn();
    const {container}=render(visual(<MetricPlot series={{bucket:'day',points:[point]}} lines={[{id:metric,name:'Показатель',color:'#000',points:[point]}]} metric={metric} onInspect={inspect}/>));
    expect(container.querySelector('.recharts-wrapper')).toBeTruthy();
    const group=screen.getByRole('group',{name:/Стрелки — по датам/});fireEvent.focus(group);fireEvent.keyDown(group,{key:'Enter'});
    expect(inspect).toHaveBeenCalledWith(point);
    expect(group.textContent).not.toMatch(/NaN|Infinity/);
    if(metric==='earningsMinor')expect(screen.getByRole('status').textContent?.replace(/\s/g,'')).toContain('19407,00');
  });
  it('mounts genuine calculator charts in StrictMode and forwards bar selection to existing handlers',()=>{
    const root=document.createElement('div');root.dataset.visualTest='true';root.innerHTML='<div id="pf-chart"><button data-month="1">1</button><button data-month="2">2</button></div><div id="pf-repeat-bar"><span></span></div>';document.body.append(root);
    const click=vi.fn();root.querySelector('[data-month="2"]')!.addEventListener('click',click);
    const payload={facts:false,currency:'RUB',selectedKey:'1',points:[{key:'1',label:'1',value:5796,clicks:100,registrations:20,firstPayments:5},{key:'2',label:'2',value:12562,clicks:200,registrations:40,firstPayments:10}],split:[{name:'Первые оплаты',value:1000},{name:'Повторные оплаты',value:4796}]};
    root.addEventListener('syntolk-calculator-render-chart',()=>root.dispatchEvent(new CustomEvent('syntolk-calculator-chart',{detail:payload})));
    const result=render(visual(<CalculatorCharts root={root}/>));
    expect(root.querySelectorAll('.tremor-calculator-chart')).toHaveLength(1);expect(root.querySelectorAll('.recharts-wrapper')).toHaveLength(1);
    expect([...root.querySelectorAll('.recharts-bar')].map(bar=>bar.getAttribute('class'))).toEqual([expect.stringContaining('fill-violet-500'),expect.stringContaining('fill-blue-500'),expect.stringContaining('fill-emerald-500')]);
    expect(root.querySelector('.tremor-calculator-chart')!.textContent).not.toContain('₽');
    const bars=root.querySelectorAll('.recharts-bar-rectangle');expect(bars).toHaveLength(6);
    const rects=[...bars].map(bar=>bar.querySelector('rect')!);
    expect(Number(rects[0]!.getAttribute('height'))/Number(rects[2]!.getAttribute('height'))).toBeCloseTo(100/20,5);
    expect(Number(rects[2]!.getAttribute('height'))/Number(rects[4]!.getAttribute('height'))).toBeCloseTo(20/5,5);
    expect(rects[0]!.getAttribute('opacity')).toBe(rects[2]!.getAttribute('opacity'));
    expect(rects[1]!.getAttribute('opacity')).toBe('0.45');
    fireEvent.click(bars[1]!);expect(click).toHaveBeenCalledOnce();
    act(()=>root.dispatchEvent(new CustomEvent('syntolk-calculator-chart',{detail:{...payload,facts:true,selectedKey:null,points:[{key:'2026-10-01',label:'1',value:19407,clicks:133,registrations:22,firstPayments:9}]}})));
    expect(root.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(3);
    const factRects=[...root.querySelectorAll('.recharts-bar-rectangle rect')];
    expect(Number(factRects[0]!.getAttribute('height'))/Number(factRects[2]!.getAttribute('height'))).toBeCloseTo(133/9,5);
    result.unmount();expect(root.querySelector('.tremor-calculator-chart')).toBeNull();expect(root.querySelector('#pf-chart')!.hasAttribute('data-tremor-mounted')).toBe(false);
  });
  it.each([320,600,1200].flatMap(width=>[
    ...Array.from({length:12},(_,i)=>({facts:false,count:i+1,width})),
    ...[1,2,7,30,90].map(count=>({facts:true,count,width})),
  ]))('keeps calculator columns compact without losing data (facts=$facts, points=$count, width=$width)',({facts,count,width:viewportWidth})=>{
    chartViewport.width=viewportWidth;
    const root=document.createElement('div');root.dataset.visualTest='true';root.innerHTML='<div id="pf-chart"></div>';document.body.append(root);
    const points=Array.from({length:count},(_,i)=>({key:String(i+1),label:String(i+1),clicks:100+i,registrations:20+i,firstPayments:5+i}));
    root.addEventListener('syntolk-calculator-render-chart',()=>root.dispatchEvent(new CustomEvent('syntolk-calculator-chart',{detail:{facts,selectedKey:'1',currency:'RUB',split:[],points}})));
    render(visual(<CalculatorCharts root={root}/>));
    const series=[...root.querySelectorAll('.recharts-bar')];
    expect(series).toHaveLength(3);
    const rects=[...series[0]!.querySelectorAll('rect')];
    expect(rects).toHaveLength(count);
    rects.forEach((rect,i)=>{
      const x=Number(rect.getAttribute('x')),width=Number(rect.getAttribute('width'));
      expect(width).toBeGreaterThan(0);expect(width).toBeLessThanOrEqual(40);
      expect(x).toBeGreaterThanOrEqual(56);expect(x+width).toBeLessThanOrEqual(viewportWidth);
      if(i){
        const previous=rects[i-1]!,previousX=Number(previous.getAttribute('x')),previousWidth=Number(previous.getAttribute('width'));
        expect(x-previousX).toBeLessThanOrEqual(48.1);
        expect(x-previousX-previousWidth).toBeGreaterThanOrEqual(0);
        expect(x-previousX-previousWidth).toBeLessThanOrEqual(8.1);
      }
    });
    const middle=Math.floor(count/2);
    expect(Number(series[0]!.querySelectorAll('rect')[middle]!.getAttribute('height'))/Number(series[2]!.querySelectorAll('rect')[middle]!.getAttribute('height'))).toBeCloseTo(points[middle]!.clicks/points[middle]!.firstPayments,5);
  });
  it('does not change link destinations or leak the partner theme into other roles',()=>{
    const result=render(<MemoryRouter>{visual(<PartnerQuickActions compact/>)}</MemoryRouter>);
    expect(screen.getByRole('link',{name:'Создать ссылку на публикацию'}).getAttribute('href')).toBe('/links?section=create&view=publications&create=publication');
    result.unmount();expect(document.documentElement.dataset.portalVisual).toBeUndefined();
    render(<PartnerVisualProvider active={false}><Button>Обновить</Button></PartnerVisualProvider>);
    expect(screen.getByRole('button',{name:'Обновить'}).hasAttribute('tremor-id')).toBe(false);
  });
});
