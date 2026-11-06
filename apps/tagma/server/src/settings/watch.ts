import { Effect, Schema, Stream } from 'effect';
import { refusingStream } from '../platform/contract/service/body.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { SettingKey } from '../platform/contract/wire/setting.js';
import type { Settings } from './contract/service/values.js';
import type { SettingContribution } from './contract/wire/declarations.js';
import type { WatchedSettings } from './contract/wire/feeds.js';

type Watched = readonly [id: string, value: Schema.Json];

const asJson = Schema.decodeUnknownEffect(Schema.Json);

export const watchSettings = (settings: Settings['Service'], declared: SettingContribution) => {
  const keysById: ReadonlyMap<string, SettingKey<unknown>> = new Map(declared.keys.map((key) => [key.id, key]));
  const personal = declared.keys.filter((key) => key.scopes.length === 1 && key.scopes[0] === 'user').map((key) => key.id);

  const keyOf = Effect.fnUntraced(function* (id: string) {
    const key = keysById.get(id);
    if (key === undefined) {
      return yield* new GateRefusal('unknown-setting', `No setting is declared under ${id}.`, [`the person's keys are: ${personal.join(', ')}`]);
    }
    if (key.scopes.length !== 1 || key.scopes[0] !== 'user') {
      return yield* new GateRefusal('setting-scope', `${id} can be set per project, so its value depends on a project.`, [
        `watch only the person's keys: ${personal.join(', ')}`,
        'read a project setting with read_settings',
      ]);
    }
    return key;
  });

  const jsonOf = (key: SettingKey<unknown>, value: unknown): Effect.Effect<Watched> =>
    Schema.encodeUnknownEffect(key.schema)(value).pipe(
      Effect.flatMap(asJson),
      Effect.map((json): Watched => [key.id, json]),
      Effect.orDie,
    );

  return ({ keys }: { readonly keys: readonly string[] }) =>
    refusingStream(
      Stream.unwrap(
        Effect.gen(function* () {
          const named = yield* Effect.forEach([...new Set(keys)], keyOf);
          if (named.length === 0) return Stream.concat(Stream.succeed<WatchedSettings>({ values: {} }), Stream.never);
          const streams = yield* Effect.forEach(named, (key) =>
            Effect.map(settings.changes(key), (values) => Stream.mapEffect(values, (value) => jsonOf(key, value))),
          );
          return Stream.mapAccum(
            Stream.mergeAll(streams, { concurrency: 'unbounded' }),
            () => new Map<string, Schema.Json>(),
            (seen, [id, value]): readonly [Map<string, Schema.Json>, readonly WatchedSettings[]] => {
              const opening = seen.size < named.length;
              seen.set(id, value);
              if (!opening) return [seen, [{ values: { [id]: value } }]];
              return [seen, seen.size === named.length ? [{ values: Object.fromEntries(seen) }] : []];
            },
          );
        }),
      ),
    );
};
