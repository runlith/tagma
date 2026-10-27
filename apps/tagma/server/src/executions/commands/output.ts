import { Effect, Exit } from 'effect';
import { TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES } from '@runlith/agent/ToolOutputSpool';
import { keptOutputLine, keptOutputOf, type KeptOutput } from '@runlith/agent-tools/CommandWork';
import { ByteOffset, offsetValue, byteOffset } from '@runlith/executions/protocol/record';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import { commandSignalId } from '../contract/wire/commands.js';
import type { CommandOutputReading, CommandReading } from '../contract/wire/commands.js';
import type { CommandOutputRequest, CommandReader, CommandWaiters } from '../contract/service/commands.js';
import type { ManagedCommands } from '../contract/service/commands.js';
import type { TerminalFailure, Terminals } from '../contract/service/terminals.js';
import { decodeUtf8, lastLines, readRange } from './outputTail.js';
import { OUTPUT_STREAMS, type OutputStream } from '../contract/wire/commands.js';

type Positions = Record<OutputStream, bigint>;

const REMEMBERED_READERS = 4_096;

export const makeCommandOutput = ({
  commands,
  reader,
  waiters,
  terminals,
}: {
  readonly commands: ManagedCommands['Service'];
  readonly reader: Pick<CommandReader['Service'], 'one'>;
  readonly waiters: CommandWaiters['Service'];
  readonly terminals: Terminals['Service'];
}) => {
  const positions = new Map<string, Positions>();

  const remember = (key: string, next: Positions): void => {
    positions.delete(key);
    positions.set(key, next);
    if (positions.size <= REMEMBERED_READERS) return;
    const oldest = positions.keys().next().value;
    if (oldest !== undefined) positions.delete(oldest);
  };

  const window = Effect.fn('CommandOutput.window')(function* (
    request: CommandOutputRequest,
    key: string,
    remembered: Positions | undefined,
  ): Effect.fn.Return<{ readonly output: string; readonly skipped: bigint; readonly whole: boolean }, TerminalFailure> {
    const { execution, authority } = request;
    const parts: string[] = [];
    const next: Positions = { stdout: 0n, stderr: 0n };
    let skipped = 0n;
    let whole = remembered === undefined;
    for (const stream of OUTPUT_STREAMS) {
      const bounds = yield* commands.bytes({ ref: execution, stream, offset: ByteOffset.make('0') }, 0, authority, {
        withPositions: true,
      });
      const retainedFrom = offsetValue(bounds.range.retainedFrom);
      const durable = offsetValue(bounds.range.durableThrough);
      const widest = BigInt(TOOL_OUTPUT_MAX_BYTES);
      const wanted = remembered?.[stream] ?? (durable > widest ? durable - widest : 0n);
      let from = wanted < retainedFrom ? retainedFrom : wanted;
      if (durable - from > widest) {
        skipped += durable - from - widest;
        from = durable - widest;
      }
      skipped += from > wanted ? from - wanted : 0n;
      if (from > 0n) whole = false;
      if (durable <= from) {
        next[stream] = durable;
        continue;
      }
      const bytes = yield* readRange(
        (cursor, limit) => commands.bytes(cursor, limit, authority),
        { ref: execution, stream, offset: byteOffset(from) },
        durable,
      );
      next[stream] = durable;
      const text = decodeUtf8(bytes);
      if (text !== '') parts.push(text);
    }
    remember(key, next);
    const joined = parts.join('\n');
    const output = lastLines(joined, request.tail ?? TOOL_OUTPUT_MAX_LINES);
    return { output, skipped, whole: whole && output === joined };
  });

  const kept = Effect.fn('CommandOutput.kept')(function* (execution: ExecutionRef): Effect.fn.Return<KeptOutput> {
    const read = yield* Effect.result(terminals.state(execution));
    if (read._tag === 'Success') return read.success === undefined ? { _tag: 'Empty' } : keptOutputOf(read.success);
    return { _tag: 'Unkept', reason: `the state of the command could not be read: ${read.failure._tag}` };
  });

  const take = Effect.fn('CommandOutput.take')(function* (execution: ExecutionRef, thread: ThreadId) {
    const taken = yield* Effect.result(waiters.take(execution, thread));
    if (taken._tag === 'Success') return taken.success;
    yield* Effect.logWarning('an ending its thread is reading could not be taken from its notice; the notice stays owed', {
      execution: execution.execution,
      reason: taken.failure._tag,
    });
    return false;
  });

  const seen = Effect.fn('CommandOutput.seen')(function* (execution: ExecutionRef, thread: ThreadId, signalId: string) {
    const answered = yield* Effect.result(waiters.seen(execution, thread, signalId));
    if (answered._tag === 'Failure') {
      yield* Effect.logWarning('an ending its thread has read could not be discharged; its notice may still reach the thread', {
        execution: execution.execution,
        reason: answered.failure._tag,
      });
    }
  });

  const unread = Effect.fn('CommandOutput.unread')(function* (execution: ExecutionRef) {
    const released = yield* Effect.result(waiters.unread(execution));
    if (released._tag === 'Failure') {
      yield* Effect.logWarning('an ending its thread failed to read could not be handed back to its notice; the next boot sends it', {
        execution: execution.execution,
        reason: released.failure._tag,
      });
    }
  });

  return {
    output: Effect.fn('CommandReader.output')(function* (
      request: CommandOutputRequest,
    ): Effect.fn.Return<CommandOutputReading, TerminalFailure> {
      const { execution } = request;
      const key = `${request.reader}|${execution.installation}|${execution.execution}:${execution.incarnation}`;
      const remembered = positions.get(key);
      const reading = yield* reader.one(request.projectId, execution.execution, execution.incarnation);
      const status = statusOf(reading);
      const origin = reading.command.origin;
      const own = origin._tag === 'Thread' && origin.thread === request.thread ? origin : undefined;
      const measured = status.phase === 'ended' ? yield* waiters.measurement(execution) : null;
      const owner = status.phase === 'ended' && measured !== null ? own : undefined;
      const evicted =
        status.phase === 'ended' &&
        reading.live._tag !== 'Unheld' &&
        reading.live._tag !== 'Unavailable' &&
        reading.live.entry.ending?.retention === 'lost';
      const shown = evicted ? Effect.succeed({ output: '', skipped: 0n, whole: true }) : window(request, key, remembered);
      const { output, skipped, whole } = yield* owner === undefined
        ? shown
        : Effect.acquireUseRelease(
            take(execution, owner.thread),
            () => shown,
            (taken, exit) =>
              Exit.isSuccess(exit)
                ? seen(execution, owner.thread, commandSignalId(reading.command.execution, owner.toolCall))
                : taken
                  ? unread(execution)
                  : Effect.void,
          );
      const standing = status.phase === 'ended' && !evicted ? yield* kept(execution) : undefined;
      const said = standing === undefined || keptOutputLine(standing, whole) === null ? undefined : standing;
      return {
        execution,
        label: reading.command.label,
        commandLine: reading.command.commandLine,
        ...status,
        output,
        skippedBytes: Number(skipped),
        first: remembered === undefined,
        evicted: evicted ? true : undefined,
        outputFile: said?._tag === 'Kept' ? said.file : undefined,
        outputUnkept: said?._tag === 'Unkept' ? said.reason : undefined,
        measurement: typeof measured === 'string' && measured !== '' ? measured : undefined,
      };
    }),
  };
};

export const statusOf = (reading: CommandReading): Pick<CommandOutputReading, 'phase' | 'exit' | 'elapsedMs'> => {
  const live = reading.live;
  if (live._tag === 'Unheld') return { phase: 'unheld', exit: undefined, elapsedMs: undefined };
  if (live._tag === 'Unavailable') return { phase: 'unavailable', exit: undefined, elapsedMs: undefined };
  const { state, deadline, ending } = live.entry;
  const phase = state.phase === 'ended' ? 'ended' : state.phase === 'reserved' || state.phase === 'queued' ? 'queued' : 'running';
  return {
    phase,
    exit: ending?.nativeExit ?? state.nativeExit,
    elapsedMs: deadline.elapsedMs,
  };
};
