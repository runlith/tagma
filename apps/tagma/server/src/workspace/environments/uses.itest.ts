import { it } from '@runlith/effect-test';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { eq } from 'drizzle-orm';
import { Effect, FileSystem, Layer, type Scope } from 'effect';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { NamespaceId } from '@runlith/files/namespace';
import { environment } from '../store/tables.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { storeLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import {
  EnvironmentUseId,
  type EnvironmentBinding,
  type EnvironmentConsumer,
  type EnvironmentVerdictFailure,
} from '../contract/wire/environments.js';
import { makeEnvironmentLedger } from './access.js';
import { makeBackendRegistry } from './backends.js';
import {
  EnvironmentBackends,
  EnvironmentOpenLost,
  EnvironmentOpenRefused,
  type EnvironmentBackend,
} from '../contract/service/environments.js';
import { makeEnvironmentStore } from '../store/environments.js';
import { makeEnvironmentUseStore } from '../store/environmentUses.js';
import { makeEnvironmentUses } from './uses.js';
import { hostEnvironment, makeMachineWorld } from '../../executions/testing/doubles.js';

const holder: EnvironmentConsumer = { kind: 'terminal', id: 'environment-uses-test' };
const machineWorld = makeMachineWorld(() => null);

const opened = (path: string) =>
  unitsLayer(MachineUnits, MachineStore).pipe(
    Layer.provideMerge(Layer.unwrap(Effect.map(sharedPool, (pool) => storeLayer(MachineStore, path, fixtureMigrations, {}, pool)))),
  );

const withStore = <A, E>(path: string, work: Effect.Effect<A, E, MachineStore | MachineUnits | FileSystem.FileSystem | Scope.Scope>) =>
  work.pipe(Effect.provide(Layer.mergeAll(opened(path), BunFileSystem.layer)), Effect.scoped);

const installation = () => join(tmpdir(), `tagma-environment-${Math.random().toString(36).slice(2, 10)}`, 'tagma.sqlite');

const fixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const { db, path } = yield* MachineStore;
  const units = yield* MachineUnits;
  const uses = makeEnvironmentUses({ uses: makeEnvironmentUseStore({ db }) });
  const host = yield* hostEnvironment({ records: makeEnvironmentStore({ db }), anchor: dirname(path), world: machineWorld });
  const ledgerOver = (backend: EnvironmentBackend) =>
    Effect.provideService(makeEnvironmentLedger({ uses }), EnvironmentBackends, makeBackendRegistry({ backends: [backend] }));
  return { db, units, uses, host, ledgerOver, access: yield* ledgerOver(host) };
});

const removable = (
  binding: EnvironmentBinding,
  admit: (unit: Unit<'machine'>) => Effect.Effect<void, EnvironmentVerdictFailure>,
  opening: 'opens' | 'none' | 'unknown',
  serving: 'available' | 'unavailable' = 'available',
): EnvironmentBackend => {
  const identity = {
    environmentId: binding.environmentId,
    kind: binding.kind,
    namespaceId: binding.namespaceId,
  };
  const capabilities = { files: false, exec: false, heldExecution: false, egress: false };
  const state = Effect.succeed({
    identity,
    binding,
    availability: serving,
    capabilities,
    reason: serving === 'available' ? null : 'the guest is stopped',
  });
  return {
    kind: 'sandbox',
    hold: { _tag: 'Retained', admit: (unit) => admit(unit) },
    state: () => state,
    open: () =>
      opening === 'opens'
        ? Effect.succeed({
            world: { environment: { platform: 'linux', shell: '/bin/sh', tmp: '/tmp', executables: { ripgrep: Effect.die('unbound') } } },
            commandEnvironment: { materialize: () => Effect.succeed([]) },
          })
        : opening === 'none'
          ? Effect.fail(new EnvironmentOpenRefused({ binding, reason: 'the guest refused before anything was reached' }))
          : Effect.fail(new EnvironmentOpenLost({ binding, reason: 'the guest stopped answering mid-open' })),
    activate: () => Effect.succeed({ identity, binding, availability: 'available' as const, capabilities, reason: null }),
  };
};

