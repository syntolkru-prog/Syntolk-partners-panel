import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

/** The original calculator asset remains byte-for-byte unchanged. */
export async function calculateCoachForecast(settings: Record<string, unknown>) {
  const source = await readFile(new URL('../../../portal/public/calculator/forecast-model.js', import.meta.url), 'utf8');
  const context = vm.createContext({ settings: JSON.parse(JSON.stringify(settings)) });
  vm.runInContext(source, context, { timeout: 1000 });
  const result = vm.runInContext(`({settings:SyntolkForecast.normalize(settings),commission:SyntolkForecast.COMMISSION,verified:SyntolkForecast.VERIFIED,scenarios:['low','base','high'].map(s=>({scenario:s,result:SyntolkForecast.forecast(settings,s)}))})`, context, { timeout: 2000 });
  return { ...JSON.parse(JSON.stringify(result)), modelHash: createHash('sha256').update(source).digest('hex'), warning: 'Прогноз по вашим допущениям, не реальные начисления и не гарантия дохода.' };
}
