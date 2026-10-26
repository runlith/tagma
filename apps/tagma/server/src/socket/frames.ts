import { Context, Effect } from 'effect';
import type { FeedPlace } from '../platform/contract/wire/operation.js';

export const SentFrames = Context.Reference<(place: FeedPlace, remote: boolean, at: number) => Effect.Effect<void>>(
  'tagma/socket/SentFrames',
  { defaultValue: () => () => Effect.void },
);
