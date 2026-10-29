import { Effect, Stream } from 'effect';
import { refusingStream } from '../platform/contract/service/body.js';
import type { Marketplaces } from './contract/service/marketplaces.js';

export const marketplaceChannels = (marketplaces: Marketplaces['Service']) => ({
  'marketplaces.subscribe': () =>
    refusingStream(
      Stream.mapEffect(marketplaces.changes, () => Effect.all({ marketplaces: marketplaces.rows(), entries: marketplaces.entries(null) })),
    ),
});
