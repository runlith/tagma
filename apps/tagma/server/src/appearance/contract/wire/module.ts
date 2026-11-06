import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { APPEARANCE_FEEDS } from './feeds.js';

export const appearance = {
  id: 'appearance',
  title: 'How Tagma looks',
  feeds: APPEARANCE_FEEDS,
} as const satisfies WireModule;
