import { watch } from 'node:fs';
import { join, resolve } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Processes } from '@runlith/execution-host/ProcessReader';
import { serverProcessesLayer } from '../children.js';
import { Cause, Clock, Context, Deferred, Effect, Exit, FileSystem, Layer, PlatformError, Queue, Schema, Stream } from 'effect';
import { RpcClient } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { digestOf } from '@runlith/executions/hostArtifacts';
import { ServerLaunch } from '../../installation/process/launch.js';
import { openVersion, swapCurrent, writeInstallation } from '../../installation/testing/doubles.js';
import { REQUIRED_ROLES, type InstallationPart } from '../../installation/contract/wire/manifest.js';
import { INSTALLATION_OPERATIONS } from '../../installation/contract/wire/operations.js';
import { healthSchema } from '../../http/contract/wire/health.js';
import { RESTART_RECORD, restartRecordSchema, type RestartRecord } from '../../installation/contract/wire/restart.js';
import { machineStateSchema } from '../../installation/contract/wire/machine.js';
import { liveSerialization, RESTARTING_CLOSE } from '../../platform/contract/wire/live.js';
import { TAGMA_SOCKET_PATH } from '../../socket/rpc.js';
import { LiveRpc } from './composed.js';
import { rolloutReadSchema, type RolloutRead } from '../../threads/contract/service/rolloutReads.js';
import { restartDataset, type RestartDataset, type RestartPlace } from './restartDataset.js';
import { RESTART_STEP_ENV } from './restartStep.js';
import type { WireSnapshot } from '../../threads/contract/wire/snapshot.js';

const checkpoint = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      projectId: Schema.Int,
      threadId: Schema.String,
      draft: Schema.String,
      startedAt: Schema.Finite,
    }),
  ),
);
const health = Schema.decodeUnknownEffect(healthSchema);
const machine = Schema.decodeUnknownEffect(INSTALLATION_OPERATIONS.read_machine_state.answer);
const machineState = Schema.decodeUnknownEffect(machineStateSchema);
const report = Schema.decodeUnknownEffect(INSTALLATION_OPERATIONS.report_restart_window.answer);
const restartRecord = Schema.decodeUnknownEffect(restartRecordSchema);
const observedRead = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      _tag: Schema.Literal('RolloutRead'),
      pid: Schema.Int,
      read: rolloutReadSchema,
    }),
  ),
);
export type RestartSample = {
  readonly dataset: RestartDataset;
  readonly place: RestartPlace;
  readonly windowMs: number;
  readonly acceptedMs: number;
  readonly frameMs: number;
  readonly transcript: WireSnapshot['transcript'];
  readonly before: WireSnapshot['before'];
  readonly frameReads: readonly RolloutRead[];
  readonly serverMs: number | null;
  readonly recoveryStartedAt: number | null;
  readonly recoveryDelayMs: number | null;
  readonly record: RestartRecord;
  readonly restored: RestartPlace;
  readonly buildBefore: string | null;
  readonly buildAfter: string | null;
  readonly rolloutReads: readonly RolloutRead[];
};
const storedRestart = Schema.decodeUnknownEffect(Schema.fromJsonString(restartRecordSchema));

const freePorts = Effect.acquireUseRelease(
  Effect.sync(() => Array.from({ length: 4 }, () => Bun.serve({ port: 0, fetch: () => new Response('') }))),
  (listeners) => {
    const ports = listeners.flatMap((listener) => (listener.port === undefined ? [] : [listener.port]));
    return ports.length === listeners.length ? Effect.succeed(ports) : Effect.die('a listener named no port');
  },
  (listeners) => Effect.promise(() => Promise.all(listeners.map((listener) => listener.stop(true)))),
);

