// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PartnerHomeBreakdown, PartnerHomeChart, homePeriodCaption } from './PartnerHomeOverview.js';
import type { AnalyticsReport } from './PartnerAnalytics.js';

afterEach(cleanup);
const point = (date: string, earningsMinor: number) => ({ date, earningsMinor, clicks: 1, registrations: 0, payments: 0 });
const series = { bucket: 'day', points: [point('2026-10-20', 219600), point('2026-10-21', 0)] };
const chart = (props = {}) => render(<PartnerHomeChart currency="RUB" loading={false} series={series} {...props} />);
const report = { rows: [
  { id: 'vk', name: 'ВКонтакте', counts: { clicks: 20 }, amountsMinor: { netAccrued: 19900 } },
  { id: 'dzen', name: 'Дзен', counts: { clicks: 8 }, amountsMinor: { netAccrued: 29900 } },
] } as AnalyticsReport;

describe('Dub-style homepage overview', () => {
  it('uses the report timezone and the exclusive end of the reporting period', () => {
    expect(homePeriodCaption({ since: '2026-10-19T21:00:00Z', until: '2026-10-21T21:00:00Z' }, 'Europe/Moscow')).toBe('20 окт. — 21 окт.');
    expect(homePeriodCaption()).toBe('');
    expect(homePeriodCaption({ since: 'invalid', until: 'invalid' })).toBe('');
  });
  it('shows actual bucket earnings in a keyboard-accessible tooltip without multiplying them', () => {
    chart();
    expect(screen.getByRole('img', { name: 'Начисления по датам' })).toBeTruthy();
    const date = screen.getByRole('button', { name: /20 окт.*2\s196,00/ });
    fireEvent.focus(date);
    expect(screen.getByRole('status').textContent).toMatch(/20 окт.*2\s196,00\s₽/);
    fireEvent.blur(date);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/103\s259/)).toBeNull();
  });
  it('does not keep a tooltip for a date removed by a period change', () => {
    const view = chart();
    fireEvent.focus(screen.getByRole('button', { name: /20 окт/ }));
    view.rerender(<PartnerHomeChart currency="RUB" loading={false} series={{ bucket: 'day', points: [point('2026-10-21', 100)] }} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: /21 окт.*1,00/ })).toBeTruthy();
  });
  it.each([
    [{ loading: true }, 'Загрузка динамики…'],
    [{ error: new Error('network') }, 'Не удалось загрузить динамику'],
    [{ series: { bucket: 'day', points: [] } }, 'За этот период событий нет'],
    [{ series: undefined }, 'Динамика недоступна'],
  ])('distinguishes loading, failed, empty and missing data: %s', (props, text) => {
    chart(props); expect(screen.getByRole('status').textContent).toBe(text);
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('renders a single bucket, zero earnings and negative corrections with finite paths', () => {
    const view = chart({ series: { bucket: 'day', points: [point('2026-10-21', 0)] } });
    expect(screen.getByRole('button', { name: /21 окт.*0,00/ })).toBeTruthy();
    view.rerender(<PartnerHomeChart currency="RUB" loading={false} series={{ bucket: 'day', points: [point('2026-10-20', -20000), point('2026-10-21', 10000)] }} />);
    for (const path of document.querySelectorAll('path')) expect(path.getAttribute('d')).not.toMatch(/NaN|Infinity/);
  });
  it('sorts actual rows by clicks or earnings and opens the same filtered report', () => {
    render(<MemoryRouter initialEntries={['/t/syntolk/']}><PartnerHomeBreakdown title="Площадки" dimension="platform" report={report} period="7d" currency="RUB" loading={false} /></MemoryRouter>);
    const region = screen.getByRole('region', { name: 'Площадки' });
    expect(within(region).getByRole('link', { name: 'ВКонтакте, переходы: 20' }).getAttribute('href')).toBe('/t/syntolk/results?period=7d&groupBy=platform&platformIds=vk');
    expect(document.querySelector('.ph-breakdown__row')?.textContent).toBe('ВКонтакте20');
    fireEvent.click(within(region).getByRole('button', { name: 'Заработок' }));
    expect(document.querySelector('.ph-breakdown__row')?.textContent).toMatch(/Дзен299,00/);
    expect(within(region).getByRole('link', { name: 'Все: площадки' }).getAttribute('href')).toBe('/t/syntolk/results?groupBy=platform&period=7d');
  });
  it('does not turn a failed breakdown request into a list of zeroes', () => {
    render(<MemoryRouter><PartnerHomeBreakdown title="Ссылки" dimension="link" period="all" currency="RUB" loading={false} error={new Error('network')} /></MemoryRouter>);
    expect(screen.getByText('Не удалось загрузить данные')).toBeTruthy();
    expect(document.querySelector('.ph-breakdown__row')).toBeNull();
  });
});
