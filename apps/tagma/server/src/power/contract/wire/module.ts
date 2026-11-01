import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { AWAKE_FEED, PACE_FEED } from './power.js';

export const power = {
  id: 'power',
  feeds: [AWAKE_FEED, PACE_FEED],
} as const satisfies WireModule;
