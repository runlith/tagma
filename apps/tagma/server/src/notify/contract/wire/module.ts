import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { NOTIFY_FEEDS } from './notification.js';

export const notify = {
  id: 'notify',
  title: 'Notifications to the operator',
  operations: async () => {
    const [{ NOTIFY_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./notification.js'), import('./refusalWords.js')]);
    return { declarations: NOTIFY_OPERATIONS, refusals: REFUSAL_WORDS };
  },
  feeds: NOTIFY_FEEDS,
} as const satisfies WireModule;
