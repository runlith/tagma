import * as Schema from 'effect/Schema';
import { ComparedPath } from './checkout.js';
import { RootId } from './ids.js';

export const CommitReading = Schema.Struct({
  rootId: RootId,
  sha: Schema.NonEmptyString,
  parents: Schema.Array(Schema.NonEmptyString),
  author: Schema.String,
  date: Schema.NonEmptyString,
  subject: Schema.String,
  files: Schema.Array(ComparedPath),
  marks: Schema.Literals(['applied', 'unavailable', 'unrequested']),
  added: Schema.Int,
  removed: Schema.Int,
  changed: Schema.Int,
  shown: Schema.Number,
  total: Schema.Number,
  next: Schema.NullOr(Schema.String),
  complete: Schema.Boolean,
});
export type CommitReading = typeof CommitReading.Type;

export const HistoryCommit = Schema.Struct({
  sha: Schema.NonEmptyString,
  parents: Schema.Array(Schema.NonEmptyString),
  author: Schema.NonEmptyString,
  date: Schema.NonEmptyString,
  subject: Schema.String,
  graph: Schema.Boolean,
});
export type HistoryCommit = typeof HistoryCommit.Type;

export const PathHistory = Schema.Struct({
  rootId: RootId,
  path: Schema.NullOr(Schema.NonEmptyString),
  grep: Schema.NullOr(Schema.NonEmptyString),
  commits: Schema.Array(HistoryCommit),
  shown: Schema.Number,
  total: Schema.NullOr(Schema.Number),
  next: Schema.NullOr(Schema.String),
  complete: Schema.Boolean,
});
export type PathHistory = typeof PathHistory.Type;

export const COMMIT_ID = /^[0-9a-f]{7,64}$/u;

export const LocatedCommit = Schema.Struct({
  id: Schema.NonEmptyString,
  sha: Schema.NonEmptyString,
  subject: Schema.String,
  projectId: Schema.Int,
});
export type LocatedCommit = typeof LocatedCommit.Type;

export const UnreadProject = Schema.Struct({
  projectId: Schema.Int,
  reason: Schema.String,
});
export type UnreadProject = typeof UnreadProject.Type;

export const CommitLocations = Schema.Struct({
  commits: Schema.Array(LocatedCommit),
  unread: Schema.Array(UnreadProject),
});
export type CommitLocations = typeof CommitLocations.Type;
