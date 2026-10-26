import { dirname } from 'node:path';
import { Console, Effect, Schema } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from 'effect/http';
import type { Restart } from '../contract/wire/source.js';
import type { DirectoryHolder } from '../../platform/contract/wire/lock.js';
import { ASKED_EVERY_MS } from '../contract/wire/layout.js';
import { startupStateSchema, type Startup, type StartupState } from '../contract/wire/restart.js';

export type Spawned = {
  readonly pid: number;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | number | null;
};

type Waiting = (holder: DirectoryHolder, startup: Startup | null) => Effect.Effect<void>;
type Failed = { readonly _tag: 'Failed'; readonly detail: string };

export type Start<A> =
  | { readonly _tag: 'Answered'; readonly answered: A; readonly raised: boolean }
  | { readonly _tag: 'Left'; readonly code: number }
  | { readonly _tag: 'Signalled'; readonly signal: NodeJS.Signals | number }
  | Failed;

const ended = (spawned: Spawned): Extract<Start<never>, { _tag: 'Left' | 'Signalled' }> | null =>
  spawned.signalCode !== null
    ? { _tag: 'Signalled', signal: spawned.signalCode }
    : spawned.exitCode !== null
      ? { _tag: 'Left', code: spawned.exitCode }
      : null;

export const awaitStart = Effect.fn('ServerStart.awaitStart')(function* <A>(
  spawned: Spawned,
  probe: Effect.Effect<A | null>,
  holder: () => DirectoryHolder,
  progress: Effect.Effect<StartupState>,
  waiting: Waiting,
): Effect.fn.Return<Start<A>> {
  let announced: DirectoryHolder = null;
  for (;;) {
    const saved = yield* progress;
    const held = holder();
    const startup = saved.startup;
    if (startup?.status === 'failed' && (startup.pid === spawned.pid || startup.pid === held)) {
      return { _tag: 'Failed', detail: startup.failure?.detail ?? `the start failed in ${startup.phase}` };
    }
    const answered = yield* probe;
    if (answered !== null) return { _tag: 'Answered', answered, raised: ended(spawned) === null };
    const left = ended(spawned);
    if (left !== null && held === null && saved.restart?.underway !== true) return left;
    const pid = held;
    if (pid !== null && pid !== announced) {
      announced = pid;
      yield* waiting(pid, startup?.pid === pid ? startup : null);
    }
    yield* Effect.sleep(ASKED_EVERY_MS);
  }
});

export type Restarted<A> = { readonly _tag: 'Answered'; readonly answered: A } | { readonly _tag: 'Silent' } | Failed;

type RestartTarget<A> = {
  readonly isSuccessor: (answered: A, progress: StartupState) => boolean;
  readonly build: (answered: A) => string | null;
  readonly expected: string | null;
};

export const awaitRestart = Effect.fn('ServerStart.awaitRestart')(function* <A>(
  probe: Effect.Effect<A | null>,
  holder: (() => DirectoryHolder) | null,
  progress: Effect.Effect<StartupState>,
  target: RestartTarget<A>,
  waiting: Waiting,
): Effect.fn.Return<Restarted<A>> {
  let announced: DirectoryHolder = null;
  for (;;) {
    const saved = yield* progress;
    if (saved.restart?.stage === 'failed') {
      return { _tag: 'Failed', detail: saved.restart.failure ?? 'the restart recorded a failure' };
    }
    if (saved.startup?.status === 'failed') {
      return { _tag: 'Failed', detail: saved.startup.failure?.detail ?? `the start failed in ${saved.startup.phase}` };
    }
    const answered = yield* probe;
    if (
      answered !== null &&
      (target.isSuccessor(answered, saved) || saved.restart?.stage === 'serving' || saved.restart?.stage === 'restored')
    ) {
      const mismatch = restartMismatch(target.build(answered), target.expected);
      return mismatch === null ? { _tag: 'Answered', answered } : { _tag: 'Failed', detail: mismatch };
    }
    const held = holder?.() ?? null;
    if (answered === null && holder !== null && held === null && saved.restart?.underway !== true) return { _tag: 'Silent' };
    if (answered === null && held !== null && held !== announced) {
      announced = held;
      yield* waiting(held, saved.startup?.pid === held ? saved.startup : null);
    }
    yield* Effect.sleep(ASKED_EVERY_MS);
  }
});

export const restartMismatch = (actual: string | null, expected: string | null): string | null =>
  actual === expected ? null : `came back on ${actual ?? 'a checkout'} instead of ${expected ?? 'the checkout'}`;

export const requestRestart = Effect.fn('ServerStart.requestRestart')(function* (
  request: Effect.Effect<Restart, unknown>,
  before: StartupState,
  progress: Effect.Effect<StartupState>,
) {
  return yield* request.pipe(
    Effect.catchIf(
      (failure) =>
        HttpClientError.isHttpClientError(failure) && (failure.reason._tag === 'TransportError' || failure.reason._tag === 'DecodeError'),
      (failure) =>
        Effect.gen(function* () {
          yield* Effect.logDebug('the restart answer was lost; reading its acceptance', failure);
          for (;;) {
            const saved = yield* progress;
            const restart = saved.restart;
            if (
              restart !== null &&
              restart !== undefined &&
              (restart.id !== before.restart?.id ||
                restart.underway ||
                ((restart.stage === 'serving' || restart.stage === 'restored') && restart.stage !== before.restart?.stage))
            )
              return null;
            if (saved.startup !== null && saved.startup.pid !== before.startup?.pid) return null;
            yield* Effect.sleep(ASKED_EVERY_MS);
          }
        }),
    ),
  );
});

const unreadProgress = (path: string, detail: string): StartupState => ({
  startup: null,
  issue: { kind: 'unreadable', path, detail },
  restart: null,
});

export const readRemoteStartup = Effect.fn('ServerStart.readRemoteStartup')(function* (url: string) {
  const client = yield* HttpClient.HttpClient;
  for (const path of ['/startup', '/health']) {
    const address = `${url}${path}`;
    const saved = yield* client.execute(HttpClientRequest.get(address)).pipe(
      Effect.matchEffect({
        onFailure: (failure) => Effect.succeed(unreadProgress(address, String(failure))),
        onSuccess: (response) => {
          if (path === '/startup' && response.status === 404) return Effect.succeed(null);
          if (response.status !== 200 && response.status !== 503) return Effect.succeed(unreadProgress(address, `HTTP ${response.status}`));
          return response.json.pipe(
            Effect.flatMap((body) => Schema.decodeUnknownEffect(startupStateSchema)(body)),
            Effect.match({
              onFailure: (failure) => unreadProgress(address, String(failure)),
              onSuccess: (progress) => progress,
            }),
          );
        },
      }),
    );
    if (saved !== null) return saved;
  }
  return unreadProgress(url, 'the server publishes no startup state');
}, Effect.provide(FetchHttpClient.layer));

const reached = (startup: Startup | null): string => {
  if (startup === null || startup.status === 'ready') return '';
  const step = startup.step === null ? '' : `, migration ${startup.step.index} of ${startup.step.total}`;
  return startup.failure === null
    ? ` — its start is at ${startup.phase}${step}`
    : ` — its start failed in ${startup.failure.phase}: ${startup.failure.detail}`;
};

export const comingUp =
  (url: string, log: string): Waiting =>
  (pid, startup) =>
    Console.error(
      `${url} does not answer yet: ${typeof pid === 'number' ? `pid ${pid}` : 'a process'} holds ${dirname(log)} and is still coming up${reached(startup)} — its output goes to ${log}`,
    );
