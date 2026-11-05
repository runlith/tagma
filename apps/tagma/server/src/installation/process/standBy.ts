import { pidAlive } from '@runlith/utils/process';
import { Effect, Exit, Result, Schema } from 'effect';
import { Processes } from '@runlith/execution-host/ProcessReader';
import { CEILINGS } from '../../platform/contract/service/deadlines.js';
import {
  type DataDirectoryConflict,
  type DataDirectoryLock,
  type DataDirectoryLockFailed,
  lockDataDirectory,
} from '../../platform/lock/dataDirectory.js';
import { SuccessorFailed } from '../contract/service/succession.js';
import { ASKED_EVERY_MS } from '../contract/wire/layout.js';
import { HANDOFF, handoffSchema, REPLACES, STANDING_BY } from '../contract/wire/launch.js';
import { checkChain, inheritedChain, makeProcessChain, waitingForStop, type Chain } from './chain.js';

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

const takePlace = (
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

export const standBy = Effect.fnUntraced(function* (dataPath: string, predecessor: number, notified = false, admitted = true) {
  const failed = (cause: unknown) => new SuccessorFailed({ detail: String(cause), log: '' });
  const reference = yield* Effect.try({ try: () => inheritedChain(process.env), catch: failed });
  if (reference === undefined) return yield* takePlace(dataPath, predecessor, notified);
  const check = checkChain(reference).pipe(Effect.mapError(failed));
  yield* check;
  const reader = yield* Effect.serviceOption(Processes);
  if (reader._tag === 'None') return yield* failed('the successor has no native process reader to join its generation');
  const chain = yield* makeProcessChain(dataPath, null, admitted).pipe(
    Effect.provideService(Processes, reader.value),
    Effect.mapError(failed),
  );
  let taken: StoodBy | undefined;
  return yield* Effect.raceFirst(
    takePlace(dataPath, predecessor, notified).pipe(
      Effect.tap((stood) =>
        Effect.sync(() => {
          taken = stood;
        }),
      ),
      Effect.tap(() => check),
    ),
    waitingForStop(reference).pipe(Effect.mapError(failed)),
  ).pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) && taken !== undefined ? taken.lock.release : Effect.void)),
    Effect.map((stood) => ({ ...stood, chain })),
  );
});

export type StoodBy = { readonly lock: DataDirectoryLock; readonly unreleased: string | null; readonly chain?: Chain };
