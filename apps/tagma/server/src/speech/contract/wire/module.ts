import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { SPEECH_FEEDS } from './feeds.js';

export const speech = {
  id: 'speech',
  title: 'Speech on this machine',
  operations: async () => {
    const [{ SPEECH_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: SPEECH_OPERATIONS, refusals: REFUSAL_WORDS };
  },
  feeds: SPEECH_FEEDS,
} as const satisfies WireModule;
