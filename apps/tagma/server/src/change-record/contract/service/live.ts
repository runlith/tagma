import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { CheckoutPlaces } from '../../../workspace/contract/service/checkouts.js';
import type { HOLDINGS_FEED } from '../wire/holdings.js';
import type { THREAD_CHANGES_FEED } from '../wire/threadChanges.js';
import type { Holdings } from './holdings.js';
import type { ThreadChanges } from './threadChanges.js';
import type { ThreadRoots } from './threadRoots.js';

export type ChangesLive = LiveDeclaration<
  readonly [typeof HOLDINGS_FEED, typeof THREAD_CHANGES_FEED],
  CheckoutPlaces | Holdings | ThreadChanges | ThreadRoots
>;
