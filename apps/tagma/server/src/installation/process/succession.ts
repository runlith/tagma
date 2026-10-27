import { closeSync, existsSync, mkdirSync, openSync, realpathSync, writeSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pidAlive } from '@runlith/utils/process';
import { CEILINGS } from '../../platform/contract/service/deadlines.js';
import { Cause, Clock, Context, Deferred, Effect, Exit, Layer, PubSub, Result, Schema, Semaphore, Stream } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { readAttempt } from '../closure/attempt.js';
import { serverPartsStand } from '../closure/present.js';
import { readInstallation, refusalDetail } from '../closure/read.js';
import type { Installation } from '../contract/wire/manifest.js';
import { ASKED_EVERY_MS, CLI_ENTRY, CURRENT, RUNTIME_PART, SERVE_FLAGS } from '../contract/wire/layout.js';
import type { Restart, RestartHost } from '../contract/wire/source.js';
import type { SuccessionSteps } from '../contract/service/steps.js';
import {
  type DataDirectoryConflict,
  type DataDirectoryLock,
  type DataDirectoryLockFailed,
  lockDataDirectory,
} from '../../platform/lock/dataDirectory.js';
import { dataDirectoryLocked } from '../../platform/lock/holder.js';
import {
  type HostRefusal,
  type HostUnprepared,
  type SuccessorLaunch,
  type SuccessorPlan,
  type SuccessionPreparation,
  Succession,
  SuccessionRefused,
  SuccessorFailed,
} from '../contract/service/succession.js';
import {
  HANDOFF,
  HOST_REPLACE,
  HOST_STATE,
  handoffOf,
  handoffSchema,
  REPLACES,
  STANDING_BY,
  takeoverSchema,
} from '../contract/wire/launch.js';
import { RESTART_ID, RESTART_RECORD } from '../contract/wire/restart.js';
import { RestartRecords } from '../contract/service/restarts.js';
import { makeProcessRestart, type ProcessRestart } from './record.js';

type Acknowledgements = {
  readonly taken: PromiseWithResolvers<void>;
  readonly serving: PromiseWithResolvers<void>;
  readonly gone: PromiseWithResolvers<void>;
  readonly lost: PromiseWithResolvers<void>;
};
type Candidate = Acknowledgements & { readonly child: Bun.Subprocess<'ignore', number, number> };

type Successor = { readonly _tag: 'Installation'; readonly installation: Installation } | { readonly _tag: 'Checkout' };

const ANSWER_GRACE_MS = 100;

const decodeTakeover = Schema.decodeUnknownResult(takeoverSchema);

const realpathOr = (path: string): string => (existsSync(path) ? realpathSync(path) : path);

export const ownCommand = (): readonly string[] => [
  realpathOr(process.execPath),
  ...process.execArgv,
  ...process.argv.slice(1).map((argument, index) => (index === 0 ? realpathOr(argument) : argument)),
];

export const successionLayer = (
  runsFrom: Installation | undefined,
  installRoot: string,
  log: string,
  signal: () => void = () => process.kill(process.pid, 'SIGTERM'),
  launch?: SuccessorLaunch,
  record?: ProcessRestart,
  preparation?: SuccessionPreparation,
  steps?: Effect.Effect<SuccessionSteps['Service']>,
  own: readonly string[] = ownCommand(),
  handoff: () => Readonly<Record<string, string>> = () => ({}),
): Layer.Layer<Succession | RestartRecords> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const records = record ?? (yield* makeProcessRestart({ path: join(dirname(log), RESTART_RECORD), pid: process.pid }));
      if (record === undefined) {
        records.load();
        records.identify({ cut: null, installation: runsFrom === undefined ? null : identityOf(runsFrom) });
      }
      const succession = yield* processSuccession({
        runsFrom,
        installRoot,
        log,
        record: records,
        signal,
        launch,
        preparation,
        steps,
        own,
        handoff,
      });
      return Context.make(Succession, succession).pipe(Context.add(RestartRecords, records));
    }),
  );

