import { Data, Deferred, Effect, Exit, Fiber, Ref, type Duration } from 'effect';
import type { BindingId, Principal } from '@runlith/executions/protocol/custody';
import { permits } from '@runlith/held/Permits';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type {
  InputCause,
  InputFrontier,
  InputAnswer,
  InputReceipt,
  InputRequest,
  InputSequence,
  InputUnsupported,
} from '@runlith/executions/protocol/input';
import type { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import { byteOffset, offsetValue, type ByteOffset, type TerminalGeometry } from '@runlith/executions/protocol/record';
import type { Binding } from './Bindings';
import { reportDeadFiber } from './hostTelemetry';
import { makeInputAdmission } from './inputAdmission';
import {
  keptLanes,
  laneOf,
  receiptKey,
  sameBytes,
  touched,
  trimReceipts,
  withLane,
  type Lane,
  type LaneBook,
  type ReceiptKey,
  type Retained,
} from './inputReceipts';

export class InputActUnsupported extends Data.TaggedError('InputActUnsupported')<{
  readonly act: 'interrupt' | 'resize' | 'end';
  readonly reason: 'transport' | 'isig-disabled' | 'no-character' | 'geometry' | 'unreadable';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export class InputWriteFailed extends Data.TaggedError('InputWriteFailed')<{
  readonly reason: 'closed' | 'exited' | 'os' | 'stopped';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export class InputFenced extends Data.TaggedError('InputFenced')<{
  readonly reason: 'stopping' | 'write-failed' | 'ended' | 'yielding';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export type InputSink = {
  readonly initiallyClosed: boolean;
  readonly write: (bytes: Uint8Array) => Effect.Effect<number, InputWriteFailed>;
  readonly stop: Effect.Effect<void>;
  readonly end: InputEnd;
  readonly interrupt: (onFlush?: () => void) => Effect.Effect<number, InputActUnsupported | InputWriteFailed>;
  readonly resize: (geometry: TerminalGeometry) => Effect.Effect<void, InputActUnsupported | InputWriteFailed>;
};

export type InputEnd =
  | { readonly _tag: 'Closes'; readonly close: () => Effect.Effect<void, InputWriteFailed> }
  | { readonly _tag: 'Unsupported'; readonly refusal: InputActUnsupported };

export type ReplyAnswer =
  | { readonly _tag: 'ReplyQueued'; readonly acceptedThrough: ByteOffset }
  | {
      readonly _tag: 'ReplyBackpressure';
      readonly pendingBytes: number;
      readonly limit: number;
      readonly room: Effect.Effect<void> | undefined;
    }
  | { readonly _tag: 'ReplyEnded' };

type Pending = { readonly _tag: 'Bytes'; readonly bytes: Uint8Array; readonly epoch: number } | { readonly _tag: 'End' };

const sizeOf = (entry: Pending): number => (entry._tag === 'Bytes' ? entry.bytes.length : 0);

const roomed = (held: InputState): Effect.Effect<void> =>
  held.room === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(held.room, undefined));

const abandoning = (held: InputState): InputState =>
  held.halted
    ? { ...held, waiting: undefined, room: undefined }
    : {
        ...held,
        waiting: undefined,
        room: undefined,
        pending: [],
        queuedBytes: 0,
        abandonedQueued: held.abandonedQueued + held.queuedBytes,
        abandonedEnd: held.abandonedEnd || held.pending.some((entry) => entry._tag === 'End'),
      };

export type InputOwed = { readonly queued: number; readonly inFlight: number; readonly ended: boolean };

export type InputCarry = { readonly accepted: ByteOffset; readonly remainder: Uint8Array; readonly ended: boolean };

type InputState = {
  readonly epoch: Binding['epoch'];
  readonly lanes: ReadonlyMap<BindingId, Lane>;
  readonly clock: number;
  readonly receipts: ReadonlyMap<ReceiptKey, Retained>;
  readonly pending: ReadonlyArray<Pending>;
  readonly queuedBytes: number;
  readonly writingBytes: number;
  readonly writingActs: number;
  readonly abandonedQueued: number;
  readonly abandonedInFlight: number;
  readonly abandonedEnd: boolean;
  readonly acceptedThrough: bigint;
  readonly closed: boolean;
  readonly ended: boolean;
  readonly fenced: InputFenced | undefined;
  readonly waiting: Deferred.Deferred<void> | undefined;
  readonly room: Deferred.Deferred<void> | undefined;
  readonly halted: boolean;
};

type Decided = { readonly _tag: 'Answer'; readonly outcome: InputAnswer } | InputFenced;
type Verdict = { readonly _tag: 'Open' } | Decided;

const OPEN: Verdict = { _tag: 'Open' };

export type ExecutionInput = {
  readonly ref: ExecutionRef;
  readonly frontier: Effect.Effect<InputFrontier>;
  readonly pendingBytes: Effect.Effect<number>;
  readonly pendingActs: Effect.Effect<number>;
  readonly admit: (request: InputRequest, binding: Binding) => Effect.Effect<InputAnswer, InputFenced>;
  readonly next: (binding: Binding) => Effect.Effect<InputSequence>;
  readonly closeIntake: () => Effect.Effect<void>;
  readonly halt: (within: Duration.Duration) => Effect.Effect<InputCarry>;
  readonly reply: (bytes: Uint8Array, settling: boolean) => Effect.Effect<ReplyAnswer, InputFenced>;
  readonly endLanes: () => Effect.Effect<void>;
  readonly closeLane: (binding: BindingId, principal: Principal) => Effect.Effect<void>;
  readonly finish: () => Effect.Effect<void>;
  readonly fence: (reason: InputFenced['reason'], detail: string) => Effect.Effect<InputOwed>;
};

export type InputOptions = {
  readonly sink: InputSink;
  readonly limits: ExecutionLimits;
  readonly ref: ExecutionRef;
  readonly announce: Effect.Effect<void>;
  readonly carried?: InputCarry;
};

export const makeExecutionInput = Effect.fnUntraced(function* ({ sink, limits, ref, announce, carried }: InputOptions) {
  const remainder =
    carried === undefined || carried.remainder.length === 0 ? [] : [{ _tag: 'Bytes' as const, bytes: carried.remainder, epoch: 0 }];
  const stateRef = yield* Ref.make<InputState>({
    epoch: 0,
    lanes: new Map(),
    clock: 0,
    receipts: new Map(),
    pending: carried?.ended === true ? [...remainder, { _tag: 'End' as const }] : remainder,
    queuedBytes: carried?.remainder.length ?? 0,
    writingBytes: 0,
    writingActs: 0,
    abandonedQueued: 0,
    abandonedInFlight: 0,
    abandonedEnd: false,
    acceptedThrough: carried === undefined ? 0n : offsetValue(carried.accepted),
    closed: sink.initiallyClosed,
    ended: sink.initiallyClosed || carried?.ended === true,
    fenced: undefined,
    waiting: undefined,
    room: undefined,
    halted: false,
  });
  const admission = makeInputAdmission({
    closed: () => new InputFenced({ reason: 'yielding', detail: 'this host is yielding its place to the next logic' }),
  });
  const resizing = permits(1);
  const interrupting = permits(1);
  const drained = yield* Deferred.make<void>();
  let flushEpoch = 0;
  let flushing = false;
  let writing: Fiber.Fiber<number, InputWriteFailed> | undefined;
  let unwritten: Uint8Array = EMPTY;
  const flushed = (): void => {
    flushEpoch++;
    flushing = true;
    writing?.interruptUnsafe();
  };
  function admit(request: InputRequest, binding: Binding): Effect.Effect<InputAnswer, InputFenced> {
    return admission.enter(
      binding.id,
      Effect.andThen(
        Ref.update(stateRef, (held) =>
          held.epoch === binding.epoch ? held : { ...held, epoch: binding.epoch, lanes: new Map(), receipts: new Map() },
        ),
        request.act._tag === 'Write'
          ? enqueue(request, binding, request.act.bytes, request.cause)
          : request.act._tag === 'End'
            ? close(request, binding)
            : request.act._tag === 'Interrupt'
              ? interrupting.within(interrupt(request, binding))
              : resizing.within(resize(request, binding, request.act.geometry)),
      ),
    );
  }

  function next(binding: Binding): Effect.Effect<InputSequence> {
    return Effect.map(Ref.get(stateRef), (held) => (held.epoch === binding.epoch ? laneOf(held, binding).next : 0));
  }

  function closeIntake(): Effect.Effect<void> {
    return admission.close;
  }

  const halt = Effect.fnUntraced(function* (within: Duration.Duration): Effect.fn.Return<InputCarry> {
    const waiting = yield* Ref.modify(stateRef, (held) => [held.waiting, { ...held, halted: true, waiting: undefined }] as const);
    if (waiting !== undefined) yield* Deferred.succeed(waiting, undefined);
    yield* sink.stop;
    yield* Effect.timeoutOption(Deferred.await(drained), within);
    const held = yield* Ref.get(stateRef);
    const parts = [unwritten, ...held.pending.flatMap((entry) => (entry._tag === 'Bytes' ? [entry.bytes] : []))];
    const remainder = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let at = 0;
    for (const part of parts) {
      remainder.set(part, at);
      at += part.length;
    }
    return {
      accepted: byteOffset(held.acceptedThrough),
      remainder,
      ended: held.pending.some((entry) => entry._tag === 'End'),
    } satisfies InputCarry;
  });

  function close(request: InputRequest, binding: Binding): Effect.Effect<InputAnswer, InputFenced> {
    const end = sink.end;
    if (end._tag === 'Unsupported') return Effect.succeed(unsupported(end.refusal));
    return decide((held) => {
      const verdict = judge(held, request, binding, EMPTY, true);
      return verdict._tag === 'Open' ? accepted(held, request, binding, EMPTY, 'end', 'end') : settled(held, binding, verdict);
    });
  }

  const interrupt = Effect.fnUntraced(function* (request: InputRequest, binding: Binding): Effect.fn.Return<InputAnswer, InputFenced> {
    const verdict = yield* Ref.modify(stateRef, (held): readonly [Verdict, InputState] => {
      const verdict = judge(held, request, binding, EMPTY, true);
      return [verdict, verdict._tag === 'Open' ? held : settled(held, binding, verdict)[1]];
    });
    if (verdict._tag !== 'Open') return yield* answered(verdict);
    const epoch = flushEpoch;
    const performed = yield* Effect.result(sink.interrupt(flushed));
    if (epoch !== flushEpoch) yield* readDiscarded();
    if (performed._tag === 'Failure')
      return performed.failure._tag === 'InputActUnsupported' ? unsupported(performed.failure) : yield* broke(performed.failure);
    return yield* decide((held) => accepted(held, request, binding, EMPTY, 'interrupt', 'none', performed.success));
  }, Effect.uninterruptible);

  function readDiscarded(): Effect.Effect<void> {
    return Effect.flatten(
      Ref.modify(stateRef, (held) => {
        flushing = false;
        const pending = held.pending.filter((entry) => entry._tag === 'End' || entry.epoch === flushEpoch);
        const queuedBytes = pending.reduce((total, entry) => total + sizeOf(entry), 0);
        return [
          woken(held),
          {
            ...held,
            pending,
            abandonedQueued: held.abandonedQueued + held.queuedBytes - queuedBytes,
            queuedBytes,
            waiting: undefined,
          },
        ];
      }),
    );
  }

  const resize = Effect.fnUntraced(function* (
    request: InputRequest,
    binding: Binding,
    geometry: TerminalGeometry,
  ): Effect.fn.Return<InputAnswer, InputFenced> {
    const verdict = yield* Ref.modify(stateRef, (held): readonly [Verdict, InputState] => {
      const verdict = judge(held, request, binding, EMPTY, false);
      return [verdict, verdict._tag === 'Open' ? held : settled(held, binding, verdict)[1]];
    });
    if (verdict._tag !== 'Open') return yield* answered(verdict);
    return yield* sink.resize(geometry).pipe(
      Effect.flatMap(() =>
        decide((held) => {
          const standing = held.epoch === binding.epoch ? judge(held, request, binding, EMPTY, false) : (held.fenced ?? OPEN);
          return standing._tag === 'Open' ? accepted(held, request, binding, EMPTY, 'resize', 'none') : settled(held, binding, standing);
        }),
      ),
      Effect.catchTag('InputActUnsupported', (failure) => Effect.succeed(unsupported(failure))),
      Effect.catchTag('InputWriteFailed', broke),
    );
  });

  function reply(bytes: Uint8Array, settling: boolean): Effect.Effect<ReplyAnswer, InputFenced> {
    return Effect.flatten(
      Ref.modify(stateRef, (held): readonly [Effect.Effect<ReplyAnswer, InputFenced>, InputState] => {
        if (held.fenced !== undefined) return [Effect.fail(held.fenced), held];
        if (held.ended) return [Effect.succeed({ _tag: 'ReplyEnded' } satisfies ReplyAnswer), held];
        const pendingBytes = owedBytes(held);
        if (bytes.length > limits.input.chunkBytes) {
          return [Effect.succeed({ _tag: 'ReplyBackpressure', pendingBytes, limit: limits.input.chunkBytes, room: undefined }), held];
        }
        if (!settling && pendingBytes + bytes.length > limits.input.pendingBytes) {
          const room = held.room ?? Deferred.makeUnsafe<void>();
          const answer = {
            _tag: 'ReplyBackpressure',
            pendingBytes,
            limit: limits.input.pendingBytes,
            room: Deferred.await(room),
          } as const;
          return [Effect.succeed(answer), { ...held, room }];
        }
        const acceptedThrough = held.acceptedThrough + BigInt(bytes.length);
        return [
          Effect.as(woken(held), { _tag: 'ReplyQueued', acceptedThrough: byteOffset(acceptedThrough) } satisfies ReplyAnswer),
          {
            ...held,
            pending:
              bytes.length === 0 ? held.pending : [...held.pending, { _tag: 'Bytes' as const, bytes: exactly(bytes), epoch: flushEpoch }],
            queuedBytes: held.queuedBytes + bytes.length,
            acceptedThrough,
            waiting: undefined,
          },
        ];
      }),
    );
  }

  function endLanes(): Effect.Effect<void> {
    return Ref.update(stateRef, (held) => dropLanes(held, () => true));
  }

  function closeLane(binding: BindingId, principal: Principal): Effect.Effect<void> {
    return Ref.update(stateRef, (held) => dropLanes(held, (id, lane) => id === binding && lane.principal === principal));
  }

  function finish(): Effect.Effect<void> {
    return Effect.flatten(
      Ref.modify(stateRef, (held) => [
        released(held),
        {
          ...abandoning(held),
          closed: true,
          ended: true,
          fenced: held.fenced?.reason === 'ended' ? undefined : held.fenced,
        },
      ]),
    );
  }

  function fence(reason: InputFenced['reason'], detail: string): Effect.Effect<InputOwed> {
    return Effect.flatten(
      Ref.modify(stateRef, (held) => [
        Effect.as(released(held), {
          queued: held.queuedBytes + held.abandonedQueued,
          inFlight: held.writingBytes + held.abandonedInFlight,
          ended: held.abandonedEnd || held.pending.some((entry) => entry._tag === 'End'),
        } satisfies InputOwed),
        { ...abandoning(held), fenced: held.closed ? held.fenced : (held.fenced ?? new InputFenced({ reason, detail })) },
      ]),
    );
  }

  function enqueue(request: InputRequest, binding: Binding, bytes: Uint8Array, cause: InputCause): Effect.Effect<InputAnswer, InputFenced> {
    return decide((held) => {
      const verdict = judge(held, request, binding, bytes, true);
      if (verdict._tag !== 'Open') return settled(held, binding, verdict);
      const limit =
        bytes.length > limits.input.chunkBytes
          ? limits.input.chunkBytes
          : owedBytes(held) + bytes.length > limits.input.pendingBytes
            ? limits.input.pendingBytes
            : undefined;
      if (limit !== undefined) {
        const lane = laneOf(held, binding);
        return [
          Effect.succeed(pressure(held, lane, limit)),
          touched(withLane(held, binding, { ...lane, pressureRefusedAt: request.sequence }), binding),
        ];
      }
      return accepted(held, request, binding, bytes, cause, 'bytes');
    });
  }

  function judge(held: InputState, request: InputRequest, binding: Binding, bytes: Uint8Array, reaches: boolean): Verdict {
    if (held.fenced !== undefined) return held.fenced;
    const lane = laneOf(held, binding);
    const conflict: Verdict = {
      _tag: 'Answer',
      outcome: { _tag: 'InputConflict', sequence: request.sequence },
    };
    if (request.sequence > lane.next) {
      return lane.pressureRefusedAt === undefined ? conflict : { _tag: 'Answer', outcome: pressure(held, lane, limits.input.pendingBytes) };
    }
    if (request.sequence === lane.next) {
      return reaches && held.ended ? { _tag: 'Answer', outcome: { _tag: 'InputEnded' } } : OPEN;
    }
    if (request.sequence < lane.retainedFrom) return expired(lane, request.sequence);
    const retained = held.receipts.get(receiptKey(binding.id, request.sequence));
    if (retained === undefined) return expired(lane, request.sequence);
    return sameBytes(retained.bytes, bytes) && retained.receipt.cause === request.cause
      ? { _tag: 'Answer', outcome: { _tag: 'InputAdmitted', receipt: retained.receipt } }
      : conflict;
  }

  function expired(lane: Lane, sequence: InputSequence): Verdict {
    return {
      _tag: 'Answer',
      outcome: {
        _tag: 'InputReceiptExpired',
        sequence,
        retainedFrom: lane.retainedFrom,
      },
    };
  }

  function accepted(
    held: InputState,
    request: InputRequest,
    binding: Binding,
    bytes: Uint8Array,
    cause: InputCause,
    queue: 'bytes' | 'end' | 'none',
    byteCount: number = bytes.length,
  ): readonly [Effect.Effect<InputAnswer, never>, InputState] {
    const sequence = request.sequence;
    const acceptedThrough = held.acceptedThrough + BigInt(byteCount);
    const receipt: InputReceipt = {
      execution: ref,
      sequence,
      cause,
      bytes: byteCount,
      acceptedThrough: byteOffset(acceptedThrough),
    };
    const retained = exactly(bytes);
    return [
      Effect.as(woken(held), { _tag: 'InputAdmitted', receipt } satisfies InputAnswer),
      {
        ...held,
        ...booked(held, binding, receipt, retained),
        pending:
          queue === 'end'
            ? [...held.pending, { _tag: 'End' as const }]
            : queue === 'bytes' && bytes.length > 0
              ? [...held.pending, { _tag: 'Bytes' as const, bytes: retained, epoch: flushEpoch }]
              : held.pending,
        queuedBytes: queue === 'bytes' ? held.queuedBytes + bytes.length : held.queuedBytes,
        ended: queue === 'end' || held.ended,
        acceptedThrough,
        waiting: undefined,
      },
    ];
  }

  function booked(held: InputState, binding: Binding, receipt: InputReceipt, bytes: Uint8Array): LaneBook {
    if (held.epoch !== binding.epoch) return { lanes: held.lanes, clock: held.clock, receipts: held.receipts };
    const clock = held.clock + 1;
    const lanes = new Map(held.lanes).set(binding.id, {
      ...laneOf(held, binding),
      next: receipt.sequence + 1,
      active: clock,
      pressureRefusedAt: undefined,
    });
    const receipts = new Map(held.receipts).set(receiptKey(binding.id, receipt.sequence), {
      binding: binding.id,
      sequence: receipt.sequence,
      receipt,
      bytes,
    });
    trimReceipts(lanes, receipts, binding.id, limits.input.receipts);
    return { lanes, clock, receipts };
  }

  const drain = Effect.fnUntraced(
    function* () {
      for (;;) {
        const taken = yield* Ref.modify(stateRef, (held): readonly [Taken, InputState] => {
          if (held.fenced !== undefined || held.closed || held.halted) return [{ _tag: 'Done' }, held];
          const entry = flushing ? undefined : held.pending[0];
          if (entry !== undefined) {
            return [
              { _tag: 'Write', entry, epoch: entry._tag === 'Bytes' ? entry.epoch : flushEpoch },
              {
                ...held,
                pending: held.pending.slice(1),
                queuedBytes: Math.max(0, held.queuedBytes - sizeOf(entry)),
                writingBytes: held.writingBytes + sizeOf(entry),
                writingActs: held.writingActs + 1,
              },
            ];
          }
          const waiting = held.waiting ?? Deferred.makeUnsafe<void>();
          return [
            { _tag: 'Idle', waiting },
            { ...held, waiting },
          ];
        });
        if (taken._tag === 'Done') return;
        if (taken._tag === 'Idle') {
          yield* Deferred.await(taken.waiting);
          continue;
        }
        const entry = taken.entry;
        const bytes = entry._tag === 'Bytes' ? entry.bytes : EMPTY;
        let cut = 0;
        for (;;) {
          const fiber = yield* Effect.forkChild(
            Effect.suspend(() =>
              taken.epoch !== flushEpoch
                ? Effect.interrupt
                : entry._tag === 'Bytes'
                  ? sink.write(bytes.subarray(cut))
                  : Effect.as(readClosing(), 0),
            ),
          );
          writing = fiber;
          if (taken.epoch !== flushEpoch) fiber.interruptUnsafe();
          const outcome = yield* Fiber.await(fiber);
          writing = undefined;
          if (taken.epoch !== flushEpoch) {
            yield* wrote(bytes.length - cut, 'uncertain');
            yield* announce;
            break;
          }
          const performed = yield* Effect.result(Exit.isSuccess(outcome) ? Effect.succeed(outcome.value) : Effect.failCause(outcome.cause));
          if (performed._tag === 'Failure') {
            if (performed.failure.reason === 'stopped') {
              unwritten = bytes.subarray(cut);
              return;
            }
            if (performed.failure.reason === 'closed' || performed.failure.reason === 'exited') {
              yield* Effect.logDebug('input ended under a write', performed.failure);
              yield* finish();
            } else yield* fence('write-failed', performed.failure.detail);
            yield* wrote(bytes.length - cut, 'uncertain');
            return;
          }
          cut += performed.success;
          if (cut >= bytes.length) {
            yield* wrote(performed.success);
            yield* announce;
            break;
          }
          yield* wrote(performed.success, 'taken', false);
          if ((yield* Ref.get(stateRef)).halted) {
            unwritten = bytes.subarray(cut);
            return;
          }
        }
      }
    },
    Effect.catchDefect((defect) =>
      Effect.gen(function* () {
        yield* fence('write-failed', String(defect));
        return yield* Effect.die(defect);
      }),
    ),
    Effect.ensuring(Effect.suspend(() => Deferred.succeed(drained, undefined))),
  );

  function readClosing(): Effect.Effect<void, InputWriteFailed> {
    const end = sink.end;
    return end._tag === 'Closes' ? end.close() : Effect.fail(new InputWriteFailed({ reason: 'closed', detail: end.refusal.detail }));
  }

  function wrote(bytes: number, outcome: 'taken' | 'uncertain' = 'taken', finished = true): Effect.Effect<void> {
    return Effect.flatten(
      Ref.modify(stateRef, (held) => [
        roomed(held),
        {
          ...held,
          room: undefined,
          writingBytes: Math.max(0, held.writingBytes - bytes),
          writingActs: finished ? Math.max(0, held.writingActs - 1) : held.writingActs,
          abandonedInFlight: outcome === 'uncertain' ? held.abandonedInFlight + bytes : held.abandonedInFlight,
        },
      ]),
    );
  }

  function woken(held: InputState): Effect.Effect<void> {
    return held.waiting === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(held.waiting, undefined));
  }

  function released(held: InputState): Effect.Effect<void> {
    return Effect.andThen(Effect.andThen(woken(held), roomed(held)), announce);
  }

  function decide<E>(f: (held: InputState) => readonly [Effect.Effect<InputAnswer, E>, InputState]): Effect.Effect<InputAnswer, E> {
    return Effect.flatten(Ref.modify(stateRef, f));
  }

  function broke(failure: InputWriteFailed): Effect.Effect<never, InputFenced> {
    return Effect.flatMap(fence('write-failed', failure.detail), () =>
      Effect.fail(new InputFenced({ reason: 'write-failed', detail: failure.detail })),
    );
  }
  yield* Effect.forkScoped(reportDeadFiber('input-drain', drain()));
  return {
    ref: ref,
    get frontier() {
      return Effect.map(Ref.get(stateRef), frontierOf);
    },
    get pendingBytes() {
      return Effect.map(Ref.get(stateRef), owedBytes);
    },
    get pendingActs() {
      return Effect.map(Ref.get(stateRef), (held) => held.pending.length + held.writingActs);
    },
    admit: admit,
    next: next,
    closeIntake: closeIntake,
    halt: halt,
    reply: reply,
    endLanes: endLanes,
    closeLane: closeLane,
    finish: finish,
    fence: fence,
  } satisfies ExecutionInput;
});

type Taken =
  | { readonly _tag: 'Write'; readonly entry: Pending; readonly epoch: number }
  | { readonly _tag: 'Idle'; readonly waiting: Deferred.Deferred<void> }
  | { readonly _tag: 'Done' };

const owedBytes = (held: InputState): number => held.queuedBytes + held.writingBytes;

const pressure = (held: InputState, lane: Lane, limit: number): InputAnswer => ({
  _tag: 'InputBackpressure',
  frontier: frontierIn(held, lane),
  pendingBytes: owedBytes(held),
  limit,
});

const settled = (held: InputState, binding: Binding, verdict: Decided): readonly [Effect.Effect<InputAnswer, InputFenced>, InputState] => [
  answered(verdict),
  verdict._tag === 'Answer' && (verdict.outcome._tag === 'InputAdmitted' || verdict.outcome._tag === 'InputBackpressure')
    ? touched(held, binding)
    : held,
];

const dropLanes = (held: InputState, drop: (id: BindingId, lane: Lane) => boolean): InputState => {
  const kept = keptLanes(held.lanes, held.receipts, drop);
  return kept === undefined ? held : { ...held, ...kept };
};

const EMPTY = new Uint8Array(0);

const exactly = (bytes: Uint8Array): Uint8Array => {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
};

const answered = (verdict: Decided): Effect.Effect<InputAnswer, InputFenced> =>
  verdict._tag === 'Answer' ? Effect.succeed(verdict.outcome) : Effect.fail(verdict);

const unsupported = (failure: InputActUnsupported): InputAnswer =>
  ({ _tag: 'InputUnsupported', act: failure.act, reason: failure.reason, detail: failure.detail }) satisfies InputUnsupported;

const frontierOf = (held: InputState): InputFrontier => ({
  acceptedThrough: byteOffset(held.acceptedThrough),
  pendingBytes: owedBytes(held),
});

const frontierIn = (held: InputState, lane: Lane): InputFrontier => ({
  sequence: lane.next === 0 ? undefined : lane.next - 1,
  ...frontierOf(held),
});
