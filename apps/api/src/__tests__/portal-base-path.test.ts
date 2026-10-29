import { expect, it } from 'vitest';
import { getPortalBaseUrl } from '../portal-url.js';

it('keeps single-tenant magic links within the deployed path', () => {
  const portal = process.env.PORTAL_URL;
  const tenancy = process.env.OPENPARTNER_TENANCY;
  try {
    process.env.PORTAL_URL = 'https://partners.syntolk.ru/vtestpartners';
    process.env.OPENPARTNER_TENANCY = 'single';
    expect(getPortalBaseUrl({ slug: 'default' })).toBe('https://partners.syntolk.ru/vtestpartners');
    expect(getPortalBaseUrl({ customDomain: 'partners.syntolk.ru' })).toBe('https://partners.syntolk.ru/vtestpartners');
  } finally {
    if (portal === undefined) delete process.env.PORTAL_URL; else process.env.PORTAL_URL = portal;
    if (tenancy === undefined) delete process.env.OPENPARTNER_TENANCY; else process.env.OPENPARTNER_TENANCY = tenancy;
  }
});
