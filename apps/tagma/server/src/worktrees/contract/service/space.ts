import { Context, type Stream } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { SpaceScanEvent } from '../wire/space.js';
import type { WorktreeRowRefusal } from './listing.js';

export class PlaceSpace extends Context.Service<
  PlaceSpace,
  {
    scan(projectId: number, rootId: RootId): Stream.Stream<SpaceScanEvent, GateRefusal<WorktreeRowRefusal | 'not-found'>>;
  }
>()('tagma/worktrees/PlaceSpace') {}
