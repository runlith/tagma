import { Cause, Effect } from 'effect';
import type { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { ThreadSignalConflictError } from '@runlith/agent/thread/run/scheduler/inputs';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { COMMAND_RESULT_SIGNAL } from '../../executions/contract/wire/commands.js';
import { TerminalUnavailable } from '../../executions/contract/wire/refusals.js';
import type { CallDebts, NoticeTakeBack } from '../../executions/contract/service/notices.js';
import { writes } from '../../platform/contract/service/writes.js';
import { owedCall } from '../store/calls.js';
import type { OwedCallRows } from '../store/owedCalls.js';
import type { CommandSignalSend } from './commandEndings.js';
import type { NativeThreadState } from '../contract/service/state.js';
import type { ThreadLookup } from '../contract/service/reads.js';

export type IdleDelivery = (threadId: string) => Effect.Effect<'wake' | 'wake-completed' | 'wait'>;

export const stayIdle: IdleDelivery = () => Effect.succeed('wait');

export const wakeUnlessStopped = (threads: ThreadLookup['Service']): IdleDelivery =>
  Effect.fnUntraced(
    function* (threadId) {
      const thread = yield* threads.summary(threadId);
      return thread === undefined || thread.archivedAt !== null ? ('wait' as const) : ('wake-completed' as const);
    },
    (work, threadId) =>
      Effect.catchCause(work, (cause) =>
        Effect.logWarning('whether a notice is owed to an archived thread could not be read; its run state alone decides the wake', {
          threadId,
          reason: Cause.pretty(cause).split('\n', 1)[0],
        }).pipe(Effect.as('wake-completed' as const)),
      ),
  );

export const callDebts = (owed: OwedCallRows): CallDebts => ({
  calls: writes('OwedCalls.carried', [owedCall]),
  release: (unit, debt) => owed.carried(unit, debt.thread, { runId: debt.run, toolCallId: debt.toolCall }),
});

export const commandNoticeTakeBack = (
  harness: AgentHarness<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>,
  owed: OwedCallRows,
): NoticeTakeBack['Service'] => ({
  ...callDebts(owed),
  retract: (thread, signalId, within) =>
    harness.threads
      .handle(thread, OPERATOR_PRINCIPAL)
      .retractSignal(signalId, (unit) =>
        Effect.mapError(within(unit), (cause) => new ThreadStorageFailed({ call: 'CommandNotice.discharge', cause })),
      )
      .pipe(
        Effect.asVoid,
        Effect.mapError((failure) => new TerminalUnavailable({ owner: 'store', message: failure.message })),
      ),
});

const conflicted = (failure: unknown): boolean =>
  failure instanceof ThreadSignalConflictError ||
  (failure instanceof ThreadCallBroke && failure.cause instanceof ThreadSignalConflictError);

export const commandSignalSend = (
  threads: ThreadLookup['Service'],
  harness: AgentHarness<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>,
  idle: IdleDelivery,
  type: string = COMMAND_RESULT_SIGNAL,
  archivedIsGone = false,
): CommandSignalSend =>
  Effect.fnUntraced(
    function* ({ threadId, id, text, notice, condition }) {
      const row = yield* threads.find(threadId, OPERATOR_PRINCIPAL);
      if (!row) return { _tag: 'NoThread' } as const;
      if (archivedIsGone && row.archivedAt != null) return { _tag: 'NoThread' } as const;
      const sent = yield* harness.threads
        .handle(threadId, OPERATOR_PRINCIPAL)
        .sendSignal({ id, type, addressee: 'transport', text, notice }, { ifActive: 'deliver', ifIdle: yield* idle(threadId), condition });
      return sent.status === 'declined' ? ({ _tag: 'Declined' } as const) : ({ _tag: 'Accepted' } as const);
    },
    Effect.catch((failure) =>
      Effect.succeed(
        conflicted(failure)
          ? ({ _tag: 'Refused', reason: `that delivery id already stands with other words: ${failure.message}` } as const)
          : ({ _tag: 'Unreachable', reason: failure.message } as const),
      ),
    ),
    Effect.catchCause((cause) =>
      Effect.succeed({ _tag: 'Unreachable', reason: Cause.pretty(cause).split('\n', 1)[0] ?? 'the signal failed' } as const),
    ),
  );
