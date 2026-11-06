import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { defineAdapter, type SettingInstance, type SettingRow } from '@runlith/tagma/adapter/provider';
import { CredentialFileFailed } from '@runlith/credential-file/failure';
import { Effect, Layer } from 'effect';
import { AdapterInstances } from '../contract/service/instances.js';
import { BuiltinAdapters, ProviderRegistry } from '../contract/service/registry.js';
import { registryLayer } from '../registry.js';
import { listModels, removeInstance, saveInstance } from './instanceActs.js';

const world = Effect.fnUntraced(function* (unwritable = false) {
  const entry = yield* Effect.promise(() => import('@runlith/adapter-openai-compatible/adapter'));
  const rows = new Map<string, SettingInstance>();
  const secrets: Record<string, SettingRow> = {};
  let revision = 0;
  const store = Layer.succeed(AdapterInstances, {
    read: () => Effect.succeed({ instances: new Map([['openai-compatible', [...rows.values()]]]), secrets }),
    save: (_adapter, instance, hidden) =>
      unwritable
        ? Effect.fail(new CredentialFileFailed({ kind: 'write', reason: 'unwritable' }))
        : Effect.sync(() => {
            const saved = { ...instance, revision: String(++revision) };
            secrets[instance.id] = hidden;
            rows.set(instance.id, saved);
            return saved;
          }),
    remove: (_adapter, id) =>
      Effect.sync(() => {
        delete secrets[id];
        rows.delete(id);
      }),
  });
  const settings = {
    ...entry.adapter.settings!,
    fields: [
      ...entry.adapter.settings!.fields,
      { id: 'password', label: 'Password', type: 'text' as const, secret: true as const },
      { id: 'pin', label: 'Pin', type: 'number' as const, secret: true as const },
      {
        id: 'connections',
        label: 'Connections',
        type: 'rows' as const,
        noun: 'connection',
        fields: [
          { id: 'id', label: 'Id', type: 'text' as const },
          { id: 'password', label: 'Password', type: 'text' as const, secret: true as const },
        ],
      },
      {
        id: 'privateRows',
        label: 'Private rows',
        type: 'rows' as const,
        noun: 'row',
        secret: true as const,
        fields: [{ id: 'pin', label: 'Pin', type: 'number' as const }],
      },
    ],
    discover: () => Effect.succeed([{ id: 'listed', key: 'must-not-escape' }]),
  };
  const registry = registryLayer.pipe(
    Layer.provideMerge(store),
    Layer.provide(
      Layer.succeed(BuiltinAdapters, {
        sources: [
          {
            id: 'openai-compatible',
            origin: 'builtin',
            version: null,
            load: async () => defineAdapter(entry.adapter, settings),
          },
        ],
      }),
    ),
  );
  return {
    rows,
    secrets,
    run: <A, E>(work: Effect.Effect<A, E, ProviderRegistry | AdapterInstances>) => Effect.provide(work, registry),
  };
});

const values = { name: 'Local LLM', baseUrl: 'http://localhost:1234/v1', models: [{ id: 'm', context: 4096 }] };

it.effect(
  'an instance gets an immutable id, names two secret fields independently, and only public settings reach its answers and catalog',
  () =>
    Effect.gen(function* () {
      const { run, rows, secrets } = yield* world();
      const first = yield* run(
        saveInstance({ adapter: 'openai-compatible', values: { ...values, key: 'bearer', password: ' separate ', pin: 17 } }),
      );
      const twin = yield* run(saveInstance({ adapter: 'openai-compatible', values }));
      const renamed = yield* run(
        saveInstance({
          adapter: 'openai-compatible',
          id: first.id,
          revision: first.revision,
          values: { ...values, name: 'Renamed', pin: 23 },
        }),
      );
      const catalog = yield* run(Effect.flatMap(ProviderRegistry, (registry) => registry.catalog));
      expect([first.id, twin.id, renamed.id]).toEqual(['openai-compatible-local-llm', 'openai-compatible-local-llm-2', first.id]);
      expect(secrets[first.id]).toMatchObject({ key: 'bearer', password: ' separate ', pin: 23 });
      expect(first.values).toEqual({ ...values, reasoningField: 'reasoning_effort' });
      expect(rows.get(first.id)?.values).toEqual(renamed.values);
      expect(catalog.served.settings[0]?.instances.find((instance) => instance.id === first.id)?.values).toEqual(renamed.values);
      expect(catalog.models.registered(first.id)).toBe(true);
      const cleared = yield* run(
        saveInstance({
          adapter: 'openai-compatible',
          id: first.id,
          revision: renamed.revision,
          values: { ...renamed.values, password: null },
        }),
      );
      expect(secrets[first.id]?.password).toBeUndefined();
      expect(cleared.values).toEqual(renamed.values);
      yield* run(removeInstance('openai-compatible', first.id));
      expect([rows.has(first.id), first.id in secrets]).toEqual([false, false]);
    }),
);

