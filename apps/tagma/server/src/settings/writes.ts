import { Effect, Result, Schema, type Scope } from 'effect';
import { GraphStore, type StoreFailure } from '../platform/contract/service/store.js';
import type { WriteUnit } from '../platform/contract/service/units.js';
import { writes } from '../platform/contract/service/writes.js';
import { WriterRegister } from '../platform/contract/service/writers.js';
import type { SettableScope, SettingKey } from '../platform/contract/wire/setting.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { session } from '../platform/store/writers.js';
import { SettingChanges } from './contract/service/changes.js';
import type { ManagedWriteInput, ManagedWriter, ManagedWriteRefusal, SettingWritten } from './contract/service/managed.js';
import { SettingReaction } from './contract/service/reaction.js';
import type { SettingLandRefusal, SettingWriteInput, SettingWriteRefusal } from './contract/service/values.js';
import { resolveSetting, type SettingLayer } from './resolution.js';
import { shapeOf } from './shape.js';
import { scopeRows, standingRow, storedValue, storeRow } from './store/rows.js';
import { setting } from './store/table.js';

type SettingLand<Code extends string> = {
  readonly key: SettingKey<unknown>;
  readonly scope: SettableScope;
  readonly projectId: number | undefined;
  readonly declined: boolean | 'standing';
  readonly value: Effect.Effect<unknown, StoreFailure | GateRefusal<Code>>;
};

const beneathOf = (scope: SettableScope, chain: readonly SettingLayer[]): SettingLayer[] =>
  chain.filter((layer) => (scope === 'project' ? layer.scope !== 'project' : false));

const gates = Effect.fn('Settings.gates')(function* (
  key: SettingKey<unknown>,
  scope: SettableScope,
  projectId: number | undefined,
): Effect.fn.Return<void, GateRefusal<'setting-scope'>> {
  if (!key.scopes.includes(scope)) {
    return yield* new GateRefusal('setting-scope', `Setting ${key.id} cannot be set in ${scope} scope.`, [
      `it accepts: ${key.scopes.join(', ')}`,
    ]);
  }
  if (scope === 'project' && projectId === undefined) {
    return yield* new GateRefusal('setting-scope', 'A project-scope setting needs the project it binds.', [
      'name the project, or write the value in user scope',
    ]);
  }
});

