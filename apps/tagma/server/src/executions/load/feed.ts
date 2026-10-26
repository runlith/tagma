import type { LoadSubscription } from '@runlith/executions/ExecutionEvidence';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import type { LoadReading } from '@runlith/executions/protocol/evidence';
import { Cause, Clock, Context, Duration, Effect, Fiber, Option, Queue, type Scope, Stream, SubscriptionRef, Tracer } from 'effect';
import { LoadReader, type LoadPoint, type MachineLoadDelta, type MachineLoadFrame, type MachineState } from '../contract/wire/load.js';
import { LoadFeed } from '../contract/service/load.js';
import type { TerminalFailure } from '../contract/service/terminals.js';
import { LoadList } from './list.js';
import type { WorkNames } from './work.js';
import type { Background } from '../../platform/contract/service/background.js';

export type HostLoadOpening = Effect.Effect<LoadSubscription, ExecutionsFailure, Scope.Scope>;

export type HostReading =
  | { readonly _tag: 'Waiting' }
  | { readonly _tag: 'Read'; readonly reading: LoadReading; readonly readAt: number }
  | { readonly _tag: 'Lost'; readonly reason: string; readonly since: number }
  | { readonly _tag: 'Outdated'; readonly reason: string };

const REOPEN = Duration.seconds(5);

const WAITING: HostReading = { _tag: 'Waiting' };

export type HostLoad = Effect.Success<ReturnType<typeof makeHostLoad>>;

export const makeHostLoad = Effect.fnUntraced(function* (opening: HostLoadOpening) {
  const latest = yield* SubscriptionRef.make<HostReading>(WAITING);
  const wanted = yield* SubscriptionRef.make(false);
  const scope = yield* Effect.scope;
  let holders = 0;
  let fiber: Fiber.Fiber<unknown, never> | undefined;

  const once = Effect.scoped(
    Effect.gen(function* () {
      const subscription = yield* opening;
      yield* Effect.raceFirst(
        Stream.runForEach(subscription.readings, (reading) =>
          Effect.flatMap(Clock.currentTimeMillis, (readAt) => SubscriptionRef.set(latest, { _tag: 'Read', reading, readAt })),
        ),
        Stream.runForEach(Stream.changes(SubscriptionRef.changes(wanted)), subscription.setInterest),
      );
    }),
  );

  const subscribed = Effect.forever(
    Effect.flatMap(Effect.exit(once), (exit) =>
      Effect.gen(function* () {
        if (exit._tag === 'Failure' && Cause.hasInterruptsOnly(exit.cause)) return;
        const failure = exit._tag === 'Failure' ? Cause.findErrorOption(exit.cause) : Option.none();
        if (Option.isSome(failure) && failure.value._tag === 'HostRefused' && failure.value.refusal._tag === 'UnsupportedCapability') {
          yield* SubscriptionRef.set(latest, { _tag: 'Outdated', reason: failure.value.refusal.reason });
          return yield* Effect.sleep(REOPEN);
        }
        const reason = exit._tag === 'Failure' ? Cause.squash(exit.cause) : 'the host ended the load subscription';
        const detail = reason instanceof Error ? reason.message : String(reason);
        yield* SubscriptionRef.set(latest, {
          _tag: 'Lost',
          reason: detail === '' ? 'the host load subscription failed' : detail,
          since: yield* Clock.currentTimeMillis,
        });
        yield* Effect.logWarning('the host load subscription ended; it opens again while a load view stands', { reason: detail });
        yield* Effect.sleep(REOPEN);
      }),
    ),
  );

  return {
    latest,
    hold: Effect.acquireRelease(
      Effect.suspend(() => {
        holders += 1;
        if (holders > 1) return Effect.void;
        return Effect.map(Effect.forkIn(subscribed, scope), (forked) => {
          fiber = forked;
        });
      }),
      () =>
        Effect.suspend(() => {
          holders -= 1;
          if (holders > 0) return Effect.void;
          const held = fiber;
          fiber = undefined;
          return Effect.andThen(held === undefined ? Effect.void : Fiber.interrupt(held), SubscriptionRef.set(latest, WAITING));
        }),
    ),
    interest: (interested: boolean): Effect.Effect<void> => SubscriptionRef.set(wanted, interested),
  };
});

type Seat = {
  base: number | undefined;
  readonly id: LoadReader;
  interested: boolean;
  readonly queue: Queue.Queue<MachineLoadFrame, TerminalFailure | Cause.Done>;
};

