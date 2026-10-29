import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const browser = {
  id: 'browser',
  title: 'Browser built into Tagma',
  operations: async () => {
    const [{ PAGE_OPERATIONS }, { PROFILE_OPERATIONS }, { COOKIE_OPERATIONS }, { TRACE_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all(
      [
        import('./pageOperations.js'),
        import('./profileOperations.js'),
        import('./cookieOperations.js'),
        import('./traceOperations.js'),
        import('./refusalWords.js'),
      ],
    );
    return {
      declarations: { ...PAGE_OPERATIONS, ...PROFILE_OPERATIONS, ...COOKIE_OPERATIONS, ...TRACE_OPERATIONS },
      refusals: REFUSAL_WORDS,
    };
  },
} as const satisfies OperationManifest;
