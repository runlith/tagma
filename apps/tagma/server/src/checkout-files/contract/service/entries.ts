import { Context, type Effect } from 'effect';
import type { GateRefusal, GitRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ProjectRoot } from '../../../workspace/contract/wire/coverage.js';
import type { EntryKind, EntryMove } from '../wire/writes.js';

export type EntryRefusal =
  | 'path-outside-tree'
  | 'graph-path'
  | 'files'
  | 'record-unread'
  | 'file-write-failed'
  | 'target-exists'
  | 'source-moved'
  | 'same-path'
  | 'cross-device'
  | 'not-a-directory'
  | 'worker-unavailable'
  | GitRefusal;

export type Acted<A> = A & { readonly unconfirmed: string | null };

export class Entries extends Context.Service<
  Entries,
  {
    create(place: ProjectRoot, path: string, kind: EntryKind): Effect.Effect<Acted<{ readonly path: string }>, GateRefusal<EntryRefusal>>;
    move(
      place: ProjectRoot,
      pairs: readonly EntryMove[],
    ): Effect.Effect<Acted<{ readonly moved: readonly EntryMove[] }>, GateRefusal<EntryRefusal>>;
    trash(place: ProjectRoot, paths: readonly string[]): Effect.Effect<Acted<{ readonly trash: string }>, GateRefusal<EntryRefusal>>;
    restore(place: ProjectRoot, trash: string): Effect.Effect<Acted<{ readonly paths: readonly string[] }>, GateRefusal<EntryRefusal>>;
  }
>()('tagma/checkout-files/Entries') {}