it.live(
  'an unproved ending keeps the use standing, across the process that reserved it',
  Effect.fnUntraced(function* () {
    const path = installation();
    try {
      yield* standingSurvivesReopen(path);
    } finally {
      rmSync(dirname(path), { recursive: true, force: true });
    }
  }),
);

it.live(
  'a use whose consumer is gone is released as abandoned',
  Effect.fnUntraced(function* () {
    const path = installation();
    try {
      yield* withStore(
        path,
        Effect.gen(function* () {
          const { units, uses, host } = yield* fixture;
          const binding = (yield* host.state()).binding;
          if (binding === null) return yield* Effect.die(new Error('the host did not answer for itself'));
          const use = yield* units.write('EnvironmentUses.use', (unit) => uses.reserve(unit, binding, holder));
          const released = yield* units.write('EnvironmentUses.released', (unit) => uses.release(unit, use.useId, holder, 'abandoned'));
          expect(released.outcome).toBe('released');
        }),
      );
    } finally {
      rmSync(dirname(path), { recursive: true, force: true });
    }
  }),
);

const standingSurvivesReopen = Effect.fnUntraced(function* (path: string) {
  const reserved = yield* withStore(
    path,
    Effect.gen(function* () {
      const { units, uses, host } = yield* fixture;
      const binding = (yield* host.state()).binding;
      if (binding === null) return yield* Effect.die(new Error('the host did not answer for itself'));
      const use = yield* units.write('EnvironmentUses.use', (unit) => uses.reserve(unit, binding, holder));
      expect(use.outcome).toBe('reserved');
      const pending = yield* units.write('EnvironmentUses.pending', (unit) => uses.release(unit, use.useId, holder, 'uncertain'));
      expect(pending.outcome).toBe('release-pending');
      return { useId: use.useId, namespaceId: binding.namespaceId };
    }),
  );
  yield* withStore(
    path,
    Effect.gen(function* () {
      const { units, uses, host, access } = yield* fixture;
      const binding = (yield* host.state()).binding;
      if (binding === null) return yield* Effect.die(new Error('the host did not answer for itself'));
      expect(binding.namespaceId).toBe(reserved.namespaceId);
      const held = yield* access.heldUses(holder);
      expect(held.map((use) => use.useId)).toEqual([reserved.useId]);
      const refused = yield* Effect.flip(units.write('EnvironmentUses.refused', (unit) => uses.admitRemoval(unit, binding)));
      expect(refused._tag).toBe('EnvironmentUseConflict');
      if (refused._tag === 'EnvironmentUseConflict') {
        expect(refused.held).toEqual([holder]);
        expect(refused.holders).toBe(1);
        expect(refused.standing).toBe(1);
      }
      const second = yield* units.write('EnvironmentUses.second', (unit) => uses.reserve(unit, binding, holder));
      const twice = yield* Effect.flip(units.write('EnvironmentUses.twice', (unit) => uses.admitRemoval(unit, binding)));
      expect(twice._tag).toBe('EnvironmentUseConflict');
      if (twice._tag === 'EnvironmentUseConflict') {
        expect(twice.holders).toBe(1);
        expect(twice.standing).toBe(2);
        expect(twice.held).toEqual([holder]);
      }
      const split = yield* units.write('EnvironmentUses.split', (unit) =>
        uses.reserve(unit, binding, { kind: 'terminal', id: '\u001eop' }),
      );
      const joined = yield* units.write('EnvironmentUses.joined', (unit) =>
        uses.reserve(unit, binding, { kind: 'terminal\u001e', id: 'op' }),
      );
      const both = yield* Effect.flip(units.write('EnvironmentUses.both', (unit) => uses.admitRemoval(unit, binding)));
      expect(both._tag).toBe('EnvironmentUseConflict');
      if (both._tag === 'EnvironmentUseConflict') {
        expect(both.holders).toBe(3);
        expect(both.standing).toBe(4);
      }
      for (const use of [split, joined]) {
        expect(
          (yield* units.write('EnvironmentUses.standingSurvivesReopen', (unit) =>
            uses.release(unit, use.useId, use.consumer, 'never-applied'),
          )).outcome,
        ).toBe('released');
      }
      const unapplied = yield* units.write('EnvironmentUses.unapplied', (unit) =>
        uses.release(unit, second.useId, holder, 'never-applied'),
      );
      expect(unapplied.outcome).toBe('released');
      const absent = yield* Effect.flip(
        units.write('EnvironmentUses.absent', (unit) =>
          uses.release(unit, EnvironmentUseId.make('a-use-nobody-minted'), holder, 'cleanup-confirmed'),
        ),
      );
      expect(absent._tag).toBe('EnvironmentUseMissing');
      const stranger = yield* Effect.flip(
        units.write('EnvironmentUses.stranger', (unit) =>
          uses.release(unit, reserved.useId, { kind: 'terminal', id: 'somebody-else' }, 'cleanup-confirmed'),
        ),
      );
      expect(stranger._tag).toBe('EnvironmentUseMissing');
      const released = yield* units.write('EnvironmentUses.released', (unit) =>
        uses.release(unit, reserved.useId, holder, 'cleanup-confirmed'),
      );
      expect(released.outcome).toBe('released');
      const repeated = yield* units.write('EnvironmentUses.repeated', (unit) => uses.release(unit, reserved.useId, holder, 'uncertain'));
      expect(repeated.outcome).toBe('released');
      const revived = yield* Effect.flip(units.write('EnvironmentUses.revived', (unit) => uses.activate(unit, reserved.useId)));
      expect(revived._tag).toBe('EnvironmentUseResolved');
      yield* units.write('EnvironmentUses.standingSurvivesReopen', (unit) => uses.admitRemoval(unit, binding));
      expect(yield* access.heldUses(holder)).toEqual([]);
    }),
  );
});

