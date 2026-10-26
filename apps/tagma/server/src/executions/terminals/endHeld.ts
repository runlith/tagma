import { Effect } from 'effect';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { principalOf } from './principals.js';
import { type TerminalRecord } from '../contract/wire/terminals.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import type { TerminalDischarge } from '../contract/service/discharge.js';

export type LaunchedExecution = { readonly execution: string; readonly incarnation: number };

export type HeldThread = { readonly id: string; readonly launched: LaunchedExecution | null };

export type HeldExecutionRoads = {
  readonly heldBy: (threadIds: readonly ThreadId[]) => Effect.Effect<readonly TerminalRecord[], unknown>;
  readonly named: (launched: LaunchedExecution) => Effect.Effect<TerminalRecord | null, unknown>;
  readonly ended: (record: TerminalRecord) => Effect.Effect<TerminalDischarge, unknown>;
  readonly stop: (key: TerminalOperationKey, record: TerminalRecord) => Effect.Effect<unknown, unknown>;
};

const OPERATOR = principalOf({ _tag: 'Operator' });

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const unreadable = (what: string) => (cause: unknown) =>
  new GateRefusal('thread-executions-unreadable', `What ${what} stands over could not be read before deleting it: ${describe(cause)}`, [
    'read this project\u2019s terminal inventory, then delete the thread again',
  ]);

export const endHeldExecutions = (deps: HeldExecutionRoads) =>
  Effect.fnUntraced(function* (threads: readonly HeldThread[], act: string) {
    const held = yield* deps
      .heldBy(threads.map((thread) => ThreadId.make(thread.id)))
      .pipe(Effect.mapError(unreadable(threads.length === 1 ? `thread ${threads[0]?.id}` : `${threads.length} threads`)));
    const ending = held.map((record) => ({ threadId: record.heldBy as string, record }));
    for (const thread of threads) {
      if (thread.launched === null) continue;
      const named = yield* deps.named(thread.launched).pipe(Effect.mapError(unreadable(`thread ${thread.id}`)));
      if (named !== null) ending.push({ threadId: thread.id, record: named });
    }
    const seen = new Set<string>();
    for (const { threadId, record } of ending) {
      const at = `${record.execution.execution}/${record.execution.incarnation}`;
      if (seen.has(at)) continue;
      seen.add(at);
      yield* end(deps, threadId, act, record);
    }
  });

const end = Effect.fnUntraced(function* (deps: HeldExecutionRoads, threadId: string, act: string, record: TerminalRecord) {
  const proof = yield* deps
    .ended(record)
    .pipe(
      Effect.mapError(
        (cause) =>
          new GateRefusal(
            'thread-executions-unreadable',
            `The ending of execution ${record.execution.execution} could not be read before deleting thread ${threadId}: ${describe(cause)}`,
            ['read this project’s terminal inventory, then delete the thread again'],
          ),
      ),
    );
  if (proof._tag === 'Discharged') return;
  const key: TerminalOperationKey = {
    projectId: record.projectId,
    operationId: HostRequestKey.make(`thread-delete-held:${threadId}:${act}:${record.execution.execution}`),
    requester: OPERATOR,
    mutation: 'stop',
    targetKey: record.targetKey,
    execution: record.execution,
  };
  yield* deps
    .stop(key, record)
    .pipe(
      Effect.mapError(
        (cause) =>
          new GateRefusal(
            'thread-execution-standing',
            `Thread ${threadId} stands over execution ${record.execution.execution} (${record.program ?? 'unknown program'}), and ending it failed: ${describe(cause)}`,
            ['stop that execution from Processes, then delete the thread again', `read terminal operation ${key.operationId}`],
          ),
      ),
    );
});
