import type {MetricRow} from './PartnerAnalytics.js';
import {money} from '../ui.js';
import {comparisonLabel} from './results-scope.js';
import {publicationValue,type PublicationMetric} from './publications-model.js';

export function PublicationMetricCell({row,previous,metric,ready,comparing,comparisonReady,currency='RUB'}:{row?:MetricRow;previous?:MetricRow;metric:PublicationMetric;ready:boolean;comparing:boolean;comparisonReady:boolean;currency?:string}){
  const value=publicationValue(row,metric),before=publicationValue(previous,metric),format=(amount:number)=>metric==='earnings'?money(amount/100,currency):amount.toLocaleString('ru-RU');
  return <span className="publication-metric"><strong>{ready?format(value):'—'}</strong>{comparing&&<small>{ready&&comparisonReady?`${before===0&&value!==0?'':`${comparisonLabel(value,before)} · `}было ${format(before)}`:'Сравнение: —'}</small>}</span>;
}
