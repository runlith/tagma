import { Context, Effect, Layer } from 'effect';
import { GraphStore, StoreIdentityConflict } from '../platform/contract/service/store.js';
import { GraphUnits, type Unit } from '../platform/contract/service/units.js';
import { WriterRegister } from '../platform/contract/service/writers.js';
import type { SettingKey } from '../platform/contract/wire/setting.js';
import { unitsLayer } from '../platform/store/units.js';
import { SettingChanges } from './contract/service/changes.js';
import { DeclaredSettings, SettingDeclarations } from './contract/service/declarations.js';
import { ManagedWrite } from './contract/service/managed.js';
import { SettingReaction } from './contract/service/reaction.js';
import { Settings } from './contract/service/values.js';
import { catalog } from './catalog.js';
import { liveOf } from './live.js';
import { resolveSetting } from './resolution.js';
import { layers, makeValueReads } from './store/rows.js';
import { makeWrites } from './writes.js';

export const settingsLayer: Layer.Layer<
  Settings | SettingDeclarations | ManagedWrite | SettingChanges,
  never,
  GraphStore | WriterRegister | SettingReaction | DeclaredSettings
> = Layer.effectContext(
  Effect.gen(function* () {
    const declarations = yield* DeclaredSettings;
    const store = yield* GraphStore;
    const units = yield* GraphUnits;
    const sessions = yield* WriterRegister;
    const { db } = store;
    const valueRows = yield* makeValueReads;
    const reads = <F extends (...args: never[]) => Effect.Effect<unknown, unknown, unknown>>(verb: F): F =>
      ((...args: never[]) => units.markReadOnly(verb(...args))) as F;
    const chainOf = (projectId?: number) => layers(db, sessions, projectId);
    const sections = new Set(declarations.sections.map((section) => section.id));
    const homeless = declarations.keys.filter((key) => !sections.has(key.section));
    if (homeless.length > 0) {
      return yield* Effect.die(`settings declared in no section: ${homeless.map((key) => `${key.id} (${key.section})`).join(', ')}`);
    }
    const keysById: ReadonlyMap<string, SettingKey<unknown>> = new Map(declarations.keys.map((key) => [key.id, key]));
    const { live, held, changes, publish, settingChanges } = liveOf(chainOf);
    const { write, amend, register, managed } = yield* Effect.provideService(
      makeWrites({ keysById, layers: chainOf, publish }),
      SettingChanges,
      settingChanges,
    );

    return Context.make(Settings, {
      read: reads(<A>(key: SettingKey<A>, projectId?: number) =>
        Effect.map(layers(db, sessions, projectId, key.id), (chain) => resolveSetting(key, chain)),
      ),
      value: reads(<A>(key: SettingKey<A>, projectId?: number, unit?: Unit<'machine'>) => {
        const resolved = Effect.map(valueRows(projectId, key.id), (chain) => resolveSetting(key, chain).value);
        if (unit === undefined) return resolved;
        return unit.store === store.identity
          ? unit.run(resolved)
          : Effect.die(new StoreIdentityConflict({ expected: store.identity, actual: unit.store }));
      }),
      chain: reads((projectId?: number) =>
        Effect.map(
          valueRows(projectId),
          (resolved) =>
            <A>(key: SettingKey<A>): A =>
              resolveSetting(key, resolved).value,
        ),
      ),
      live: reads(live),
      held: reads(held),
      changes: reads(changes),
      write,
      amend,
    }).pipe(
      Context.add(SettingDeclarations, { read: reads(catalog(declarations, chainOf)) }),
      Context.add(ManagedWrite, { register, write: managed }),
      Context.add(SettingChanges, settingChanges),
    );
  }),
).pipe(Layer.provide(unitsLayer(GraphUnits, GraphStore)));
