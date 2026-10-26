import { servesResource } from '@tagma/server/http/contract/wire/served';
import { VIEW_WINDOW_PATH } from './bridge.js';

const DESKTOP_ONLY = '/_desktop/';

export const fromSurface = (surface: URL, sender: string | undefined): boolean =>
  sender !== undefined && URL.canParse(sender) && new URL(sender).origin === surface.origin;

export function viewWindowUrl(surface: URL, path: unknown): URL | null {
  if (typeof path !== 'string' || !path.startsWith(VIEW_WINDOW_PATH)) return null;
  const url = new URL(path, surface);
  return url.origin === surface.origin && url.pathname.startsWith(VIEW_WINDOW_PATH) ? url : null;
}

export function revealedUrl(surface: URL, path: unknown): URL | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null;
  const url = new URL(path, surface);
  const route = decoded(url.pathname);
  return url.origin === surface.origin && route !== null && !route.startsWith(DESKTOP_ONLY) ? url : null;
}

export function surfacePage(url: URL): boolean {
  const route = decoded(url.pathname);
  return route !== null && !servesResource(route);
}

function decoded(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}
