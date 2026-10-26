import { processReader } from './posix/macos/processes';
import { Processes } from './ProcessReader';
// WHAT AN ENDED TERMINAL HOLDS, measured over a real PTY and a real child: nothing. A terminal's two
// master aliases and the notifier thread behind them are released when its OUTPUT is over, not when
// somebody retires the record — and the host's own count of open terminals says the same thing at the
// same instant.
//
// Bound to the retirement instead, this is the segment defect wearing the other transport: a record is
// retained until its owner retires it, an act no host performs for itself, so every terminal that
// simply ended held two descriptors, an OS thread and a threadsafe callback for the life of the host.
// The count hid it — `exited` gave the pty back at the child's death, so `host.terminals` read an ended
// terminal as holding nothing while its descriptors stood open, and the one ceiling that could have
// refused for them never could.

import { afterAll, describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, Layer, Schema } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import type { ConnectionId, CustodianEpoch, Role } from '@runlith/executions/protocol/registration';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionStop } from './registry/stops';
import { HostByteRecords, TerminalScreen } from './registry/reads';
import { HostLifecycle } from './registry/shutdown';
import { connectionOf, keyOf, registrationOf, stateDirectories } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder } from './posix/testing/holder';
import { loadLibrary, type LoadedLibrary } from './posix/Library';
import { runtimeProfile } from './runtimeFixture';

// The artifact the package's own `build:native` script leaves; the test script runs it first.
const ARTIFACT = join(import.meta.dir, '..', 'native/target/release/libexecution_platform.dylib');

const directories = stateDirectories('terminal-release-');
afterAll(() => directories.clear());

const decodePrincipal = Schema.decodeUnknownSync(Principal);

// A child that writes once and leaves at once: the case is about what the host holds AFTER the bytes,
// so the shortest child that still produces output is the whole of what it needs to run.
const launch = (program: string, args: ReadonlyArray<string>): LaunchRequest => ({
  command: {
    program,
    args,
    environment: [
      { name: 'PATH', value: '/usr/bin:/bin' },
      { name: 'TERM', value: 'xterm-256color' },
      { name: 'PS1', value: '' },
    ],
    cwd: '/tmp',
  },
  transport: { _tag: 'pty', geometry: { rows: 24, columns: 80 } },
  lifetime: 'held',
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd: '/tmp', dependencies: [] },
  holder: decodePrincipal('principal-operator'),
  origin: decodePrincipal('principal-operator'),
  budget: {},
});

const withTerminalHost = <A>(
  body: (host: {
    readonly hostExecutions: Executions['Service'];
    readonly stops: ExecutionStop['Service'];
    readonly byteRecords: HostByteRecords['Service'];
    readonly screens: TerminalScreen['Service'];
    readonly lifecycle: HostLifecycle['Service'];
    readonly capacity: (typeof ExecutionCapacity)['Service'];
    readonly claim: { readonly connection: ConnectionId; readonly epoch: CustodianEpoch; readonly role: Role };
  }) => Effect.Effect<A, unknown>,
): Effect.Effect<A, unknown> => {
  const directory = directories.open();
  const registration = registrationOf(directory);
  const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer, hostSpawner);
  const capacity = ExecutionCapacity.layer(runtimeProfile({ transports: ['pty'], rows: 40, columns: 120 }));
  return Effect.scoped(
    Effect.gen(function* () {
      const state = hostState(join(directory, 'executions.sqlite'), registration, yield* sharedPool).pipe(Layer.provideMerge(capacity));
      const library = yield* loadLibrary(ARTIFACT);
      const layer = ExecutionRegistry.layer().pipe(
        Layer.provide(Layer.effect(Processes, processReader(library))),
        Layer.provideMerge(Bindings.layer),
        Layer.provideMerge(state),
        Layer.provide(testHolder(directory)),
      );
      return yield* Effect.provide(
        Effect.gen(function* () {
          const custodian = yield* Custodian;
          const connection = connectionOf('connection-release');
          const taken = yield* custodian.take(keyOf('take-release'), 0, connection, 'custodian');
          return yield* body({
            hostExecutions: yield* Executions,
            stops: yield* ExecutionStop,
            byteRecords: yield* HostByteRecords,
            screens: yield* TerminalScreen,
            lifecycle: yield* HostLifecycle,
            capacity: yield* ExecutionCapacity,
            claim: { connection, epoch: taken.standing.epoch, role: 'custodian' },
          });
        }),
        layer,
      );
    }),
  ).pipe(Effect.provide(platform));
};

const descriptors = () => readdirSync('/dev/fd').length;

