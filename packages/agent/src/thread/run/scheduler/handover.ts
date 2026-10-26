import { Cause, Effect, Exit, type Fiber } from 'effect';
import type { ThreadRow, ThreadRunRow } from '../../rows';
import type { ThreadCompactionEntry } from '../../../transcript/entries';
import type { ThreadInboxItem } from '../../storage/inbox';
import { ThreadCallBroke, type ThreadBorderFailed } from '../../ThreadBorder';
import { LaunchFailed, type LaunchGuidance, type RunLaunch, type WithdrawFailed, type Withdrawal } from '../../transport/contract';
import { Transports } from '../../transport/Transports';
import { LaunchGate } from '../LaunchGate';
import { RunLifecycle } from '../lifecycle/RunLifecycle';
import { RunControl } from '../RunControl';
import { WordsInFlight } from '../WordsInFlight';
export type Opened = {
  readonly thread: ThreadRow;
  readonly run: ThreadRunRow;
  readonly oriented: boolean;
  readonly outputOptional: boolean;
  readonly seed: readonly ThreadInboxItem[];
  readonly compacts?: Effect.Effect<CompactionOrder | null, ThreadBorderFailed>;
};
export type CompactionOrder = {
  readonly keep: string | undefined;
  readonly mode: ThreadCompactionEntry['mode'];
};
export type Handover = Effect.Success<ReturnType<typeof makeHandover>>;
export const makeHandover = Effect.fnUntraced(function* ({
  guidance,
  spawn,
}: {
  readonly guidance: LaunchGuidance;
  readonly spawn: (work: Effect.Effect<void>) => Fiber.Fiber<void>;
}) {
  const transports = yield* Transports;
  const lifecycle = yield* RunLifecycle;
  const gate = yield* LaunchGate;
  const control = yield* RunControl;
  const inflight = yield* WordsInFlight;
  const refused = Effect.fnUntraced(function* (launch: Opened, reason: string) {
    const { thread, run } = launch;
    gate.refused(thread.id);
    yield* Effect.logWarning('a run could not be launched', { runId: run.id, threadId: thread.id, reason });
    yield* lifecycle
      .finish(run, {
        kind: 'broke',
        cause: Cause.fail(new Error(`The run could not be launched: ${reason}`)),
        departing: false,
        returnsWords: true,
      })
      .pipe(
        Effect.exit,
        Effect.flatMap((exit) =>
          Exit.isFailure(exit)
            ? Effect.logWarning('a refused launch could not be settled', { runId: run.id, cause: Cause.pretty(exit.cause) })
            : Effect.void,
        ),
      );
    inflight.settled(
      run,
      launch.seed.map((item) => item.id),
    );
  });
  const dispatch = Effect.fnUntraced(
    function* (opened: Opened, published: Effect.Effect<void>) {
      const { compacts, ...opening } = opened;
      const launch: RunLaunch = { ...opening, guidance };
      yield* published;
      const transport = yield* transports.of(launch.thread.transport);
      if (compacts !== undefined) {
        const order = yield* compacts;
        if (order === null) {
          yield* lifecycle.finish(launch.run, { kind: 'completed' });
          return;
        }
        if (transport.compaction === undefined) return yield* new LaunchFailed({ reason: `${transport.adapter} compacts no session` });
        return yield* transport.compaction.compact(launch.run, order.keep, order.mode);
      }
      if (transport.words === 'receipt' && launch.seed.length > 0)
        inflight.handed(
          launch.run,
          launch.seed.map((item) => item.id),
        );
      yield* transport.runs.launch(launch);
    },
    (effect, opened) =>
      effect.pipe(
        Effect.catchTags({
          LaunchFailed: (failure) => refused(opened, failure.reason),
          TransportUnregistered: (failure) => refused(opened, failure.message),
        }),
        Effect.exit,
        Effect.flatMap((exit) =>
          !Exit.isFailure(exit) || Cause.hasInterruptsOnly(exit.cause) ? Effect.void : refused(opened, Cause.pretty(exit.cause)),
        ),
      ),
  );
  return {
    words: (thread: { readonly transport: ThreadRow['transport'] }): Effect.Effect<'opening' | 'receipt'> =>
      Effect.map(Effect.option(transports.of(thread.transport)), (found) => (found._tag === 'Some' ? found.value.words : 'opening')),
    deliver: (
      thread: {
        readonly transport: ThreadRow['transport'];
      },
      run: ThreadRunRow,
      items: readonly ThreadInboxItem[],
    ): Effect.Effect<void, ThreadBorderFailed> =>
      Effect.flatMap(Effect.option(transports.of(thread.transport)), (found) => {
        if (found._tag === 'None' || found.value.words === 'opening') return Effect.void;
        inflight.handed(
          run,
          items.map((item) => item.id),
        );
        return found.value.runs.deliver(run, items);
      }),
    queued: (
      thread: {
        readonly transport: ThreadRow['transport'];
      },
      run: ThreadRunRow,
    ): Effect.Effect<void, ThreadBorderFailed> =>
      Effect.flatMap(Effect.option(transports.of(thread.transport)), (found) =>
        found._tag === 'None' || found.value.words === 'opening' ? Effect.void : found.value.runs.queued(run),
      ),
    withdraw: (
      thread: {
        readonly transport: ThreadRow['transport'];
      },
      run: ThreadRunRow,
      item: ThreadInboxItem,
    ): Effect.Effect<Withdrawal, WithdrawFailed> =>
      Effect.flatMap(Effect.option(transports.of(thread.transport)), (found) =>
        found._tag === 'Some' && found.value.words === 'receipt' ? found.value.runs.withdraw(run, item) : Effect.succeed('unsent' as const),
      ),
    restore: (thread: { readonly id: string; readonly transport: ThreadRow['transport'] }): Effect.Effect<void, ThreadBorderFailed> =>
      Effect.flatMap(
        Effect.mapError(transports.of(thread.transport), (cause) => new ThreadCallBroke({ cause })),
        (transport) =>
          transport.history === undefined
            ? new ThreadCallBroke({ cause: new Error(`${transport.adapter} rebuilds no session from the thread history.`) })
            : transport.history.reset(thread.id),
      ),
    begin: (opened: Opened, published: Effect.Effect<void>): Effect.Effect<void> =>
      Effect.sync(() => {
        const release = control.launching(opened.run);
        spawn(Effect.ensuring(dispatch(opened, published), Effect.sync(release)));
      }),
    hold: (run: ThreadRunRow): void => {
      control.drive(run);
    },
  };
});
