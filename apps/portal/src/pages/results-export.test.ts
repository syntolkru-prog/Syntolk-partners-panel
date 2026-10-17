import { describe, expect, it } from 'vitest';
import { buildResultsCsv } from './results-export.js';
import type { MetricRow } from './PartnerAnalytics.js';
const row:MetricRow={id:'one',name:'Ссылка; "Дзен"',archived:false,createdAt:'2026-10-01T00:00:00Z',counts:{clicks:12,registrations:2,payingCustomers:1,paymentCount:2,firstPaymentCount:1,repeatPaymentCount:1},amountsMinor:{observedPayments:100000,refunds:40000,netPayments:60000,netAccrued:12000}};
describe('results CSV',()=>{
  it('exports only supplied rows in their order and keeps currency values in rubles',()=>{
    const csv=buildResultsCsv([row],{since:'2026-10-01T00:00:00Z',until:'2026-10-02T00:00:00Z'});
    expect(csv.startsWith('\uFEFF')).toBe(true);expect(csv).toContain('"Ссылка; ""Дзен"""');
    expect(csv).toContain('"12";"2";"1";"1";"1";"120";"400"');
    expect(csv).toContain('2026-10-01T00:00:00Z');expect(csv.split('\r\n')).toHaveLength(4);
  });
  it('escapes spreadsheet formulas but preserves trusted numeric amounts',()=>{
    const csv=buildResultsCsv([{...row,name:'=HYPERLINK("https://evil.test")',amountsMinor:{...row.amountsMinor,refunds:-100}}]);
    expect(csv).toContain('"\'=HYPERLINK');expect(csv).toContain('"-1"');
  });
  it('keeps fractional ruble amounts readable in Russian spreadsheets',()=>{
    const csv=buildResultsCsv([{...row,amountsMinor:{...row.amountsMinor,netAccrued:12005}}]);
    expect(csv).toContain('"120,05"');
  });
});
