import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';
import { PLACE_REFUSALS } from '../../../workspace/contract/wire/refusals.js';

export const FolderEntry = Schema.Struct({
  name: Schema.NonEmptyString,
  kind: Schema.Literals(['file', 'directory']),
  bytes: Schema.Number,
  modifiedAt: Schema.Number,
});
export type FolderEntry = typeof FolderEntry.Type;

export const FolderFrame = Schema.Struct({
  directory: Schema.NonEmptyString,
  entries: Schema.Array(FolderEntry),
  total: Schema.Int,
});
export type FolderFrame = typeof FolderFrame.Type;

export const FOLDER_ROWS = 500;

export const SCRATCH_FEED = feed('scratch.subscribe', {
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    thread: Schema.NonEmptyString.annotate({ description: 'The thread whose scratch is listed.' }),
    path: Schema.optional(Schema.String.annotate({ description: "Folder relative to the thread's scratch; omitted: the scratch itself." })),
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: FOLDER_ROWS })),
  }),
  event: FolderFrame,
  refusals: [...PLACE_REFUSALS, 'path-outside-tree', 'files'],
  callers: 'operator',
  admission: 'project',
});
