import { it } from '@runlith/effect-test';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer, Path, Stream, type Scope } from 'effect';
import { ChildProcess, type ChildProcessSpawner } from 'effect/process';
import { NamespaceId } from '@runlith/files/namespace';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { EnvironmentId, type EnvironmentBinding, type EnvironmentConsumer, type EnvironmentState } from '../contract/wire/environments.js';
import { makeEnvironmentLedger } from './access.js';
import { makeBackendRegistry } from './backends.js';
import { makeEnvironmentStore } from '../store/environments.js';
import { makeEnvironmentUseStore } from '../store/environmentUses.js';
import { makeEnvironmentUses } from './uses.js';
import { EnvironmentBackends } from '../contract/service/environments.js';
import { hostEnvironment, makeMachineWorld } from '../../executions/testing/doubles.js';

const consumer: EnvironmentConsumer = { kind: 'terminal', id: 'environment-access-test' };
const machineWorld = makeMachineWorld(() => null);
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
  ),
);
const layers = Layer.mergeAll(storage, BunFileSystem.layer, Path.layer);

const fixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const anchor = yield* files.makeTempDirectoryScoped({ prefix: 'environment-access-' });
  const store = makeEnvironmentStore({ db });
  const host = yield* hostEnvironment({ records: store, anchor, world: machineWorld });
  const uses = makeEnvironmentUses({ uses: makeEnvironmentUseStore({ db }) });
  const access = yield* Effect.provideService(
    makeEnvironmentLedger({ uses }),
    EnvironmentBackends,
    makeBackendRegistry({ backends: [host] }),
  );
  return { files, anchor, store, uses, units, access };
});

const run = <A, E>(work: Effect.Effect<A, E, MachineStore | MachineUnits | FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
  Effect.provide(work, layers);

function witnessed(state: EnvironmentState): EnvironmentBinding {
  if (state.binding === null) throw new Error(`the environment did not answer for itself: ${state.reason}`);
  return state.binding;
}

const environmentOf = Effect.fn('test.environmentOf')(function* (
  variables: readonly { readonly name: string; readonly value: string }[],
  exec: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>,
) {
  const printed = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make('/usr/bin/env', [], {
        env: Object.fromEntries(variables.map((variable) => [variable.name, variable.value])),
        extendEnv: false,
        stdin: 'ignore',
      });
      return yield* Stream.mkString(Stream.decodeText(handle.stdout));
    }),
  ).pipe(Effect.provide(exec));
  return printed.split('\n').filter((line) => line.length > 0);
});

it.live('inspection opens no channel, and acquisition hands back the real host world', () =>
  run(
    Effect.gen(function* () {
      const { access, files, anchor } = yield* fixture;
      const [first, second] = yield* Effect.all([access.inspect('host'), access.inspect('host')], {
        concurrency: 2,
      });
      const looked = witnessed(first);
      expect(witnessed(second)).toEqual(looked);
      const again = yield* access.inspect('host');
      expect(again.availability).toBe('available');
      expect(witnessed(again)).toEqual(looked);
      const acquired = yield* access.acquireActive({ binding: looked, consumer, requires: ['files', 'exec'] });
      expect(acquired.accessGeneration).toBe(1);
      expect(acquired.use).toEqual({ _tag: 'Intrinsic', binding: looked });
      const bound = acquired.world.files;
      const exec = acquired.world.exec;
      if (bound === undefined || exec === undefined) return yield* Effect.die(new Error('the host world bound no filesystem or spawner'));
      const note = `${anchor}/note`;
      yield* files.writeFileString(note, 'bound');
      const read = yield* Effect.provide(
        Effect.flatMap(FileSystem.FileSystem, (world) => world.readFileString(note)),
        bound,
      );
      expect(read).toBe('bound');
      const alone = yield* acquired.commandEnvironment.materialize({
        inherit: false,
        entries: [{ _tag: 'Set', name: 'TAGMA_ENVIRONMENT_PROOF', value: 'bound' }],
      });
      expect(yield* environmentOf(alone, exec)).toEqual(['TAGMA_ENVIRONMENT_PROOF=bound']);
      const without = yield* acquired.commandEnvironment.materialize({
        inherit: true,
        entries: [{ _tag: 'Unset', name: 'PATH' }],
      });
      const printed = yield* environmentOf(without, exec);
      expect(printed.some((line) => line.startsWith('PATH='))).toBe(false);
      expect(printed.length).toBeGreaterThan(0);
      const reopened = yield* access.acquireActive({ binding: looked, consumer, requires: ['files'] });
      expect(reopened.accessGeneration).toBe(2);
      expect(reopened.binding).toEqual(looked);
    }),
  ),
);