it.effect(
  'removing a public row retains the surviving row’s named secrets without returning them, and an entirely secret rows field stays private',
  () =>
    Effect.gen(function* () {
      const { run, secrets } = yield* world();
      const first = yield* run(
        saveInstance({
          adapter: 'openai-compatible',
          values: {
            ...values,
            privateRows: [{ pin: 7 }],
            connections: [
              { id: 'a', password: 'first' },
              { id: 'b', password: 'second' },
            ],
          },
        }),
      );
      expect(first.values.connections).toEqual([{ id: 'a' }, { id: 'b' }]);
      expect(first.values.privateRows).toBeUndefined();
      const edited = yield* run(
        saveInstance({
          adapter: 'openai-compatible',
          id: first.id,
          revision: first.revision,
          values: {
            ...values,
            connections: [{ _source: 1, id: 'renamed' }],
          },
        }),
      );
      expect(edited.values.connections).toEqual([{ id: 'renamed' }]);
      expect(secrets[first.id]).toMatchObject({ privateRows: [{ pin: 7 }], connections: [{ password: 'second' }] });
      expect(
        yield* run(
          Effect.flip(
            saveInstance({
              adapter: 'openai-compatible',
              id: first.id,
              revision: first.revision,
              values: {
                ...first.values,
                connections: [
                  { _source: 0, id: 'a' },
                  { _source: 1, id: 'b' },
                ],
              },
            }),
          ),
        ),
      ).toMatchObject({ code: 'stale-instance' });
      const untouched = yield* run(saveInstance({ adapter: 'openai-compatible', id: first.id, revision: edited.revision }));
      expect(secrets[first.id]?.connections).toEqual([{ password: 'second' }]);
      yield* run(
        saveInstance({
          adapter: 'openai-compatible',
          id: first.id,
          revision: untouched.revision,
          values: {
            ...values,
            connections: [{ _source: 0, id: 'renamed', password: null }],
            privateRows: null,
          },
        }),
      );
      expect(secrets[first.id]?.connections).toEqual([{}]);
      expect(secrets[first.id]?.privateRows).toBeUndefined();
    }),
);

it.effect('invalid values and a refused credential-file write leave creation unrecorded', () =>
  Effect.gen(function* () {
    const { run, rows } = yield* world(true);
    const invalid = yield* run(Effect.flip(saveInstance({ adapter: 'openai-compatible', values: { ...values, models: [{ id: 'm' }] } })));
    expect(invalid).toMatchObject({ code: 'instance-invalid' });
    expect(yield* Effect.flip(run(saveInstance({ adapter: 'openai-compatible', values: { ...values, key: 'secret' } })))).toMatchObject({
      reason: 'unwritable',
    });
    expect(rows.size).toBe(0);
  }),
);

it.effect('model discovery returns only the declared public candidate fields', () =>
  Effect.gen(function* () {
    const { run } = yield* world();
    expect(
      yield* run(listModels({ adapter: 'openai-compatible', values: { baseUrl: values.baseUrl, models: [{ id: 'unfinished' }] } })),
    ).toEqual([{ id: 'listed' }]);
  }),
);
