import { Cause, Effect, Exit, Fiber, Ref, Result, Schema, Scope } from 'effect';
import { ExecutionId } from '@runlith/executions/protocol/execution';
import type { UsageReading } from '@runlith/executions/protocol/evidence';
import type { ByteCursor } from '@runlith/executions/protocol/record';
import type { Request, SubscriptionEnding } from '@runlith/executions/protocol/wire';
import type { Executions } from './registry/launch';
import type { HostCommands } from './registry/inventory';
import type { ByteReadFailure, HostByteRecords, TerminalScreen } from './registry/reads';
import type { InputLanes, LaneFollow } from './registry/control';
import type { ProfiledRead } from './RetainedRecordReads';
import type { ReaderId } from './RecordReaders';
import type { Admitted, Subscription } from './HostConnections';
import { reportDeadFiber } from './hostTelemetry';
import type { ScreenViewerId } from './Presentation';
import type { ProcessUsage } from './ProcessUsage';

const readExecutionId = Schema.decodeUnknownSync(ExecutionId);

export const subscribe = (
  executions: Executions['Service'],
  commands: HostCommands['Service'],
  records: HostByteRecords['Service'],
  screens: TerminalScreen['Service'],
  lanes: InputLanes['Service'],
  usage: ProcessUsage | undefined,
  admitted: Admitted,
  body: Extract<Request, { readonly _tag: 'Subscribe' }>,
  chunk: number,
  refused: (failure: { readonly _tag: string }) => Effect.Effect<void>,
  span: <A, E, R>(
    verb: string,
    execution: string | undefined,
    operation: string | undefined,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<void> => {
  const source = body.source;
  const tailed = <A, R>(fiber: string, subscription: Subscription, pump: Effect.Effect<A, never, R>): Effect.Effect<void, never, R> =>
    Effect.asVoid(reportDeadFiber(fiber, Effect.raceFirst(pump, subscription.closed)));
  if (source._tag === 'Screen') {
    const watched = readExecutionId(source.execution.execution);
    return Effect.scoped(
      Effect.flatMap(
        span(
          'Subscribe.Screen',
          source.execution.execution,
          undefined,
          screens.openViewer(watched, source.base).pipe(
            Effect.matchEffect({
              onFailure: (failure) => Effect.as(refused(failure), Effect.void),
              onSuccess: (viewer) =>
                Effect.flatMap(admitted.subscribe(body.credits), (subscription) =>
                  Effect.succeed(
                    subscription === undefined
                      ? Effect.void
                      : tailed('subscribe-frames', subscription, frames(screens, records, watched, viewer, subscription)),
                  ),
                ),
            }),
          ),
        ),
        (run) => run,
      ),
    );
  }
  if (source._tag === 'ScreenSettled') {
    const watched = readExecutionId(source.execution.execution);
    return Effect.scoped(
      Effect.flatMap(
        span(
          'Subscribe.ScreenSettled',
          source.execution.execution,
          undefined,
          screens.openStillness(watched).pipe(
            Effect.matchEffect({
              onFailure: (failure) => Effect.as(refused(failure), Effect.void),
              onSuccess: (viewer) =>
                Effect.flatMap(admitted.subscribe(body.credits), (subscription) =>
                  Effect.succeed(
                    subscription === undefined
                      ? Effect.void
                      : tailed('subscribe-settled', subscription, stillness(screens, watched, viewer, source.quietMs, subscription)),
                  ),
                ),
            }),
          ),
        ),
        (run) => run,
      ),
    );
  }
  if (source._tag === 'State') {
    const watched = readExecutionId(source.execution.execution);
    return Effect.flatMap(
      span('Subscribe.State', source.execution.execution, undefined, admitted.subscribe(body.credits)),
      (subscription) =>
        subscription === undefined
          ? Effect.void
          : tailed('subscribe-states', subscription, states(executions, commands, watched, subscription)),
    );
  }
  if (source._tag === 'Load') {
    if (usage === undefined) return refused({ _tag: 'UnsupportedCapability' });
    return Effect.scoped(
      Effect.flatMap(span('Subscribe.Load', undefined, undefined, admitted.subscribe(body.credits)), (subscription) =>
        subscription === undefined
          ? Effect.void
          : tailed(
              'subscribe-load',
              subscription,
              Effect.gen(function* () {
                yield* usage.subscribe(`${admitted.connection}:${subscription.id}`, source.serverPid, source.parts);
                let waiting = yield* Effect.forkChild(usage.sampled());
                const standing = yield* usage.load;
                if (standing !== undefined && !(yield* subscription.load(standing))) return;
                while (true) {
                  yield* Fiber.join(waiting);
                  waiting = yield* Effect.forkChild(usage.sampled());
                  const reading = yield* usage.load;
                  if (reading !== undefined && !(yield* subscription.load(reading))) return;
                }
              }),
            ),
      ),
    );
  }
  if (source._tag === 'Inventory') {
    return Effect.flatMap(span('Subscribe.Inventory', undefined, undefined, admitted.subscribe(body.credits)), (subscription) =>
      subscription === undefined ? Effect.void : tailed('subscribe-inventory', subscription, inventory(executions, usage, subscription)),
    );
  }
  if (source._tag === 'Inputs') {
    return Effect.scoped(
      Effect.flatMap(
        span(
          'Subscribe.Inputs',
          source.execution.execution,
          undefined,
          lanes.inputs(readExecutionId(source.execution.execution)).pipe(
            Effect.matchEffect({
              onFailure: (failure) => Effect.as(refused(failure), Effect.void),
              onSuccess: (follow) =>
                Effect.flatMap(admitted.subscribe(body.credits), (subscription) =>
                  Effect.succeed(
                    subscription === undefined ? Effect.void : tailed('subscribe-inputs', subscription, inputs(follow, subscription)),
                  ),
                ),
            }),
          ),
        ),
        (run) => run,
      ),
    );
  }
  const execution = readExecutionId(source.cursor.ref.execution);
  const opened: Effect.Effect<Effect.Effect<void>, never, Scope.Scope> = records
    .openReader(execution, source.cursor.stream, source.cursor.offset)
    .pipe(
      Effect.matchEffect({
        onFailure: (failure) =>
          failure._tag === 'ExecutionUnknown' || failure._tag === 'ExecutionRefused'
            ? Effect.andThen(
                records.sealed(execution),
                Effect.flatMap(Effect.result(records.read(source.cursor, chunk)), (first) =>
                  Result.isFailure(first) && first.failure._tag === 'StreamMissing'
                    ? Effect.as(refused(first.failure), Effect.void)
                    : Result.isFailure(first) && first.failure._tag === 'ExecutionUnknown'
                      ? Effect.as(refused(failure), Effect.void)
                      : Effect.flatMap(admitted.subscribe(body.credits), (subscription) =>
                          Effect.succeed(
                            subscription === undefined
                              ? Effect.void
                              : tailed('subscribe-sealed', subscription, sealedPump(records, source.cursor, subscription, chunk, first)),
                          ),
                        ),
                ),
              )
            : Effect.as(refused(failure), Effect.void),
        onSuccess: (reader) =>
          Effect.flatMap(admitted.subscribe(body.credits), (subscription) =>
            Effect.succeed(
              subscription === undefined
                ? Effect.void
                : tailed('subscribe-pump', subscription, pump(records, execution, reader, subscription, chunk)),
            ),
          ),
      }),
    );
  return Effect.scoped(Effect.flatMap(span('Subscribe', source.cursor.ref.execution, undefined, opened), (run) => run));
};

const states = Effect.fnUntraced(function* (
  executions: Executions['Service'],
  commands: HostCommands['Service'],
  execution: ExecutionId,
  subscription: Subscription,
): Effect.fn.Return<void> {
  while ((yield* executions.summary(execution)) === undefined) {
    const moved = yield* executions.inventoryChanged();
    if (yield* executions.settingUp(execution)) {
      yield* moved;
      continue;
    }
    if ((yield* executions.summary(execution)) !== undefined) break;
    const read = yield* Effect.result(commands.command(execution));
    if (read._tag === 'Failure') {
      yield* Effect.logWarning(`the command of ${execution} could not be read; its subscription ends unavailable`, read.failure);
    }
    const row = read._tag === 'Success' ? read.success : undefined;
    if (row === undefined || row.state.phase === 'ended') {
      const finished = yield* executions.summary(execution);
      if (finished !== undefined && !(yield* subscription.state(finished))) return;
      return yield* subscription.end(row === undefined && finished === undefined ? 'unavailable' : 'completed');
    }
    yield* moved;
  }
  let armed = yield* Effect.exit(executions.changed(execution));
  const standing = yield* executions.summary(execution);
  if (standing === undefined) return yield* subscription.end('unavailable');
  if (!(yield* subscription.state(standing))) return;
  yield* Effect.forever(
    Effect.gen(function* () {
      if (Exit.isFailure(armed)) {
        if (!Cause.hasInterruptsOnly(armed.cause)) yield* subscription.end('completed');
        return yield* Effect.interrupt;
      }
      yield* armed.value;
      armed = yield* Effect.exit(executions.changed(execution));
      const summary = yield* executions.summary(execution);
      if (summary === undefined) {
        yield* subscription.end('completed');
        return yield* Effect.interrupt;
      }
      if (!(yield* subscription.state(summary))) return yield* Effect.interrupt;
    }),
  );
}, Effect.asVoid);

const inputs = (follow: LaneFollow, subscription: Subscription): Effect.Effect<void> =>
  Effect.raceFirst(
    Effect.forever(
      Effect.flatMap(follow.next, (input) => Effect.flatMap(subscription.inputs(input), (sent) => (sent ? Effect.void : Effect.interrupt))),
    ),
    Effect.andThen(follow.over, subscription.end('completed')),
  );

const inventory = Effect.fnUntraced(function* (
  executions: Executions['Service'],
  usage: ProcessUsage | undefined,
  subscription: Subscription,
): Effect.fn.Return<void> {
  const readings = usage === undefined ? Effect.succeed<ReadonlyArray<UsageReading>>([]) : usage.all();
  let transition = yield* executions.inventoryChanged();
  let round: Fiber.Fiber<void> | undefined = undefined;
  if (usage !== undefined) round = yield* Effect.forkChild(usage.sampled());
  let shown = yield* executions.inventoryRevision();
  if (!(yield* subscription.inventory({ _tag: 'Moved', revision: shown, usage: yield* readings }))) return;
  yield* Effect.forever(
    Effect.gen(function* () {
      const woken = round === undefined ? transition : Effect.race(transition, Fiber.join(round));
      const spent = round;
      yield* woken;
      transition = yield* executions.inventoryChanged();
      if (usage !== undefined) round = yield* Effect.forkChild(usage.sampled());
      if (spent !== undefined) yield* Fiber.interrupt(spent);
      const revision = yield* executions.inventoryRevision();
      if (revision > shown + 1) {
        const missed = revision - shown - 1;
        if (
          !(yield* subscription.inventory({
            _tag: 'Gap',
            revision,
            detail: `${missed} inventory transitions passed without a delivery`,
          }))
        ) {
          return yield* Effect.interrupt;
        }
      }
      shown = revision;
      if (!(yield* subscription.inventory({ _tag: 'Moved', revision, usage: yield* readings }))) {
        return yield* Effect.interrupt;
      }
    }),
  );
}, Effect.asVoid);

const frames = Effect.fnUntraced(function* (
  screens: TerminalScreen['Service'],
  records: HostByteRecords['Service'],
  execution: ExecutionId,
  viewer: ScreenViewerId,
  subscription: Subscription,
): Effect.fn.Return<void> {
  const ended = (failure: { readonly _tag: string }) => Effect.as(subscription.end(endingOf(failure)), undefined);
  const credit = screens
    .grantFrame(execution, viewer, 1)
    .pipe(Effect.matchEffect({ onFailure: ended, onSuccess: (held) => Effect.succeed(held) }));
  if ((yield* credit) === undefined) return;
  yield* Effect.forever(
    Effect.gen(function* () {
      const more = yield* screens
        .awaitFrame(execution, viewer)
        .pipe(Effect.matchEffect({ onFailure: ended, onSuccess: (waiting) => Effect.succeed(waiting) }));
      if (more === undefined) return yield* Effect.interrupt;
      if (!more) {
        yield* subscription.end('completed');
        return yield* Effect.interrupt;
      }
      const update = yield* screens.nextFrame(execution, viewer).pipe(
        Effect.matchEffect({
          onFailure: (failure) =>
            contended(failure)
              ? Effect.map(readable(records, execution), (waited) => (waited ? ('again' as const) : ('over' as const)))
              : Effect.as(ended(failure), 'over' as const),
          onSuccess: (frame) => Effect.succeed(frame),
        }),
      );
      if (update === 'over') {
        yield* subscription.end('unavailable');
        return yield* Effect.interrupt;
      }
      if (update === 'again' || update === undefined) return;
      if (!(yield* subscription.screen(update))) return yield* Effect.interrupt;
      if ((yield* credit) === undefined) return yield* Effect.interrupt;
    }),
  );
}, Effect.asVoid);

const stillness = Effect.fnUntraced(function* (
  screens: TerminalScreen['Service'],
  execution: ExecutionId,
  viewer: ScreenViewerId,
  quietMs: number,
  subscription: Subscription,
): Effect.fn.Return<void> {
  for (;;) {
    const still = yield* screens.settled(execution, viewer, quietMs).pipe(Effect.result);
    if (still._tag === 'Failure') return yield* subscription.end(endingOf(still.failure));
    if (!still.success) return yield* subscription.end('completed');
    if (!(yield* subscription.settled())) return;
  }
});

const sealedPump = Effect.fnUntraced(function* (
  records: HostByteRecords['Service'],
  from: ByteCursor,
  subscription: Subscription,
  chunk: number,
  first: SealedRead,
): Effect.fn.Return<void> {
  let cursor = from;
  let read = first;
  for (;;) {
    if (read._tag === 'Failure') return yield* subscription.end(endingOf(read.failure));
    if (read.success.range.gap) return yield* subscription.end('gap');
    if (read.success.bytes.length === 0)
      return yield* subscription.end(read.success.ending === undefined || read.success.ending === 'eof' ? 'completed' : 'unavailable');
    if (!(yield* subscription.bytes(read.success.range, read.success.bytes))) return;
    cursor = { ...cursor, offset: read.success.range.next };
    read = yield* Effect.result(records.read(cursor, chunk));
  }
});

type SealedRead = Result.Result<ProfiledRead, ByteReadFailure>;

const pump = (
  records: HostByteRecords['Service'],
  execution: ExecutionId,
  reader: ReaderId,
  subscription: Subscription,
  chunk: number,
): Effect.Effect<void> =>
  Effect.flatMap(Ref.make(0), (owed) =>
    Effect.forever(
      Effect.gen(function* () {
        const more = yield* records.awaitBytes(execution, reader).pipe(
          Effect.matchEffect({
            onFailure: (failure) => Effect.as(subscription.end(endingOf(failure)), undefined),
            onSuccess: (waiting) => Effect.succeed(waiting),
          }),
        );
        if (more === undefined) return yield* Effect.interrupt;
        if (!more) {
          yield* subscription.end(
            yield* records
              .positions(execution, reader)
              .pipe(
                Effect.match({ onFailure: endingOf, onSuccess: (standing) => (standing.ending === 'eof' ? 'completed' : 'unavailable') }),
              ),
          );
          return yield* Effect.interrupt;
        }
        const held = yield* Ref.get(owed);
        if (held < chunk) {
          const granted = yield* records.grant(execution, reader, chunk - held).pipe(
            Effect.matchEffect({
              onFailure: (failure) => Effect.as(subscription.end(endingOf(failure)), undefined),
              onSuccess: (credit) => Effect.succeed(credit),
            }),
          );
          if (granted === undefined) return yield* Effect.interrupt;
          yield* Ref.set(owed, chunk);
        }
        const pulled = yield* records.pull(execution, reader).pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              contended(failure)
                ? Effect.map(readable(records, execution), (waited) => (waited ? ('again' as const) : ('over' as const)))
                : Effect.as(subscription.end(endingOf(failure)), 'over' as const),
            onSuccess: (pull) => Effect.succeed(pull),
          }),
        );
        if (pulled === 'over') {
          yield* subscription.end('unavailable');
          return yield* Effect.interrupt;
        }
        if (pulled === 'again') return;
        yield* Ref.update(owed, (credit) => credit - pulled.bytes.length);
        if (pulled.range.gap) {
          yield* subscription.end('gap');
          return yield* Effect.interrupt;
        }
        if (pulled.bytes.length === 0 && !pulled.regridded) return;
        if (!(yield* subscription.bytes(pulled.range, pulled.bytes))) return yield* Effect.interrupt;
      }),
    ),
  ).pipe(Effect.asVoid);

const contended = (failure: { readonly _tag: string }): boolean =>
  failure._tag === 'CapacityRefused' || failure._tag === 'ReservationMissing';

const readable = (records: HostByteRecords['Service'], execution: ExecutionId): Effect.Effect<boolean> =>
  Effect.as(records.awaitRead(execution), true).pipe(
    Effect.catchTags({
      ExecutionUnknown: () => Effect.succeed(false),
      ReservationMissing: () => Effect.succeed(false),
      CapacityRefused: () => Effect.succeed(false),
    }),
  );

const endingOf = (failure: { readonly _tag: string }): SubscriptionEnding =>
  failure._tag === 'ExecutionRefused' || failure._tag === 'ExecutionUnknown' ? 'completed' : 'unavailable';
