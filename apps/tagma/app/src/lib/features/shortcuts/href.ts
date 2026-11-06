import type { Router } from '@runlith/layer/Router';
import { settingsHref } from '$lib/features/workspace/address.js';

export const REBIND = 'rebind';

export const rebindHref = (router: Router, action: string): string => {
  const href = settingsHref(router, 'shortcuts');
  return `${href}${href.includes('?') ? '&' : '?'}${REBIND}=${encodeURIComponent(action)}`;
};
