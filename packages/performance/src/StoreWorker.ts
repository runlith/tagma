import * as Cause from 'effect/Cause';
import * as Deferred from 'effect/Deferred';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import { describeErrors } from '@runlith/utils/error';
import { WorkerUnavailable, workerGone } from '@runlith/utils/worker';
import { monotonicMs } from './monotonic.js';
import { PerformanceStoreUnavailable } from './store/records.js';
import type * as EffectWorker from 'effect/workers/Worker';
import type { StoreRequest, StoreAnswer } from './store/wire.js';

export const COMMAND_TIMEOUT_MS = 60_000;
export const OPEN_TIMEOUT_MS = 300_000;
export const REPLACEMENT_BACKOFF_MS = 60_000;
const STABLE_MS = 10_000;
const FIRST_RETRY_MS = 250;

export type StoreWorkerOptions = {
  readonly commandTimeoutMs?: number | undefined;
  readonly openTimeoutMs?: number | undefined;
  readonly backoffMs?: number | undefined;
};

export const makeStoreWorker = ({
  worker,
  onResponse,
  onGone,
  initialize,
  options = {},
}: {
  readonly worker: EffectWorker.Worker<StoreAnswer, StoreRequest>;
  readonly onResponse: (response: StoreAnswer) => void;
  readonly onGone: (gone: WorkerUnavailable) => void;
  readonly initialize: () => StoreRequest;
  readonly options?: StoreWorkerOptions;
}) => {
  let trip: Deferred.Deferred<void> | undefined;
  let ready = false;
  let stopped = false;
  let generations = 0;
  let failure: WorkerUnavailable | undefined;
  const backoffMs = options.backoffMs ?? REPLACEMENT_BACKOFF_MS;
  const openTimeout = Duration.millis(options.openTimeoutMs ?? OPEN_TIMEOUT_MS);

  const fail = (message: string): WorkerUnavailable => {
    if (failure !== undefined) return failure;
    const standing = trip;
    trip = undefined;
    ready = false;
    const gone = (failure = stopped ? new WorkerUnavailable('performance worker', message) : workerGone('performance worker', message));
    onGone(gone);
    if (standing !== undefined) Deferred.doneUnsafe(standing, Effect.void);
    return gone;
  };

  const end = (message: string): void => {
    if (trip === undefined) return;
    fail(message);
  };

  const send = (request: StoreRequest, transfers?: ReadonlyArray<unknown>): Effect.Effect<void, PerformanceStoreUnavailable> =>
    worker.send(request, transfers).pipe(
      Effect.mapError((error) => {
        const cause = fail(error.message);
        return new PerformanceStoreUnavailable({ message: cause.message, cause });
      }),
    );

  return {
    commandTimeout: Duration.millis(options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS),
    get restarts(): number {
      return Math.max(0, generations - 1);
    },
    send,
    end,
    run: Effect.gen(function* () {
      let failures = 0;
      while (!stopped) {
        const current = Deferred.makeUnsafe<void>();
        trip = current;
        failure = undefined;
        ready = false;
        generations += 1;
        const started = yield* monotonicMs;
        yield* worker
          .run(
            (response) =>
              Effect.sync(() => {
                if (response._tag === 'StoreReady') ready = true;
                onResponse(response);
              }),
            { onSpawn: Effect.asVoid(Effect.result(send(initialize()))) },
          )
          .pipe(
            Effect.raceFirst(
              Effect.sleep(openTimeout).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    if (!ready) end('the performance worker did not open within its deadline');
                  }),
                ),
                Effect.andThen(Deferred.await(current)),
              ),
            ),
            Effect.raceFirst(Deferred.await(current)),
            Effect.catchCause((cause) => Effect.sync(() => fail(describeErrors(Cause.prettyErrors(cause))))),
          );
        if (trip === current) fail('the performance worker ended');
        if (stopped) return;
        const lived = (yield* monotonicMs) - started;
        failures = lived < STABLE_MS ? failures + 1 : 0;
        if (failures > 0) {
          yield* Effect.sleep(Duration.millis(Math.min(backoffMs, FIRST_RETRY_MS * 2 ** (failures - 1))));
        }
      }
    }).pipe(Effect.withTracerEnabled(false)),
    stop: (): void => {
      stopped = true;
      end('performance store scope is closed');
    },
  };
};
