import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunServices from '@effect/platform-bun/BunServices';
import { join } from 'node:path';
import { Context, Deferred, Effect, Exit, FileSystem, Layer } from 'effect';
import { JOURNAL_FILE, segmentFile } from '@runlith/executions/recordFormat';
import type { ExecutionId } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { Holder, type HeldExecution } from './holder/Holder';
import { testHolder } from './posix/testing/holder';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionStop } from './registry/stops';
import { HostLifecycle } from './registry/shutdown';
import { HostByteRecords } from './registry/reads';
import type { HostClaim } from './registry/state';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { runtimeProfile } from './runtimeFixture';
import { connectionOf, keyOf, principalOf, registrationOf } from './hostFixture';
import { faulty, type Fault } from './testing/faultyFiles';

const profile = runtimeProfile({ executions: 1, transports: ['pipes'] });

const registryOver = <S>(directory: string, platform: Context.Context<S>, files?: FileSystem.FileSystem) =>
  (files === undefined
    ? ExecutionRegistry.layer()
    : ExecutionRegistry.layer().pipe(Layer.provide(Layer.succeed(FileSystem.FileSystem, files)))
  ).pipe(
    Layer.provideMerge(Bindings.layer),
    Layer.provideMerge(
      Layer.unwrap(Effect.map(sharedPool, (pool) => hostState(join(directory, 'executions.sqlite'), registrationOf(directory), pool))).pipe(
        Layer.provideMerge(ExecutionCapacity.layer(profile)),
      ),
    ),
    Layer.provideMerge(Layer.succeedContext(platform)),
    Layer.provideMerge(hostSpawner),
  );

const claimed = Effect.fnUntraced(function* (name: string) {
  const custodian = yield* Custodian;
  const current = yield* custodian.current();
  const connection = connectionOf(name);
  const taken = yield* custodian.take(
    keyOf(`${name}-take`),
    current._tag === 'Settled' ? current.custody.revision : 0,
    connection,
    'custodian',
  );
  return { connection, epoch: taken.standing.epoch, role: 'custodian' } satisfies HostClaim;
});

const principal = principalOf('torn-handover');
const PRINTS = 'printf first; sleep 0.3; printf torn; exec /usr/bin/perl -e "sleep while 1"';
const launchOf = (script: string): LaunchRequest => ({
  command: { program: '/bin/sh', args: ['-c', script], environment: [] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'held',
  purpose: 'command',
  target: { environment: 'e', namespace: 'n', cwd: '/tmp', dependencies: [] },
  holder: principal,
  origin: principal,
});

const torn: Fault = { whenPathHas: join('stdout', segmentFile(0n)), onCall: 3, landed: 2, fails: true, truncateFails: true };

const handedOver = Effect.fnUntraced(function* (
  prefix: string,
  script: string,
  faults: ReadonlyArray<Fault>,
  departing: (execution: ExecutionId) => Effect.Effect<void, never, Executions>,
) {
  const files = yield* FileSystem.FileSystem;
  const directory = yield* files.makeTempDirectoryScoped({ prefix });
  const platform = yield* Layer.build(testHolder(directory).pipe(Layer.provide(hostSpawner)));
  const real = Context.get(platform, Holder);
  let retained: HeldExecution | undefined;
  const retaining = Holder.of({
    ...real,
    get held() {
      return real.held;
    },
    launch: (spec) =>
      Effect.tap(real.launch(spec), (child) =>
        Effect.sync(() => {
          retained = child;
        }),
      ),
  });
  const leaving = yield* Layer.build(
    registryOver(
      directory,
      Context.add(platform, Holder, retaining),
      faults.reduce((carrier, fault) => faulty(carrier, fault), files),
    ),
  );
  const execution = yield* Effect.gen(function* () {
    const lifecycle = yield* HostLifecycle;
    const claim = yield* claimed(`${prefix}leaving`);
    const started = yield* (yield* Executions).start(claim, keyOf(`${prefix}start`), launchOf(script));
    if (started._tag !== 'Started') return yield* Effect.die(new Error(`the command did not start: ${started._tag}`));
    yield* departing(started.execution.execution);
    const quiesced = yield* lifecycle.quiesce(claim, keyOf(`${prefix}quiesce`));
    if (quiesced._tag === 'Refused') return yield* Effect.die(new Error(`quiesce refused: ${quiesced.refusal._tag}`));
    yield* lifecycle.yield(quiesced.ticket);
    yield* lifecycle.departed;
    return started.execution;
  }).pipe(Effect.provide(leaving));
  const child = retained;
  if (child === undefined) return yield* Effect.die(new Error('the holder launched no child'));
  return yield* Effect.gen(function* () {
    const claim = yield* claimed(`${prefix}next`);
    const read = yield* (yield* HostByteRecords).read({ ref: execution, stream: 'stdout', offset: byteOffset(0n) }, 64);
    const summary = yield* (yield* Executions).summary(execution.execution);
    yield* (yield* ExecutionStop).stop(claim, keyOf(`${prefix}stop`), execution.execution, 'explicit-stop', 'destroy');
    return { text: new TextDecoder().decode(read.bytes), durable: read.range.durableThrough, stdout: summary?.state.streams.stdout };
  }).pipe(Effect.provide(registryOver(directory, Context.add(platform, Holder, { ...real, held: [child] }))));
});

it.live('the next logic does not continue a stream from a payload its predecessor could neither cut back nor journal', () =>
  Effect.gen(function* () {
    const after = yield* handedOver(
      'torn-handover-',
      PRINTS,
      [torn, { whenPathHas: JOURNAL_FILE, onCall: 2, fails: true }],
      Effect.fnUntraced(function* (execution) {
        const executions = yield* Executions;
        for (;;) {
          const change = yield* Effect.exit(executions.changed(execution));
          if ((yield* executions.summary(execution))?.state.streams.stdout === 'error') return;
          if (Exit.isFailure(change)) return yield* Effect.die(new Error('the execution left before its stdout ended'));
          yield* change.value;
        }
      }),
    );
    expect(after).toEqual({ text: '', durable: byteOffset(0n), stdout: 'error' });
  }).pipe(Effect.provide(BunServices.layer)),
);

it.live('a stream ending its pipeline never got to the store reaches the next logic through the departure', () =>
  Effect.gen(function* () {
    const held = yield* Deferred.make<void>();
    const entered = yield* Deferred.make<void>();
    const after = yield* handedOver(
      'torn-race-',
      `exec 2>&-; ${PRINTS}`,
      [torn, { whenPathHas: JOURNAL_FILE, onCall: 3, held, entered, heldThroughInterrupt: true }],
      () => Deferred.await(entered),
    ).pipe(Effect.ensuring(Deferred.succeed(held, undefined)));
    expect(after).toEqual({ text: '', durable: byteOffset(0n), stdout: 'error' });
  }).pipe(Effect.provide(BunServices.layer)),
);

it.live('a departure gives up on a capture whose write ignores interruption, and the next logic reads what was confirmed', () =>
  Effect.gen(function* () {
    const held = yield* Deferred.make<void>();
    const entered = yield* Deferred.make<void>();
    const after = yield* handedOver(
      'masked-write-',
      PRINTS,
      [{ whenPathHas: join('stdout', segmentFile(0n)), onCall: 3, held, entered, heldThroughInterrupt: true, fails: true }],
      () => Deferred.await(entered),
    ).pipe(Effect.ensuring(Deferred.succeed(held, undefined)));
    expect(after).toMatchObject({ text: 'first', durable: byteOffset(5n) });
  }).pipe(Effect.provide(BunServices.layer)),
);
