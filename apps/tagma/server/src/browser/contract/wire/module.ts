import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { BROWSER_FEEDS } from './feeds.js';

export const browser = {
  id: 'browser',
  title: 'Browser built into Tagma',
  operations: async () => {
    const [
      { PAGE_OPERATIONS },
      { PROFILE_OPERATIONS },
      { COOKIE_OPERATIONS },
      { TRACE_OPERATIONS },
      { RECORD_OPERATIONS },
      { AUDIT_OPERATIONS },
      { REFUSAL_WORDS },
    ] = await Promise.all([
      import('./pageOperations.js'),
      import('./profileOperations.js'),
      import('./cookieOperations.js'),
      import('./traceOperations.js'),
      import('./recordOperations.js'),
      import('./auditOperations.js'),
      import('./refusalWords.js'),
    ]);
    return {
      declarations: {
        ...PAGE_OPERATIONS,
        ...PROFILE_OPERATIONS,
        ...COOKIE_OPERATIONS,
        ...TRACE_OPERATIONS,
        ...RECORD_OPERATIONS,
        ...AUDIT_OPERATIONS,
      },
      refusals: REFUSAL_WORDS,
    };
  },
  feeds: BROWSER_FEEDS,
} as const satisfies WireModule;
