import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { COVERAGE_REFUSALS, REPOSITORY_REFUSALS, ROOT_REFUSALS } from '../../../workspace/contract/wire/refusals.js';

const Bytes = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const SpaceScanAsk = Schema.Struct({
  projectId: Schema.Int.check(Schema.isGreaterThan(0)),
  rootId: RootId,
});
export type SpaceScanAsk = typeof SpaceScanAsk.Type;

export const SpaceItem = Schema.Struct({
  name: Schema.NonEmptyString,
  kind: Schema.Literals(['directory', 'file', 'symlink']),
  bytes: Bytes,
  reclaimable: Bytes,
});
export type SpaceItem = typeof SpaceItem.Type;

export const SpaceScanEvent = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Progress'),
    entries: Bytes,
    bytes: Bytes,
  }),
  Schema.Struct({
    _tag: Schema.Literal('Scanned'),
    rootId: RootId,
    path: Schema.NonEmptyString,
    scannedAt: Schema.Number,
    entries: Bytes,
    bytes: Bytes,
    reclaimable: Bytes,
    items: Schema.Array(SpaceItem),
    unread: Bytes,
    ignored: Schema.optional(Schema.String),
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type SpaceScanEvent = typeof SpaceScanEvent.Type;

export const SPACE_SCAN_FEED = feed('space.scan', {
  input: SpaceScanAsk,
  event: SpaceScanEvent,
  refusals: ['not-found', 'worktree-unavailable', ...COVERAGE_REFUSALS, ...ROOT_REFUSALS, ...REPOSITORY_REFUSALS],
  callers: 'operator',
  admission: 'project',
  graph: 'none',
});
