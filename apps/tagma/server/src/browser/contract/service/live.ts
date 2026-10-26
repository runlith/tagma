import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { BROWSER_FEEDS } from '../wire/feeds.js';
import type { Automation } from './automation.js';
import type { Pages } from './pages.js';
import type { Screencast } from './screencast.js';

export type BrowserLive = LiveDeclaration<typeof BROWSER_FEEDS, Pages | Automation | Screencast>;
