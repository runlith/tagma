import { mergeOperations, type WireModule } from '../../../platform/contract/wire/manifest.js';

export const externalHarnesses = {
  id: 'external-harnesses',
  title: 'Foreign CLI sessions and installs',
  operations: async () => {
    const [{ INSTALL_STATUS_OPERATIONS }, { HARNESS_OPERATIONS }, { HOOK_OPERATIONS }, { HOSTED_OPERATIONS }, { REFUSAL_WORDS }] =
      await Promise.all([
        import('./installs.js'),
        import('./operations.js'),
        import('./hooks.js'),
        import('./hosted.js'),
        import('./refusalWords.js'),
      ]);
    return {
      declarations: mergeOperations(HOOK_OPERATIONS, HOSTED_OPERATIONS, HARNESS_OPERATIONS, INSTALL_STATUS_OPERATIONS),
      refusals: REFUSAL_WORDS,
    } as const;
  },
} as const satisfies WireModule;
