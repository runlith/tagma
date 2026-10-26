import type { Effect } from 'effect';
import type { ThreadMetadataRow } from '@runlith/agent/thread/rows';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { Unit } from '../../../platform/contract/service/units.js';

export type ThreadMetadataReads = {
  metadata(id: string, tx?: Unit<'machine'>): Effect.Effect<ThreadMetadataRow | undefined, ThreadStorageFailed>;
};
