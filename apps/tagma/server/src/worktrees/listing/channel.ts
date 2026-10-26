import { Effect, Stream } from 'effect';
import { refusing } from '../../platform/contract/service/body.js';
import type { RefusalBody } from '../../platform/contract/wire/refusal.js';
import type { WorktreeFeedEvent } from '../contract/wire/rows.js';
import type { SpaceScanAsk, SpaceScanEvent } from '../contract/wire/space.js';
import type { WorktreeRows } from '../contract/service/listing.js';
import type { PlaceSpace } from '../contract/service/space.js';

export const worktreeChannel = (listing: WorktreeRows['Service']) => ({
  'worktrees.subscribe': ({
    projectId,
    start,
    limit,
    places,
  }: {
    readonly projectId: number;
    readonly start: number;
    readonly limit: number;
    readonly places?: boolean;
  }): Stream.Stream<WorktreeFeedEvent, RefusalBody> =>
    Stream.catch(listing.subscribe(projectId, { start, limit, places }), (refusal) => Stream.fromEffect(refusing(Effect.fail(refusal)))),
});

export const spaceChannel = (space: PlaceSpace['Service']) => ({
  'space.scan': ({ projectId, rootId }: SpaceScanAsk): Stream.Stream<SpaceScanEvent, RefusalBody> =>
    Stream.catch(space.scan(projectId, rootId), (refusal) => Stream.fromEffect(refusing(Effect.fail(refusal)))),
});
