import { Effect } from 'effect';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { body, pair } from '../../platform/contract/service/body.js';
import type { ProjectCaller } from '../../projects/contract/wire/project.js';
import { type WorktreeActFailure, Worktrees, type WorktreeCaller } from '../contract/service/creation.js';
import { worktreeRefusal } from '../contract/service/refusals.js';
import { admitted } from '../../platform/contract/service/routed.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { CREATION_OPERATIONS } from '../contract/wire/operations/creation.js';

const worktreeCaller = (call: ProjectCaller): WorktreeCaller => ({ projectId: call.project.id });

type Declared = typeof CREATION_OPERATIONS;

const creating =
  <K extends keyof Declared>(id: K) =>
  <A, R>(work: Effect.Effect<A, WorktreeActFailure, R>) =>
    admitted(CREATION_OPERATIONS[id])(Effect.mapError(work, (failure): GateRefusal => worktreeRefusal(failure)));

const OPS = CREATION_OPERATIONS;

export const CREATION_PAIRS = {
  prepare_worktree: pair(
    OPS.prepare_worktree,
    body(OPS.prepare_worktree, {
      prepare: () => Effect.map(Effect.flatten(CurrentProject), (call) => call.project),
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const worktrees = yield* Worktrees;
        const prepared = yield* creating('prepare_worktree')(
          worktrees.prepare(worktreeCaller(call), {
            operationId: input.operationId,
            repository: input.repository,
            destination: input.destination,
            mode: input.mode,
          }),
        );
        return { status: 'ok' as const, ...prepared };
      }),
    }),
  ),

  create_worktree: pair(
    OPS.create_worktree,
    body(OPS.create_worktree, {
      prepare: Effect.fn('create_worktree.prepare')(function* (input) {
        const call = yield* yield* CurrentProject;
        const worktrees = yield* Worktrees;
        return yield* creating('create_worktree')(worktrees.read(worktreeCaller(call), input.operationId));
      }),
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const worktrees = yield* Worktrees;
        const opened = yield* creating('create_worktree')(worktrees.create(worktreeCaller(call), input.operationId));
        return { status: 'ok' as const, operation: opened };
      }),
    }),
  ),

  read_worktree_operation: pair(
    OPS.read_worktree_operation,
    body(OPS.read_worktree_operation, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const worktrees = yield* Worktrees;
        const opened = yield* creating('read_worktree_operation')(worktrees.read(worktreeCaller(call), input.operationId));
        return { status: 'ok' as const, operation: opened };
      }),
    }),
  ),

  prepare_worktree_recovery: pair(
    OPS.prepare_worktree_recovery,
    body(OPS.prepare_worktree_recovery, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const worktrees = yield* Worktrees;
        const recovery = yield* creating('prepare_worktree_recovery')(
          worktrees.prepareRecovery(worktreeCaller(call), input.operationId, input.observed),
        );
        return { status: 'ok' as const, ...recovery };
      }),
    }),
  ),

  reconcile_worktree: pair(
    OPS.reconcile_worktree,
    body(OPS.reconcile_worktree, {
      prepare: Effect.fn('reconcile_worktree.prepare')(function* (input) {
        const call = yield* yield* CurrentProject;
        const worktrees = yield* Worktrees;
        return yield* creating('reconcile_worktree')(worktrees.read(worktreeCaller(call), input.operationId));
      }),
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const worktrees = yield* Worktrees;
        const opened = yield* creating('reconcile_worktree')(worktrees.reconcile(worktreeCaller(call), input.operationId));
        return { status: 'ok' as const, operation: opened };
      }),
    }),
  ),

  adopt_worktree: pair(
    OPS.adopt_worktree,
    body(OPS.adopt_worktree, {
      prepare: Effect.fn('adopt_worktree.prepare')(function* (input) {
        const call = yield* yield* CurrentProject;
        const worktrees = yield* Worktrees;
        return yield* creating('adopt_worktree')(worktrees.read(worktreeCaller(call), input.operationId));
      }),
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const worktrees = yield* Worktrees;
        const opened = yield* creating('adopt_worktree')(
          worktrees.adopt(worktreeCaller(call), input.operationId, input.revision, input.observed),
        );
        return { status: 'ok' as const, operation: opened };
      }),
    }),
  ),

  abandon_worktree: pair(
    OPS.abandon_worktree,
    body(OPS.abandon_worktree, {
      prepare: Effect.fn('abandon_worktree.prepare')(function* (input) {
        const call = yield* yield* CurrentProject;
        const worktrees = yield* Worktrees;
        return yield* creating('abandon_worktree')(worktrees.read(worktreeCaller(call), input.operationId));
      }),
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const worktrees = yield* Worktrees;
        const opened = yield* creating('abandon_worktree')(
          worktrees.abandon(worktreeCaller(call), input.operationId, input.revision, input.reason),
        );
        return { status: 'ok' as const, operation: opened };
      }),
    }),
  ),
};
