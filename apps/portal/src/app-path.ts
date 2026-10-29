/** Deployment prefix; root deployments retain their existing URLs. */
export const appBase = import.meta.env.BASE_URL.replace(/\/$/, '');
export function appPath(path: string, base = appBase): string {
  if (!base || !path.startsWith('/') || path.startsWith('//') || path === base || path.startsWith(base + '/')) return path;
  return base + path;
}
export function appLocationPath(): string {
  const path = window.location.pathname;
  return appBase && (path === appBase || path.startsWith(appBase + '/')) ? path.slice(appBase.length) || '/' : path;
}
