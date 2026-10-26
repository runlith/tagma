import { randomUUID } from 'node:crypto';
import { Clock, Data, Duration, Effect, Queue, Schedule } from 'effect';
import type { CallAddress, CallRecord } from '@runlith/agent/callProgress';
import type { AgentCallEnding } from '@runlith/agent/contracts';
import { DETACHED_DETAIL } from '@runlith/agent/tool';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { owedCall } from '../store/calls.js';
import type { OwedCallRows, OwedEnding, OwedOutcome, OwedRow } from '../store/owedCalls.js';
import { CallEpoch, OwedCalls } from '../contract/service/owedCalls.js';
import { HarnessCalls } from '../contract/service/engine.js';
import type { CommandSignalSend } from './commandEndings.js';

const owing = writes('OwedCalls.write', [owedCall]);

const REDRIVE_ATTEMPTS = 3;
const REDRIVE_MS = 1_000;

class CallEndingUnreachable extends Data.TaggedError('CallEndingUnreachable') {}

export const INTERRUPTED_WORDS =
  "The call's ending was never recorded: the server stopped, or could not write it, before the call ended. Whether its effect happened is unknown — read what it acts on before repeating it.";

export const CUT_WORDS =
  'The call was cut before it answered: the server stopped, or what owned the call ended, while it ran. Whether its effect happened is unknown — read what it acts on before repeating it.';

export const UNSTARTED_WORDS =
  'The server stopped before the call started, so it did not run and changed nothing; any question it asked was withdrawn. Call it again if it is still wanted.';

const signalId = (address: CallAddress): string => `tool-result:${JSON.stringify([address.runId, address.toolCallId])}`;

const endedWords = (outcome: OwedOutcome): string =>
  outcome === 'completed' ? 'finished' : outcome === 'failed' ? 'failed' : outcome === 'stopped' ? 'was stopped' : 'was interrupted';

const noticeText = (row: OwedRow): string =>
  `${row.name} ${endedWords(row.outcome ?? 'interrupted')} in the background.\nCall: ${row.toolCallId}\nRun: ${row.runId}\n\n${row.words ?? INTERRUPTED_WORDS}`;

const noticeOf = (row: OwedRow): AgentCallEnding => ({
  kind: 'call-ending',
  runId: row.runId,
  toolCallId: row.toolCallId,
  tool: row.name,
  outcome: row.outcome ?? 'interrupted',
  threads: row.threads ?? [],
});

const recordOf = (row: OwedRow, epoch: string): CallRecord => ({
  runId: row.runId,
  toolCallId: row.toolCallId,
  threadId: row.threadId,
  name: row.name,
  input: row.input,
  phase: row.outcome ?? (row.epoch === epoch ? 'running' : 'interrupted'),
  mode: 'background',
  detachable: false,
  startedAt: row.openedAt.getTime(),
  admittedAt: null,
  endedAt: row.endedAt?.getTime() ?? null,
  expiresAt: null,
  expiresBy: null,
  limitCeilingMs: null,
  detail: row.outcome === 'interrupted' ? INTERRUPTED_WORDS : null,
  executions: [],
});

