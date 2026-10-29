import type {ChartMetric} from '../../pages/ResultsChart.js';
import {AvailableChartColors,type AvailableChartColorsKeys} from './raw/utils/chartColors.js';

// Shared semantic colors for chart marks and external legends.
// CSS keeps them separate from the neutral partner controls.
const paletteEntry=(color:AvailableChartColorsKeys)=>[color,`var(--op-chart-${color})`] as const;
export const chartPalette = AvailableChartColors.map(paletteEntry);
export const metricPalette:Record<ChartMetric,typeof chartPalette[number]> = {
  clicks:paletteEntry('cyan'),identities:paletteEntry('lime'),registrations:paletteEntry('violet'),
  payingCustomers:paletteEntry('fuchsia'),payments:paletteEntry('amber'),
  customerPaymentsMinor:paletteEntry('emerald'),earningsMinor:paletteEntry('blue'),
};
export function sourcePalette(id:string) {
  return chartPalette[[...id].reduce((hash,char)=>(hash*31+char.charCodeAt(0))%chartPalette.length,0)]!;
}
