import { Effect } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { threadIdOf } from '../../platform/contract/wire/actor.js';
import { admitted } from '../../platform/contract/service/routed.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { RETIREMENT_OPERATIONS } from '../contract/wire/operations/retirement.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { WorktreeRetirement } from '../contract/service/retirement.js';
import type { FinishFailure } from '../contract/wire/failures.js';
import { finishingRefusal } from '../contract/service/refusals.js';

type Declared = typeof RETIREMENT_OPERATIONS;

export const finishing =
  <K extends keyof Declared>(id: K) =>
  <A, R>(work: Effect.Effect<A, FinishFailure, R>) =>
    admitted(RETIREMENT_OPERATIONS[id])(Effect.mapError(work, finishingRefusal));

export const finishingPlace = <K extends keyof Declared>(id: K, withBase: boolean) =>
  Effect.fn('worktree.finishingPlace')(function* (input: { readonly rootId: RootId }) {
    const call = yield* yield* CurrentProject;
    return yield* finishing(id)((yield* WorktreeRetirement).place(call.project.id, input.rootId, withBase));
  });

export const retiringTerms = <K extends keyof Declared>(id: K) =>
  Effect.fn('worktree.retiringTerms')(function* (input: { readonly rootId: RootId }, caller: Caller) {
    const call = yield* yield* CurrentProject;
    return yield* finishing(id)((yield* WorktreeRetirement).terms(call.project.id, input.rootId, threadIdOf(caller.actor)));
  });
