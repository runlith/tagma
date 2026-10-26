import { Context, type Effect } from 'effect';
import type { ThreadResourceKind } from '@runlith/agent/resources/ResourcesConfig';
import type { Unit } from '../../../platform/contract/service/units.js';
import type { RolloutPart, RolloutParts } from '../../journal/rolloutMeta.js';
import type { HarnessFailure } from './failure.js';
import type { ThreadHeld } from '../../../change-record/contract/wire/holdings.js';
import type { ThreadMetadataReads } from './rows.js';

export class NativeRolloutPart extends Context.Service<NativeRolloutPart, RolloutParts['native']>()('tagma/threads/NativeRolloutPart') {}

export class ExternalRolloutPart extends Context.Service<ExternalRolloutPart, RolloutPart>()('tagma/threads/ExternalRolloutPart') {}

export class NativeResourceKinds extends Context.Service<NativeResourceKinds, readonly ThreadResourceKind<Unit<'machine'>>[]>()(
  'tagma/threads/NativeResourceKinds',
) {}

export class ThreadMetadataSource extends Context.Service<ThreadMetadataSource, ThreadMetadataReads>()(
  'tagma/threads/ThreadMetadataSource',
) {}

export class HeldPathCounts extends Context.Service<
  HeldPathCounts,
  {
    readonly counts: (threadIds: readonly string[]) => Effect.Effect<ReadonlyMap<string, ThreadHeld>, HarnessFailure>;
    readonly moved: (threadIds: readonly string[]) => Effect.Effect<ReadonlyMap<string, ThreadHeld>, HarnessFailure>;
  }
>()('tagma/threads/HeldPathCounts') {}

export class ThreadFilesPlace extends Context.Service<
  ThreadFilesPlace,
  {
    readonly attachments: string;
    readonly scratch?: string;
  }
>()('tagma/threads/ThreadFilesPlace') {}
