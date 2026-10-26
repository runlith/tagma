import { Schema } from 'effect';
import { placeRole } from '../../../platform/contract/wire/place.js';

export const RunSelection = Schema.Struct({
  threadId: Schema.NonEmptyString.annotate(placeRole('value')),
  runIds: Schema.Array(Schema.NonEmptyString),
});
export type RunSelection = typeof RunSelection.Type;

export const LineCounts = Schema.Struct({ added: Schema.Int, removed: Schema.Int });
export type LineCounts = typeof LineCounts.Type;

export const RunChange = Schema.Struct({
  id: Schema.String,
  runId: Schema.String,
  firstLine: Schema.NullOr(Schema.Int),
  lines: Schema.NullOr(Schema.Int),
  commit: Schema.NullOr(Schema.String),
  counts: Schema.Struct({ added: Schema.NullOr(Schema.Int), removed: Schema.NullOr(Schema.Int) }),
});
export type RunChange = typeof RunChange.Type;

export const RunFile = Schema.Struct({
  path: Schema.String,
  own: LineCounts,
  committed: Schema.Array(RunChange),
  held: Schema.Array(Schema.Struct({ threadId: Schema.String, agentName: Schema.NullOr(Schema.String), lines: LineCounts })),
  overwritten: Schema.Array(Schema.String),
  unproven: Schema.Array(Schema.String),
  atHead: Schema.Array(Schema.String),
  notRecreated: Schema.Array(Schema.String),
  unavailable: Schema.NullOr(Schema.Literals(['git-unreadable', 'path-unreadable', 'binary', 'root-unproven', 'path-refused'])),
});
export type RunFile = typeof RunFile.Type;

export type RunFilePage = {
  readonly files: readonly RunFile[];
  readonly total: number;
  readonly next: string | null;
  readonly unavailable: string | null;
};

export const RunFilesRead = Schema.Struct({
  root: Schema.NullOr(Schema.String),
  files: Schema.Array(RunFile),
  total: Schema.Int,
  next: Schema.NullOr(Schema.String),
  unavailable: Schema.NullOr(Schema.String),
});
export type RunFilesRead = typeof RunFilesRead.Type;

export const LinesReverted = Schema.Struct({
  reverted: Schema.Array(Schema.Struct({ path: Schema.String, changes: Schema.Array(Schema.String), lines: LineCounts })),
  skipped: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      changes: Schema.Array(Schema.String),
      reason: Schema.Literals(['committed', 'at-head', 'overwritten', 'unproven', 'moved', 'unrecorded', 'unreadable', 'deleted-file']),
    }),
  ),
});
export type LinesReverted = typeof LinesReverted.Type;
