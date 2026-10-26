import { Deferred, Effect, Stream } from 'effect';
import { HostRequestKey, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { frame, type Envelope } from '@runlith/ndjson-rpc/envelope';
import { ExchangeFailed, inbound, type ExchangeOversized, type Inbound } from '@runlith/ndjson-rpc/exchange';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { threadCallFailed, type HarnessFailure } from '../../threads/contract/service/failure.js';
import { TERMINAL_PERMISSION_REVISION } from '../../executions/contract/service/subjectPolicy.js';
import { OUTPUT_RETAINED_BYTES } from '../../executions/contract/wire/terminalBehavior.js';
import type { ExecutionRecords } from '../../executions/contract/service/records.js';
import type { TerminalStartReceipt, Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import { laneRefused, type HarnessLane, type HarnessLanes } from '../sessions/lanes.js';
import type { HarnessPlace } from '../sessions/launch.js';

const CHUNK_BYTES = 16 * 1024;
const PRESSURE_BEAT_MS = 100;
const PRESSURE_BEATS = 300;
const STDERR_TAIL_BYTES = 2 * 1024;
const SEAL = new Uint8Array([10]);

export type Written =
  | { readonly _tag: 'Admitted' }
  | { readonly _tag: 'Unwritten'; readonly reason: string; readonly poisoned: false }
  | { readonly _tag: 'Refused'; readonly reason: string; readonly poisoned: boolean }
  | { readonly _tag: 'Unknown'; readonly reason: string; readonly poisoned: boolean };

export type Transfer = Written | { readonly _tag: 'Untaken' };

type Landed =
  | { readonly _tag: 'Admitted' }
  | { readonly _tag: 'Cancelled' }
  | { readonly _tag: 'Spent'; readonly failure: HarnessFailure }
  | { readonly _tag: 'Refused' | 'Unknown'; readonly reason: string };

export type Read =
  | { readonly _tag: 'Frame'; readonly inbound: Inbound }
  | { readonly _tag: 'Oversized'; readonly start: bigint; readonly ceiling: number };

export type Ending = { reason: 'completed' | 'gap' | 'lost' | null; retainedFrom: bigint };

export const launchAgent = (
  terminals: Terminals['Service'],
  place: HarnessPlace,
  operation: string,
  argv: readonly [string, ...string[]],
): Effect.Effect<TerminalStartReceipt, HarnessFailure> =>
  Effect.scoped(
    terminals.start({
      actor: place.actor,
      operationId: HostRequestKey.make(operation),
      target: place.target,
      targetKey: place.targetKey,
      program: argv[0],
      args: argv.slice(1),
      transport: 'pipes',
      lifetime: 'held',
      purpose: 'command',
      launchedFor: place.launchedFor,
      environment: place.environment,
    }),
  ).pipe(Effect.mapError((cause) => threadCallFailed(cause)));

const writeChunk = Effect.fnUntraced(function* (
  writing: TerminalWriting['Service'],
  lane: HarnessLane,
  bytes: Uint8Array,
  interrupted: Deferred.Deferred<void> | null,
) {
  for (let beat = 0; beat < PRESSURE_BEATS; beat += 1) {
    if (interrupted !== null && (yield* Deferred.isDone(interrupted))) return { _tag: 'Cancelled' } as const;
    const at = lane.frontier();
    const answered = yield* Effect.result(
      writing.input(
        lane.execution,
        { binding: lane.binding, principal: lane.principal },
        {
          sequence: at,
          cause: 'raw',
          act: { _tag: 'Write', bytes },
        },
        TERMINAL_PERMISSION_REVISION,
      ),
    );
    if (answered._tag === 'Failure') {
      const failure = answered.failure;
      const spent = threadCallFailed(failure);
      if (laneRefused(spent)) return { _tag: 'Spent', failure: spent } as const;
      const unsent =
        failure._tag === 'TerminalRefused' ||
        failure._tag === 'HostRefused' ||
        ((failure._tag === 'WireLost' || failure._tag === 'WireUnavailable') && !failure.sent);
      if (unsent) return { _tag: 'Refused', reason: `the host refused the write: ${failure._tag}` } as const;
      lane.took(at);
      return { _tag: 'Unknown', reason: `the host answer to the write was lost: ${failure._tag}` } as const;
    }
    const outcome = answered.success;
    if (outcome._tag === 'InputAdmitted') {
      lane.took(at);
      return { _tag: 'Admitted' } as const;
    }
    if (outcome._tag === 'InputBackpressure') {
      yield* interrupted === null
        ? Effect.sleep(PRESSURE_BEAT_MS)
        : Effect.raceFirst(Effect.sleep(PRESSURE_BEAT_MS), Deferred.await(interrupted));
      continue;
    }
    if (outcome._tag === 'InputReceiptExpired') {
      lane.took(at);
      return { _tag: 'Unknown', reason: 'the host no longer holds the receipt of the write' } as const;
    }
    return { _tag: 'Refused', reason: `the host answered the write ${outcome._tag}` } as const;
  }
  return { _tag: 'Refused', reason: `the agent read none of its input for ${(PRESSURE_BEATS * PRESSURE_BEAT_MS) / 1000} s` } as const;
});

export const writeFrame = (
  writing: TerminalWriting['Service'],
  lanes: HarnessLanes,
  sessionId: string,
  envelope: Envelope,
  interrupted: Deferred.Deferred<void> | null,
  tearable = false,
): Effect.Effect<Transfer, HarnessFailure> =>
  lanes
    .typing(sessionId, (lane) =>
      Effect.gen(function* () {
        const bytes = new TextEncoder().encode(frame(envelope));
        for (let from = 0; from < bytes.length; from += CHUNK_BYTES) {
          const cut = from === 0 || tearable ? interrupted : null;
          const landed = yield* writeChunk(writing, lane, bytes.subarray(from, from + CHUNK_BYTES), cut);
          if (landed._tag === 'Admitted') continue;
          if (landed._tag === 'Cancelled') {
            if (from === 0) return { _tag: 'Untaken' } as const;
            const closed = yield* writeChunk(writing, lane, SEAL, null);
            if (closed._tag !== 'Admitted')
              return {
                _tag: 'Unknown',
                reason: 'a cancel cut this frame mid-transfer and its line could not be closed',
                poisoned: true,
              } as const;
            return bytes.length - from === 1
              ? ({ _tag: 'Admitted' } as const)
              : ({
                  _tag: 'Unwritten',
                  reason: 'a cancel cut this frame mid-transfer; its unfinished line was closed unreadable',
                  poisoned: false,
                } as const);
          }
          if (from === 0 && landed._tag === 'Spent') return yield* Effect.fail(landed.failure);
          const refused = landed._tag === 'Spent' ? ({ _tag: 'Refused', reason: 'the host closed the lane mid-frame' } as const) : landed;
          if (from === 0 && refused._tag === 'Refused') return { ...refused, poisoned: false };
          const sealed = yield* writeChunk(writing, lane, SEAL, null);
          return { _tag: refused._tag, reason: refused.reason, poisoned: sealed._tag !== 'Admitted' };
        }
        return { _tag: 'Admitted' } as const;
      }),
    )
    .pipe(
      Effect.catchIf(
        (failure): failure is GateRefusal => failure instanceof GateRefusal && failure.code === 'harness-lane-unopened',
        (failure) => Effect.succeed({ _tag: 'Unwritten' as const, reason: failure.reason, poisoned: false as const }),
      ),
      Effect.catchIf(laneRefused, () =>
        Effect.succeed({
          _tag: 'Unwritten' as const,
          reason: 'the host closed the lane again before any of the frame was taken',
          poisoned: false as const,
        }),
      ),
    );

const stdout = (records: ExecutionRecords['Service'], execution: ExecutionRef, ending: Ending) => (offset: bigint) =>
  records.records({ ref: execution, stream: 'stdout', offset: ByteOffset.make(String(offset)) }).pipe(
    Stream.tap((chunk) =>
      Effect.sync(() => {
        if (chunk._tag === 'Ended') ending.reason = chunk.ending === 'completed' ? 'completed' : chunk.ending === 'gap' ? 'gap' : 'lost';
        else if (chunk.range.gap) {
          ending.reason = 'gap';
          ending.retainedFrom = BigInt(chunk.range.retainedFrom);
        }
      }),
    ),
    Stream.takeWhile((chunk) => chunk._tag === 'Bytes' && !chunk.range.gap),
    Stream.map((chunk) => (chunk._tag === 'Bytes' ? chunk.bytes : new Uint8Array())),
    Stream.mapError((failure) => new ExchangeFailed({ detail: `the agent output could not be read: ${failure._tag}` })),
  );

export const retainedFrom = (
  records: ExecutionRecords['Service'],
  execution: ExecutionRef,
  offset: bigint,
): Effect.Effect<bigint | null, HarnessFailure> =>
  records.bytes({ ref: execution, stream: 'stdout', offset: ByteOffset.make(String(offset)) }, 0).pipe(
    Effect.map((read) => (read.range.gap ? BigInt(read.range.retainedFrom) : null)),
    Effect.mapError((cause) => threadCallFailed(cause)),
  );

export const stderrTail = Effect.fnUntraced(
  function* (records: ExecutionRecords['Service'], execution: ExecutionRef) {
    const probe = yield* records.bytes({ ref: execution, stream: 'stderr', offset: ByteOffset.make('0') }, 0);
    const end = BigInt(probe.range.durableThrough);
    const from = end > BigInt(STDERR_TAIL_BYTES) ? end - BigInt(STDERR_TAIL_BYTES) : 0n;
    const start = BigInt(probe.range.retainedFrom) > from ? BigInt(probe.range.retainedFrom) : from;
    const read = yield* records.bytes({ ref: execution, stream: 'stderr', offset: ByteOffset.make(String(start)) }, STDERR_TAIL_BYTES);
    return new TextDecoder().decode(read.bytes).trim();
  },
  Effect.mapError((cause) => threadCallFailed(cause)),
);

export const reading = (
  records: ExecutionRecords['Service'],
  execution: ExecutionRef,
  from: { readonly offset: bigint; readonly torn: boolean },
  ending: Ending,
): Stream.Stream<Read, ExchangeFailed> =>
  inbound(stdout(records, execution, ending), from, OUTPUT_RETAINED_BYTES).pipe(
    Stream.map((frame): Read => ({ _tag: 'Frame', inbound: frame })),
    Stream.catchTag('ExchangeOversized', (oversized: ExchangeOversized) =>
      Stream.succeed<Read>({ _tag: 'Oversized', start: oversized.start, ceiling: oversized.ceiling }),
    ),
  );