export const makeMachineLoad = Effect.fnUntraced(function* (host: HostLoad, names: WorkNames, background: Background['Service']) {
  const scope = yield* Effect.scope;
  const seats = new Map<Queue.Queue<MachineLoadFrame, TerminalFailure | Cause.Done>, Seat>();
  let wake: (() => void) | undefined;
  let fiber: Fiber.Fiber<void> | undefined;

  const anyInterested = () => {
    for (const seat of seats.values()) if (seat.interested) return true;
    return false;
  };

  const composed = Effect.suspend(() => {
    const list = new LoadList();
    let state: MachineState = { _tag: 'Waiting' };
    let sequence = 0;
    const joins = Stream.callback<'joined'>(
      (queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            wake = () => void Queue.offerUnsafe(queue, 'joined');
          }),
          () =>
            Effect.sync(() => {
              wake = undefined;
            }),
        ),
      { bufferSize: 1, strategy: 'sliding' },
    );
    const pulses = Stream.merge(SubscriptionRef.changes(host.latest).pipe(Stream.buffer({ capacity: 1, strategy: 'sliding' })), joins);
    return Stream.runForEach(
      pulses,
      Effect.fnUntraced(
        function* (pulse) {
          const composedAt = yield* Clock.currentTimeMillis;
          let delta: MachineLoadDelta | undefined;
          if (pulse !== 'joined') {
            let point: LoadPoint | undefined;
            if (pulse._tag === 'Read') {
              const refs = pulse.reading.groups.flatMap((group) => (group.owner._tag === 'Execution' ? [group.owner.execution] : []));
              const named = yield* names.read(refs, composedAt);
              const read = list.compose(pulse.reading, named, pulse.readAt, yield* background.standing);
              state = { _tag: 'Read', view: read.view };
              point = read.point;
            } else {
              if (pulse._tag === 'Waiting') list.reset();
              state = pulse;
            }
            sequence += 1;
            delta = { composedAt, state, point };
          }
          let sent = 0;
          let snapshots = 0;
          for (const seat of seats.values()) {
            let frame: MachineLoadFrame;
            if (seat.base === undefined || (delta !== undefined && Queue.sizeUnsafe(seat.queue) > 0)) {
              frame = { _tag: 'Snapshot', sequence, snapshot: { composedAt, reader: seat.id, state, history: list.points } };
              snapshots += 1;
            } else if (delta !== undefined) frame = { _tag: 'Delta', sequence, base: sequence - 1, delta };
            else continue;
            Queue.offerUnsafe(seat.queue, frame);
            seat.base = sequence;
            sent += 1;
          }
          yield* Effect.annotateCurrentSpan({ sent, snapshots });
        },
        (effect, pulse) => Effect.withSpan(effect, 'load.machine', { attributes: { snapshot: pulse === 'joined' } }),
      ),
    );
  });

  const join = (queue: Queue.Queue<MachineLoadFrame, TerminalFailure | Cause.Done>) =>
    Effect.suspend(() => {
      seats.set(queue, { base: undefined, id: LoadReader.make(crypto.randomUUID()), interested: false, queue });
      if (fiber !== undefined) {
        wake?.();
        return Effect.void;
      }
      const composing = Effect.updateContext(Effect.scoped(Effect.andThen(host.hold, composed)), (context: Context.Context<never>) =>
        Context.omit(Tracer.ParentSpan)(context),
      );
      return Effect.map(Effect.forkIn(composing, scope), (forked) => {
        fiber = forked;
      });
    });

  const leave = (queue: Queue.Queue<MachineLoadFrame, TerminalFailure | Cause.Done>) =>
    Effect.suspend(() => {
      const seat = seats.get(queue);
      seats.delete(queue);
      const release = seat?.interested === true ? host.interest(anyInterested()) : Effect.void;
      if (seats.size > 0) return release;
      const held = fiber;
      fiber = undefined;
      return Effect.andThen(release, held === undefined ? Effect.void : Fiber.interrupt(held));
    });

  return LoadFeed.of({
    machine: () =>
      Stream.callback<MachineLoadFrame, TerminalFailure>((queue) => Effect.acquireRelease(join(queue), () => leave(queue)), {
        bufferSize: 1,
        strategy: 'sliding',
      }),
    interest: (reader, interested) =>
      Effect.suspend(() => {
        const seat = [...seats.values()].find((one) => one.id === reader);
        if (seat === undefined) return Effect.succeed(false);
        seat.interested = interested;
        return Effect.as(host.interest(anyInterested()), true);
      }),
  });
});
