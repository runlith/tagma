import type { WireModule } from '../../../platform/contract/wire/manifest.js';

export const settings = {
  id: 'settings',
  title: "This project's settings",
  operations: async () => {
    const [{ SETTINGS_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: SETTINGS_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies WireModule;
