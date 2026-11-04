import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { processReader } from './composition/testing/native';
import { Processes } from './ProcessReader';
import { tempoLayer } from './posix/Tempo';
import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, type Scope } from 'effect';
import { TestClock } from 'effect/testing';
import type { ExecutionId, ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { reserveOf } from '@runlith/executions/protocol/capacity';
import { byteOffset, offsetValue } from '@runlith/executions/protocol/record';
import { SEAL_FILE } from '@runlith/executions/recordFormat';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { Principal } from '@runlith/executions/protocol/custody';
import { CustodianEpoch } from '@runlith/executions/protocol/registration';
import type { HostClaim } from './registry/state';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionRequest } from './registry/operations';
import { InputLanes, CustodyControl } from './registry/control';
import { ExecutionStop } from './registry/stops';
import { HostByteRecords } from './registry/reads';
import { ExecutionRetirement } from './registry/retention';
import { HostLifecycle } from './registry/shutdown';
import { ExecutionStore } from './store/ExecutionStore';
import { Holder, type HeldExecution, type WorkState } from './holder/Holder';
import { connectionOf, keyOf, principalOf, registrationOf } from './hostFixture';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { testHolder, HOLDER_LIBRARY } from './posix/testing/holder';
import { runtimeProfile } from './runtimeFixture';
import { loadLibrary } from './posix/Library';
import { pidStanding } from './posix/testing/processes';

const ARTIFACT = HOLDER_LIBRARY;

const waitFor = Effect.fnUntraced(function* <A, E, R>(
  executions: Executions['Service'],
  execution: ExecutionId,
  read: Effect.Effect<A, E, R>,
  ready: (value: A) => boolean,
) {
  for (;;) {
    const changed = yield* executions.changed(execution);
    const value = yield* read;
    if (ready(value)) return value;
    yield* changed;
  }
});

const summaryWhen = (executions: Executions['Service'], execution: ExecutionId, ready: (summary: ExecutionSummary) => boolean) =>
  waitFor(executions, execution, executions.summary(execution), (summary) => summary !== undefined && ready(summary));

const outputWhen = Effect.fnUntraced(function* (records: HostByteRecords['Service'], ref: ExecutionRef, ready: (text: string) => boolean) {
  const reader = yield* records.openReader(ref.execution, 'stdout', byteOffset(0n));
  let text = '';
  while (!ready(text)) {
    const more = yield* records.awaitBytes(ref.execution, reader);
    if (!more) return yield* Effect.die(new Error(`stdout ended before the child was ready: ${text}`));
    yield* records.grant(ref.execution, reader, 4096);
    const read = yield* records.pull(ref.execution, reader);
    text += new TextDecoder().decode(read.bytes);
  }
  return text;
}, Effect.scoped);

const bytesPast = Effect.fnUntraced(function* (records: HostByteRecords['Service'], ref: ExecutionRef, offset: bigint) {
  const reader = yield* records.openReader(ref.execution, 'stdout', byteOffset(offset));
  expect(yield* records.awaitBytes(ref.execution, reader)).toBe(true);
}, Effect.scoped);

const decodePrincipal = Principal.make;

const launchOf = (program: string, args: ReadonlyArray<string>, holder: string): LaunchRequest => ({
  command: { program, args, environment: [{ name: 'PATH', value: '/usr/bin:/bin' }] },
  transport: { _tag: 'pipes', stdin: 'pipe' },
  lifetime: 'held',
  purpose: 'command',
  target: { environment: 'environment-1', namespace: 'namespace-1', cwd: '/tmp', dependencies: [] },
  holder: decodePrincipal(holder),
  origin: decodePrincipal(holder),
  budget: {},
});

type HeldFileInput = { readonly held: Deferred.Deferred<void>; readonly entered: Deferred.Deferred<void>; readonly act: 'read' | 'sync' };
const makeHoldingFiles = Effect.fnUntraced(function* ({ held, entered, act }: HeldFileInput) {
  const real = yield* FileSystem.FileSystem;
  let seen = false;
  const pause = Effect.fnUntraced(function* <A, E>(work: Effect.Effect<A, E>) {
    if (seen) return yield* work;
    seen = true;
    yield* Deferred.succeed(entered, undefined);
    yield* Deferred.await(held);
    return yield* work;
  });
  return {
    ...real,
    open: (path: string, options?: Parameters<FileSystem.FileSystem['open']>[1]) =>
      Effect.map(real.open(path, options), (file): FileSystem.File => ({
        [FileSystem.FileTypeId]: FileSystem.FileTypeId,
        stat: file.stat,
        sync: act === 'sync' && path.includes(`/${SEAL_FILE}.`) ? pause(file.sync) : file.sync,
        seek: (offset, from) => file.seek(offset, from),
        readAlloc: (size) => file.readAlloc(size),
        truncate: (length) => file.truncate(length),
        write: (buffer) => file.write(buffer),
        writeAll: (buffer) => file.writeAll(buffer),
        read: (buffer) => (act === 'read' ? pause(file.read(buffer)) : file.read(buffer)),
      })),
  } satisfies FileSystem.FileSystem;
});

type RuntimeWorld = {
  readonly hostExecutions: Executions['Service'];
  readonly requests: ExecutionRequest['Service'];
  readonly lanes: InputLanes['Service'];
  readonly custodyControl: CustodyControl['Service'];
  readonly stops: ExecutionStop['Service'];
  readonly byteRecords: HostByteRecords['Service'];
  readonly retirement: ExecutionRetirement['Service'];
  readonly lifecycle: HostLifecycle['Service'];
  readonly bindings: Bindings['Service'];
  readonly custodian: Custodian['Service'];
  readonly capacity: ExecutionCapacity['Service'];
  readonly store: ExecutionStore['Service'];
  readonly claim: HostClaim;
};
type RuntimeGate = { readonly held: Deferred.Deferred<void>; readonly entered: Deferred.Deferred<void>; readonly arrivals?: number };
type RuntimeOptions = {
  readonly executions?: number;
  readonly holdRead?: RuntimeGate;
  readonly holdSeal?: RuntimeGate;
  readonly holdVacate?: RuntimeGate;
  readonly holdOutput?: RuntimeGate;
  readonly unmeasured?: { readonly vacated: Deferred.Deferred<void> };
  readonly shutdownMs?: number;
  readonly library?: boolean;
};
const withHost = Effect.fnUntraced(function* <A, E>(
  body: (host: RuntimeWorld) => Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem>,
  options: RuntimeOptions = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'execution-runtime-' });
  const registration = registrationOf(directory);
  const holding = options.holdRead ?? options.holdSeal;
  const files =
    holding === undefined
      ? BunFileSystem.layer
      : Layer.effect(
          FileSystem.FileSystem,
          makeHoldingFiles({ held: holding.held, entered: holding.entered, act: options.holdRead === undefined ? 'sync' : 'read' }),
        ).pipe(Layer.provide(BunFileSystem.layer));
  const heldHolder = Layer.effectContext(Effect.map(Layer.build(testHolder(directory)), Context.omit(Processes)));
  const vacating = options.holdVacate;
  const output = options.holdOutput;
  const unmeasured = options.unmeasured;
  const closing = new Set<string>();
  const measuredAs = (child: HeldExecution): HeldExecution =>
    unmeasured === undefined
      ? child
      : {
          ...child,
          get reaped() {
            return child.reaped;
          },
          workState: Effect.succeed<WorkState>('unmeasured'),
        };
  const holder =
    vacating === undefined && output === undefined && unmeasured === undefined
      ? heldHolder
      : Layer.effect(
          Holder,
          Effect.map(Holder, (real) => ({
            ...real,
            launch: (launch) =>
              Effect.map(real.launch(launch), (launched) => {
                const child = measuredAs(launched);
                return output === undefined
                  ? child
                  : {
                      ...child,
                      get reaped() {
                        return launched.reaped;
                      },
                      closeOutput: Effect.andThen(
                        Effect.suspend(() => {
                          closing.add(child.id);
                          return closing.size >= (output.arrivals ?? 1) ? Deferred.succeed(output.entered, undefined) : Effect.void;
                        }),
                        Effect.andThen(Deferred.await(output.held), child.closeOutput),
                      ),
                    };
              }),
            vacate:
              vacating !== undefined
                ? Effect.andThen(Deferred.succeed(vacating.entered, undefined), Effect.andThen(Deferred.await(vacating.held), real.vacate))
                : unmeasured !== undefined
                  ? Effect.andThen(Deferred.succeed(unmeasured.vacated, undefined), real.vacate)
                  : real.vacate,
          })),
        ).pipe(Layer.provideMerge(heldHolder));
  const platform = Layer.mergeAll(files, BunPath.layer, hostSpawner);
  const capacity = ExecutionCapacity.layer(
    runtimeProfile({
      executions: options.executions ?? 1,
      transports: ['pipes'],
      shutdownMs: options.shutdownMs,
    }),
  );
  const state = hostState(join(directory, 'executions.sqlite'), registration, yield* sharedPool).pipe(Layer.provideMerge(capacity));
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const library = options.library === true ? yield* loadLibrary(ARTIFACT) : undefined;
      const layer = ExecutionRegistry.layer().pipe(
        Layer.provide(library === undefined ? Layer.empty : Layer.effect(Processes, processReader(library))),
        Layer.provide(tempoLayer),
        Layer.provideMerge(Bindings.layer),
        Layer.provideMerge(state),
        Layer.provide(holder),
      );
      return yield* Effect.provide(
        Effect.gen(function* () {
          const custodian = yield* Custodian;
          const connection = connectionOf('connection-host');
          const taken = yield* custodian.take(keyOf('take-host'), 0, connection, 'custodian');
          const hostExecutions = yield* Executions;
          const requests = yield* ExecutionRequest;
          const lanes = yield* InputLanes;
          const custodyControl = yield* CustodyControl;
          const stops = yield* ExecutionStop;
          const byteRecords = yield* HostByteRecords;
          const retirement = yield* ExecutionRetirement;
          const lifecycle = yield* HostLifecycle;
          const claim = { connection, epoch: taken.standing.epoch, role: 'custodian' } as const;
          return yield* body({
            hostExecutions,
            requests,
            lanes,
            custodyControl,
            stops,
            byteRecords,
            retirement,
            lifecycle,
            bindings: yield* Bindings,
            custodian,
            capacity: yield* ExecutionCapacity,
            store: yield* ExecutionStore,
            claim,
          }).pipe(Effect.ensuring(lifecycle.shutdown(claim, keyOf('with-host-end')).pipe(Effect.orDie, Effect.asVoid)));
        }),
        layer,
      );
    }),
  ).pipe(Effect.provide(platform));
}, Effect.provide(BunFileSystem.layer));

