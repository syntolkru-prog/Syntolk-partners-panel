import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarChart } from './raw/components/BarChart/BarChart.js';
import { usePartnerVisual } from './PartnerVisual.js';

interface CalculatorChartData {
  points: Array<{ key: string; label: string; clicks?: number | null; registrations?: number | null; firstPayments?: number | null }>;
  facts: boolean; currency: string; selectedKey: string | null;
  split: Array<{ name: string; value: number }>;
}
/** The calculator remains the owner of every value and click handler. */
export function CalculatorCharts({ root }: { root: HTMLElement | null }) {
  const tremor=usePartnerVisual();
  const [data,setData]=useState<CalculatorChartData|null>(null);
  const [hosts,setHosts]=useState<{bars:HTMLElement;legacy:HTMLElement}|null>(null);
  useEffect(()=>{
    if(!tremor||!root)return;
    let legacy=root.querySelector<HTMLElement>('#pf-chart');
    if(!legacy)return;
    const bars=document.createElement('div');bars.className='tremor-calculator-chart';
    const attach=()=>{
      const current=root.querySelector<HTMLElement>('#pf-chart');
      if(!current)return;
      if(current!==legacy){if(legacy)delete legacy.dataset.tremorMounted;legacy=current;}
      if(current.nextElementSibling!==bars){current.after(bars);setHosts({bars,legacy:current});}
      current.dataset.tremorMounted='true';
    };
    attach();
    const update=(event:Event)=>{attach();setData((event as CustomEvent<CalculatorChartData>).detail);};
    root.addEventListener('syntolk-calculator-chart',update);
    root.dispatchEvent(new CustomEvent('syntolk-calculator-render-chart'));
    return()=>{root.removeEventListener('syntolk-calculator-chart',update);bars.remove();if(legacy)delete legacy.dataset.tremorMounted;};
  },[root,tremor]);
  const categories=['Переходы','Регистрации','Первые оплаты'];
  // Distinct event counts, not money or unique people. Missing facts remain
  // unknown; never infer first payments from revenue or all payment events.
  const chartData=useMemo(()=>data?.points.map(point=>({date:point.key,'Переходы':point.clicks??null,'Регистрации':point.registrations??null,'Первые оплаты':point.firstPayments??null}))??[],[data]);
  if(!tremor||!hosts||!data)return null;
  const format=(value:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:data.facts?0:1}).format(value);
  return createPortal(<BarChart className="h-full w-full" data={chartData} index="date" categories={categories} colors={['violet','blue','emerald']} type="stacked" selectedIndex={data.selectedKey} minPointSize={0} showLegend={false} valueFormatter={format} xAxisValueFormatter={value=>data.points.find(point=>point.key===value)?.label??value} yAxisWidth={46} xAxisPadding={0} minValue={0} allowDecimals={!data.facts} barCategoryGap="14%" maxBarSize={data.facts?22:30} showTooltipCursor={false} hoverScale={1.06}
    onValueChange={value=>{if(value?.eventType==='category')return;if(!value){if(data.facts)root?.dispatchEvent(new CustomEvent('syntolk-calculator-fact-point',{detail:null}));return;}const key=String(value.date);const button=[...hosts.legacy.querySelectorAll<HTMLButtonElement>('button')].find(button=>(data.facts?button.dataset.factPoint:button.dataset.month)===key);button?.click();}}/>,hosts.bars);
}
