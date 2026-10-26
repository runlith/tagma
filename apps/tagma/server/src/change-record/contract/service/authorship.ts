import { Context, Data, type Effect } from 'effect';
import type { GitAnswerInvalid, GitUnreadable } from '@runlith/git/repository';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { PathUnreadable } from '../../../workspace/contract/service/checkouts.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { RootResolutionFailure } from '../../../workspace/contract/wire/roots.js';
import type { AuthorshipSide, PathAuthorship } from '../wire/authorship.js';
import type { AuthorshipOpen } from '../wire/operations.js';

export class PathRefused extends Data.TaggedError('PathRefused')<{
  readonly path: string;
  readonly bytes: number;
  readonly reason: 'oversized';
}> {}

export type ReadingFailure = StoreFailure | RootResolutionFailure | GitUnreadable | GitAnswerInvalid | PathUnreadable | PathRefused;

export type AuthorshipReadRefusal =
  | 'path-outside-tree'
  | 'graph-path'
  | 'git-unreadable'
  | 'not-found'
  | 'stretch-gone'
  | 'context-too-wide'
  | 'side-with-commit'
  | 'record-unread';

export class Authorship extends Context.Service<
  Authorship,
  {
    readonly read: (
      rootId: RootId,
      path: string,
      context?: number,
      open?: readonly AuthorshipOpen[],
      commit?: string,
      since?: string,
      side?: AuthorshipSide,
    ) => Effect.Effect<PathAuthorship, ReadingFailure | GateRefusal<AuthorshipReadRefusal>>;
  }
>()('tagma/change-record/Authorship') {}