const processSuccession = Effect.fnUntraced(function* (input: {
  readonly record: ProcessRestart;
  readonly runsFrom: Installation | undefined;
  readonly installRoot: string;
  readonly log: string;
  readonly signal: () => void;
  readonly launch: SuccessorLaunch | undefined;
  readonly preparation: SuccessionPreparation | undefined;
  readonly steps: Effect.Effect<SuccessionSteps['Service']> | undefined;
  readonly own: readonly string[];
  readonly handoff: () => Readonly<Record<string, string>>;
}) {
  const { runsFrom, installRoot, log, record, signal, launch, preparation, steps, own, handoff } = input;
  let left: Restart | null = null;
  let candidate: Candidate | null = null;
  let refusal: HostRefusal | null = null;
  const refusals = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1, replay: 1 }), PubSub.shutdown);
  yield* PubSub.publish(refusals, undefined);
  const asking = yield* Semaphore.make(1);
  const scope = yield* Effect.scope;
  const clock = yield* Clock.Clock;

  const returned = (): void => {
    const tried = readAttempt(installRoot);
    const retried = runsFrom !== undefined && tried !== null && tried.ended === null && tried.starts > 0;
    const command = retried
      ? [join(installRoot, CURRENT, RUNTIME_PART), ...SERVE_FLAGS, join(installRoot, CURRENT, CLI_ENTRY), 'serve']
      : own;
    console.error(
      `[tagma] the successor ended before it served; pid ${process.pid} starts ${retried ? 'the attempt that stands again' : 'its own build again'}`,
    );
    const env: NodeJS.ProcessEnv = { ...process.env, ...handoff() };
    for (const name of [REPLACES, HANDOFF, HOST_STATE, HOST_REPLACE, RESTART_ID]) delete env[name];
    mkdirSync(dirname(log), { recursive: true });
    const sink = openSync(log, 'a');
    try {
      writeSync(
        sink,
        `\n=== tagma serve started ${new Date().toISOString()}, returned by pid ${process.pid} after its successor ended ===\n`,
      );
      Bun.spawn([...command], { stdin: 'ignore', stdout: sink, stderr: sink, detached: true, env }).unref();
    } finally {
      closeSync(sink);
    }
  };

  const holding = async (pid: number, ended: Promise<'gone'>): Promise<'holding' | 'gone'> => {
    for (;;) {
      const looked = await Promise.race([ended, Bun.sleep(ASKED_EVERY_MS).then(() => 'look' as const)]);
      if (looked === 'gone') return looked;
      if (dataDirectoryLocked(dirname(log)) === pid) return 'holding';
    }
  };

  const settled = async ({ child, taken, serving, gone, lost }: Candidate): Promise<void> => {
    const ended = gone.promise.then(() => 'gone' as const);
    const cut = lost.promise.then(() => 'lost' as const);
    const acknowledged = await Promise.race([taken.promise.then(() => 'taken' as const), ended, cut]);
    const outcome =
      acknowledged === 'taken' ? await Promise.race([serving.promise.then(() => 'serving' as const), ended, cut]) : acknowledged;
    const verdict = outcome === 'lost' ? await holding(child.pid, ended) : outcome;
    candidate = null;
    if (verdict === 'gone') return returned();
    if (verdict === 'holding')
      console.error(`[tagma] pid ${child.pid} holds the data directory with its channel to pid ${process.pid} closed`);
    child.unref();
  };

  const current = Effect.gen(function* () {
    const root = join(installRoot, CURRENT);
    const read = yield* Effect.result(readInstallation(root));
    if (read._tag === 'Success') return { root, manifest: read.success };
    return read.failure._tag === 'InstallationMissing' ? null : yield* read.failure;
  }).pipe(Effect.provide(BunFileSystem.layer));

  const withdrawn: Effect.Effect<void> = steps === undefined ? Effect.void : Effect.flatMap(steps, (port) => port.withdraw);

  const cancelled = Effect.suspend(() => {
    if (launch !== undefined) return Effect.sync(() => launch.cancel());
    const standing = candidate;
    if (standing === null) return Effect.void;
    candidate = null;
    return Effect.promise(async () => {
      standing.child.kill('SIGKILL');
      await standing.child.exited;
    });
  });

  const readied = (restartId: string, host: RestartHost, successor: Successor): Effect.Effect<void, HostUnprepared> => {
    if (steps === undefined) return Effect.void;
    return Effect.flatMap(steps, (port) => port.prepare(restartId, host)).pipe(
      Effect.tapError((unprepared) =>
        Effect.andThen(
          Effect.sync(() => {
            refusal = {
              successor: successor._tag === 'Installation' ? identityOf(successor.installation) : null,
              detail: unprepared.detail,
            };
          }),
          PubSub.publish(refusals, undefined),
        ),
      ),
      Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : Effect.andThen(cancelled, withdrawn))),
    );
  };

  const successorOf = Effect.gen(function* () {
    if (runsFrom === undefined) return { _tag: 'Checkout' } as const;
    const standing = yield* current.pipe(Effect.mapError((refusal) => new SuccessionRefused({ detail: refusalDetail(refusal) })));
    if (standing === null) {
      return yield* new SuccessionRefused({
        detail: `nothing stands at ${join(installRoot, CURRENT)}, and an installed server comes up from what stands there`,
      });
    }
    yield* serverPartsStand(standing).pipe(
      Effect.provide(BunFileSystem.layer),
      Effect.mapError((refusal) => new SuccessionRefused({ detail: refusalDetail(refusal) })),
    );
    return { _tag: 'Installation', installation: standing } as const;
  });

  const started = Effect.fn('Succession.start')(function* (
    successor: Successor,
    restartId: string,
    plan: SuccessorPlan | null,
    host: RestartHost,
  ): Effect.fn.Return<void, SuccessorFailed> {
    const command =
      successor._tag === 'Installation'
        ? [join(successor.installation.root, RUNTIME_PART), ...SERVE_FLAGS, join(successor.installation.root, CLI_ENTRY), 'serve']
        : [...own];
    const failed = (detail: string) => new SuccessorFailed({ detail, log });
    const env = {
      ...process.env,
      ...handoff(),
      [REPLACES]: String(process.pid),
      ...(launch === undefined || launch.releases ? { [HANDOFF]: '1' } : {}),
      ...(plan === null ? {} : { [HOST_STATE]: plan.hostState }),
      ...(host === 'replace' ? { [HOST_REPLACE]: '1' } : {}),
      [RESTART_ID]: restartId,
    };
    if (launch !== undefined) {
      return yield* Effect.tryPromise({
        try: (signal) => launch.start(command, env, signal),
        catch: (cause) => failed(cause instanceof Error ? cause.message : String(cause)),
      });
    }
    return yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => mkdir(dirname(log), { recursive: true }),
          catch: (cause) => failed(`the log directory ${dirname(log)} would not be made: ${String(cause)}`),
        });
        const sink = yield* Effect.acquireRelease(
          Effect.tryPromise({ try: () => open(log, 'a'), catch: (cause) => failed(`the log ${log} would not open: ${String(cause)}`) }),
          (handle) => Effect.promise(() => handle.close()),
        );
        const stamp = new Date(yield* Clock.currentTimeMillis).toISOString();
        yield* Effect.tryPromise({
          try: () => sink.write(`\n=== tagma serve started ${stamp}, asked by pid ${process.pid} on restart ===\n`),
          catch: (cause) => failed(`the log ${log} would not take the start's header: ${String(cause)}`),
        });
        const stood = yield* Deferred.make<void, SuccessorFailed>();
        let standing = false;
        const acknowledgements: Acknowledgements = {
          taken: Promise.withResolvers<void>(),
          serving: Promise.withResolvers<void>(),
          gone: Promise.withResolvers<void>(),
          lost: Promise.withResolvers<void>(),
        };
        return yield* Effect.acquireRelease(
          Effect.try({
            try: () =>
              Bun.spawn(command, {
                stdin: 'ignore',
                stdout: sink.fd,
                stderr: sink.fd,
                detached: true,
                env,
                ipc: (message) => {
                  if (message === STANDING_BY) {
                    standing = true;
                    Deferred.doneUnsafe(stood, Exit.void);
                    return;
                  }
                  const said = decodeTakeover(message);
                  if (Result.isSuccess(said)) (said.success._tag === 'Taken' ? acknowledgements.taken : acknowledgements.serving).resolve();
                },
                onDisconnect: () => acknowledgements.lost.resolve(),
                onExit: (ended, code) => {
                  acknowledgements.gone.resolve();
                  if (standing) Effect.runFork(withdrawn);
                  Deferred.doneUnsafe(
                    stood,
                    Exit.fail(
                      failed(`the successor ${command.join(' ')} ended with ${ended.signalCode ?? `code ${code}`} before it stood by`),
                    ),
                  );
                },
              }),
            catch: (cause) => failed(`the successor ${command.join(' ')} would not start: ${String(cause)}`),
          }),
          (child, exit) =>
            Exit.isSuccess(exit)
              ? Effect.void
              : Effect.try(() => child.kill('SIGKILL')).pipe(
                  Effect.tapError((failure) => Effect.logWarning('Failed successor could not be killed', { pid: child.pid, failure })),
                  Effect.ignore,
                ),
        ).pipe(
          Effect.tap((child) =>
            Effect.sync(() =>
              record.spawned(child.pid, {
                cut: null,
                installation: successor._tag === 'Installation' ? identityOf(successor.installation) : null,
              }),
            ),
          ),
          Effect.flatMap((child) =>
            Effect.map(Deferred.await(stood), () => {
              candidate = { child, ...acknowledgements };
            }),
          ),
        );
      }),
    );
  });

  return Succession.of({
    current,
    leaving: Effect.sync(() => left !== null),
    release: (failure) =>
      Effect.suspend(() =>
        left === null
          ? Effect.void
          : Effect.try({
              try: () => {
                if (launch !== undefined) {
                  if (launch.releases) launch.release(failure);
                } else if (candidate !== null) {
                  const standing = candidate;
                  try {
                    standing.child.send(handoffOf(process.pid, failure));
                  } catch (cause) {
                    console.error(`[tagma] pid ${standing.child.pid} could not be told the data directory is released: ${String(cause)}`);
                    standing.gone.resolve();
                  }
                }
              },
              catch: (cause) => new SuccessorFailed({ detail: `the data directory release could not be sent: ${String(cause)}`, log }),
            }),
      ),
    settle: Effect.suspend(() => {
      const standing = candidate;
      return standing === null ? Effect.void : Effect.promise(() => settled(standing));
    }),
    refusals: Stream.fromPubSub(refusals),
    refused: Effect.sync(() => refusal),
    restart: (host = 'hand-over') =>
      asking
        .withPermit(
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              if (left !== null) return left;
              const successor = yield* restore(successorOf);
              const plan =
                preparation === undefined
                  ? null
                  : yield* restore(preparation(successor._tag === 'Installation' ? successor.installation : null));
              const id = yield* record
                .begin(plan?.heavy)
                .pipe(Effect.mapError((failure) => new SuccessorFailed({ detail: failure.detail, log })));
              const recorded = <A, E>(step: Effect.Effect<A, E>) =>
                step.pipe(
                  Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : Effect.sync(() => record.fail(Cause.pretty(exit.cause))))),
                );
              yield* recorded(restore(started(successor, id, plan, host))).pipe(
                Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : withdrawn)),
              );
              yield* recorded(restore(readied(id, host, successor)));
              record.point('standing-by', plan === null ? {} : { migrations: plan.migrations });
              const leaving: Restart = {
                leaving: runsFrom === undefined ? null : identityOf(runsFrom),
                successor:
                  successor._tag === 'Installation'
                    ? { _tag: 'Installation', ...identityOf(successor.installation) }
                    : { _tag: 'Checkout' },
                migrations: plan?.migrations ?? null,
                ...(plan?.heavy === undefined ? {} : { heavy: plan.heavy }),
              };
              left = leaving;
              yield* Effect.forkIn(
                Effect.andThen(Effect.sleep(ANSWER_GRACE_MS), Effect.sync(signal)).pipe(Effect.provideService(Clock.Clock, clock)),
                scope,
              );
              return leaving;
            }),
          ),
        )
        .pipe(Effect.withSpan('Succession.restart')),
  });
});