export const makeWrites = Effect.fnUntraced(function* (input: {
  readonly keysById: ReadonlyMap<string, SettingKey<unknown>>;
  readonly layers: (projectId?: number) => Effect.Effect<SettingLayer[], StoreFailure>;
  readonly publish: (keyId: string, scope: SettableScope, projectId: number | null, stored: string | null, declined: boolean) => void;
}) {
  const { keysById, layers, publish } = input;
  const changes = yield* SettingChanges;
  const store = yield* GraphStore;
  const sessions = yield* WriterRegister;
  const reaction = yield* SettingReaction;
  const managers = new Map<string, ManagedWriter<unknown>>();

  const settle = Effect.fnUntraced(function* (
    key: SettingKey<unknown>,
    scope: SettableScope,
    projectId: number | null,
    stored: string | null,
    declined: boolean,
    unit: WriteUnit<'graph'>,
  ): Effect.fn.Return<SettingWritten, StoreFailure> {
    yield* storeRow(store.db, sessions, unit, key.id, scope, projectId, stored, declined);
    return {
      announce: Effect.andThen(
        Effect.sync(() => publish(key.id, scope, projectId, stored, declined)),
        changes.publish({ key: key.id, scope, projectId }),
      ),
    };
  });

  const land = Effect.fn('Settings.land')(function* <Code extends string>(
    landing: SettingLand<Code>,
  ): Effect.fn.Return<void, StoreFailure | GateRefusal<Code | SettingLandRefusal>> {
    const key = landing.key;
    const projectId = landing.scope === 'project' ? (landing.projectId ?? null) : null;
    const reacting = reaction.open();
    yield* store.transaction(
      writes('settings', [session, setting], reaction.reach),
      (unit) =>
        reacting.within(
          unit,
          key,
          projectId,
          Effect.gen(function* () {
            const offered = yield* landing.value;
            const declined =
              landing.declined === 'standing'
                ? (yield* standingRow(store.db, key.id, landing.scope, projectId)).declined
                : landing.declined;
            const beneath = resolveSetting(key, beneathOf(landing.scope, yield* layers(landing.projectId)));
            const stored = storedValue(key, offered, declined, beneath);
            return yield* settle(key, landing.scope, projectId, stored, declined, unit);
          }),
        ),
      { onCommit: (written) => reacting.committed(written.announce) },
    );
  });

  const managedWrite = Effect.fn('Settings.managedWrite')(function* (
    writer: ManagedWriter<unknown>,
    key: SettingKey<unknown>,
    scope: SettableScope,
    projectId: number | undefined,
    offered: unknown,
    declined: boolean,
    declinedGiven: boolean,
  ): Effect.fn.Return<void, StoreFailure | GateRefusal<ManagedWriteRefusal>> {
    const chain = yield* layers(projectId);
    const stored = storedValue(key, offered, declined, resolveSetting(key, beneathOf(scope, chain)));
    const values = new Map<string, unknown>();
    if (stored !== null) values.set(key.id, JSON.parse(stored));
    const prospective: SettingLayer = { scope, values, declined: declined ? new Set([key.id]) : new Set(), writers: new Map() };
    yield* writer({
      key,
      scope,
      projectId: scope === 'project' ? (projectId ?? null) : null,
      value: offered,
      declined,
      declinedGiven,
      resolved: resolveSetting(key, [...chain.filter((layer) => layer.scope !== scope), prospective]).value,
    });
  });

  const write = Effect.fn('Settings.write')(function* (
    offer: SettingWriteInput,
  ): Effect.fn.Return<void, StoreFailure | GateRefusal<SettingWriteRefusal>> {
    const key = keysById.get(offer.key);
    if (!key) {
      return yield* new GateRefusal('unknown-setting', `No setting is declared under ${offer.key}.`, [
        `the declared keys are: ${[...keysById.keys()].join(', ')}`,
      ]);
    }
    const writer = managers.get(key.id);
    if (writer === undefined && key.control?.kind === 'managed') {
      return yield* new GateRefusal(
        'setting-managed',
        `${key.id} is written by ${key.control.by} alone: this door writes the key WHOLE, so a value or a clear here would replace every entry at once with none of that operation's gates and nothing reconciled after it.`,
        [`${key.control.by} writes this key, one entry at a time and gated`, 'read what stands with read_settings'],
      );
    }
    if (writer === undefined && key.installs === true) {
      return yield* new GateRefusal(
        'setting-managed',
        `${key.id} installs what it names, and nothing that installs it is running here, so its value cannot be written.`,
        ['read what stands with read_settings'],
      );
    }
    const scope = offer.scope ?? (key.scopes.includes('project') ? 'project' : 'user');
    yield* gates(key, scope, offer.projectId);
    if (offer.value !== undefined) {
      const decoded = Schema.decodeUnknownResult(key.schema)(offer.value);
      if (Result.isFailure(decoded)) {
        return yield* new GateRefusal('setting-value', `The value offered for ${key.id} is not what it holds: ${decoded.failure.message}`, [
          `write a value of the form ${key.id} holds: ${shapeOf(key)}`,
          key.description,
        ]);
      }
    }
    const declined = offer.declined ?? false;
    if (writer !== undefined) {
      return yield* managedWrite(writer, key, scope, offer.projectId, offer.value, declined, offer.declined !== undefined);
    }
    yield* land<never>({ key, scope, projectId: offer.projectId, declined, value: Effect.succeed(offer.value) });
  });

  const amend = Effect.fnUntraced(function* <A, Code extends string>(
    key: SettingKey<A>,
    scope: SettableScope,
    projectId: number | undefined,
    change: (current: A) => Effect.Effect<A, GateRefusal<Code>>,
  ): Effect.fn.Return<void, StoreFailure | GateRefusal<Code | SettingLandRefusal | 'setting-scope' | 'setting-value'>> {
    const declaration = key as SettingKey<unknown>;
    yield* gates(declaration, scope, projectId);
    yield* land<Code | 'setting-value'>({
      key: declaration,
      scope,
      projectId,
      declined: 'standing',
      value: Effect.gen(function* () {
        const { value: current, spare } = yield* scopeRows(store.db, key, scope, scope === 'project' ? (projectId ?? null) : null);
        const changed = yield* Schema.encodeEffect(key.schema)((yield* change(current)) as never).pipe(
          Effect.mapError(
            (issue) =>
              new GateRefusal('setting-value', `The changed value for ${key.id} cannot be stored: ${issue.message}`, [key.description]),
          ),
        );
        return spare.length === 0 ? changed : [...(changed as unknown[]), ...spare];
      }),
    });
  });

  const register = Effect.fnUntraced(function* <A>(key: SettingKey<A>, writer: ManagedWriter<A>) {
    if (managers.has(key.id)) return yield* Effect.die(`a second writer registered for ${key.id}`);
    managers.set(key.id, writer as ManagedWriter<unknown>);
    yield* Effect.addFinalizer(() => Effect.sync(() => managers.delete(key.id)));
  });

  const managed = Effect.fnUntraced(function* <A>(unit: WriteUnit<'graph'>, written: ManagedWriteInput<A>) {
    const key = written.key as SettingKey<unknown>;
    const stored = written.kept
      ? (yield* standingRow(store.db, key.id, written.scope, written.projectId)).value
      : written.pinned === true && written.value !== undefined
        ? JSON.stringify(written.value)
        : storedValue(
            key,
            written.value,
            written.declined,
            resolveSetting(key, beneathOf(written.scope, yield* layers(written.projectId ?? undefined))),
          );
    return yield* settle(key, written.scope, written.projectId, stored, written.declined, unit);
  });

  return { write, amend, register, managed };
});
