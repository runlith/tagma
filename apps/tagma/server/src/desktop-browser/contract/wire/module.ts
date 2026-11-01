import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { ATTACH_FEED } from './channel.js';

export const desktopBrowser = {
  id: 'desktop-browser',
  feeds: [ATTACH_FEED],
} as const satisfies WireModule;