export const replaced = (env: NodeJS.ProcessEnv): number | undefined => {
  const named = Number(env[REPLACES]);
  delete env[REPLACES];
  return Number.isInteger(named) && named > 0 ? named : undefined;
};

const UNNAMED_POLLS = 10;

const takenAfter = (
  dataPath: string,
  predecessor: number,
  gone = false,
  polls = 0,
): Effect.Effect<DataDirectoryLock, DataDirectoryConflict | DataDirectoryLockFailed> =>
  lockDataDirectory(dataPath).pipe(
    Effect.catchTag('DataDirectoryConflict', (held) => {
      if (gone || (held.holder !== null && held.holder !== predecessor)) return Effect.fail(held);
      if (!pidAlive(predecessor)) return takenAfter(dataPath, predecessor, true, polls);
      if (polls > 0 && (polls * ASKED_EVERY_MS) % CEILINGS.callWait === 0)
        console.warn(`[tagma] still waiting for pid ${predecessor} to leave ${dataPath}`);
      return Effect.andThen(
        Effect.sleep(ASKED_EVERY_MS),
        Effect.suspend(() => takenAfter(dataPath, predecessor, false, polls + 1)),
      );
    }),
  );

const named = (dataPath: string, polls: number): Effect.Effect<DataDirectoryLock, DataDirectoryConflict | DataDirectoryLockFailed> =>
  lockDataDirectory(dataPath).pipe(
    Effect.catchTag('DataDirectoryConflict', (held) =>
      held.holder !== null || polls <= 1
        ? Effect.fail(held)
        : Effect.andThen(
            Effect.sleep(ASKED_EVERY_MS),
            Effect.suspend(() => named(dataPath, polls - 1)),
          ),
    ),
  );

