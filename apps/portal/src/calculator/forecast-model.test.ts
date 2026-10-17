import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

interface Settings extends Record<string, unknown> {
  registration: number; paidConversion: number; businessShare: number;
  paymentDelayEnabled: boolean; delayShare: number;
  frequency: Record<string, number>; tail: Record<string, number>;
  channels: Record<string, { enabled: boolean; formats: string[]; views: number; ctr: number }>;
  prices: number[]; mix: number[];
}
interface Month {
  clicks: number; registrations: number; newPaid: number; newPersonal: number; newBusiness: number;
  byPlan: number[]; newReward: number; repeatReward: number; reward: number; payments: number;
}
interface Model {
  WEEKS: number;
  defaults(): Settings;
  normalize(settings: Record<string, unknown>): Settings;
  selectMatchingChannels(settings: Record<string, unknown>): Settings;
  workload(settings: Record<string, unknown>): {unplaced:string[]};
  forecast(settings: Record<string, unknown>, scenario?: string): { months: [Month, Month, Month, ...Month[]] };
}
const context: { SyntolkForecast?: Model } = {};
runInNewContext(readFileSync(resolve(process.cwd(), 'public/calculator/forecast-model.js'), 'utf8'), context);
const model = context.SyntolkForecast!;

function example(): Settings {
  const settings = model.defaults();
  Object.keys(settings.frequency).forEach(id => { settings.frequency[id] = id === 'post' ? 1 : 0; });
  Object.values(settings.channels).forEach(channel => { channel.enabled = false; channel.formats = []; });
  settings.channels['telegram-post'] = { enabled: true, formats: ['post'], views: 200 / model.WEEKS, ctr: 100 };
  Object.keys(settings.tail).forEach(id => { settings.tail[id] = 0; });
  return { ...settings, registration: 14, paidConversion: 10.7, businessShare: 10,
    growth: 0, stopAfter: 1, personalRetention: 100, businessRetention: 100,
    personalUpgrade: 0, businessUpgrade: 0 };
}