it.live('a binding the backend does not answer for cannot win acquisition', () =>
  run(
    Effect.gen(function* () {
      const { access } = yield* fixture;
      const binding = witnessed(yield* access.inspect('host'));
      const replaced: EnvironmentBinding = {
        ...binding,
        identityWitness: { ...binding.identityWitness, token: `${binding.identityWitness.token}-elsewhere` },
      };
      const stale = yield* Effect.flip(access.acquireActive({ binding: replaced, consumer, requires: ['files'] }));
      expect(stale._tag).toBe('EnvironmentReplaced');
      if (stale._tag === 'EnvironmentReplaced') expect(stale.current).toEqual(binding.identityWitness);
      expect((yield* access.inspect('host', { binding: replaced })).availability).toBe('replaced');
      const otherFormat: EnvironmentBinding = {
        ...binding,
        identityWitness: { ...binding.identityWitness, format: 'another-witness-format' },
      };
      const incomparable = yield* Effect.flip(access.acquireActive({ binding: otherFormat, consumer, requires: ['files'] }));
      expect(incomparable._tag).toBe('EnvironmentReplaced');
      expect(witnessed(yield* access.inspect('host')).namespaceId).toBe(binding.namespaceId);
      const foreign: EnvironmentBinding = {
        ...binding,
        environmentId: EnvironmentId.make('environment-of-another-installation'),
        namespaceId: NamespaceId.make('namespace-of-another-installation'),
      };
      const unknown = yield* Effect.flip(access.acquireActive({ binding: foreign, consumer, requires: ['files'] }));
      expect(unknown._tag).toBe('EnvironmentUnavailable');
      if (unknown._tag === 'EnvironmentUnavailable') expect(unknown.binding).toEqual(foreign);
      const elsewhere: EnvironmentBinding = {
        ...binding,
        namespaceId: NamespaceId.make('namespace-of-another-address-space'),
      };
      const misnamed = yield* Effect.flip(access.acquireActive({ binding: elsewhere, consumer, requires: ['files'] }));
      expect(misnamed._tag).toBe('EnvironmentUnavailable');
      if (misnamed._tag === 'EnvironmentUnavailable') {
        expect(misnamed.binding.namespaceId).toBe(elsewhere.namespaceId);
      }
      const activatedElsewhere = yield* Effect.flip(access.activate(foreign));
      expect(activatedElsewhere._tag).toBe('EnvironmentUnavailable');
      if (activatedElsewhere._tag === 'EnvironmentUnavailable') {
        expect(activatedElsewhere.binding).toEqual(foreign);
      }
      const activatedMisnamed = yield* Effect.flip(access.activate(elsewhere));
      expect(activatedMisnamed._tag).toBe('EnvironmentUnavailable');
      if (activatedMisnamed._tag === 'EnvironmentUnavailable') {
        expect(activatedMisnamed.binding.namespaceId).toBe(elsewhere.namespaceId);
      }
      const activatedStale = yield* Effect.flip(access.activate(replaced));
      expect(activatedStale._tag).toBe('EnvironmentReplaced');
      if (activatedStale._tag === 'EnvironmentReplaced') {
        expect(activatedStale.current).toEqual(binding.identityWitness);
      }
    }),
  ),
);

it.live('a reading that could not witness the storage says so, and never reports it absent', () =>
  run(
    Effect.gen(function* () {
      const { files, store, units } = yield* fixture;
      const home = yield* files.makeTempDirectoryScoped({ prefix: 'environment-anchor-' });
      const gone = yield* hostEnvironment({ records: store, anchor: `${home}/never-made`, world: machineWorld });
      const absent = yield* gone.state();
      expect(absent.availability).toBe('unavailable');
      expect(absent.binding).toBeNull();
      yield* files.writeFileString(`${home}/blocker`, 'not a directory');
      const unreadable = yield* hostEnvironment({ records: store, anchor: `${home}/blocker/inside`, world: machineWorld });
      const unread = yield* unreadable.state();
      expect(unread.availability).toBe('unknown');
      expect(unread.binding).toBeNull();
      expect(unread.reason).toContain('could not be read');
      expect(unread.identity).toEqual(absent.identity);
    }),
  ),
);

it.live('an environment kind this installation binds no provider for refuses, and never falls back to the host', () =>
  run(
    Effect.gen(function* () {
      const { access } = yield* fixture;
      const host = witnessed(yield* access.inspect('host'));
      const guest: EnvironmentBinding = { ...host, kind: 'sandbox' };
      const browsed = yield* Effect.flip(access.inspect('sandbox'));
      expect(browsed._tag).toBe('ActivationUnsupported');
      if (browsed._tag === 'ActivationUnsupported') {
        expect(browsed.kind).toBe('sandbox');
        expect(browsed.capability).toBe('access');
        expect(browsed.binding).toBeNull();
      }
      const taken = yield* Effect.flip(access.acquireActive({ binding: guest, consumer, requires: ['exec'] }));
      expect(taken._tag).toBe('ActivationUnsupported');
      if (taken._tag === 'ActivationUnsupported') expect(taken.binding).toEqual(guest);
      expect(yield* access.heldUses(consumer)).toEqual([]);
      const activation = yield* Effect.flip(access.activate(host));
      expect(activation._tag).toBe('ActivationUnsupported');
      if (activation._tag === 'ActivationUnsupported') expect(activation.capability).toBe('activation');
    }),
  ),
);