const announce = Effect.sync(() => process.connected && process.send?.(STANDING_BY));

export const expectsRelease = (env: NodeJS.ProcessEnv): boolean => {
  const expected = env[HANDOFF] === '1';
  delete env[HANDOFF];
  return expected;
};

const released = (predecessor: number): Effect.Effect<string | null, SuccessorFailed> =>
  Effect.callback((resume) => {
    const settle = (answer: Effect.Effect<string | null, SuccessorFailed>) => {
      stop();
      resume(answer);
    };
    const refused = (detail: string) => settle(Effect.fail(new SuccessorFailed({ detail, log: '' })));
    const left = () => settle(Effect.succeed(`pid ${predecessor} left without releasing the data directory`));
    const disconnected = left;
    const received = (message: unknown) => {
      const decoded = Schema.decodeUnknownResult(handoffSchema)(message);
      if (Result.isFailure(decoded)) {
        refused(`the data directory handoff could not be read: ${String(decoded.failure)}`);
        return;
      }
      const answer = decoded.success;
      if (answer.pid !== predecessor) {
        refused(`the data directory handoff names pid ${answer.pid} instead of ${predecessor}`);
        return;
      }
      settle(Effect.succeed(answer._tag === 'Released' ? null : answer.detail));
    };
    function stop() {
      clearInterval(watching);
      process.off('message', received);
      process.off('disconnect', disconnected);
    }
    process.on('message', received);
    const watching = setInterval(() => {
      if (!pidAlive(predecessor)) left();
    }, ASKED_EVERY_MS);
    if (!process.connected || process.send === undefined) refused(`pid ${predecessor} cannot be told this successor stands by`);
    else {
      process.once('disconnect', disconnected);
      try {
        process.send(STANDING_BY);
      } catch (cause) {
        refused(`pid ${predecessor} could not be told this successor stands by: ${String(cause)}`);
      }
    }
    return Effect.sync(stop);
  });

