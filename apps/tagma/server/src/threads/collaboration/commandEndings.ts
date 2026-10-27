import { Duration, Effect, Queue, Schedule } from 'effect';
import type { AgentCommandEnding, AgentSignalNotice } from '@runlith/agent/contracts';
import { type ThreadPortFailure } from '@runlith/agent/thread/ThreadBorder';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { cleanupWords, keptOutputLine, keptOutputOf, lifeEnded, type CommandLimit } from '@runlith/agent-tools/CommandWork';
import type { CommandDelivery as CommandDeliveryObligation, CommandRecord } from '../../executions/contract/wire/commands.js';
import { copyHead } from '../../executions/commands/ruleResolution.js';
import { lastLines, recordTail } from '../../executions/commands/outputTail.js';
import { CommandWaiters, type CommandDeliveryCursor } from '../../executions/contract/service/commands.js';
import { executionHandshakeMs } from '../../executions/contract/wire/terminalBehavior.js';
import { ExecutionRecords } from '../../executions/contract/service/records.js';
import { ManagedCommands } from '../../executions/contract/service/commands.js';
import { Terminals } from '../../executions/contract/service/terminals.js';

export type CommandSignalOutcome =
  | { readonly _tag: 'Accepted' }
  | { readonly _tag: 'NoThread' }
  | { readonly _tag: 'Refused'; readonly reason: string }
  | { readonly _tag: 'Unreachable'; readonly reason: string }
  | { readonly _tag: 'Declined' };

export type CommandSignalSend = (input: {
  readonly threadId: string;
  readonly id: string;
  readonly text: string;
  readonly notice?: AgentSignalNotice;
  readonly condition?: (unit: WriteUnit<'machine'>) => Effect.Effect<boolean, ThreadPortFailure>;
}) => Effect.Effect<CommandSignalOutcome>;

const READ_MS = 1_000;

export type CommandDeliveryAttempt = { readonly _tag: 'Settled' } | { readonly _tag: 'Kept'; readonly retryable: boolean };

const REDRIVE_ATTEMPTS = 3;

export type CommandDelivery = Effect.Success<ReturnType<typeof makeCommandDelivery>>;

type EndingMessage = { readonly text: string; readonly notice: AgentCommandEnding };

