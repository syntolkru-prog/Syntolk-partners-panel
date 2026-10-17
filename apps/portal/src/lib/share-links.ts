import { currentTenantSlug } from '../api.js';

export function shareUrlBase(): string {
  const slug = currentTenantSlug();
  const origin = (import.meta.env.VITE_ROUTER_URL as string | undefined)?.replace(/\/$/, '') ?? window.location.origin;
  return `${origin}/r${slug ? `/${encodeURIComponent(slug)}` : ''}`;
}

export function trackingShareUrl(linkKey: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString();
  return `${shareUrlBase()}/${encodeURIComponent(linkKey)}${query ? `?${query}` : ''}`;
}