it.live(
  'a reservation is written only with the admission that allowed it, in one unit',
  Effect.fnUntraced(function* () {
    const path = installation();
    try {
      yield* reservationMeetsRemoval(path);
    } finally {
      rmSync(dirname(path), { recursive: true, force: true });
    }
  }),
);

const reservationMeetsRemoval = (path: string) =>
  withStore(
    path,
    Effect.gen(function* () {
      const { db, units, uses, host, ledgerOver } = yield* fixture;
      const registered = (yield* host.state()).binding;
      if (registered === null) return yield* Effect.die(new Error('the host did not answer for itself'));
      const guest: EnvironmentBinding = { ...registered, kind: 'sandbox' };
      const admit = (unit: Unit<'machine'>) =>
        unit.run(db.select().from(environment).where(eq(environment.environmentId, guest.environmentId)).get()).pipe(
          Effect.mapError((error): EnvironmentVerdictFailure => ({
            _tag: 'EnvironmentRegistryUnavailable',
            reason: error.message,
          })),
          Effect.flatMap((row) =>
            row === undefined
              ? Effect.fail<EnvironmentVerdictFailure>({
                  _tag: 'EnvironmentUnavailable',
                  binding: guest,
                  witnessed: false,
                  reason: 'the environment has begun to leave',
                })
              : Effect.void,
          ),
        );
      const uncertain = yield* ledgerOver(removable(guest, admit, 'unknown'));
      const lost = yield* Effect.flip(Effect.scoped(uncertain.acquireActive({ binding: guest, consumer: holder, requires: [] })));
      expect(lost._tag).toBe('EnvironmentUnavailable');
      const standing = yield* uncertain.heldUses(holder);
      expect(standing.map((use) => use.outcome)).toEqual(['reserved']);
      const blocked = yield* Effect.flip(units.write('EnvironmentUses.blocked', (unit) => uses.admitRemoval(unit, guest)));
      expect(blocked._tag).toBe('EnvironmentUseConflict');
      const [obligation] = standing;
      if (obligation === undefined) return yield* Effect.die(new Error('the uncertain acquisition retained nothing'));
      yield* units.write('EnvironmentUses.reservationMeetsRemoval', (unit) =>
        uses.release(unit, obligation.useId, holder, 'cleanup-confirmed'),
      );
      const clean = yield* ledgerOver(removable(guest, admit, 'none'));
      yield* Effect.flip(Effect.scoped(clean.acquireActive({ binding: guest, consumer: holder, requires: [] })));
      expect(yield* clean.heldUses(holder)).toEqual([]);
      const open = yield* ledgerOver(removable(guest, admit, 'opens'));
      const acquired = yield* Effect.scoped(open.acquireActive({ binding: guest, consumer: holder, requires: [] }));
      expect(acquired.use._tag).toBe('Retained');
      const after = yield* open.heldUses(holder);
      expect(after.map((use) => use.outcome)).toEqual(['active']);
      const [running] = after;
      if (running === undefined) return yield* Effect.die(new Error('the opened access retained nothing'));
      yield* units.write('EnvironmentUses.reservationMeetsRemoval', (unit) =>
        uses.release(unit, running.useId, holder, 'cleanup-confirmed'),
      );
      yield* units.write('EnvironmentUses.reservationMeetsRemoval', (unit) =>
        unit.run(db.delete(environment).where(eq(environment.environmentId, guest.environmentId))),
      );
      const late = yield* Effect.flip(Effect.scoped(clean.acquireActive({ binding: guest, consumer: holder, requires: [] })));
      expect(late._tag).toBe('EnvironmentUnavailable');
      expect(yield* clean.heldUses(holder)).toEqual([]);
      const unserved = yield* Effect.flip(Effect.scoped(clean.acquireActive({ binding: guest, consumer: holder, requires: ['exec'] })));
      expect(unserved._tag).toBe('ActivationUnsupported');
      if (unserved._tag === 'ActivationUnsupported') expect(unserved.capability).toBe('exec');
    }),
  );
