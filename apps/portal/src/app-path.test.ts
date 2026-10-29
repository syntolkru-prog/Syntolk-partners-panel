import { describe, expect, it } from 'vitest';
import { appPath } from './app-path.js';

describe('deployment path', () => {
  it('keeps existing root deployments unchanged', () => {
    expect(appPath('/api/me', '')).toBe('/api/me');
  });
  it('scopes API and browser redirects without adding the prefix twice', () => {
    expect(appPath('/api/me', '/vtestpartners')).toBe('/vtestpartners/api/me');
    expect(appPath('/login?next=1', '/vtestpartners')).toBe('/vtestpartners/login?next=1');
    expect(appPath('/vtestpartners/api/me', '/vtestpartners')).toBe('/vtestpartners/api/me');
  });
  it('preserves external URLs and relative destinations', () => {
    expect(appPath('https://syntolk.ru/register', '/vtestpartners')).toBe('https://syntolk.ru/register');
    expect(appPath('//syntolk.ru/register', '/vtestpartners')).toBe('//syntolk.ru/register');
    expect(appPath('next', '/vtestpartners')).toBe('next');
  });
});
