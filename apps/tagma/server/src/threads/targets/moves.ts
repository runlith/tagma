import { Context, Effect } from 'effect';
import { threadCauseOf } from '@runlith/agent/thread/ThreadBorder';
import { servedAgentOf } from '@runlith/agent/thread/rows';
import { OPERATOR_PRINCIPAL, type Actor } from '../../platform/contract/wire/actor.js';
import type { AssignmentActor, SelectionRevision } from '../../workspace/contract/wire/assignments.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { harnessSessionActive } from '../contract/wire/harness/session.js';
import { ThreadTargetOperationKey, type ThreadTargetChange } from '../contract/wire/target.js';
import type { WorkspaceGeneration } from '../../workspace/contract/wire/ids.js';
import { ThreadLookup } from '../contract/service/reads.js';
import { NEW_WORKTREE, Placing } from '../birth/placement.js';
import { ThreadList } from '../contract/service/list.js';
import { ThreadHarness } from '../contract/service/engine.js';
import type { ThreadTargets } from './decide.js';
import { NoteWriting } from '../journal/worktreeNotes.js';
import { Worlds } from '../../executions/contract/service/worlds.js';

export type ThreadMove = {
  readonly threadId: string;
  readonly worktree: string;
  readonly operationKey?: string;
  readonly expectedSelectionRevision?: SelectionRevision;
  readonly expectedGeneration?: WorkspaceGeneration;
  readonly reach?: 'consented';
};

const assigning = (actor: Actor): Effect.Effect<AssignmentActor, GateRefusal> => {
  if (actor.kind === 'operator') return Effect.succeed({ kind: 'operator' });
  if (actor.kind === 'thread') return Effect.succeed({ kind: 'thread', threadId: ThreadId.make(actor.threadId) });
  return Effect.fail(
    new GateRefusal('denied', 'A session Tagma does not run carries no thread to move from and no operator word.', [
      'move the thread from the Tagma app, or from a thread of this project',
    ]),
  );
};

export const makeThreadMover = Effect.fnUntraced(function* ({ targets }: { readonly targets: ThreadTargets }) {
  const placement = yield* Placing;
  const threads = yield* ThreadLookup;
  const harness = yield* ThreadHarness;
  const worlds = yield* Worlds;
  const list = yield* ThreadList;
  const notes = yield* NoteWriting;
  const move: (
    projectId: number,
    actor: Actor,
    move: ThreadMove,
  ) => Effect.Effect<ThreadTargetChange & { readonly threadId: string }, GateRefusal> = Effect.fn('ThreadMover.move')(function* (
    projectId: number,
    actor: Actor,
    move: ThreadMove,
  ) {
    if (move.worktree === NEW_WORKTREE) {
      return yield* new GateRefusal('worktree-unknown', 'A move enters a worktree that stands; `new` is not one.', [
        'make it first: prepare_worktree, then create_worktree',
        'list_worktrees — the worktrees this thread can move into',
      ]);
    }
    const mover: AssignmentActor = move.reach === 'consented' ? { kind: 'operator' } : yield* assigning(actor);
    const row = yield* threads
      .find(move.threadId, OPERATOR_PRINCIPAL)
      .pipe(
        Effect.mapError(
          (failure) =>
            new GateRefusal(
              'target-placement-unreadable',
              `Thread ${move.threadId} could not be read: ${String('message' in failure ? failure.message : failure)}`,
              ['read the thread again, and move it once storage answers'],
            ),
        ),
      );
    if (row === undefined || row.projectId !== projectId) {
      return yield* new GateRefusal('not-found', `This project holds no thread ${move.threadId}.`, [
        'list_threads — the threads this project holds',
      ]);
    }
    const session = row.harness?.session;
    if (servedAgentOf(row) === null && session !== undefined && harnessSessionActive(session)) {
      const going = yield* harness.reads.snapshot(move.threadId).pipe(
        Effect.map((state) => state.activeRun !== null),
        Effect.mapError(
          (failure) =>
            new GateRefusal('target-placement-unreadable', `Thread ${move.threadId} could not be read: ${failure.message}`, [
              'read the thread again, and move it once storage answers',
            ]),
        ),
      );
      if (going) {
        return yield* new GateRefusal(
          'harness-pinned',
          `Thread ${move.threadId} has a turn going in a CLI session whose working directory was fixed when it launched; a move would not reach it.`,
          ['stop its run (stop_run, or stop_agent for a child), then move it', 'start a thread of that harness in the worktree instead'],
        );
      }
      yield* harness.threads
        .handle(move.threadId, OPERATOR_PRINCIPAL)
        .release()
        .pipe(
          Effect.mapError((failure) => {
            const cause = threadCauseOf(failure);
            return cause instanceof GateRefusal
              ? cause
              : new GateRefusal('target-placement-unreadable', `Its CLI session could not be released: ${failure.message}`, [
                  'read the thread again, and move it once its session ended',
                ]);
          }),
        );
    }
    const root = yield* placement.resolve({
      projectId,
      worktree: move.worktree,
      from: move.threadId,
      operationId: `move:${move.threadId}`,
      name: move.worktree,
      agent: actor.kind !== 'operator',
      asked: false,
      guest: row.hostKind !== null,
    });
    const operationKey = ThreadTargetOperationKey.make(move.operationKey ?? `move-${crypto.randomUUID()}`);
    const changed = yield* targets
      .change(
        { projectId, actor: mover },
        {
          threadId: ThreadId.make(move.threadId),
          operationKey,
          root,
          expectedSelectionRevision: move.expectedSelectionRevision,
          expectedGeneration: move.expectedGeneration,
        },
        {
          kernel: { request: (_runId, ask) => harness.threads.handle(move.threadId, OPERATOR_PRINCIPAL).changeContext(ask) },
          acquire: (request) => worlds.of({ thread: row, at: request.at, root: request.root }),
        },
      )
      .pipe(
        Effect.mapError((failure) =>
          failure instanceof GateRefusal
            ? failure
            : new GateRefusal(
                'target-placement-unreadable',
                `The move could not be recorded: ${String('message' in failure ? failure.message : failure)}`,
                ['read the thread again, and move it once storage answers'],
              ),
        ),
      );
    if (changed.status === 'selected') {
      yield* notes.moved(move.threadId, root.rootId, changed.operationKey);
    }
    yield* list.announceThread(move.threadId);
    return { ...changed, threadId: move.threadId };
  });
  return ThreadMoves.of({ move });
});

export class ThreadMoves extends Context.Service<
  ThreadMoves,
  {
    move(projectId: number, actor: Actor, move: ThreadMove): Effect.Effect<ThreadTargetChange & { readonly threadId: string }, GateRefusal>;
  }
>()('tagma/threads/ThreadMoves') {}