export const makeCallEndings = Effect.fnUntraced(function* ({
  rows,
  send,
  ended,
  withdraw,
}: {
  readonly rows: OwedCallRows;
  readonly send: CommandSignalSend;
  readonly ended: Queue.Queue<CallAddress>;
  readonly withdraw: (threadId: string, toolCallId: string, reason: string) => Effect.Effect<void, unknown>;
}) {
  const units = yield* MachineUnits;
  const calls = yield* HarnessCalls;
  const epoch = (yield* CallEpoch).id;

  const owe: OwedCalls['Service']['owe'] = (call) => {
    const threadId = call.threadId;
    if (threadId === null) return Effect.void;
    return units.write(owing, (unit) => rows.owe(unit, call, threadId, epoch));
  };

  const began: OwedCalls['Service']['began'] = (call) =>
    call.threadId === null ? Effect.void : units.write(owing, (unit) => rows.began(unit, call));

  const end: OwedCalls['Service']['end'] = (call, ending) => {
    const threadId = call.threadId;
    if (threadId === null) return Effect.void;
    const written =
      ending.outcome === 'elsewhere'
        ? units.write(owing, (unit) => Effect.as(rows.settle(unit, call), false))
        : units.write(owing, (unit) =>
            Effect.gen(function* () {
              const at = new Date(yield* Clock.currentTimeMillis);
              const owed: OwedEnding =
                ending.outcome === 'interrupted'
                  ? { outcome: ending.outcome, words: CUT_WORDS, endedAt: at, threads: null }
                  : { outcome: ending.outcome, words: ending.result, endedAt: at, threads: ending.threads ?? null };
              if (yield* rows.end(unit, call, owed)) return true;
              return yield* rows.ended(unit, {
                runId: call.runId,
                toolCallId: call.toolCallId,
                threadId,
                name: call.name,
                input: call.input ?? null,
                epoch,
                openedAt: new Date(call.startedAt),
                unstarted: null,
                ...owed,
              });
            }),
          );
    return written.pipe(
      Effect.retry({ times: REDRIVE_ATTEMPTS - 1, schedule: Schedule.spaced(Duration.millis(REDRIVE_MS)) }),
      Effect.flatMap((owed) => (owed ? Queue.offer(ended, { runId: call.runId, toolCallId: call.toolCallId }) : Effect.void)),
      Effect.asVoid,
    );
  };

  const deliver = Effect.fn('CallEndings.deliver')(
    function* (address: CallAddress) {
      const row = yield* units.read((unit) => rows.row(unit, address));
      if (row === null || row.outcome === null) return 'settled' as const;
      const sent = yield* send({
        threadId: row.threadId,
        id: signalId(address),
        text: noticeText(row),
        notice: noticeOf(row),
        condition: (unit) =>
          Effect.mapError(rows.settle(unit, address), (cause) => new ThreadStorageFailed({ call: 'OwedCalls.accepted', cause })),
      });
      if (sent._tag === 'Accepted' || sent._tag === 'Declined') return 'settled' as const;
      if (sent._tag === 'Unreachable') {
        yield* Effect.logWarning('a call ending could not be delivered; the obligation stands', {
          toolCallId: address.toolCallId,
          thread: row.threadId,
          reason: sent.reason,
        });
        return 'retry' as const;
      }
      yield* (sent._tag === 'Refused' ? Effect.logWarning : Effect.logInfo)(
        'a call ending is owed where nobody receives it; the obligation ends',
        {
          toolCallId: address.toolCallId,
          thread: row.threadId,
          answer: sent._tag,
          reason: sent._tag === 'Refused' ? sent.reason : undefined,
        },
      );
      yield* units
        .write(owing, (unit) => rows.settle(unit, address))
        .pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              Effect.logWarning('an undeliverable call ending could not be dropped; a boot walks it again', {
                toolCallId: address.toolCallId,
                reason: failure.message,
              }),
            onSuccess: () => Effect.void,
          }),
        );
      return 'settled' as const;
    },
    (work, address) =>
      work.pipe(
        Effect.matchEffect({
          onSuccess: Effect.succeed,
          onFailure: Effect.fnUntraced(function* (failure) {
            yield* Effect.logWarning('a call ending owed could not be read; the obligation stands', {
              toolCallId: address.toolCallId,
              reason: failure.message,
            });
            return 'kept' as const;
          }),
        }),
      ),
  );

  const drive = Effect.fn('CallEndings.drive')((address: CallAddress) =>
    deliver(address).pipe(
      Effect.flatMap((left) => (left === 'retry' ? new CallEndingUnreachable() : Effect.void)),
      Effect.retry({ times: REDRIVE_ATTEMPTS - 1, schedule: Schedule.spaced(Duration.millis(REDRIVE_MS)) }),
      Effect.catchTag('CallEndingUnreachable', () =>
        Effect.logInfo('a call ending owed is still standing after this discharge; a boot walks it again', {
          runId: address.runId,
          toolCallId: address.toolCallId,
        }),
      ),
    ),
  );

  const owedCalls = OwedCalls.of({
    owe,
    began,
    end,

    detached: (call, work, stopped, ending) =>
      Effect.suspend(() => {
        const runId = call.runId ?? `door:${randomUUID()}`;
        const toolCallId = `door:${randomUUID()}`;
        const held = calls.open({
          runId,
          toolCallId,
          name: call.name,
          input: call.input,
          threadId: call.threadId ?? undefined,
        });
        return held.run({
          work,
          background: () => ({ status: 'running', runId, toolCallId, tool: call.name, detail: DETACHED_DETAIL }),
          stopped: (reason) => Effect.succeed(stopped(reason)),
          completed: (exit) => end(held.record, ending(exit, held.record.phase === 'stopping')).pipe(Effect.orDie),
          owe: () => owe(held.record),
          detached: true,
        });
      }),

    take: (address, threadId) =>
      units.write(owing, (unit) =>
        Effect.gen(function* () {
          const row = yield* rows.row(unit, address);
          if (row === null || row.threadId !== threadId) return { status: 'none' } as const;
          if (row.outcome === null) return { status: 'running' } as const;
          yield* rows.settle(unit, address);
          return { status: 'ended', outcome: row.outcome, words: row.words ?? INTERRUPTED_WORDS } as const;
        }),
      ),

    owed: (scope) => units.read((unit) => Effect.map(rows.of(unit, scope), (found) => found.map((row) => recordOf(row, epoch)))),
  });

  return {
    ...owedCalls,
    epoch,

    attend: (): Effect.Effect<never> => Effect.forever(Effect.flatMap(Queue.take(ended), (address) => drive(address))),

    resume: Effect.fn('CallEndings.resume')(
      function* () {
        const at = new Date(yield* Clock.currentTimeMillis);
        const begun = yield* units.write(owing, (unit) => rows.orphaned(unit, epoch, at, INTERRUPTED_WORDS));
        if (begun > 0) yield* Effect.logInfo('calls a previous process left without an ending were settled interrupted', { calls: begun });
        yield* Effect.forEach(
          yield* units.read((unit) => rows.unstarted(unit, epoch)),
          (row) =>
            withdraw(row.threadId, row.toolCallId, UNSTARTED_WORDS).pipe(
              Effect.andThen(units.write(owing, (unit) => rows.interrupt(unit, row, UNSTARTED_WORDS, at))),
              Effect.matchEffect({
                onFailure: (failure) =>
                  Effect.logWarning('a call that never started stays owed: its question could not be withdrawn; a boot walks it again', {
                    toolCallId: row.toolCallId,
                    thread: row.threadId,
                    reason: String(failure),
                  }),
                onSuccess: () => Effect.void,
              }),
            ),
          { discard: true },
        );
        const due = (yield* units.read((unit) => rows.of(unit, {}))).filter((row) => row.outcome !== null);
        yield* Effect.forEach(due, (row) => drive(row), { discard: true });
        return due.length;
      },
      Effect.matchEffect({
        onSuccess: Effect.succeed,
        onFailure: Effect.fnUntraced(function* (failure) {
          yield* Effect.logWarning('the calls still owed could not be resumed; they are walked at the next boot', {
            reason: failure.message,
          });
          return 0;
        }),
      }),
    ),
  };
});