const announced = (said: 'Taken' | 'Serving'): Effect.Effect<void> =>
  Effect.sync(() => {
    if (process.connected) process.send?.({ _tag: said, pid: process.pid });
  });

export const serving = (notified: boolean): Effect.Effect<void> => (notified ? announced('Serving') : Effect.void);

export const standBy = (
  dataPath: string,
  predecessor: number,
  notified = false,
): Effect.Effect<StoodBy, DataDirectoryConflict | DataDirectoryLockFailed | SuccessorFailed> => {
  const free = (lock: Effect.Effect<DataDirectoryLock, DataDirectoryConflict | DataDirectoryLockFailed>) =>
    Effect.map(lock, (taken): StoodBy => ({ lock: taken, unreleased: null }));
  return notified
    ? released(predecessor).pipe(
        Effect.flatMap((unreleased) =>
          Effect.map(takenAfter(dataPath, predecessor), (lock): StoodBy => ({
            lock,
            unreleased,
          })),
        ),
        Effect.tap(() => announced('Taken')),
      )
    : free(named(dataPath, UNNAMED_POLLS)).pipe(
        Effect.tap(() => announce),
        Effect.catchTag('DataDirectoryConflict', (held) =>
          held.holder !== predecessor ? Effect.fail(held) : Effect.andThen(announce, free(takenAfter(dataPath, predecessor))),
        ),
      );
};

export type StoodBy = { readonly lock: DataDirectoryLock; readonly unreleased: string | null };

const identityOf = (installation: Installation) => ({
  build: installation.manifest.identity.build,
  digest: installation.manifest.identity.digest,
});