describe('first payment conversion and tariff allocation', () => {
  it('selects only compatible active formats, including custom scopes, without altering assumptions',()=>{
    const input={...example(),removedChannels:['vk'],customFormats:[{id:'format-group',name:'Сообщение в группе',base:'post',channelId:'telegram-post'}],frequency:{post:10,short:0,long:0,article:0,circle:0,'format-group':1}};
    const selected=model.selectMatchingChannels(input);
    expect(selected.channels.vk!.enabled).toBe(false);
    expect(selected.channels.youtube!.enabled).toBe(false);
    expect(selected.channels['telegram-post']!.formats).toEqual(['post','format-group']);
    expect(selected.channels.dzen!.formats).toEqual(['post']);
    expect(selected.channels.email!.enabled).toBe(true);
    expect(selected.frequency).toEqual(input.frequency);
    expect(selected.registration).toBe(input.registration);expect(selected.prices).toEqual(input.prices);
    expect(selected.channels['telegram-post']!.views).toBe(input.channels['telegram-post']!.views);
    expect(model.workload(selected).unplaced).toEqual([]);
    expect(model.selectMatchingChannels(selected)).toEqual(selected);
  });
  it('discards legacy effort settings without changing publication or income forecasts', () => {
    const settings = example();
    const legacy = { ...settings, budgetHours: 0, publishMinutes: 120, adminMinutes: 10080,
      hourlyCost: 100000, minutes: { post: 600 } };
    const normalized = model.normalize(legacy);
    for (const field of ['budgetHours', 'publishMinutes', 'adminMinutes', 'hourlyCost', 'minutes']) {
      expect(normalized).not.toHaveProperty(field);
    }
    expect(model.forecast(legacy).months).toEqual(model.forecast(settings).months);
  });

  it('calculates 200 clicks → 28 registrations → 2.996 payments before splitting tariffs', () => {
    const settings = example();
    const [first, second] = model.forecast(settings).months;
    expect(first.clicks).toBeCloseTo(200, 10);
    expect(first.registrations).toBeCloseTo(28, 10);
    expect(first.newPaid).toBeCloseTo(2.996, 10);
    expect(first.newPersonal).toBeCloseTo(2.6964, 10);
    expect(first.newBusiness).toBeCloseTo(.2996, 10);
    expect(first.byPlan.slice(0, 3).reduce((sum, count) => sum + count, 0)).toBeCloseTo(first.newPersonal, 10);
    expect(first.byPlan.slice(3).reduce((sum, count) => sum + count, 0)).toBeCloseTo(first.newBusiness, 10);
    expect(first.reward).toBeCloseTo(first.byPlan.reduce((sum, count, index) => sum + count * settings.prices[index]!, 0) * .2, 10);
    expect(first.repeatReward).toBe(0);
    expect(second.newPaid).toBe(0);
    expect(second.newReward).toBe(0);
    expect(second.repeatReward).toBeCloseTo(first.reward, 10);
  });

  it('changes income but never the number of first payments when buyer mix changes', () => {
    const outcomes = [0, 10, 100].map(businessShare => model.forecast({ ...example(), businessShare }).months[0]);
    for (const month of outcomes) {
      expect(month.newPaid).toBeCloseTo(2.996, 10);
      expect(month.newPersonal + month.newBusiness).toBeCloseTo(month.newPaid, 10);
    }
    expect(outcomes[0]!.newBusiness).toBe(0);
    expect(outcomes[2]!.newPersonal).toBe(0);
    expect(outcomes[0]!.reward).toBeLessThan(outcomes[1]!.reward);
    expect(outcomes[1]!.reward).toBeLessThan(outcomes[2]!.reward);
  });

  it('applies a saved delay percentage only when explicitly enabled', () => {
    const settings = { ...example(), delayShare: 25 };
    expect(model.forecast(settings).months[0].newPaid).toBeCloseTo(2.996, 10);
    const [first, second, third] = model.forecast({ ...settings, paymentDelayEnabled: true }).months;
    expect(first.newPaid).toBeCloseTo(2.247, 10);
    expect(second.newPaid).toBeCloseTo(.749, 10);
    expect(first.newPaid + second.newPaid).toBeCloseTo(2.996, 10);
    expect(third.newPaid).toBe(0);
    expect(second.newBusiness / second.newPaid).toBeCloseTo(.1, 10);
  });

  it.each(['registration', 'paidConversion'])('supports zero %s and caps scenario conversion at 100%', field => {
    expect(model.forecast({ ...example(), [field]: 0 }).months[0].newPaid).toBe(0);
    const month = model.forecast({ ...example(), registration: 100, paidConversion: 100 }, 'high').months[0];
    expect(month.registrations).toBeCloseTo(month.clicks, 10);
    expect(month.newPaid).toBeCloseTo(month.registrations, 10);
  });

  it('translates legacy audience rates once and preserves the saved content', () => {
    const input = { ...example(), conversionVersion: 1, paidConversion: undefined, registration: 20,
      newVisitorShare: 70, personalPaid: 12, businessPaid: 6, businessShare: 10, delayShare: 25 };
    const normalized = model.normalize(input);
    expect(normalized.registration).toBeCloseTo(14, 10);
    expect(normalized.paidConversion).toBeCloseTo(11.4, 10);
    expect(normalized.businessShare).toBeCloseTo(100 * .6 / 11.4, 10);
    expect(normalized.paymentDelayEnabled).toBe(false);
    expect(normalized.delayShare).toBe(25);
    expect(normalized.frequency).toEqual(input.frequency);
    expect(normalized.channels['telegram-post']).toEqual(input.channels['telegram-post']);
    expect(model.normalize(normalized)).toEqual(normalized);
    expect(normalized).not.toHaveProperty('newVisitorShare');
    expect(normalized).not.toHaveProperty('personalPaid');
    expect(normalized).not.toHaveProperty('businessPaid');
    const month = model.forecast(normalized).months[0];
    expect(month.registrations).toBeCloseTo(28, 10);
    expect(month.newPaid).toBeCloseTo(3.192, 10);
    expect(month.newBusiness).toBeCloseTo(.168, 10);
  });

  it('uses explicit new rates even when obsolete fields are included', () => {
    const settings = { ...example(), newVisitorShare: 0, personalPaid: 0, businessPaid: 0 };
    expect(model.forecast(settings).months[0].newPaid).toBeCloseTo(2.996, 10);
    expect(model.forecast({ ...settings, paymentDelayEnabled: true, delayShare: 25 }).months[1].newPaid).toBeCloseTo(.749, 10);
  });
});
