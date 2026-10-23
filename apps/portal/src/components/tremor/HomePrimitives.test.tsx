// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TremorCard, TremorProgressBar } from './HomePrimitives.js';
afterEach(cleanup);
describe('homepage Tremor primitives', () => {
  it('preserves card attributes and children', () => {
    render(<TremorCard role="region" aria-label="Сводка" className="custom">Данные</TremorCard>);
    expect(screen.getByRole('region').className).toBe('ph-card custom');
    expect(screen.getByText('Данные').getAttribute('tremor-id')).toBe('tremor-raw');
  });
  it.each([[1, 4, 25], [6, 4, 100], [-1, 4, 0], [0, 0, 0], [NaN, 4, 0], [1, Infinity, 0]])('safely displays progress %s/%s', (value, max, width) => {
    render(<TremorProgressBar value={value} max={max} aria-label="Задачи" />);
    expect(screen.getByRole('progressbar', { name: 'Задачи' }).querySelector<HTMLElement>('.ph-progress__bar')!.style.width).toBe(`${width}%`);
    expect(Number.isFinite(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow')))).toBe(true);
  });
});
