import type {ChartMetric} from '../../pages/ResultsChart.js';
import {AvailableChartColors,type AvailableChartColorsKeys} from './raw/utils/chartColors.js';

// Tremor's named chart palette, also used by the existing external legends.
const paletteEntry=(color:AvailableChartColorsKeys)=>[color,`var(--color-${color}-500)`] as const;
export const chartPalette = AvailableChartColors.map(paletteEntry);
export const metricPalette:Record<ChartMetric,typeof chartPalette[number]> = {
  clicks:paletteEntry('blue'),identities:paletteEntry('gray'),registrations:paletteEntry('violet'),
  payingCustomers:paletteEntry('emerald'),payments:paletteEntry('amber'),
  customerPaymentsMinor:paletteEntry('emerald'),earningsMinor:paletteEntry('blue'),
};
export function sourcePalette(id:string) {
  return chartPalette[[...id].reduce((hash,char)=>(hash*31+char.charCodeAt(0))%chartPalette.length,0)]!;
}