export const makeCommandDelivery = Effect.fnUntraced(function* ({ send }: { readonly send: CommandSignalSend }) {
  const waiters = yield* CommandWaiters;
  const terminals = yield* Terminals;
  const commands = yield* ManagedCommands;
  const records = yield* ExecutionRecords;
  const ended = waiters.ended;
  const attend: () => Effect.Effect<never> = () => Effect.forever(Effect.flatMap(Queue.take(ended), (execution) => drive(execution)));

  const drive = Effect.fn('CommandDelivery.drive')(function* (execution: ExecutionRef): Effect.fn.Return<void, never> {
    const left = yield* deliver(execution).pipe(
      Effect.repeat({
        times: REDRIVE_ATTEMPTS - 1,
        schedule: Schedule.spaced(Duration.millis(executionHandshakeMs)),
        while: (attempt) => attempt._tag === 'Kept' && attempt.retryable,
      }),
    );
    if (left._tag === 'Kept' && left.retryable) {
      yield* Effect.logInfo('an ending owed is still standing after this discharge; a boot walks it again', {
        execution: execution.execution,
        attempts: REDRIVE_ATTEMPTS,
      });
    }
  });

  const resume: () => Effect.Effect<number, never> = Effect.fn('CommandDelivery.resume')(function* () {
    let after: CommandDeliveryCursor | undefined;
    let seen = 0;
    for (;;) {
      const page = yield* Effect.result(waiters.outstanding(after));
      if (page._tag === 'Failure') {
        yield* Effect.logWarning('the endings still owed could not be read, so none is resumed', {
          reason: page.failure._tag,
        });
        return seen;
      }
      const owed = page.success;
      if (owed.length === 0) return seen;
      seen += owed.length;
      yield* Effect.forEach(owed, (obligation) => deliver(obligation.execution), { discard: true });
      const last = owed[owed.length - 1]!;
      after = { openedAt: last.openedAt, execution: last.execution.execution };
    }
  });

  const deliver: (execution: ExecutionRef) => Effect.Effect<CommandDeliveryAttempt> = Effect.fn('CommandDelivery.deliver')(function* (
    execution: ExecutionRef,
  ): Effect.fn.Return<CommandDeliveryAttempt, never> {
    const standing = yield* Effect.result(waiters.owed(execution));
    if (standing._tag === 'Failure') {
      yield* Effect.logWarning('an ending owed could not be read; the obligation stands', {
        execution: execution.execution,
        reason: standing.failure._tag,
      });
      return { _tag: 'Kept', retryable: false };
    }
    const obligation = standing.success;
    if (obligation === null) return { _tag: 'Settled' };
    const words = yield* endingWords(obligation);
    if (words === null) return { _tag: 'Kept', retryable: false };
    if (words === undefined) return { _tag: 'Kept', retryable: true };
    const sent = yield* send({
      threadId: obligation.thread,
      id: obligation.signalId,
      text: words.text,
      notice: words.notice,
      condition: (unit) =>
        Effect.mapError(waiters.accepted(unit, execution), (cause) => new ThreadStorageFailed({ call: 'CommandDelivery.accepted', cause })),
    });
    if (sent._tag === 'Declined') return { _tag: 'Settled' };
    if (sent._tag === 'Unreachable') {
      yield* Effect.logWarning('an ending could not be delivered; the obligation stands', {
        execution: execution.execution,
        thread: obligation.thread,
        reason: sent.reason,
      });
      return { _tag: 'Kept', retryable: true };
    }
    if (sent._tag === 'NoThread') {
      yield* Effect.logInfo('an ending is owed to a thread that no longer exists; its history stands', {
        execution: execution.execution,
        thread: obligation.thread,
      });
    }
    if (sent._tag === 'Refused') {
      yield* Effect.logWarning('an ending was refused where it is owed; the obligation ends with the reason', {
        execution: execution.execution,
        thread: obligation.thread,
        reason: sent.reason,
      });
    }
    const settled = yield* Effect.result(waiters.delivered(execution));
    if (settled._tag === 'Failure') {
      yield* Effect.logWarning('a delivered ending could not be recorded as delivered; it will be sent again', {
        execution: execution.execution,
        reason: settled.failure._tag,
      });
      return { _tag: 'Kept', retryable: false };
    }
    return { _tag: 'Settled' };
  });

  const endingWords = Effect.fn('CommandDelivery.words')(function* (
    obligation: CommandDeliveryObligation,
  ): Effect.fn.Return<EndingMessage | null | undefined, never> {
    if (obligation.text !== undefined) {
      const notice = endingNotice(obligation.execution, yield* commandRecord(obligation.execution), null, null);
      return { text: obligation.text, notice };
    }
    const read = yield* Effect.result(terminals.wait(obligation.execution, READ_MS));
    if (read._tag === 'Failure') {
      yield* Effect.logWarning('the ending of a command owed could not be read; the obligation stands', {
        execution: obligation.execution.execution,
        reason: read.failure._tag,
      });
      return null;
    }
    const answer = read.success;
    if (answer._tag === 'Undecided') return null;
    const measured = yield* Effect.result(waiters.measurement(obligation.execution));
    if (measured._tag === 'Failure') {
      yield* Effect.logWarning('the measurement of a command owed could not be read; the obligation stands', {
        execution: obligation.execution.execution,
        reason: measured.failure._tag,
      });
      return undefined;
    }
    if (measured.success === null) return null;
    const record = yield* commandRecord(obligation.execution);
    if (answer._tag !== 'Decided') {
      const notice = endingNotice(obligation.execution, record, null, null);
      return { text: unreadableText(notice, measured.success ?? ''), notice };
    }
    const decision = answer.summary.decision;
    const expired = decision?._tag === 'Cancelled' && decision.cause === 'timeout';
    const limit = expired ? yield* life(obligation.execution, record) : null;
    const printed = yield* tail(obligation.execution);
    const notice = endingNotice(obligation.execution, record, answer.summary, printed === null ? null : printed.text);
    return {
      notice,
      text: endingText(
        notice,
        limit,
        cleanupWords(answer.summary.state.cleanup),
        decision?._tag === 'Cancelled' ? `${decision.cause}: ${decision.trigger}` : null,
        measured.success ?? '',
        keptOutputLine(keptOutputOf(answer.summary), printed !== null && printed.whole),
      ),
    };
  });

  const life = Effect.fn('CommandDelivery.life')(function* (
    execution: ExecutionRef,
    record: CommandRecord | null,
  ): Effect.fn.Return<CommandLimit | null, never> {
    const read = yield* Effect.result(commands.deadline(execution));
    if (read._tag === 'Failure') {
      yield* Effect.logInfo('the life of an ended command could not be read for its ending notice', {
        execution: execution.execution,
        reason: read.failure._tag,
      });
      return null;
    }
    const deadline = read.success;
    if (deadline === null || deadline.executionMs === undefined) return null;
    const rule = deadline.origin === 'rule' ? record?.time?.rules[0] : undefined;
    return { ms: deadline.executionMs, origin: deadline.origin, rule: rule === undefined ? null : copyHead(rule, 'life') };
  });

  const commandRecord = Effect.fn('CommandDelivery.record')(function* (
    execution: ExecutionRef,
  ): Effect.fn.Return<CommandRecord | null, never> {
    const row = yield* Effect.result(commands.record(execution.execution, execution.incarnation));
    if (row._tag === 'Failure') {
      yield* Effect.logInfo('the record of an ended command could not be read for its ending notice', {
        execution: execution.execution,
        reason: row.failure._tag,
      });
      return null;
    }
    return row.success;
  });

  const tail = Effect.fn('CommandDelivery.tail')(function* (
    execution: ExecutionRef,
  ): Effect.fn.Return<{ readonly text: string; readonly whole: boolean } | null, never> {
    const read = yield* Effect.result(recordTail(records, execution, ENDING_TAIL_BYTES));
    if (read._tag === 'Failure') {
      yield* Effect.logInfo('the tail of an ended command could not be read for its ending notice', {
        execution: execution.execution,
        reason: read.failure._tag,
      });
      return null;
    }
    const text = lastLines(read.success.text, ENDING_TAIL_LINES);
    return { text, whole: !read.success.cut && text === read.success.text };
  });
  return { attend, resume, deliver };
});

