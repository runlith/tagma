import { Context, type Effect } from 'effect';
import type { sweepProse } from '@runlith/agent-tools/sweepProse';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export type StrippedPath = { readonly path: string; readonly dropped: number };
export type UnlexablePath = { readonly path: string; readonly reason: string };
export type HeldPath = { readonly path: string; readonly holders: readonly string[] };

export type CommentSweep = {
  readonly path: string;
  readonly read: number;
  readonly dropped: number;
  readonly stripped: readonly StrippedPath[];
  readonly unrecorded: readonly StrippedPath[];
  readonly unlexable: readonly UnlexablePath[];
  readonly exempt: readonly string[];
  readonly linesHeld: readonly HeldPath[];
};

export type StripCommentsRequest = {
  readonly projectId: number;
  readonly threadId: string;
  readonly root: string;
  readonly checkout: string | null;
  readonly path: string;
};

export type StripCommentsRefusal = 'path-outside-tree' | 'repository-unread' | 'record-unread';
type ProseFailure = ReturnType<typeof sweepProse> extends Effect.Effect<unknown, infer Failure> ? Failure : never;
export type StripCommentsFailure = GateRefusal<StripCommentsRefusal> | ProseFailure | StoreFailure;

export class StripComments extends Context.Service<
  StripComments,
  {
    strip(request: StripCommentsRequest): Effect.Effect<CommentSweep, StripCommentsFailure>;
  }
>()('tagma/change-record/StripComments') {}
