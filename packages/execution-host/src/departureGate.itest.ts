import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { join } from 'node:path';
import { Deferred, Effect, Fiber, FileSystem, Layer, Schedule } from 'effect';
import { ExecutionStore } from './store/ExecutionStore';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Bindings } from './Bindings';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { HostAdmission } from './HostAdmission';
import { connectionOf, fixtureHolder, hostProfile, hostTestRoot, keyOf, principalOf, registrationOf } from './hostFixture';
import { hostSpawner } from './hostSpawner';
import { hostState } from './hostState';
import { testHolder } from './posix/testing/holder';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { HostLifecycle } from './registry/shutdown';
import type { HostClaim } from './registry/state';

const directory = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = hostTestRoot();
  yield* fs.makeDirectory(root, { recursive: true });
  return yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'departure-gate-' });
});
const fixture = Effect.fnUntraced(function* ({ directory }: { readonly directory: string }) {
  const entered = yield* Deferred.make<void>();
  let parked = false;
  const files = Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (real) =>
      FileSystem.FileSystem.of({
        ...real,
        makeDirectory: (path, options) =>
          Effect.andThen(
            parked && path.startsWith(join(directory, 'records'))
              ? Effect.andThen(Deferred.succeed(entered, undefined), Effect.never)
              : Effect.void,
            real.makeDirectory(path, options),
          ),
      }),
    ),
  ).pipe(Layer.provide(BunFileSystem.layer));
  const context = yield* Layer.build(
    ExecutionRegistry.layer().pipe(
      Layer.provideMerge(Bindings.layer),
      Layer.provideMerge(
        hostState(join(directory, 'executions.sqlite'), registrationOf(directory), yield* sharedPool).pipe(
          Layer.provideMerge(ExecutionCapacity.layer(hostProfile({ executions: 2 }))),
        ),
      ),
      Layer.provide(testHolder(directory)),
      Layer.provide(files),
    ),
  );
  return {
    context,
    entered,
    park: Effect.sync(() => {
      parked = true;
    }),
  };
});
const claimed = Effect.gen(function* () {
  const custodian = yield* Custodian;
  const took = yield* custodian.take(keyOf('take-gate'), 0, connectionOf('gate'), 'custodian');
  return { connection: connectionOf('gate'), epoch: took.standing.epoch, role: 'custodian' } satisfies HostClaim;
});
const ticketOf = (lifecycle: HostLifecycle['Service'], claim: HostClaim) =>
  Effect.flatMap(lifecycle.quiesce(claim, keyOf('quiesce-gate')), (answer) =>
    answer._tag === 'Refused' ? Effect.die(new Error(`quiesce refused: ${answer.refusal._tag}`)) : Effect.succeed(answer.ticket),
  );

layer(Layer.mergeAll(BunFileSystem.layer, BunPath.layer, hostSpawner), { excludeTestServices: true })(
  'a host ends one way at a time',
  (it) => {
    it.effect(
      'a shutdown asked after an accepted yield is refused as closed admission',
      Effect.fnUntraced(function* () {
        const current = yield* fixture({ directory: yield* directory });
        yield* Effect.gen(function* () {
          const lifecycle = yield* HostLifecycle;
          const claim = yield* claimed;
          const yielded = yield* lifecycle.yield(yield* ticketOf(lifecycle, claim));
          const shutdown = yield* lifecycle.shutdown(claim, keyOf('shutdown-after-yield'));
          yield* lifecycle.departed;
          expect(yielded._tag).toBe('Yielding');
          expect(shutdown).toMatchObject({ _tag: 'Refused', refusal: { _tag: 'AdmissionClosed' } });
        }).pipe(Effect.provide(current.context));
      }),
    );

    it.effect(
      'a yield asked while a shutdown runs is refused as a conflict and shutdown finishes',
      Effect.fnUntraced(function* () {
        const current = yield* fixture({ directory: yield* directory });
        yield* Effect.gen(function* () {
          const lifecycle = yield* HostLifecycle;
          const admission = yield* HostAdmission;
          const executions = yield* Executions;
          const claim = yield* claimed;
          const started = yield* executions.start(claim, keyOf('start-stubborn'), {
            command: { program: '/usr/bin/perl', args: ['-e', '$SIG{INT}="IGNORE"; $SIG{TERM}="IGNORE"; sleep 30'], environment: [] },
            transport: { _tag: 'pipes', stdin: 'ignore' },
            lifetime: 'held',
            purpose: 'command',
            target: { environment: 'e', namespace: 'n', cwd: '/tmp', dependencies: [] },
            holder: principalOf('gate'),
            origin: principalOf('gate'),
          });
          if (started._tag !== 'Started') return yield* Effect.die(new Error(`did not start: ${started._tag}`));
          const ticket = yield* ticketOf(lifecycle, claim);
          const shutting = yield* Effect.forkScoped(lifecycle.shutdown(claim, keyOf('shutdown-first')));
          yield* admission.phase().pipe(Effect.repeat({ while: (phase) => phase === 'open', schedule: Schedule.spaced('5 millis') }));
          const yielded = yield* lifecycle.yield(ticket);
          expect(yielded).toMatchObject({ _tag: 'Refused', refusal: { _tag: 'HostConflict' } });
          expect((yield* Fiber.join(shutting))._tag).toBe('ShutdownComplete');
        }).pipe(Effect.provide(current.context));
      }),
    );

    it.effect(
      'a command accepted before logic yields ends not started',
      Effect.fnUntraced(function* () {
        const root = yield* directory;
        const outcome = yield* Effect.scoped(
          Effect.gen(function* () {
            const current = yield* fixture({ directory: root });
            return yield* Effect.gen(function* () {
              const lifecycle = yield* HostLifecycle;
              const executions = yield* Executions;
              const claim = yield* claimed;
              yield* current.park;
              const accepted = yield* executions.start(claim, keyOf('start-queued'), {
                command: { program: '/bin/echo', args: ['never'], environment: [] },
                transport: { _tag: 'pipes', stdin: 'ignore' },
                lifetime: 'command',
                purpose: 'command',
                target: { environment: 'e', namespace: 'n', cwd: '/tmp', dependencies: [] },
                holder: principalOf('gate'),
                origin: principalOf('gate'),
                admission: {
                  origin: { scope: 'project-1', owner: 'agent-1', cohort: 'wave-1' },
                  limits: { executionMs: 60_000 },
                  policyIdentity: 'policy-1',
                },
              });
              yield* Deferred.await(current.entered);
              const yielded = yield* lifecycle.yield(yield* ticketOf(lifecycle, claim));
              yield* lifecycle.departed;
              return { accepted, yielded };
            }).pipe(Effect.provide(current.context));
          }),
        );
        const decided = yield* ExecutionStore.use((store) => store.decisionOf(keyOf('start-queued'))).pipe(
          Effect.provide(
            hostState(join(root, 'executions.sqlite'), registrationOf(root), yield* sharedPool).pipe(
              Layer.provide(fixtureHolder()),
              Layer.provideMerge(ExecutionCapacity.layer(hostProfile({ executions: 2 }))),
            ),
          ),
        );
        expect(outcome.accepted._tag).toBe('Accepted');
        expect(outcome.yielded._tag).toBe('Yielding');
        expect(decided).toMatchObject({ _tag: 'Cancelled', cause: 'not-started' });
      }),
    );
  },
);
