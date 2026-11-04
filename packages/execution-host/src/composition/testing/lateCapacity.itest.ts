import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Fiber, FileSystem, Layer } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { host, serve } from '../../host';
import { ExecutionId } from '@runlith/executions/protocol/execution';
import { ExecutionCapacity } from '../../ExecutionCapacity';
import { makeSegmentRecord } from '../../ExecutionRecord';
import { Holder } from '../../holder/Holder';
import { Bindings } from '../../Bindings';
import { ExecutionRegistry } from '../../registry/ExecutionRegistry';
import { Executions } from '../../registry/launch';
import { HostByteRecords } from '../../registry/reads';
import { ExecutionStore } from '../../store/ExecutionStore';
import { hostSpawner } from '../../hostSpawner';
import { PlatformFacts } from '../../PlatformFacts';
import {
  fixtureFacts,
  fixtureHolder,
  hostPolicy,
  hostShare,
  hostWireLimits,
  hostTestRoot,
  keyOf,
  principalOf,
  registrationOf,
} from '../../hostFixture';
import { HOLDER_LIBRARY, testHolder } from '../../posix/testing/holder';
import { platformLayer } from '../platform';
import { credentialsLayer } from '../../posix/credentials';

it.live('an adopted child ending during globals leaves its sampled descriptors out of the initialized occupancy', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const state = yield* files.makeTempDirectoryScoped({ prefix: 'adopted-census-' });
    const native = yield* Layer.build(testHolder(state).pipe(Layer.provide(hostSpawner)));
    const holder = Context.get(native, Holder);
    const policy = hostPolicy({ transports: ['pipes'] });
    const facts = fixtureFacts(policy);
    const input = {
      state,
      registration: registrationOf(state),
      library: HOLDER_LIBRARY,
      policy,
      share: hostShare(policy, 2),
      limits: hostWireLimits(policy, 1, { envelopeBytes: 16384, connections: 2, requests: 4 }),
    };
    const execution = ExecutionId.make('adopted-census');
    const operation = keyOf('adopted-census');
    const child = yield* Effect.scoped(
      Effect.gen(function* () {
        const built = yield* host(input);
        const store = yield* Effect.provide(ExecutionStore, built.owners);
        const capacity = yield* Effect.provide(ExecutionCapacity, built.owners);
        yield* capacity.reserve(execution, 'pipes');
        const ref = { execution, installation: input.registration.installation, incarnation: built.incarnation };
        yield* store.reserve({
          operation,
          fingerprint: 'adopted-census',
          ref,
          transport: 'pipes',
          purpose: 'command',
          target: { environment: 'test', namespace: 'test', cwd: state, dependencies: [] },
          holder: principalOf('census'),
          origin: principalOf('census'),
          receipt: { _tag: 'Accepted', execution: ref },
          lifetime: 'held',
        });
        const record = yield* makeSegmentRecord({
          mode: 'create',
          records: `${state}/records`,
          ref,
          transport: 'pipes',
          limits: policy.execution,
        });
        yield* record.suspend();
        return yield* holder.launch({
          id: execution,
          path: '/bin/cat',
          argv: ['cat'],
          env: [],
          cwd: state,
          transport: { _tag: 'pipes', stdin: 'pipe' },
          pace: 'full',
        });
      }),
    ).pipe(Effect.provide(native), Effect.provideService(PlatformFacts, facts));
    yield* Effect.scoped(
      Effect.gen(function* () {
        const sampled = yield* Deferred.make<void>();
        const globals = yield* Deferred.make<void>();
        let records!: HostByteRecords['Service'];
        const expense = ExecutionCapacity.descriptors(policy, facts.descriptors).pipes;
        const reading = PlatformFacts.of({
          ...facts,
          limits: Effect.succeed({ openFiles: expense.logic, holderFiles: 'absent', processes: 'absent', terminals: 'absent' }),
          standing: Effect.fnUntraced(function* (observe) {
            const standing = yield* Effect.sync(() => {
              observe();
              return {
                descriptors: facts.descriptors.pipes.logic + (records.openHandles().get(execution) ?? 0),
                holderDescriptors: 0,
                processes: 1,
                terminals: 0,
              };
            });
            yield* Deferred.succeed(sampled, undefined);
            yield* Deferred.await(globals);
            return standing;
          }),
        });
        const built = yield* host(input).pipe(Effect.provideService(PlatformFacts, reading));
        const registry = yield* Layer.build(
          ExecutionRegistry.layer().pipe(Layer.provideMerge(Bindings.layer), Layer.provide(hostSpawner), Layer.provide(built.owners)),
        );
        const executions = Context.get(registry, Executions);
        records = Context.get(registry, HostByteRecords);
        const capacity = yield* Effect.provide(ExecutionCapacity, built.owners);
        expect((yield* executions.summary(execution))?.state.phase).toBe('running');
        const initializing = yield* Effect.forkChild(capacity.initialize(reading, records.openHandles));
        yield* Deferred.await(sampled);
        yield* child.closeInput;
        while (true) {
          const changed = yield* executions.changed(execution);
          const summary = yield* executions.summary(execution);
          if (summary?.state.cleanup === 'complete') break;
          yield* changed;
        }
        expect((yield* capacity.ledger()).executions).toBe(0);
        yield* Deferred.succeed(globals, undefined);
        expect((yield* Fiber.join(initializing)).perTransport.pipes).toBe(1);
        yield* capacity.reserve(ExecutionId.make('after-census'), 'pipes');
        expect(yield* Effect.flip(capacity.reserve(ExecutionId.make('beyond-census'), 'pipes'))).toMatchObject({
          budget: 'host.executions',
        });
      }),
    ).pipe(Effect.provide(native.pipe(Context.add(PlatformFacts, facts), Context.add(Holder, Holder.of({ ...holder, held: [child] })))));
  }).pipe(Effect.provide(HostRegistration.layer), Effect.provide(BunServices.layer)),
);

it.live(
  'a late zero-guarantee refusal withdraws the registration it published',
  Effect.fnUntraced(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = hostTestRoot();
    yield* fs.makeDirectory(root, { recursive: true });
    const state = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'late-capacity-' });
    const policy = hostPolicy({ executions: 1, transports: ['pipes'] });
    const limits = hostWireLimits(policy, 1, { envelopeBytes: 16384, connections: 2, requests: 4 });
    const facts = fixtureFacts(policy);
    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        const refused = yield* Effect.flip(
          serve({ state, registration: registrationOf(state), library: HOLDER_LIBRARY, policy, share: hostShare(policy), limits }).pipe(
            Effect.provideService(PlatformFacts, {
              ...facts,
              limits: Effect.succeed({ openFiles: 'absent', holderFiles: 'absent', terminals: 'absent', processes: 1 } as const),
              standing: (observe) =>
                Effect.sync(() => {
                  observe();
                  return { terminals: 0, descriptors: 0, holderDescriptors: 0, processes: 1 };
                }),
            }),
            Effect.provide(platformLayer(HOLDER_LIBRARY)),
            Effect.provide(credentialsLayer(registrationOf(state).credentials)),
            Effect.provide(fixtureHolder()),
          ),
        );
        const registrations = yield* HostRegistration;
        const missing = yield* Effect.flip(registrations.read(state));
        return { refused, missing };
      }),
    ).pipe(Effect.provide(HostRegistration.layer));
    expect(result.refused._tag).toBe('ProfileInvalid');
    expect(result.missing._tag).toBe('RegistrationMissing');
  }, Effect.provide(BunServices.layer)),
);
