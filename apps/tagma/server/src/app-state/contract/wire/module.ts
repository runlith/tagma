import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { APP_STATE_FEED } from './documents.js';

export const appState = {
  id: 'app-state',
  title: 'App documents',
  operations: async () => {
    const { APP_STATE_OPERATIONS } = await import('./documents.js');
    return { declarations: APP_STATE_OPERATIONS };
  },
  feeds: [APP_STATE_FEED],
} as const satisfies WireModule;