it.live(
  'activation reaches an environment that stands without serving, and no other',
  Effect.fnUntraced(function* () {
    const path = installation();
    try {
      yield* activationRoute(path);
    } finally {
      rmSync(dirname(path), { recursive: true, force: true });
    }
  }),
);

const activationRoute = (path: string) =>
  withStore(
    path,
    Effect.gen(function* () {
      const { host, ledgerOver } = yield* fixture;
      const registered = (yield* host.state()).binding;
      if (registered === null) return yield* Effect.die(new Error('the host did not answer for itself'));
      const guest: EnvironmentBinding = { ...registered, kind: 'sandbox' };
      const stopped = yield* ledgerOver(removable(guest, () => Effect.void, 'opens', 'unavailable'));
      expect(yield* stopped.activate(guest)).toMatchObject({ availability: 'available', binding: guest });
      const early = yield* Effect.flip(Effect.scoped(stopped.acquireActive({ binding: guest, consumer: holder, requires: [] })));
      expect(early._tag).toBe('EnvironmentUnavailable');
      if (early._tag === 'EnvironmentUnavailable') expect(early.witnessed).toBe(true);
      expect(yield* stopped.heldUses(holder)).toEqual([]);
      const elsewhere: EnvironmentBinding = { ...guest, namespaceId: NamespaceId.make('another-address-space') };
      const misnamed = yield* Effect.flip(stopped.activate(elsewhere));
      expect(misnamed._tag).toBe('EnvironmentUnavailable');
      if (misnamed._tag === 'EnvironmentUnavailable') {
        expect(misnamed.binding).toEqual(elsewhere);
        expect(misnamed.witnessed).toBe(false);
      }
      const stale: EnvironmentBinding = {
        ...guest,
        identityWitness: { ...guest.identityWitness, token: `${guest.identityWitness.token}-before` },
      };
      const replaced = yield* Effect.flip(stopped.activate(stale));
      expect(replaced._tag).toBe('EnvironmentReplaced');
      if (replaced._tag === 'EnvironmentReplaced') expect(replaced.current).toEqual(guest.identityWitness);
    }),
  );
