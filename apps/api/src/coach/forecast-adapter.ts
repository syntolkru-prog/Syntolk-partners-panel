import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

/** Run the same calculator model used by the partner-facing browser. */
export async function calculateCoachForecast(settings: Record<string, unknown>) {
  const source = await readFile(new URL('../../../portal/public/calculator/forecast-model.js', import.meta.url), 'utf8');
  const context = vm.createContext({ settings: JSON.parse(JSON.stringify(settings)) });
  vm.runInContext(source, context, { timeout: 1000 });
  const result = vm.runInContext(`(()=>{const normalized=SyntolkForecast.normalize(settings);return {settings:normalized,formats:SyntolkForecast.allFormats(normalized),channels:SyntolkForecast.allChannels(normalized),workload:SyntolkForecast.workload(normalized),commission:SyntolkForecast.COMMISSION,verified:SyntolkForecast.VERIFIED,scenarios:['low','base','high'].map(s=>({scenario:s,result:SyntolkForecast.forecast(normalized,s)}))};})()`, context, { timeout: 2000 });
  return { ...JSON.parse(JSON.stringify(result)), modelHash: createHash('sha256').update(source).digest('hex'), warning: 'Прогноз по вашим допущениям, не реальные начисления и не гарантия дохода.' };
}