export const makeRestartRig = Effect.fn('restart.rig')(function* () {
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'restart-window-' }));
  const [port, artifact, sandbox, remote] = yield* freePorts;
  if (port === undefined || artifact === undefined || sandbox === undefined || remote === undefined)
    return yield* Effect.die('the rig did not get four ports');
  const origin = `http://127.0.0.1:${port}`;
  const wall = yield* Clock.currentTimeMillis;
  const monotonic = yield* Clock.monotonicTimeNanos;
  const sourceClock = yield* Clock.Clock;
  const now = () => wall + Number(sourceClock.monotonicTimeNanosUnsafe() - monotonic) / 1_000_000;
  const clock = Effect.sync(now);
  const processes = Context.get(
    yield* Layer.build(serverProcessesLayer(resolve(import.meta.dir, '../../../../../..', 'packages/execution-host'), undefined)),
    Processes,
  );
  let launch: ServerLaunch | null = null;
  let build = 0;
  let dataset: RestartDataset | null = null;

  const guarded = <A, E, R>(work: Effect.Effect<A, E, R>) => {
    const held = launch;
    return held === null
      ? work
      : Effect.raceFirst(
          work,
          Effect.flatMap(
            Effect.promise(() => held.exited),
            (code) => Effect.die(new Error(`the owned server chain exited with ${code}`)),
          ),
        );
  };
  const ready = Effect.fn('restart.ready')(
    function* (previous?: number) {
      const directory = join(root, 'data');
      const changed = yield* Effect.acquireRelease(Queue.sliding<void, PlatformError.PlatformError>(1), Queue.shutdown);
      const failed = (cause: unknown) =>
        PlatformError.systemError({ _tag: 'Unknown', module: 'FileSystem', method: 'watch', pathOrDescriptor: directory, cause });
      yield* Effect.acquireRelease(
        Effect.try({
          try: () =>
            watch(directory, () => Queue.offerUnsafe(changed, undefined)).on('error', (cause) =>
              Queue.failCauseUnsafe(changed, Cause.fail(failed(cause))),
            ),
          catch: failed,
        }),
        (observer) => Effect.sync(() => observer.close()),
      );
      for (;;) {
        const text = yield* files
          .readFileString(join(root, 'data', RESTART_RECORD))
          .pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)));
        if (text !== null) {
          const record = yield* storedRestart(text);
          if (record.failure !== null) return yield* Effect.die(new Error(record.failure.detail));
          const startup = record.startup;
          if (startup?.readyAt != null && startup.pid !== previous) {
            const response = yield* Effect.tryPromise((signal) => fetch(`${origin}/health`, { signal }));
            const current = yield* health(yield* Effect.tryPromise(() => response.json()));
            if (current.database !== join(root, 'data/tagma.sqlite'))
              return yield* Effect.die('the address answers from outside the owned rig');
            return { ...current, pid: startup.pid };
          }
        }
        yield* Queue.take(changed);
      }
    },
    (effect, _previous?: number) => guarded(Effect.scoped(effect)),
  );

  const op = Effect.fn('restart.op')(function* (id: string, input: object, project?: number) {
    const response = yield* Effect.tryPromise((signal) =>
      fetch(`${origin}/api/op/${id}${project === undefined ? '' : `?project=${project}`}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      }),
    );
    const answer: unknown = yield* Effect.tryPromise(() => response.json());
    if (!response.ok) return yield* Effect.die(new Error(`${id}: ${response.status} ${JSON.stringify(answer)}`));
    return answer;
  });
  const install = Effect.fn('restart.install')(function* () {
    const identity = `fixture-${++build}`;
    const target = yield* Effect.try(() => openVersion(join(root, 'install'), identity));
    const parts: InstallationPart[] = [];
    for (const role of REQUIRED_ROLES) {
      const path = role === 'surface' ? 'surface/index.html' : `parts/${role}`;
      const text = role === 'surface' ? `<html><body>${identity}</body></html>` : role;
      yield* files.makeDirectory(join(target, role === 'surface' ? 'surface' : 'parts'), { recursive: true });
      yield* files.writeFileString(join(target, path), text);
      parts.push({
        role,
        path,
        kind: 'file',
        bytes: new TextEncoder().encode(text).length,
        digest: digestOf(new TextEncoder().encode(text)),
      });
    }
    yield* writeInstallation(target, { os: process.platform, arch: process.arch }, identity, parts).pipe(
      Effect.provideService(FileSystem.FileSystem, files),
    );
    yield* Effect.try(() => swapCurrent(join(root, 'install'), identity));
  });
  const stop = Effect.fn('restart.stop')(function* () {
    if (launch === null) return;
    const held = launch;
    yield* Effect.promise(() => held.stop('SIGTERM'));
    launch = null;
  });
  yield* Effect.addFinalizer((exit) =>
    Effect.gen(function* () {
      if (Exit.isFailure(exit)) {
        const log = yield* files
          .readFileString(join(root, 'data/serve.log'))
          .pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed('the owned server wrote no log')));
        yield* Effect.logError(log);
      }
    }).pipe(Effect.ensuring(stop()), Effect.orDie),
  );

  const stepMarker = join(root, 'successor-step');
  const prepare = Effect.fn('restart.prepare')(function* (messages: number, rested = false) {
    if (launch !== null) return yield* Effect.die('stop the owned server before changing its dataset');
    dataset = yield* restartDataset(root, messages, dataset ?? undefined, rested);
    yield* install();
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(([key, value]) => !key.startsWith('TAGMA_') && value !== undefined),
    );
    launch = new ServerLaunch(
      [process.execPath, join(import.meta.dir, 'restartServe.ts'), 'serve'],
      {
        ...inherited,
        [RESTART_STEP_ENV]: stepMarker,
        HOME: root,
        TAGMA_DATABASE_PATH: join(root, 'data/tagma.sqlite'),
        TAGMA_SEED_DIRECTORY: join(root, 'seeds'),
        TAGMA_INSTALL_ROOT: join(root, 'install'),
        TAGMA_PORT: String(port),
        TAGMA_ARTIFACT_PORT: String(artifact),
        TAGMA_SANDBOX_PORT: String(sandbox),
        TAGMA_REMOTE_PORT: String(remote),
        TAGMA_SQLITE_READERS: '1',
        TAGMA_OBSERVE_ROLLOUT: '1',
      },
      join(root, 'data/serve.log'),
      processes,
    );
    yield* ready();
  });
  const place = (index: number): RestartPlace => {
    const found = dataset?.places[index];
    if (found === undefined) throw new Error(`the dataset has no place ${index}`);
    return found;
  };
  const connect = (closed?: Deferred.Deferred<number>) => {
    const constructor = Layer.succeed(Socket.WebSocketConstructor, (url, options) => {
      if (options !== undefined && typeof options !== 'string' && !Array.isArray(options))
        throw new TypeError('the restart client accepts WebSocket protocols only');
      const socket = new WebSocket(url, options);
      if (closed !== undefined)
        socket.addEventListener(
          'close',
          (event) =>
            Deferred.doneUnsafe(
              closed,
              event.code === RESTARTING_CLOSE
                ? Exit.succeed(now())
                : Exit.die(new Error(`the restart client closed with ${event.code}: ${event.reason}`)),
            ),
          { once: true },
        );
      return socket;
    });
    const protocol = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(Socket.layerWebSocket(`${origin.replace('http:', 'ws:')}${TAGMA_SOCKET_PATH}`)),
      Layer.provide(liveSerialization),
      Layer.provide(constructor),
    );
    return Effect.flatMap(Layer.build(protocol), (context) => Effect.provide(RpcClient.make(LiveRpc), context));
  };
  const reads = Effect.fn('restart.reads')(function* (pid: number) {
    const reads: RolloutRead[] = [];
    for (const line of (yield* files.readFileString(join(root, 'data/serve.log'))).split('\n')) {
      const at = line.indexOf('{"_tag":"RolloutRead"');
      if (at < 0) continue;
      const observed = yield* observedRead(line.slice(at));
      if (observed.pid === pid) reads.push(observed.read);
    }
    return reads;
  });
  const sample = Effect.fn('restart.sample')(function* (location: RestartPlace, successor: { readonly step?: boolean } = {}) {
    if (dataset === null || launch === null) return yield* Effect.die('the rig has not prepared a dataset');
    const heldDataset = dataset;
    const before = yield* ready();
    const startedAt = yield* Effect.scoped(
      Effect.gen(function* () {
        const closed = yield* Deferred.make<number>();
        const client = yield* connect(closed);
        yield* Stream.runCollect(
          Stream.take(client['thread.subscribe']({ projectId: location.projectId, threadId: location.threadId }), 1),
        );
        yield* install();
        if (successor.step === true) yield* files.writeFileString(stepMarker, '');
        yield* op('restart_server', {});
        return yield* guarded(Deferred.await(closed));
      }),
    );
    const saved = join(root, 'client.json');
    yield* files.writeFileString(saved, JSON.stringify({ ...location, startedAt }));
    const after = yield* ready(before.pid);
    const restored = yield* checkpoint(yield* files.readFileString(saved));
    const {
      record,
      windowMs,
      acceptedMs,
      frameMs,
      transcript,
      before: beforeEntry,
      frameReads,
    } = yield* Effect.scoped(
      Effect.flatMap(connect(), (client) =>
        Effect.gen(function* () {
          const requestedAt = yield* clock;
          const frames = yield* Stream.runCollect(
            Stream.take(client['thread.subscribe']({ projectId: restored.projectId, threadId: restored.threadId }), 1),
          );
          const first = frames[0];
          if (first?.type !== 'snapshot' || first.payload.snapshot.thread.id !== restored.threadId)
            return yield* Effect.die('the client returned to another thread');
          const framedAt = yield* clock;
          const windowMs = framedAt - restored.startedAt;
          const frameMs = framedAt - requestedAt;
          const frameReads = yield* reads(after.pid);
          yield* op('set_thread_title', { threadId: restored.threadId, title: 'returned place' }, restored.projectId);
          const acceptedMs = (yield* clock) - restored.startedAt;
          const state = yield* machine(yield* op('read_machine_state', {}));
          if (state.status !== 'read') return yield* Effect.die('the successor did not return its machine state');
          const current = yield* machineState(state.machine);
          if (current.restart.record === null) return yield* Effect.die('the successor has no restart record');
          const answered = yield* report(
            yield* op('report_restart_window', {
              restartId: current.restart.record.id,
              clientId: 'test-client',
              door: 'local',
              projectId: restored.projectId,
              threadId: restored.threadId,
              durationMs: windowMs,
            }),
          );
          if (answered.status !== 'recorded') return yield* Effect.die('the successor did not record the client window');
          return {
            record: yield* restartRecord(answered.restart),
            windowMs,
            acceptedMs,
            frameMs,
            transcript: first.payload.snapshot.transcript,
            before: first.payload.snapshot.before,
            frameReads,
          };
        }),
      ),
    );
    const recoveryStartedAt = record.phases.find((phase) => phase.name === 'run recovery triggered')?.startedAt ?? null;
    const doorClosedAt = record.points.find((point) => point.name === 'door-closed' && point.door === 'local')?.at ?? null;
    return {
      dataset: heldDataset,
      place: location,
      restored,
      windowMs,
      acceptedMs,
      frameMs,
      transcript,
      before: beforeEntry,
      frameReads,
      record,
      serverMs: record.frames.find((frame) => frame.door === 'local')?.intervalMs ?? null,
      recoveryStartedAt,
      recoveryDelayMs: recoveryStartedAt === null || doorClosedAt === null ? null : recoveryStartedAt - doorClosedAt,
      buildBefore: before.builds.surface.served?.build ?? null,
      buildAfter: after.builds.surface.served?.build ?? null,
      rolloutReads: yield* reads(after.pid),
    } satisfies RestartSample;
  });
  return { root, origin, place, prepare, sample, op, stop };
}, Effect.provide(BunFileSystem.layer));

export type RestartRig = Effect.Success<ReturnType<typeof makeRestartRig>>;