// The ending is measured on the execution's own fiber, after its sources drain and its exit is read.
// A fixed sleep would be a wall-clock assertion; this asks the runtime what it holds until the
// measurement has landed. `cleanup` leaving `pending` is that instant, and the release stands before
// it on the same road.
const untilMeasured = Effect.fnUntraced(function* (
  hostExecutions: Executions['Service'],
  execution: Parameters<Executions['Service']['summary']>[0],
) {
  for (;;) {
    const summary = yield* hostExecutions.summary(execution);
    if (summary !== undefined && summary.state.phase === 'ended' && summary.state.cleanup !== 'pending') return summary;
    yield* Effect.sleep(20);
  }
});

describe('what an ended terminal holds', () => {
  it.live('gives its descriptors and its place in the pty count back when its output ends, not at a retirement', () =>
    Effect.gen(function* () {
      const outcome = yield* withTerminalHost(({ hostExecutions, capacity, claim }) =>
        Effect.gen(function* () {
          // ONE TERMINAL RUN AND ENDED FIRST, so the baseline below is a warm host: the store opens its
          // write-ahead files on its first write and the library maps itself on its first spawn, and a
          // baseline read before either would count those as this execution's leak.
          const warm = yield* hostExecutions.start(claim, keyOf('release-warm'), launch('/bin/sh', ['-c', 'printf WARM']));
          if (warm._tag !== 'Started') return { warm } as never;
          yield* untilMeasured(hostExecutions, warm.execution.execution);

          const before = descriptors();
          // TWO, because one terminal's descriptors could be a constant and two are a RATE: the defect
          // this case exists for is accumulation per ended execution, and the figure that reached the
          // operator was ten thousand of them on one host. Nothing here waits on a clock — every read is
          // taken after the ending has been measured, which is a fact the runtime answers.
          const summaries = [];
          for (const key of ['release-1', 'release-2']) {
            const started = yield* hostExecutions.start(claim, keyOf(key), launch('/bin/sh', ['-c', 'printf RUNLITH_OUT']));
            if (started._tag !== 'Started') return { started } as never;
            summaries.push(yield* untilMeasured(hostExecutions, started.execution.execution));
          }
          // The records are NOT retired: this is exactly the state that held the descriptors for the
          // life of the host, and the point of the case is that nothing is waiting on that act.
          const ended = descriptors();
          const after = yield* capacity.ledger();
          return { before, summaries, ended, endedPtys: after.terminals };
        }),
      );

      // Both children ran, their bytes were all taken and their exits were READ, which is what makes
      // the release safe to make at all.
      expect(outcome.summaries.map((summary) => summary?.state.phase)).toEqual(['ended', 'ended']);
      expect(outcome.summaries.map((summary) => summary?.state.nativeExit)).toEqual([
        { _tag: 'Code', code: 0 },
        { _tag: 'Code', code: 0 },
      ]);

      // AND THE TERMINALS ARE BACK, with nothing retired: an ended terminal costs this host no
      // descriptor at all, and two of them cost no more than one. The crate cannot take the master
      // aliases until the notifier thread has retired, and the callback is freed in the same step, so
      // the descriptors returning is the whole act having run.
      expect(outcome.ended).toBe(outcome.before);
      // AND THE COUNT AGREES, which is the half that makes the bound a bound: a ceiling fed by a figure
      // that drops while the descriptors stand could never refuse for them.
      expect(outcome.endedPtys).toBe(0);
    }),
  );

  it.live('stays held once it ended and nothing reads it, because a pane reads its screen through the interpreter', () =>
    Effect.gen(function* () {
      const outcome = yield* withTerminalHost(({ hostExecutions, stops, byteRecords, screens, lifecycle, claim }) =>
        Effect.gen(function* () {
          const started = yield* hostExecutions.start(claim, keyOf('held-terminal'), launch('/bin/sh', ['-c', 'printf HELD']));
          if (started._tag !== 'Started') return { started } as never;
          const execution = started.execution.execution;
          const measured = yield* untilMeasured(hostExecutions, execution);
          yield* stops.stop(claim, keyOf('held-terminal-stop'), execution, 'explicit-stop', 'signal');
          const listed = yield* hostExecutions.list(undefined, 10);
          return {
            measured,
            listed: listed.executions.map((summary) => summary.state.ref.execution),
            sealed: yield* byteRecords.sealed(execution),
            screen: yield* Effect.result(screens.screen(execution)),
            kept: (yield* lifecycle.status()).kept?.records,
            execution,
          };
        }),
      );

      expect(outcome.measured?.state).toMatchObject({ phase: 'ended', cleanup: 'complete' });
      expect(outcome.listed).toContain(outcome.execution);
      expect(outcome.sealed).toBe(false);
      expect(outcome.screen._tag).toBe('Success');
      expect(outcome.kept).toBe(0);
    }),
  );
});
