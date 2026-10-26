import { Schema } from 'effect';
import type { MergeCheck, WorktreeElsewhere, WorktreeFact, WorktreeRow } from '../contract/wire/rows.js';
import type { TreeMetadata } from './metadata.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';

export type StateQuestion = {
  readonly rootId: RootId;
  readonly path: string;
  readonly metadata: TreeMetadata;
  readonly tip: string | null;
  readonly tipTime: number | null;
  readonly mode: 'page' | 'watched' | 'fresh';
  readonly queued?: () => void;
};

export const Reading = Schema.Struct({
  head: Schema.NullOr(Schema.String),
  ref: Schema.NullOr(Schema.String),
  repository: Schema.Boolean,
  stale: Schema.Boolean,
  uncommitted: Schema.Int,
  diff: Schema.NullOr(Schema.Struct({ files: Schema.Int, added: Schema.Int, removed: Schema.Int })),
});
export type Reading = typeof Reading.Type;

export const StateSnapshot = Schema.Struct({
  read: Reading,
  indexStamp: Schema.String,
  base: Schema.NullOr(Schema.String),
  baseTime: Schema.NullOr(Schema.Number),
  takenAt: Schema.Number,
  ahead: Schema.NullOr(Schema.Int),
  behind: Schema.NullOr(Schema.Int),
});
export type StateSnapshot = typeof StateSnapshot.Type;

export const UNTAKEN: WorktreeFact = { state: 'untaken', head: null, base: null, baseTime: null, takenAt: null };

export type Sight = {
  readonly seen: boolean;
  readonly present: boolean;
  readonly gone: boolean;
  readonly read: Reading | null;
  readonly metadata?: TreeMetadata;
  readonly fact?: WorktreeFact;
};

export type Distance = {
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly check: MergeCheck;
  readonly held: boolean;
  readonly fact?: WorktreeFact;
};

export type Divergence = { readonly ahead: number; readonly behind: number };
export type Entry = { readonly row: WorktreeRow; readonly rank: number; readonly movedAt: number };
export type WorktreeEntries = { readonly entries: readonly Entry[]; readonly elsewhere: readonly WorktreeElsewhere[] };
