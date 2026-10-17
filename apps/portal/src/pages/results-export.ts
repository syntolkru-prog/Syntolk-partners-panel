import type { MetricRow } from './PartnerAnalytics.js';

const cell = (value: string | number) => {
  const text = typeof value === 'number' ? value.toLocaleString('ru-RU',{useGrouping:false,maximumFractionDigits:2}) : /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
};
export function buildResultsCsv(rows: MetricRow[], period?: { since: string; until: string }) {
  const lines: Array<Array<string | number>> = [
    ...(period ? [['Начало периода', period.since], ['Конец периода (не включён)', period.until]] : []),
    ['Название', 'Создана', 'Площадка', 'Канал', 'Материал', 'Переходы', 'Регистрации', 'Платящие клиенты', 'Первые оплаты', 'Повторные оплаты', 'Заработок, RUB', 'Возвраты клиентов, RUB', 'Оплачено клиентами, RUB'],
    ...rows.map(row => [row.name, row.createdAt ?? '', row.placement?.platformName ?? row.platformNames?.join(', ') ?? '', row.placement?.channelName ?? '', row.placement?.materialTitle ?? (row.material ? row.name : ''),
      row.counts.clicks, row.counts.registrations, row.counts.payingCustomers, row.counts.firstPaymentCount, row.counts.repeatPaymentCount,
      row.amountsMinor.netAccrued / 100, row.amountsMinor.refunds / 100, row.amountsMinor.observedPayments / 100]),
  ];
  return '\uFEFF' + lines.map(line => line.map(cell).join(';')).join('\r\n');
}
export function downloadResultsCsv(rows: MetricRow[], period?: { since: string; until: string }) {
  const url = URL.createObjectURL(new Blob([buildResultsCsv(rows, period)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'syntolk-results.csv'; document.body.append(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