const authority = Effect.fnUntraced(function* (bindings: (typeof Bindings)['Service'], claim: HostClaim, name: string) {
  const principal = principalOf(`principal-${name}`);
  const binding = yield* bindings.open(principal, claim.connection, claim.epoch);
  return { connection: claim.connection, principal, binding, epoch: claim.epoch };
});

describe('the live execution runtime', () => {
  it.live('conditional prevention spends an absent start key but never stops an admitted child', () =>
    Effect.gen(function* () {
      yield* withHost(({ hostExecutions, stops, claim }) =>
        Effect.gen(function* () {
          const absent = keyOf('prevent-absent');
          expect((yield* hostExecutions.cancelStart(claim, absent, 'explicit-stop', 'recovery', 'unadmitted'))._tag).toBe('Prevented');
          expect((yield* hostExecutions.start(claim, absent, launchOf('/usr/bin/perl', ['-e', 'sleep while 1'], 'agent')))._tag).toBe(
            'Cancelled',
          );
          const live = keyOf('prevent-live');
          const started = yield* hostExecutions.start(claim, live, launchOf('/usr/bin/perl', ['-e', 'sleep while 1'], 'agent'));
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`start failed: ${started._tag}`));
          expect((yield* hostExecutions.cancelStart(claim, live, 'explicit-stop', 'recovery', 'unadmitted'))._tag).toBe('Refused');
          expect((yield* hostExecutions.summary(started.execution.execution))?.state.phase).toBe('running');
          expect(yield* stops.ending(started.execution.execution)).toBeUndefined();
          yield* stops.stop(claim, keyOf('prevent-cleanup'), started.execution.execution, 'explicit-stop', 'signal');
        }),
      );
    }),
  );
  it.live('tells two launches apart by what the child would actually be, environment values included', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, claim }) =>
        Effect.gen(function* () {
          const key = keyOf('start-identity');
          const launch = {
            ...launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
            command: {
              program: '/bin/sh',
              args: ['-c', 'exec /usr/bin/perl -e "sleep while 1"'],
              environment: [
                { name: 'PATH', value: '/usr/bin:/bin' },
                { name: 'TOKEN', value: 'first-secret' },
              ],
            },
          } satisfies LaunchRequest;
          const first = yield* hostExecutions.start(claim, key, launch);
          const same = yield* hostExecutions.start(claim, key, launch);
          const revalued = yield* hostExecutions.start(claim, key, {
            ...launch,
            command: {
              ...launch.command,
              environment: [
                { name: 'PATH', value: '/usr/bin:/bin' },
                { name: 'TOKEN', value: 'second-secret' },
              ],
            },
          });
          const reconfigured = yield* hostExecutions.start(claim, key, { ...launch, transport: { _tag: 'pipes', stdin: 'ignore' } });
          const reworded = yield* hostExecutions.start(claim, key, { ...launch, command: { ...launch.command, args: ['-c', 'sleep 9'] } });
          const page = yield* hostExecutions.list(undefined, 10);
          return { first, same, revalued, reconfigured, reworded, count: page.executions.length };
        }),
      );

      expect(outcome.first._tag).toBe('Started');
      expect(outcome.same._tag).toBe('Started');
      if (outcome.first._tag === 'Started' && outcome.same._tag === 'Started') {
        expect(outcome.same.execution.execution).toBe(outcome.first.execution.execution);
      }
      expect(outcome.revalued._tag).toBe('Refused');
      if (outcome.revalued._tag === 'Refused') expect(outcome.revalued.refusal._tag).toBe('OperationConflict');
      expect(outcome.reconfigured._tag).toBe('Refused');
      if (outcome.reconfigured._tag === 'Refused') expect(outcome.reconfigured.refusal._tag).toBe('OperationConflict');
      expect(outcome.reworded._tag).toBe('Refused');
      if (outcome.reworded._tag === 'Refused') expect(outcome.reworded.refusal._tag).toBe('OperationConflict');
      expect(outcome.count).toBe(1);
    }),
  );

  it.live('refuses a terminal launch on a host that loaded no terminal library', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, claim }) =>
        hostExecutions.start(claim, keyOf('start-pty'), {
          ...launchOf('/bin/sh', ['-c', 'sleep 1'], 'agent'),
          transport: { _tag: 'pty', geometry: { rows: 24, columns: 80 } },
        }),
      );
      expect(outcome._tag).toBe('Refused');
      if (outcome._tag === 'Refused') expect(outcome.refusal._tag).toBe('UnsupportedCapability');
    }),
  );

  it.live('takes repeated input over pipes and closes the child stdin only on the act that asks for it', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, lanes, byteRecords, bindings, claim }) =>
        Effect.gen(function* () {
          const held = yield* authority(bindings, claim, 'stdin');
          const started = yield* hostExecutions.start(
            claim,
            keyOf('stdin-1'),
            launchOf('/bin/sh', ['-c', 'cat; echo done; exec /usr/bin/perl -e "sleep while 1"'], 'principal-stdin'),
          );
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`stdin child: ${started._tag}`));
          const ref = started.execution;
          const typing = { binding: held.binding.id, principal: held.principal, connection: held.connection, epoch: held.epoch };
          const typed = (sequence: number, text: string) =>
            lanes.admit(ref.execution, typing, {
              sequence,
              cause: 'typed',
              act: { _tag: 'Write', bytes: new TextEncoder().encode(text) },
            });
          const first = yield* typed(0, 'first\n');
          const repeated = yield* typed(0, 'first\n');
          const conflicting = yield* typed(0, 'other\n');
          const second = yield* typed(1, 'second\n');
          const ended = yield* lanes.admit(ref.execution, typing, {
            sequence: 2,
            cause: 'end',
            act: { _tag: 'End' },
          });
          const written = yield* outputWhen(byteRecords, ref, (text) => text.includes('done'));
          const afterwards = yield* typed(3, 'late\n');
          const phase = (yield* hostExecutions.summary(ref.execution))?.state.phase;
          return { first, repeated, conflicting, second, ended, written, afterwards, phase };
        }),
      );

      expect(outcome.first._tag).toBe('InputAdmitted');
      if (outcome.first._tag === 'InputAdmitted') expect(String(outcome.first.receipt.acceptedThrough)).toBe('6');
      expect(outcome.repeated).toEqual(outcome.first);
      expect(outcome.conflicting._tag).toBe('InputConflict');
      expect(outcome.second._tag).toBe('InputAdmitted');
      expect(outcome.ended._tag).toBe('InputAdmitted');
      expect(outcome.written).toBe('first\nsecond\ndone\n');
      expect(outcome.afterwards).toEqual({ _tag: 'InputEnded' });
      expect(outcome.phase).toBe('running');
    }),
  );

  it.live('refuses an interrupt on a transport that has no line discipline, without ending the child', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, lanes, bindings, claim }) =>
        Effect.gen(function* () {
          const held = yield* authority(bindings, claim, 'interrupt');
          const started = yield* hostExecutions.start(claim, keyOf('interrupt-1'), launchOf('/bin/cat', [], 'principal-interrupt'));
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`interrupt child: ${started._tag}`));
          const typing = { binding: held.binding.id, principal: held.principal, connection: held.connection, epoch: held.epoch };
          const answered = yield* lanes.admit(started.execution.execution, typing, {
            sequence: 0,
            cause: 'interrupt',
            act: { _tag: 'Interrupt' },
          });
          const page = yield* hostExecutions.list(undefined, 10);
          return { answered, phase: page.executions[0]?.state.phase };
        }),
      );
      expect(outcome.answered._tag).toBe('InputUnsupported');
      if (outcome.answered._tag === 'InputUnsupported') {
        expect(outcome.answered.act).toBe('interrupt');
        expect(outcome.answered.reason).toBe('transport');
      }
      expect(outcome.phase).toBe('running');
    }),
  );

  it.live('stops with no viewer and no credit, and reports what it confirmed', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, stops, claim }) =>
        Effect.gen(function* () {
          const started = yield* hostExecutions.start(
            claim,
            keyOf('stop-1'),
            launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
          );
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`stop child: ${started._tag}`));
          const armed = yield* hostExecutions.changed(started.execution.execution);
          const receipt = yield* stops.stop(claim, keyOf('stop-op-1'), started.execution.execution, 'explicit-stop', 'destroy');
          const woken = yield* armed.pipe(Effect.as(true));
          return { receipt, woken };
        }),
      );
      expect(outcome.woken).toBe(true);
      expect(outcome.receipt.cause).toBe('explicit-stop');
      expect(outcome.receipt.requested).toBe('destroy');
      expect(outcome.receipt.confirmed.map((ending) => ending.relation)).toEqual(['leader', 'work']);
      expect(outcome.receipt.relation).toBe('covered');
      expect(outcome.receipt.residual).toEqual([]);
      expect(outcome.receipt.cleanup).toBe('complete');
    }),
  );

  it.live('stops a forking child as its group and reports the group it measured, never the leader alone', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, stops, byteRecords, claim }) =>
        Effect.gen(function* () {
          const started = yield* hostExecutions.start(
            claim,
            keyOf('stop-group-1'),
            launchOf(
              '/bin/sh',
              ['-c', 'trap "" INT; trap "exit 7" TERM; /usr/bin/perl -e "sleep while 1" & printf "%s\\n" "$!"; wait'],
              'agent',
            ),
          );
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`group child: ${started._tag}`));
          yield* outputWhen(byteRecords, started.execution, (text) => text.includes('\n'));
          const receipt = yield* stops.stop(claim, keyOf('stop-group-op-1'), started.execution.execution, 'explicit-stop', 'signal');
          return { receipt };
        }),
      );
      expect(outcome.receipt.confirmed.map((ending) => ending.relation)).toEqual(['leader', 'work']);
      expect(outcome.receipt.relation).toBe('covered');
      expect(outcome.receipt.residual).toEqual([]);
      expect(outcome.receipt.cleanup).toBe('complete');
      expect(outcome.receipt.steps).toEqual(['interrupt', 'terminate']);
      expect(outcome.receipt.confirmed.find((ending) => ending.relation === 'work')?.step).toBe('terminate');
    }),
  );

  it.live('destroys a forking child as its group, so the fork does not outlive the destruction', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, stops, byteRecords, claim }) =>
        Effect.gen(function* () {
          const started = yield* hostExecutions.start(
            claim,
            keyOf('destroy-group-1'),
            launchOf('/bin/sh', ['-c', 'trap "exit 7" TERM; /usr/bin/perl -e "sleep while 1" & printf "%s\\n" "$!"; wait'], 'agent'),
          );
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`destroy child: ${started._tag}`));
          const announced = yield* outputWhen(byteRecords, started.execution, (text) => text.includes('\n'));
          const forked = Number(announced.trim());
          const receipt = yield* stops.stop(claim, keyOf('destroy-group-op-1'), started.execution.execution, 'explicit-stop', 'destroy');
          const standing = yield* pidStanding(forked);
          return { receipt, forked, standing };
        }),
      );
      expect(outcome.forked).toBeDefined();
      expect(outcome.standing).toBe('gone');
      expect(outcome.receipt.confirmed.map((ending) => ending.relation)).toEqual(['leader', 'work']);
      expect(outcome.receipt.relation).toBe('covered');
      expect(outcome.receipt.residual).toEqual([]);
      expect(outcome.receipt.cleanup).toBe('complete');
    }),
  );

  it.live('ends the descendant that left the group, and claims that population only because it read it', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(
        ({ hostExecutions, stops, byteRecords, claim }) =>
          Effect.gen(function* () {
            const started = yield* hostExecutions.start(
              claim,
              keyOf('stop-ancestry-1'),
              launchOf('/bin/sh', ['-c', "perl -e 'use POSIX; POSIX::setsid(); $|=1; print qq{$$\\n}; sleep while 1' & wait"], 'agent'),
            );
            if (started._tag !== 'Started') return yield* Effect.die(new Error(`ancestry child: ${started._tag}`));
            const announced = yield* outputWhen(byteRecords, started.execution, (text) => text.includes('\n'));
            const found = Number(announced.trim());
            const receipt = yield* stops.stop(claim, keyOf('stop-ancestry-op-1'), started.execution.execution, 'explicit-stop', 'signal');
            return { receipt, found, standing: yield* pidStanding(found) };
          }),
        { library: true },
      );
      expect(outcome.found).toBeDefined();
      expect(outcome.standing).toBe('gone');
      expect(outcome.receipt.coverage).toEqual(['leader', 'work', 'ancestry']);
      expect(outcome.receipt.relation).toBe('covered');
      expect(outcome.receipt.residual).toEqual([]);
      expect(outcome.receipt.unverifiable).toEqual([]);
      expect(outcome.receipt.cleanup).toBe('complete');
    }),
  );

  it.live('stops a child flooding past retention and still measures what it covered, byte-exact', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, stops, byteRecords, claim }) =>
        Effect.gen(function* () {
          const lines = 400000;
          const started = yield* hostExecutions.start(
            claim,
            keyOf('stop-flood-1'),
            launchOf('/bin/sh', ['-c', `awk 'BEGIN{for(i=0;i<${lines};i++) printf "%050d\\n", i}'`], 'agent'),
          );
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`flood child: ${started._tag}`));
          const ref = started.execution;
          yield* bytesPast(byteRecords, ref, 65536n);
          const receipt = yield* stops.stop(claim, keyOf('stop-flood-op-1'), ref.execution, 'explicit-stop', 'signal');
          const summary = yield* summaryWhen(hostExecutions, ref.execution, (summary) =>
            summary.streams.some((stream) => stream.stream === 'stdout' && stream.ending !== 'open'),
          );
          const stdout = summary?.streams.find((positions) => positions.stream === 'stdout');
          let offset = offsetValue(stdout!.retainedFrom);
          let held = '';
          for (;;) {
            const read = yield* byteRecords.read({ ref, stream: 'stdout', offset: byteOffset(offset) }, 65536);
            held += Buffer.from(read.bytes).toString();
            if (!read.range.gap && offsetValue(read.range.next) >= offsetValue(stdout!.durableThrough)) break;
            if (offsetValue(read.range.next) <= offset) break;
            offset = offsetValue(read.range.next);
          }
          return { receipt, stdout, held, lines };
        }),
      );
      expect(outcome.receipt.cause).toBe('explicit-stop');
      expect(outcome.receipt.confirmed.map((ending) => ending.relation)).toEqual(['leader', 'work']);
      expect(outcome.receipt.relation).toBe('covered');
      expect(outcome.receipt.residual).toEqual([]);
      expect(outcome.receipt.unverifiable).toEqual([]);
      expect(outcome.receipt.cleanup).toBe('complete');
      expect(offsetValue(outcome.stdout!.durableThrough)).toBeGreaterThan(65536n);
      expect(offsetValue(outcome.stdout!.retainedFrom)).toBeGreaterThan(0n);
      const fragments = outcome.held.split('\n');
      if (fragments[fragments.length - 1] === '') fragments.pop();
      else fragments.pop();
      if (offsetValue(outcome.stdout!.retainedFrom) > 0n) fragments.shift();
      const numbers = fragments.map((line) => Number(line));
      expect(numbers.length).toBeGreaterThan(0);
      expect(numbers.every((n) => Number.isInteger(n))).toBe(true);
      expect(numbers.every((n, i) => i === 0 || n === numbers[i - 1]! + 1)).toBe(true);
      expect(numbers[numbers.length - 1]).toBeLessThan(outcome.lines);
      if (offsetValue(outcome.stdout!.retainedFrom) === 0n) expect(numbers[0]).toBe(0);
    }),
  );

  it.live("holds an execution's record until it is forgotten, not until its process exits", () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(
        ({ hostExecutions, stops, retirement, capacity, claim, store }) =>
          Effect.gen(function* () {
            const files = yield* FileSystem.FileSystem;
            const records = join((yield* store.incarnation()).registration.state, 'records');
            const started = yield* hostExecutions.start(
              claim,
              keyOf('capacity-1'),
              launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
            );
            if (started._tag !== 'Started') return yield* Effect.die(new Error(`capacity child: ${started._tag}`));
            const early = yield* retirement.forget(started.execution.execution);
            yield* stops.stop(claim, keyOf('capacity-stop'), started.execution.execution, 'explicit-stop', 'signal');
            const afterExit = (yield* capacity.account()).reservations.size;
            const filesBefore = (yield* files.readDirectory(records, { recursive: true })).length;
            const forgotten = yield* retirement.forget(started.execution.execution);
            const afterForget = (yield* capacity.account()).reservations.size;
            const filesAfter = (yield* files.readDirectory(records, { recursive: true })).length;
            return { early, afterExit, forgotten, afterForget, filesBefore, filesAfter };
          }),
        { executions: 1 },
      );
      expect(outcome.early._tag).toBe('ForgetRefused');
      expect(outcome.afterExit).toBe(1);
      expect(outcome.forgotten._tag).toBe('Forgotten');
      expect(outcome.afterForget).toBe(0);
      expect(outcome.filesBefore).toBeGreaterThan(0);
      expect(outcome.filesAfter).toBe(0);
    }),
  );

  it.live('keeps every resource while an admitted read is still running, and finishes once it has', () =>
    Effect.gen(function* () {
      const gate = Deferred.makeUnsafe<void>();
      const reached = Deferred.makeUnsafe<void>();
      const outcome = yield* withHost(
        ({ hostExecutions, stops, byteRecords, retirement, capacity, claim }) =>
          Effect.gen(function* () {
            const started = yield* hostExecutions.start(claim, keyOf('retire-1'), {
              ...launchOf('/bin/sh', ['-c', 'printf hello; exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
              lifetime: 'call',
            });
            if (started._tag !== 'Started') return yield* Effect.die(new Error(`reader child: ${started._tag}`));
            const ref = started.execution;
            yield* bytesPast(byteRecords, ref, 4n);
            yield* stops.stop(claim, keyOf('retire-stop'), ref.execution, 'explicit-stop', 'signal');

            const reading = yield* Effect.forkChild(byteRecords.read({ ref, stream: 'stdout', offset: byteOffset(0n) }, 8));
            yield* Deferred.await(reached);

            const held = yield* retirement.forget(ref.execution);
            const duringReserved = (yield* capacity.account()).reservations.size;
            const late = yield* Effect.result(byteRecords.read({ ref, stream: 'stdout', offset: byteOffset(0n) }, 8));

            yield* Deferred.succeed(gate, undefined);
            const read = yield* Fiber.join(reading);
            const after = yield* retirement.forget(ref.execution);
            const afterReserved = (yield* capacity.account()).reservations.size;
            return { held, duringReserved, late, read, after, afterReserved };
          }),
        { executions: 1, holdRead: { held: gate, entered: reached } },
      );
      expect(outcome.held._tag).toBe('ForgetUnresolved');
      if (outcome.held._tag === 'ForgetUnresolved') expect(outcome.held.reads).toBe(1);
      expect(outcome.duringReserved).toBe(1);
      expect(outcome.late._tag).toBe('Failure');
      if (outcome.late._tag === 'Failure') expect(outcome.late.failure._tag).toBe('ExecutionRefused');
      expect(new TextDecoder().decode(outcome.read.bytes)).toBe('hello');
      expect(outcome.after._tag).toBe('Forgotten');
      expect(outcome.afterReserved).toBe(0);
    }),
  );

  it.live('ends the child when a call deadline expires, and the decision says timeout', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, requests, claim }) =>
        Effect.gen(function* () {
          const started = yield* hostExecutions.start(claim, keyOf('deadline-1'), {
            ...launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
            lifetime: 'call',
            budget: { timeoutMs: 50 },
          });
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`deadline child: ${started._tag}`));
          const ref = started.execution;
          const summary = yield* summaryWhen(hostExecutions, ref.execution, (summary) => summary.state.phase === 'ended');
          return {
            answer: yield* requests.callResult(keyOf('deadline-1')),
            phase: summary?.state.phase,
            exit: summary?.state.nativeExit,
          };
        }),
      );
      expect(outcome.answer._tag).toBe('Settled');
      if (outcome.answer._tag === 'Settled' && outcome.answer.result._tag === 'Decided') {
        const decision = outcome.answer.result.decision;
        expect(decision._tag).toBe('Cancelled');
        if (decision._tag === 'Cancelled') expect(decision.cause).toBe('timeout');
      }
      expect(outcome.phase).toBe('ended');
      expect(outcome.exit).toBeDefined();
    }),
  );

  it.live('decides a stopped call by the cause its requester named, not by the exit the signal produced', () =>
    Effect.gen(function* () {
      const gate = Deferred.makeUnsafe<void>();
      const reached = Deferred.makeUnsafe<void>();
      const outcome = yield* withHost(
        ({ hostExecutions, requests, stops, retirement, capacity, claim }) =>
          Effect.gen(function* () {
            const started = yield* hostExecutions.start(claim, keyOf('cause-1'), {
              ...launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
              lifetime: 'call',
              budget: {},
            });
            if (started._tag !== 'Started') return yield* Effect.die(new Error(`cause child: ${started._tag}`));
            const ref = started.execution;
            const receipt = yield* stops.stop(claim, keyOf('cause-stop'), ref.execution, 'explicit-stop', 'destroy');
            yield* Deferred.await(reached);
            const answer = yield* requests.callResult(keyOf('cause-1'));
            yield* Deferred.succeed(gate, undefined);
            yield* summaryWhen(
              hostExecutions,
              ref.execution,
              (summary) => summary.state.phase === 'ended' && summary.state.cleanup !== 'pending',
            );
            const ledger = yield* capacity.ledger();
            const next = yield* hostExecutions.start(claim, keyOf('cause-next'), {
              ...launchOf('/bin/echo', ['next'], 'agent'),
              lifetime: 'call',
            });
            const forgotten = yield* retirement.retire(claim, keyOf('cause-retire'), ref.execution);
            const again = yield* Effect.result(retirement.retire(claim, keyOf('cause-retire'), ref.execution));
            const afterForget = yield* requests.callResult(keyOf('cause-1'));
            return { receipt, answer, ledger, next, forgotten, again, afterForget };
          }).pipe(Effect.ensuring(Deferred.succeed(gate, undefined))),
        { holdOutput: { held: gate, entered: reached } },
      );

      expect(outcome.ledger.executions).toBe(0);
      expect(outcome.ledger.reserved).toBe(0);
      expect(outcome.next._tag).toBe('Started');
      expect(outcome.answer._tag).toBe('Settled');
      if (outcome.answer._tag === 'Settled' && outcome.answer.result._tag === 'Decided') {
        expect(outcome.answer.result.decision._tag).toBe('Cancelled');
        if (outcome.answer.result.decision._tag === 'Cancelled') {
          expect(outcome.answer.result.decision.cause).toBe('explicit-stop');
        }
        expect(outcome.answer.result.nativeExit).toBeDefined();
        expect(outcome.answer.result.cleanup).toBe(outcome.receipt.cleanup);
        expect(outcome.answer.result.retention).toBe(outcome.receipt.retention);
        expect(outcome.answer.result.sources.stdout.completed).toBe(true);
        expect(outcome.answer.result.sources.stderr.completed).toBe(true);
      }
      expect(outcome.receipt.cause).toBe('explicit-stop');
      expect([outcome.receipt.cleanup, ...outcome.receipt.unverifiable.map((resource) => resource.reason)]).toEqual(['complete']);
      expect(outcome.forgotten._tag === 'ForgetRefused' ? outcome.forgotten.detail : outcome.forgotten._tag).toBe('Forgotten');
      expect(outcome.again._tag === 'Failure' ? outcome.again.failure._tag : outcome.again.success._tag).toBe('Forgotten');
      expect(outcome.afterForget._tag).toBe('Settled');
      if (outcome.afterForget._tag === 'Settled' && outcome.afterForget.result._tag === 'Decided') {
        expect(outcome.afterForget.result.decision._tag).toBe('Cancelled');
        expect(outcome.afterForget.result.cleanup).toBe(outcome.receipt.cleanup);
        expect(outcome.afterForget.result.retention).toBe('lost');
        expect(outcome.afterForget.result.nativeExit).toBeDefined();
      }
    }),
  );

  it.live('answers a completed call when retirement interrupts its output release', () =>
    Effect.gen(function* () {
      const gate = Deferred.makeUnsafe<void>();
      const reached = Deferred.makeUnsafe<void>();
      const outcome = yield* withHost(
        ({ hostExecutions, requests, retirement, capacity, claim }) =>
          Effect.gen(function* () {
            const started = yield* hostExecutions.start(claim, keyOf('retiring-call'), {
              ...launchOf('/bin/echo', ['finished'], 'agent'),
              lifetime: 'call',
            });
            if (started._tag !== 'Started') return yield* Effect.die(new Error('the retirement test could not start its child'));
            yield* Deferred.await(reached);
            const answered = yield* Deferred.make<void>();
            const waiting = yield* Effect.forkChild(
              requests.callResult(keyOf('retiring-call')).pipe(Effect.tap(() => Deferred.succeed(answered, undefined))),
              { startImmediately: true },
            );
            const before = yield* Deferred.isDone(answered);
            const retired = yield* retirement.retire(claim, keyOf('retiring-retire'), started.execution.execution);
            const answer = yield* Fiber.join(waiting);
            return { before, retired, answer, ledger: yield* capacity.ledger() };
          }).pipe(Effect.ensuring(Deferred.succeed(gate, undefined))),
        { holdOutput: { held: gate, entered: reached } },
      );

      expect(outcome.before).toBe(false);
      expect(outcome.retired._tag).toBe('Forgotten');
      expect(outcome.answer._tag).toBe('Settled');
      if (outcome.answer._tag === 'Settled' && outcome.answer.result._tag === 'Decided') {
        expect(outcome.answer.result.decision._tag).toBe('Completed');
      }
      expect(outcome.ledger.executions).toBe(0);
      expect(outcome.ledger.reserved).toBe(0);
    }),
  );

  it.live('runs a second command on a one-slot host once the first has been retired', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, requests, stops, retirement, claim, capacity }) =>
        Effect.gen(function* () {
          const first = yield* hostExecutions.start(claim, keyOf('slot-1'), {
            ...launchOf('/bin/echo', ['first'], 'agent'),
            lifetime: 'call',
          });
          if (first._tag !== 'Started') return yield* Effect.die(new Error(`slot child: ${first._tag}`));
          const decided = yield* waitFor(
            hostExecutions,
            first.execution.execution,
            requests.callResult(keyOf('slot-1')),
            (answer) => answer._tag === 'Settled',
          );
          const receipt = yield* stops.stop(claim, keyOf('slot-stop'), first.execution.execution, 'explicit-stop', 'signal');
          const retired = yield* retirement.retire(claim, keyOf('slot-retire'), first.execution.execution);
          const held = yield* capacity.account();
          const second = yield* hostExecutions.start(claim, keyOf('slot-2'), {
            ...launchOf('/bin/echo', ['second'], 'agent'),
            lifetime: 'call',
          });
          return { decided, receipt, retired, reservations: held.reservations.size, second };
        }),
      );

      expect(outcome.decided._tag).toBe('Settled');
      if (outcome.decided._tag === 'Settled' && outcome.decided.result._tag === 'Decided') {
        expect(outcome.decided.result.decision._tag).toBe('Completed');
      }
      expect(outcome.receipt.cleanup).toBe('complete');
      expect(outcome.receipt.confirmed).toContainEqual({
        pid: expect.any(Number),
        relation: 'leader',
        exit: { _tag: 'Code', code: 0 },
        step: 'unsignalled',
      });
      expect(outcome.receipt.unverifiable).toEqual([]);
      expect(outcome.receipt.abandonedOutput).toBe(false);
      expect(outcome.retired._tag).toBe('Forgotten');
      expect(outcome.reservations).toBe(0);
      expect(outcome.second._tag).toBe('Started');
    }),
  );

  it.live('admits a start beside a live execution once the other child has exited, with nothing retired', () =>
    Effect.gen(function* () {
      const gate = Deferred.makeUnsafe<void>();
      const reached = Deferred.makeUnsafe<void>();
      const outcome = yield* withHost(
        ({ hostExecutions, requests, claim, capacity }) =>
          Effect.gen(function* () {
            yield* capacity.regrant(1);
            const live = yield* hostExecutions.start(
              claim,
              keyOf('exit-live'),
              launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
            );
            const ended = yield* hostExecutions.start(claim, keyOf('exit-1'), {
              ...launchOf('/bin/echo', ['first'], 'agent'),
              lifetime: 'call',
            });
            if (live._tag !== 'Started' || ended._tag !== 'Started')
              return yield* Effect.die(new Error('the capacity test could not start its children'));
            yield* Deferred.await(reached);
            const answered = yield* Deferred.make<void>();
            const waiting = yield* Effect.forkChild(
              requests.callResult(keyOf('exit-1')).pipe(Effect.tap(() => Deferred.succeed(answered, undefined))),
              { startImmediately: true },
            );
            const beforeRelease = yield* Deferred.isDone(answered);
            const during = yield* capacity.ledger();
            yield* Deferred.succeed(gate, undefined);
            const decided = yield* Fiber.join(waiting);
            const ledger = yield* capacity.ledger();
            const account = yield* capacity.account();
            const listed = yield* hostExecutions.list(undefined, 10);
            const next = yield* hostExecutions.start(claim, keyOf('exit-2'), {
              ...launchOf('/bin/echo', ['second'], 'agent'),
              lifetime: 'call',
            });
            return { beforeRelease, during, decided, ledger, held: account.reservations.size, next, listed: listed.executions.length };
          }).pipe(Effect.ensuring(Deferred.succeed(gate, undefined))),
        { executions: 2, holdOutput: { held: gate, entered: reached } },
      );

      expect(outcome.beforeRelease).toBe(false);
      expect(outcome.during.executions).toBe(2);
      expect(outcome.decided._tag).toBe('Settled');
      if (outcome.decided._tag === 'Settled' && outcome.decided.result._tag === 'Decided') {
        expect(outcome.decided.result.decision._tag).toBe('Completed');
      }
      expect(outcome.ledger.executions).toBe(1);
      expect(outcome.ledger.reserved).toBe(reserveOf(runtimeProfile({ executions: 2, transports: ['pipes'] }).execution, 'pipes'));
      expect(outcome.held).toBe(2);
      expect(outcome.listed).toBe(2);
      expect(outcome.next._tag).toBe('Started');
    }),
  );

  it.live('answers a completed call with the cost its own ending measured, on the first read', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, requests, stops, claim }) =>
        Effect.gen(function* () {
          const started = yield* hostExecutions.start(claim, keyOf('cost-1'), {
            ...launchOf('/bin/sh', ['-c', 'yes | head -c 4000000 > /dev/null'], 'agent'),
            lifetime: 'call',
          });
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`cost child: ${started._tag}`));
          const decided = yield* waitFor(
            hostExecutions,
            started.execution.execution,
            requests.callResult(keyOf('cost-1')),
            (answer) => answer._tag === 'Settled',
          );
          return { decided, ending: yield* stops.ending(started.execution.execution) };
        }),
      );

      expect(outcome.decided._tag).toBe('Settled');
      if (outcome.decided._tag === 'Settled' && outcome.decided.result._tag === 'Decided') {
        expect(outcome.decided.result.decision._tag).toBe('Completed');
        if (outcome.ending === undefined) return yield* Effect.die(new Error('the completed call has no ending'));
        expect(outcome.decided.result.cost).toEqual(outcome.ending.cost);
        expect(outcome.decided.result.cost._tag).toBe('Measured');
        if (outcome.decided.result.cost._tag === 'Measured') {
          expect(outcome.decided.result.cost.cpuMicros).toBeGreaterThan(0);
          expect(outcome.decided.result.cost.peakRssBytes).toBeGreaterThan(0);
        }
      }
    }),
  );

  it.live('answers a page with the cursor that continues it, so nothing is skipped between two pages', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(
        ({ hostExecutions, claim }) =>
          Effect.gen(function* () {
            const first = yield* hostExecutions.start(
              claim,
              keyOf('page-1'),
              launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
            );
            const second = yield* hostExecutions.start(
              claim,
              keyOf('page-2'),
              launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
            );
            if (first._tag !== 'Started' || second._tag !== 'Started')
              return yield* Effect.die(new Error('the page children did not start'));
            const opening = yield* hostExecutions.list(undefined, 1);
            const following = yield* hostExecutions.list(opening.after?.execution, 1);
            const ending = yield* hostExecutions.list(following.executions[following.executions.length - 1]?.state.ref.execution, 1);
            const whole = yield* hostExecutions.list(undefined, 10);
            return { opening, following, ending, whole };
          }),
        { executions: 2 },
      );

      expect(outcome.opening.executions.length).toBe(1);
      expect(outcome.opening.after).toBeDefined();
      expect(outcome.following.executions.length).toBe(1);
      const paged = [...outcome.opening.executions, ...outcome.following.executions].map((row) => row.state.ref.execution);
      expect(new Set(paged).size).toBe(2);
      expect(paged.sort()).toEqual(outcome.whole.executions.map((row) => row.state.ref.execution).sort());
      expect(outcome.following.after).toBeUndefined();
      expect(outcome.ending.executions.length).toBe(0);
    }),
  );

  it.live('keeps taking pipe output past its retained budget and reports the gap instead of losing it silently', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, byteRecords, claim }) =>
        Effect.gen(function* () {
          const started = yield* hostExecutions.start(
            claim,
            keyOf('retain-1'),
            launchOf('/bin/sh', ['-c', 'awk \'BEGIN{for(i=0;i<4000;i++) printf "%050d\\n", i}\''], 'agent'),
          );
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`retention child: ${started._tag}`));
          const ref = started.execution;
          const summary = yield* summaryWhen(hostExecutions, ref.execution, (summary) =>
            summary.streams.some((stream) => stream.stream === 'stdout' && stream.ending !== 'open'),
          );
          const stdout = summary?.streams.find((positions) => positions.stream === 'stdout');
          const behind = yield* byteRecords.read({ ref, stream: 'stdout', offset: byteOffset(0n) }, 4096);
          return { stdout, behind };
        }),
      );
      expect(offsetValue(outcome.stdout!.durableThrough)).toBe(204000n);
      expect(outcome.stdout!.ending).toBe('eof');
      expect(offsetValue(outcome.stdout!.retainedFrom)).toBeGreaterThan(0n);
      expect(outcome.behind.range.gap).toBe(true);
      expect(outcome.behind.range.next).toBe(outcome.stdout!.retainedFrom);
    }),
  );

  it.live('wakes a waiting reader when bytes land, and tells it when the stream is over', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, lanes, bindings, byteRecords, claim }) =>
        Effect.gen(function* () {
          const held = yield* authority(bindings, claim, 'reader');
          const typing = { binding: held.binding.id, principal: held.principal, connection: held.connection, epoch: held.epoch };
          const started = yield* hostExecutions.start(claim, keyOf('await-1'), launchOf('/bin/cat', [], 'principal-reader'));
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`wake child: ${started._tag}`));
          const ref = started.execution;
          return yield* Effect.scoped(
            Effect.gen(function* () {
              const reader = yield* byteRecords.openReader(ref.execution, 'stdout', byteOffset(0n));
              const waiting = yield* Effect.forkChild(byteRecords.awaitBytes(ref.execution, reader), { startImmediately: true });
              yield* lanes.admit(ref.execution, typing, {
                sequence: 0,
                cause: 'typed',
                act: { _tag: 'Write', bytes: new TextEncoder().encode('spoke') },
              });
              yield* lanes.admit(ref.execution, typing, { sequence: 1, cause: 'end', act: { _tag: 'End' } });
              const woke = yield* Fiber.join(waiting);
              yield* byteRecords.grant(ref.execution, reader, 64);
              const pulled = yield* byteRecords.pull(ref.execution, reader);
              const ended = yield* byteRecords.awaitBytes(ref.execution, reader);
              return { woke, pulled, ended };
            }),
          );
        }),
      );
      expect(outcome.woke).toBe(true);
      expect(new TextDecoder().decode(outcome.pulled.bytes)).toBe('spoke');
      expect(outcome.ended).toBe(false);
    }),
  );

  it.live('wakes a watcher when a child ends on its own, and measures what that ending left with no stop involved', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, requests, stops, claim }) =>
        Effect.gen(function* () {
          const started = yield* hostExecutions.start(claim, keyOf('wake-1'), {
            ...launchOf('/bin/echo', ['managed'], 'agent'),
            lifetime: 'call',
          });
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`natural ending child: ${started._tag}`));
          const ref = started.execution;
          yield* summaryWhen(
            hostExecutions,
            ref.execution,
            (summary) => summary.state.phase === 'ended' && summary.state.nativeExit !== undefined,
          );
          const ending = yield* waitFor(hostExecutions, ref.execution, stops.ending(ref.execution), (ending) => ending !== undefined);
          return {
            ref,
            summary: yield* hostExecutions.summary(ref.execution),
            answer: yield* requests.callResult(keyOf('wake-1')),
            ending,
          };
        }),
      );
      expect(outcome.summary?.state.phase).toBe('ended');
      expect(outcome.summary?.state.nativeExit).toEqual({ _tag: 'Code', code: 0 });
      expect(outcome.answer._tag).toBe('Settled');
      expect(outcome.ending?.execution).toEqual(outcome.ref);
      expect(outcome.ending?.cleanup).toBe('complete');
      expect(outcome.ending?.confirmed).toContainEqual({
        pid: expect.any(Number),
        relation: 'leader',
        exit: { _tag: 'Code', code: 0 },
        step: 'unsignalled',
      });
      expect(outcome.ending?.residual).toEqual([]);
      expect(outcome.ending?.unverifiable).toEqual([]);
      expect(outcome.ending?.nativeExit).toEqual({ _tag: 'Code', code: 0 });
      if (outcome.answer._tag === 'Settled' && outcome.answer.result._tag === 'Decided') {
        expect(outcome.answer.result.decision._tag).toBe('Completed');
        expect(outcome.answer.result.cleanup).toBe('complete');
      }
    }),
  );

  it.live('lets recovery stop and shut down a host whose custodian is gone, and start nothing', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, stops, lifecycle, custodian, claim }) =>
        Effect.gen(function* () {
          const started = yield* hostExecutions.start(
            claim,
            keyOf('recover-1'),
            launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
          );
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`recovery child: ${started._tag}`));
          const standing = yield* custodian.current();
          const revision = standing._tag === 'Settled' ? standing.custody.revision : standing.last.revision;
          const recovery = { connection: connectionOf('connection-recovery'), epoch: CustodianEpoch.make(0), role: 'recovery' as const };
          yield* custodian.fence(keyOf('recover-fence'), revision, recovery.connection, 'recovery');
          const receipt = yield* stops.stop(recovery, keyOf('recover-stop'), started.execution.execution, 'explicit-stop', 'signal');
          const refused = yield* hostExecutions.start(recovery, keyOf('recover-2'), launchOf('/bin/sh', ['-c', 'sleep 1'], 'agent'));
          const shutdown = yield* lifecycle.shutdown(recovery, keyOf('recover-shutdown'));
          return { receipt, refused, shutdown };
        }),
      );
      expect(outcome.receipt.confirmed.map((ending) => ending.relation)).toEqual(['leader', 'work']);
      expect(outcome.receipt.relation).toBe('covered');
      expect(outcome.refused._tag).toBe('Refused');
      if (outcome.refused._tag === 'Refused') expect(outcome.refused.refusal._tag).toBe('Unauthorized');
      expect(outcome.shutdown._tag).toBe('ShutdownComplete');
    }),
  );

  it.live('refuses to start work for a custodian that has been fenced', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, lifecycle, custodian, claim }) =>
        Effect.gen(function* () {
          const before = yield* hostExecutions.start(
            claim,
            keyOf('fenced-1'),
            launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
          );
          const standing = yield* custodian.current();
          const revision = standing._tag === 'Settled' ? standing.custody.revision : standing.last.revision;
          yield* custodian.fence(keyOf('fence-op'), revision, connectionOf('connection-recovery'), 'recovery');
          const after = yield* hostExecutions.start(
            claim,
            keyOf('fenced-2'),
            launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
          );
          const shutdown = yield* lifecycle.shutdown(claim, keyOf('fenced-shutdown'));
          return { before, after, shutdown };
        }),
      );
      expect(outcome.before._tag).toBe('Started');
      expect(outcome.after._tag).toBe('Refused');
      if (outcome.after._tag === 'Refused') expect(outcome.after.refusal._tag).toBe('Unauthorized');
      expect(outcome.shutdown._tag).toBe('Refused');
    }),
  );

  it.live('records a shutdown as stopping before it enumerates, and closes when nothing survives', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, lifecycle, claim }) =>
        Effect.gen(function* () {
          yield* hostExecutions.start(
            claim,
            keyOf('shutdown-1'),
            launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
          );
          const shutdown = yield* lifecycle.shutdown(claim, keyOf('shutdown-op'));
          const status = yield* lifecycle.status();
          const refused = yield* hostExecutions.start(claim, keyOf('shutdown-2'), launchOf('/bin/sh', ['-c', 'sleep 1'], 'agent'));
          return { shutdown, phase: status.phase, refused };
        }),
      );
      expect(outcome.shutdown._tag).toBe('ShutdownComplete');
      expect(outcome.phase).toBe('closed');
      expect(outcome.refused._tag).toBe('Refused');
      const swept = outcome.shutdown._tag === 'ShutdownComplete' ? outcome.shutdown.executions : [];
      expect(swept.map((receipt) => [receipt.requested, receipt.steps])).toEqual([['destroy', ['interrupt']]]);
      expect(swept[0]?.confirmed.map((ending) => [ending.relation, ending.exit, ending.step])).toEqual([
        ['leader', { _tag: 'Signal', signal: 'SIGINT' }, 'interrupt'],
        ['work', { _tag: 'Signal', signal: 'SIGINT' }, 'interrupt'],
      ]);
    }),
  );

  it.live('closes and vacates its holder once every stop ran, naming the groups it could not measure', () =>
    Effect.gen(function* () {
      const vacated = Deferred.makeUnsafe<void>();
      const outcome = yield* withHost(
        ({ hostExecutions, lifecycle, claim }) =>
          Effect.gen(function* () {
            const started = yield* hostExecutions.start(
              claim,
              keyOf('unmeasured-1'),
              launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
            );
            if (started._tag !== 'Started') return yield* Effect.die(new Error(`the child did not start: ${started._tag}`));
            const shutdown = yield* lifecycle.shutdown(claim, keyOf('unmeasured-shutdown'));
            const status = yield* lifecycle.status();
            const retried = yield* lifecycle.shutdown(claim, keyOf('unmeasured-shutdown'));
            const refused = yield* hostExecutions.start(claim, keyOf('unmeasured-2'), launchOf('/bin/sh', ['-c', 'sleep 1'], 'agent'));
            return { shutdown, phase: status.phase, retried, refused, vacated: yield* Deferred.isDone(vacated) };
          }),
        { unmeasured: { vacated } },
      );
      expect(outcome.shutdown._tag).toBe('ShutdownIncomplete');
      if (outcome.shutdown._tag !== 'ShutdownIncomplete')
        return yield* Effect.die(new Error(`expected Incomplete, got ${outcome.shutdown._tag}`));
      expect(outcome.shutdown.reason).toContain('the host closed');
      expect(outcome.shutdown.unverifiable.map((row) => row.reason)).toContain('the retained group could not be measured');
      expect(outcome.phase).toBe('closed');
      expect(outcome.vacated).toBe(true);
      expect(outcome.retried).toEqual(outcome.shutdown);
      expect(outcome.refused._tag).toBe('Refused');
    }),
  );

  it.live('stops several live commands together while each one holds its output release', () =>
    Effect.gen(function* () {
      const held = yield* Deferred.make<void>();
      const entered = yield* Deferred.make<void>();
      const outcome = yield* withHost(
        ({ hostExecutions, lifecycle, byteRecords, claim }) =>
          Effect.gen(function* () {
            const started = yield* Effect.forEach(['a', 'b'], (name) =>
              hostExecutions.start(
                claim,
                keyOf(`deaf-${name}`),
                launchOf('/bin/sh', ['-c', 'trap "" INT; printf armed; exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
              ),
            );
            if (started.some((answer) => answer._tag !== 'Started')) return yield* Effect.die(new Error('the children did not start'));
            for (const answer of started) {
              if (answer._tag !== 'Started') return yield* Effect.die(new Error('a deaf child was refused'));
              yield* bytesPast(byteRecords, answer.execution, 4n);
            }
            const sweeping = yield* Effect.forkScoped(lifecycle.shutdown(claim, keyOf('deaf-shutdown')));
            yield* Deferred.await(entered);
            yield* Deferred.succeed(held, undefined);
            return { shutdown: yield* Fiber.join(sweeping) };
          }).pipe(Effect.ensuring(Deferred.succeed(held, undefined))),
        { executions: 2, holdOutput: { held, entered, arrivals: 2 } },
      );
      expect(outcome.shutdown._tag).toBe('ShutdownComplete');
      const swept = outcome.shutdown._tag === 'ShutdownComplete' ? outcome.shutdown.executions : [];
      expect(swept.map((receipt) => receipt.steps)).toEqual([
        ['interrupt', 'terminate'],
        ['interrupt', 'terminate'],
      ]);
    }),
  );

  it.live('names the live children it never reached when the bound is spent before the sweep begins', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(
        ({ hostExecutions, stops, lifecycle, claim }) =>
          Effect.gen(function* () {
            const first = yield* hostExecutions.start(
              claim,
              keyOf('unswept-1'),
              launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
            );
            const second = yield* hostExecutions.start(
              claim,
              keyOf('unswept-2'),
              launchOf('/bin/sh', ['-c', 'exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
            );
            if (first._tag !== 'Started' || second._tag !== 'Started') return yield* Effect.die(new Error('the children did not start'));
            const shutdown = yield* lifecycle.shutdown(claim, keyOf('unswept-shutdown'));
            const refused = yield* hostExecutions.start(claim, keyOf('unswept-3'), launchOf('/bin/sh', ['-c', 'sleep 1'], 'agent'));
            yield* stops.stop(claim, keyOf('unswept-stop-1'), first.execution.execution, 'explicit-stop', 'destroy');
            yield* stops.stop(claim, keyOf('unswept-stop-2'), second.execution.execution, 'explicit-stop', 'destroy');
            return {
              first: first.execution.execution,
              second: second.execution.execution,
              shutdown,
              refused,
            };
          }),
        { executions: 4, shutdownMs: 1 },
      );
      expect(outcome.shutdown._tag).toBe('ShutdownIncomplete');
      if (outcome.shutdown._tag !== 'ShutdownIncomplete')
        return yield* Effect.die(new Error(`expected Incomplete, got ${outcome.shutdown._tag}`));
      const unreached = outcome.shutdown.unverifiable.map((row) => row.detail);
      const stopped = outcome.shutdown.executions.map((receipt) => String(receipt.execution.execution));
      expect([...unreached, ...stopped]).toContain(outcome.first);
      expect([...unreached, ...stopped]).toContain(outcome.second);
      expect(unreached.length).toBeGreaterThan(0);
      expect(outcome.refused._tag).toBe('Refused');
    }),
  );

  it.live('a shutdown retry cannot complete while the first execution finalization is still held', () =>
    Effect.gen(function* () {
      const held = Deferred.makeUnsafe<void>();
      const entered = Deferred.makeUnsafe<void>();
      const outcome = yield* withHost(
        ({ hostExecutions, lifecycle, stops, claim }) =>
          Effect.gen(function* () {
            const started = yield* hostExecutions.start(claim, keyOf('seal-held-start'), launchOf('/bin/echo', ['finished'], 'agent'));
            if (started._tag !== 'Started') return yield* Effect.die(new Error(`the retained execution did not start: ${started._tag}`));
            yield* stops.stop(claim, keyOf('seal-held-stop'), started.execution.execution, 'explicit-stop', 'signal');
            const operation = keyOf('seal-held-shutdown');
            const sweeping = yield* Effect.forkScoped(lifecycle.shutdown(claim, operation));
            yield* Deferred.await(entered);
            const first = yield* Fiber.join(sweeping);
            const second = yield* lifecycle.shutdown(claim, operation);
            const during = yield* lifecycle.status();
            yield* Deferred.succeed(held, undefined);
            const third = yield* lifecycle.shutdown(claim, keyOf('seal-released-shutdown'));
            return { first, second, third, during, execution: started.execution.execution };
          }).pipe(Effect.ensuring(Deferred.succeed(held, undefined))),
        { shutdownMs: 300, holdSeal: { held, entered } },
      );
      expect(outcome.first._tag).toBe('ShutdownIncomplete');
      expect(outcome.second._tag).toBe('ShutdownIncomplete');
      if (outcome.second._tag !== 'ShutdownIncomplete')
        return yield* Effect.die(new Error(`the retry reported ${outcome.second._tag} before finalization ended`));
      expect(outcome.second.unverifiable.map((row) => row.detail)).toContain(outcome.execution);
      expect(outcome.during.phase).toBe('stopping');
      expect(outcome.third._tag).toBe('ShutdownComplete');
    }),
  );

  it.live('a holder that does not answer vacate cannot outlive the shutdown budget', () =>
    Effect.gen(function* () {
      const held = Deferred.makeUnsafe<void>();
      const entered = Deferred.makeUnsafe<void>();
      const outcome = yield* withHost(
        ({ lifecycle, claim }) =>
          Effect.gen(function* () {
            const sweeping = yield* Effect.forkScoped(lifecycle.shutdown(claim, keyOf('vacate-held-shutdown')));
            yield* Deferred.await(entered).pipe(TestClock.withLive);
            yield* TestClock.adjust(200);
            const incomplete = yield* Fiber.join(sweeping);
            const during = yield* lifecycle.status();
            yield* Deferred.succeed(held, undefined);
            const complete = yield* lifecycle.shutdown(claim, keyOf('vacate-released-shutdown'));
            return { incomplete, complete, during };
          }).pipe(Effect.ensuring(Deferred.succeed(held, undefined)), Effect.provide(TestClock.layer())),
        { shutdownMs: 200, holdVacate: { held, entered } },
      );
      expect(outcome.incomplete._tag).toBe('ShutdownIncomplete');
      if (outcome.incomplete._tag !== 'ShutdownIncomplete')
        return yield* Effect.die(new Error(`the held holder reported ${outcome.incomplete._tag}`));
      expect(outcome.incomplete.unverifiable).toHaveLength(1);
      expect(outcome.incomplete.unverifiable[0]?.kind).toBe('process');
      expect(outcome.during.phase).toBe('stopping');
      expect(outcome.complete._tag).toBe('ShutdownComplete');
    }),
  );

  it.live('ends finished records together, answering each from its own measurement', () =>
    Effect.gen(function* () {
      const N = 2;
      const outcome = yield* withHost(
        ({ hostExecutions, lifecycle, claim }) =>
          Effect.gen(function* () {
            for (let i = 0; i < N; i++) {
              const started = yield* hostExecutions.start(claim, keyOf(`ended-${i}`), {
                ...launchOf('/bin/sh', ['-c', 'exit 0'], 'agent'),
                lifetime: 'call',
              });
              if (started._tag !== 'Started') return yield* Effect.die(new Error(`start ${i} did not start: ${started._tag}`));
            }
            for (;;) {
              const changed = yield* hostExecutions.inventoryChanged();
              const page = yield* hostExecutions.list(undefined, N + 1);
              if (
                page.executions.length === N &&
                page.executions.every((row) => row.state.phase === 'ended' && row.state.cleanup !== 'pending')
              )
                break;
              yield* changed;
            }
            return yield* lifecycle.shutdown(claim, keyOf('ended-shutdown'));
          }),
        { executions: N + 10, shutdownMs: 2500 },
      );
      expect(outcome._tag).toBe('ShutdownComplete');
      if (outcome._tag !== 'ShutdownComplete') return yield* Effect.die(new Error(`expected Complete, got ${outcome._tag}`));
      expect(outcome.executions.length).toBe(N);
      expect(outcome.executions.every((receipt) => receipt.requested === 'destroy' && receipt.cleanup === 'complete')).toBe(true);
    }),
  );

  it.live('names what is still moving when the bound runs out, instead of hanging or folding silence', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(
        ({ hostExecutions, lifecycle, byteRecords, claim }) =>
          Effect.gen(function* () {
            const started = yield* hostExecutions.start(
              claim,
              keyOf('wedge-1'),
              launchOf('/bin/sh', ['-c', 'trap "" INT TERM; printf armed; exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
            );
            if (started._tag !== 'Started') return yield* Effect.die(new Error(`the wedge did not start: ${started._tag}`));
            yield* outputWhen(byteRecords, started.execution, (text) => text === 'armed');
            const shutdown = yield* lifecycle.shutdown(claim, keyOf('wedge-shutdown'));
            yield* summaryWhen(
              hostExecutions,
              started.execution.execution,
              (summary) => summary.state.phase === 'ended' && summary.state.cleanup !== 'pending',
            );
            const retried = yield* lifecycle.shutdown(claim, keyOf('wedge-shutdown'));
            const fresh = yield* lifecycle.shutdown(claim, keyOf('wedge-shutdown-2'));
            return { ref: started.execution, shutdown, retried, fresh };
          }),
        { shutdownMs: 400 },
      );
      expect(outcome.shutdown._tag).toBe('ShutdownIncomplete');
      if (outcome.shutdown._tag !== 'ShutdownIncomplete')
        return yield* Effect.die(new Error(`expected Incomplete, got ${outcome.shutdown._tag}`));
      expect(outcome.shutdown.reason).toContain('did not finish within 400ms');
      expect(outcome.shutdown.reason).toContain('stopping executions');
      expect(outcome.shutdown.reason).toContain('1 stop unfinished');
      const named = outcome.shutdown.unverifiable.find((row) => row.detail === outcome.ref.execution);
      if (named === undefined) return yield* Effect.die(new Error('the still-moving execution was not named'));
      expect(named.reason).toContain('held: its stop did not finish within the shutdown budget');
      expect(outcome.retried._tag).toBe('ShutdownComplete');
      expect(outcome.fresh).toEqual({ _tag: 'ShutdownComplete', operation: keyOf('wedge-shutdown-2'), executions: [] });
    }),
  );

  it.live('answers a same-key retry from the one sweep, never starting a second beside it', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(
        ({ hostExecutions, lifecycle, store, claim }) =>
          Effect.gen(function* () {
            const started = yield* hostExecutions.start(
              claim,
              keyOf('join-1'),
              launchOf('/bin/sh', ['-c', 'trap "" TERM; exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
            );
            if (started._tag !== 'Started') return yield* Effect.die(new Error(`the joiner did not start: ${started._tag}`));
            const key = keyOf('join-shutdown');
            const fiber = yield* Effect.forkScoped(lifecycle.shutdown(claim, key));
            const first = yield* lifecycle.shutdown(claim, key);
            const second = yield* Fiber.join(fiber);
            const fresh = yield* lifecycle.shutdown(claim, keyOf('already-closed'));
            const third = yield* lifecycle.shutdown(claim, key);
            const intents = yield* store.stopRequestsOf(started.execution.execution);
            return { first, second, third, fresh, intents };
          }),
        { shutdownMs: 5000 },
      );
      expect(outcome.first._tag).toBe('ShutdownComplete');
      expect(outcome.second).toEqual(outcome.first);
      expect(outcome.third).toEqual(outcome.first);
      expect(outcome.fresh).toEqual({ _tag: 'ShutdownComplete', operation: keyOf('already-closed'), executions: [] });
      expect(outcome.intents.length).toBe(1);
      expect(outcome.intents[0]?.operation.operation).toBe(keyOf('join-shutdown').operation);
    }),
  );

  it.live('sweeps once per key when two different keys arrive together', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(
        ({ hostExecutions, lifecycle, store, claim }) =>
          Effect.gen(function* () {
            const started = yield* hostExecutions.start(
              claim,
              keyOf('keys-1'),
              launchOf('/bin/sh', ['-c', 'trap "" TERM; exec /usr/bin/perl -e "sleep while 1"'], 'agent'),
            );
            if (started._tag !== 'Started') return yield* Effect.die(new Error(`the keyed one did not start: ${started._tag}`));
            const fiber = yield* Effect.forkScoped(lifecycle.shutdown(claim, keyOf('keys-shutdown-a')));
            const first = yield* lifecycle.shutdown(claim, keyOf('keys-shutdown-b'));
            const second = yield* Fiber.join(fiber);
            const intents = yield* store.stopRequestsOf(started.execution.execution);
            return { first, second, intents };
          }),
        { shutdownMs: 5000 },
      );
      expect(outcome.first._tag).toBe('ShutdownComplete');
      expect(outcome.second._tag).toBe('ShutdownComplete');
      expect(outcome.intents.length).toBe(2);
      expect(outcome.intents.map((intent) => String(intent.operation.operation)).sort()).toEqual(['keys-shutdown-a', 'keys-shutdown-b']);
    }),
  );

  it.live('keeps two bindings on one connection distinct at the input gate, and a closed one cannot spend the other', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, lanes, stops, bindings, claim }) =>
        Effect.gen(function* () {
          const tab = yield* authority(bindings, claim, 'operator');
          const otherBinding = yield* bindings.open(tab.principal, tab.connection, tab.epoch);
          const other = { connection: tab.connection, principal: tab.principal, binding: otherBinding, epoch: tab.epoch };
          const started = yield* hostExecutions.start(claim, keyOf('bind-1'), launchOf('/bin/cat', [], 'principal-operator'));
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`binding child: ${started._tag}`));
          const ref = started.execution;
          const typing = { binding: tab.binding.id, principal: tab.principal, connection: tab.connection, epoch: tab.epoch };
          const neighbour = {
            binding: other.binding.id,
            principal: other.principal,
            connection: other.connection,
            epoch: other.epoch,
          };
          const write = (sequence: number, text: string) => ({
            sequence,
            cause: 'typed' as const,
            act: { _tag: 'Write' as const, bytes: new TextEncoder().encode(text) },
          });

          const admitted = yield* lanes.admit(ref.execution, typing, write(0, 'hello\n'));
          yield* lanes.close(tab.binding.id, principalOf('principal-agent'));
          const retried = yield* lanes.admit(ref.execution, typing, write(0, 'hello\n'));
          const neighbourTyped = yield* lanes.admit(ref.execution, neighbour, write(0, 'beside\n'));

          yield* bindings.close(other.binding.id, other.principal);
          const afterNeighbourClosed = yield* lanes.admit(ref.execution, typing, write(1, 'still\n'));
          const closedNeighbour = yield* Effect.result(lanes.admit(ref.execution, neighbour, write(1, 'ghost\n')));

          yield* lanes.close(tab.binding.id, tab.principal);
          const afterOwnClose = yield* Effect.result(lanes.admit(ref.execution, typing, write(2, 'late\n')));
          const after = yield* hostExecutions.summary(ref.execution);
          const receipt = yield* stops.stop(claim, keyOf('bind-stop'), ref.execution, 'explicit-stop', 'signal');
          return { admitted, retried, neighbourTyped, afterNeighbourClosed, closedNeighbour, afterOwnClose, after, receipt };
        }),
      );
      expect(outcome.admitted._tag).toBe('InputAdmitted');
      expect(outcome.retried).toEqual(outcome.admitted);
      expect(String(outcome.after?.input?.acceptedThrough)).toBe('19');
      expect(outcome.neighbourTyped._tag).toBe('InputAdmitted');
      expect(outcome.afterNeighbourClosed._tag).toBe('InputAdmitted');
      expect(outcome.closedNeighbour._tag).toBe('Failure');
      if (outcome.closedNeighbour._tag === 'Failure') {
        expect(outcome.closedNeighbour.failure._tag).toBe('BindingMissing');
      }
      expect(outcome.afterOwnClose._tag).toBe('Failure');
      if (outcome.afterOwnClose._tag === 'Failure') {
        expect(outcome.afterOwnClose.failure._tag).toBe('BindingMissing');
      }
      expect(outcome.receipt.cleanup).toBe('complete');
    }),
  );

  it.live('refuses a transfer presented by a principal that does not hold the execution, moves nothing and leaves its lanes typing', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(({ hostExecutions, lanes, custodyControl, stops, bindings, claim }) =>
        Effect.gen(function* () {
          const viewer = principalOf('principal-viewer');
          const opened = yield* bindings.open(viewer, claim.connection, claim.epoch);
          const started = yield* hostExecutions.start(claim, keyOf('lane-1'), launchOf('/bin/cat', [], 'principal-operator'));
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`lane child: ${started._tag}`));
          const ref = started.execution;
          const lane = { binding: opened.id, principal: viewer, connection: claim.connection, epoch: claim.epoch };
          const write = (sequence: number, text: string) => ({
            sequence,
            cause: 'typed' as const,
            act: { _tag: 'Write' as const, bytes: new TextEncoder().encode(text) },
          });

          const typed = yield* lanes.admit(ref.execution, lane, write(0, 'lane\n'));
          const refused = yield* custodyControl.move(
            { principal: viewer, connection: claim.connection, epoch: claim.epoch },
            { operation: keyOf('lane-transfer'), execution: ref, expected: 0, act: { _tag: 'Transfer', holder: viewer } },
          );
          const afterRefusal = yield* hostExecutions.summary(ref.execution);
          const still = yield* lanes.admit(ref.execution, lane, write(1, 'still\n'));
          const receipt = yield* stops.stop(claim, keyOf('lane-stop'), ref.execution, 'explicit-stop', 'signal');
          return { typed, refused, afterRefusal, still, receipt };
        }),
      );

      expect(outcome.typed._tag).toBe('InputAdmitted');
      expect(outcome.refused._tag).toBe('Refused');
      if (outcome.refused._tag === 'Refused') expect(outcome.refused.refusal._tag).toBe('CustodyConflict');
      expect(outcome.afterRefusal?.custody.revision).toBe(0);
      expect(String(outcome.afterRefusal?.custody.holder)).toBe('principal-operator');
      expect(outcome.still._tag).toBe('InputAdmitted');
      expect(outcome.receipt.cleanup).toBe('complete');
    }),
  );

  it.live(
    'admits the first acts of one lane sent at once to two executions into exactly one of them, and refuses it at the other from then on',
    () =>
      Effect.gen(function* () {
        const outcome = yield* withHost(
          ({ hostExecutions, lanes, stops, bindings, claim }) =>
            Effect.gen(function* () {
              const viewer = principalOf('principal-viewer');
              const opened = yield* bindings.open(viewer, claim.connection, claim.epoch);
              const one = yield* hostExecutions.start(claim, keyOf('race-1'), launchOf('/bin/cat', [], 'principal-operator'));
              const two = yield* hostExecutions.start(claim, keyOf('race-2'), launchOf('/bin/cat', [], 'principal-operator'));
              if (one._tag !== 'Started' || two._tag !== 'Started') return yield* Effect.die(new Error('the raced children did not start'));
              const lane = { binding: opened.id, principal: viewer, connection: claim.connection, epoch: claim.epoch };
              const write = (sequence: number, text: string) => ({
                sequence,
                cause: 'typed' as const,
                act: { _tag: 'Write' as const, bytes: new TextEncoder().encode(text) },
              });
              const raced = yield* Effect.all(
                [one, two].map((started) => Effect.result(lanes.admit(started.execution.execution, lane, write(0, 'first\n')))),
                { concurrency: 2 },
              );
              const [bound, other] = raced[0]?._tag === 'Success' ? [one, two] : [two, one];
              const next = yield* lanes.admit(bound.execution.execution, lane, write(1, 'next\n'));
              const elsewhere = yield* Effect.result(lanes.admit(other.execution.execution, lane, write(0, 'elsewhere\n')));
              yield* stops.stop(claim, keyOf('race-stop-1'), one.execution.execution, 'explicit-stop', 'signal');
              yield* stops.stop(claim, keyOf('race-stop-2'), two.execution.execution, 'explicit-stop', 'signal');
              return { raced, next, elsewhere };
            }),
          { executions: 2 },
        );

        const tags = outcome.raced.map((answer) => (answer._tag === 'Success' ? answer.success._tag : answer.failure._tag));
        expect([...tags].sort()).toEqual(['InputAdmitted', 'LaneRefused']);
        expect(outcome.next._tag).toBe('InputAdmitted');
        expect(outcome.elsewhere._tag).toBe('Failure');
        if (outcome.elsewhere._tag === 'Failure') {
          expect(outcome.elsewhere.failure._tag).toBe('LaneRefused');
        }
      }),
  );

  it.live('binds a lane to the first execution it ends, so a write at another refuses', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(
        ({ hostExecutions, lanes, stops, bindings, claim }) =>
          Effect.gen(function* () {
            const viewer = principalOf('principal-viewer');
            const opened = yield* bindings.open(viewer, claim.connection, claim.epoch);
            const one = yield* hostExecutions.start(claim, keyOf('end-first-1'), launchOf('/bin/cat', [], 'principal-operator'));
            const two = yield* hostExecutions.start(claim, keyOf('end-first-2'), launchOf('/bin/cat', [], 'principal-operator'));
            if (one._tag !== 'Started' || two._tag !== 'Started')
              return yield* Effect.die(new Error('the lane ending children did not start'));
            const lane = { binding: opened.id, principal: viewer, connection: claim.connection, epoch: claim.epoch };
            const ended = yield* Effect.result(
              lanes.admit(one.execution.execution, lane, { sequence: 0, cause: 'end', act: { _tag: 'End' } }),
            );
            const typed = yield* Effect.result(
              lanes.admit(two.execution.execution, lane, {
                sequence: 1,
                cause: 'typed',
                act: { _tag: 'Write', bytes: new TextEncoder().encode('typed\n') },
              }),
            );
            yield* stops.stop(claim, keyOf('end-first-stop-1'), one.execution.execution, 'explicit-stop', 'signal');
            yield* stops.stop(claim, keyOf('end-first-stop-2'), two.execution.execution, 'explicit-stop', 'signal');
            return { ended, typed };
          }),
        { executions: 2 },
      );

      expect(outcome.ended._tag === 'Failure' ? outcome.ended.failure._tag : outcome.ended.success._tag).toBe('InputAdmitted');
      expect(outcome.typed._tag).toBe('Failure');
      if (outcome.typed._tag === 'Failure') expect(outcome.typed.failure._tag).toBe('LaneRefused');
    }),
  );

  it.live('ends every lane typing into an execution when it is transferred, and leaves a lane typing into another', () =>
    Effect.gen(function* () {
      const outcome = yield* withHost(
        ({ hostExecutions, lanes, custodyControl, stops, bindings, claim }) =>
          Effect.gen(function* () {
            const page = yield* authority(bindings, claim, 'operator');
            const held = yield* hostExecutions.start(claim, keyOf('ended-1'), launchOf('/bin/cat', [], 'principal-operator'));
            const beside = yield* hostExecutions.start(claim, keyOf('ended-2'), launchOf('/bin/cat', [], 'principal-operator'));
            if (held._tag !== 'Started' || beside._tag !== 'Started')
              return yield* Effect.die(new Error('the transfer children did not start'));
            const laneOf = (name: string) =>
              Effect.map(bindings.open(principalOf(name), claim.connection, claim.epoch), (opened) => ({
                binding: opened.id,
                principal: principalOf(name),
                connection: claim.connection,
                epoch: claim.epoch,
              }));
            const holders = yield* laneOf('principal-operator');
            const viewers = yield* laneOf('principal-viewer');
            const besideLane = yield* laneOf('principal-viewer');
            const write = (sequence: number, text: string) => ({
              sequence,
              cause: 'typed' as const,
              act: { _tag: 'Write' as const, bytes: new TextEncoder().encode(text) },
            });
            yield* lanes.admit(held.execution.execution, holders, write(0, 'holder\n'));
            yield* lanes.admit(held.execution.execution, viewers, write(0, 'viewer\n'));
            yield* lanes.admit(beside.execution.execution, besideLane, write(0, 'beside\n'));

            const transferred = yield* custodyControl.move(
              { principal: page.principal, connection: page.connection, epoch: page.epoch },
              {
                operation: keyOf('ended-transfer'),
                execution: held.execution,
                expected: 0,
                act: { _tag: 'Transfer', holder: decodePrincipal('principal-thread-7') },
              },
            );
            const ended = yield* Effect.forEach([holders, viewers], (lane) =>
              Effect.result(lanes.admit(held.execution.execution, lane, write(1, 'late\n'))),
            );
            const stillTyping = yield* lanes.admit(beside.execution.execution, besideLane, write(1, 'still\n'));
            yield* stops.stop(claim, keyOf('ended-stop-1'), held.execution.execution, 'explicit-stop', 'signal');
            yield* stops.stop(claim, keyOf('ended-stop-2'), beside.execution.execution, 'explicit-stop', 'signal');
            return { transferred, ended, stillTyping };
          }),
        { executions: 2 },
      );

      expect(outcome.transferred._tag).toBe('Accepted');
      if (outcome.transferred._tag === 'Accepted') {
        expect(outcome.transferred.receipt.frontier.sequence).toBeUndefined();
        expect(String(outcome.transferred.receipt.frontier.acceptedThrough)).toBe('14');
      }
      expect(outcome.ended.map((answer) => (answer._tag === 'Failure' ? answer.failure._tag : answer.success._tag))).toEqual([
        'BindingMissing',
        'BindingMissing',
      ]);
      expect(outcome.stillTyping._tag).toBe('InputAdmitted');
    }),
  );
});