const ENDING_TAIL_BYTES = 4 * 1024;
const ENDING_TAIL_LINES = 40;

const endingNotice = (
  execution: ExecutionRef,
  record: CommandRecord | null,
  summary: ExecutionSummary | null,
  tail: string | null,
): AgentCommandEnding => {
  const decision = summary?.decision;
  const exit = summary?.state.nativeExit;
  return {
    kind: 'command-ending',
    execution: execution.execution,
    incarnation: execution.incarnation,
    label: record?.label,
    command: record?.commandLine ?? null,
    ending:
      decision === undefined
        ? 'unknown'
        : decision._tag === 'Completed'
          ? 'completed'
          : decision._tag === 'Cancelled' && decision.cause === 'timeout'
            ? 'expired'
            : 'stopped',
    exit: exit === undefined ? null : exit._tag === 'Code' ? { kind: 'code', code: exit.code } : { kind: 'signal', signal: exit.signal },
    tail,
  };
};

const endingText = (
  notice: AgentCommandEnding,
  life: CommandLimit | null,
  cleanup: string | null,
  stopped: string | null,
  measured: string,
  kept: string | null,
): string => {
  const where = `${notice.execution}:${notice.incarnation}`;
  const named = notice.command ?? notice.label ?? null;
  const ending =
    notice.ending === 'unknown'
      ? 'ended, and this installation holds no decision for it'
      : notice.ending === 'completed'
        ? 'completed'
        : notice.ending === 'expired'
          ? 'its life ran out'
          : `ended by its execution owner — ${stopped}`;
  const exit = notice.exit;
  const reported = exit === null ? 'no exit was reported' : exit.kind === 'code' ? `exit ${exit.code}` : `killed by ${exit.signal}`;
  const tail = notice.tail;
  return [
    `A command you left running has ended: ${ending}, ${reported}${named === null ? '' : ` — ${named}`}.`,
    ...(life === null ? [] : [lifeEnded(life)]),
    ...(cleanup === null ? [] : [cleanup]),
    ``,
    ...(tail === null ? ['(its output could not be read)'] : tail === '' ? ['(no output)'] : [tail]),
    ``,
    ...(measured === '' ? [] : [measured, ``]),
    ...(kept === null ? [] : [kept]),
    `execution: ${where} — read_output reads the rest of what it printed.`,
  ].join('\n');
};

const unreadableText = (notice: AgentCommandEnding, measured: string): string =>
  [
    `A command you left running is over, and how it ended can no longer be read here.`,
    ``,
    ...(measured === '' ? [] : [measured, ``]),
    `execution: ${notice.execution}:${notice.incarnation}`,
    `This installation holds no ending for that reference: whether it finished, and with what, is not known — and it was not run again to find out.`,
  ].join('\n');
