import {describe,expect,it} from 'vitest';
import {QueryClient} from '@tanstack/react-query';
import {adminOverviewParams,analyticsChartTotals,analyticsChartChanges,comparisonLabel,invalidateAnalytics,resetResultsFilters} from './results-scope.js';

describe('report reset',()=>{
  it('removes report settings without losing tenant or selected-partner navigation',()=>{
    const input=new URLSearchParams({tenant:'syntolk',selectedPartner:'a',selectedPartnerName:'Партнёр',returnTo:'period=all',programId:'p',period:'custom',from:'2025-04-01',to:'2025-04-03',compare:'true',compareFrom:'2026-10-01',compareTo:'2026-10-07',platformIds:'vk',formatIds:'post',scenarioIds:'draft',partnerIds:'a',page:'2',metrics:'clicks',currency:'USD',timezone:'UTC'});
    const context=new URLSearchParams({tenant:'syntolk',selectedPartner:'a',selectedPartnerName:'Партнёр',returnTo:'period=all'});
    expect(resetResultsFilters(input).toString()).toBe(context.toString());
    context.set('programId','p');expect(resetResultsFilters(input,true).toString()).toBe(context.toString());
    expect(input.get('compare')).toBe('true');
  });
});

describe('shared metric comparison',()=>{
  it('maps both periods to the same card metrics without mixing money and payment counts',()=>{
    const current={counts:{clicks:20,registrations:4,payingCustomers:2,paymentCount:3,firstPaymentCount:2,repeatPaymentCount:1},amountsMinor:{observedPayments:10000,refunds:0,netPayments:10000,netAccrued:2000}};
    const previous={counts:{...current.counts,clicks:10,paymentCount:6},amountsMinor:{...current.amountsMinor,observedPayments:20000,netAccrued:0}};
    expect(analyticsChartTotals(current)).toEqual({clicks:20,identities:0,registrations:4,payingCustomers:2,payments:3,customerPaymentsMinor:10000,earningsMinor:2000});
    expect(analyticsChartChanges(current,previous)).toMatchObject({clicks:'↑ 100%',registrations:'Без изменений',payments:'↓ 50%',customerPaymentsMinor:'↓ 50%',earningsMinor:'В сравнении — 0'});
  });
  it('handles zero and negative baselines without invalid percentages',()=>{
    expect(comparisonLabel(0,0)).toBe('Без изменений');
    expect(comparisonLabel(100,0)).toBe('В сравнении — 0');
    expect(comparisonLabel(0,100)).toBe('↓ 100%');
    expect(comparisonLabel(0,-100)).toBe('↑ 100%');
  });
});

describe('administrator overview scope',()=>{
  it('removes only scenario selections and keeps content filters intact',()=>{
    const input=new URLSearchParams('scenarioId=draft-a&scenarioIds=draft-b&scenarioIds=draft-c&formatId=post&formatIds=article&chartBy=scenario&groupBy=scenario&period=custom&from=2026-10-01&to=2026-10-19&partnerIds=partner-a&platformIds=vk&programId=program-a&metrics=clicks');
    const cleaned=adminOverviewParams(input);
    expect(cleaned.toString()).toBe('formatId=post&formatIds=article&period=custom&from=2026-10-01&to=2026-10-19&partnerIds=partner-a&platformIds=vk&programId=program-a&metrics=clicks');
    expect(input.get('scenarioId')).toBe('draft-a');
    expect(adminOverviewParams(cleaned).toString()).toBe(cleaned.toString());
  });
  it('retains supported partner, platform and content breakdowns',()=>{
    for(const by of ['partner','platform','format']){
      const query=new URLSearchParams({chartBy:by});
      expect(adminOverviewParams(query).get('chartBy')).toBe(by);
    }
    expect(adminOverviewParams(new URLSearchParams('chartBy=format&groupBy=format')).toString()).toBe('chartBy=format&groupBy=format');
  });
});

describe('financial action refresh',()=>{
  it('invalidates every affected analytics view without touching calculator data',async()=>{
    const client=new QueryClient();
    const keys=['dashboard','partner-analytics','partner-analytics-details','admin-analytics','admin-analytics-partners','admin-analytics-partner-picker','admin-analytics-quality'];
    for(const key of [...keys,'calculator'])client.setQueryData([key,'tenant','partner'],{value:1});
    await invalidateAnalytics(client);
    for(const key of keys)expect(client.getQueryState([key,'tenant','partner'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['calculator','tenant','partner'])?.isInvalidated).toBe(false);
    client.clear();
  });
});
