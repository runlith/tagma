import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { settingCatalogSchema } from '../../settings/contract/wire/catalog.js';
import { shapeOf } from '../../settings/shape.js';
import { SETTING_DECLARATIONS } from './settings.js';

it.effect('declared control descriptors survive the catalog JSON boundary', () =>
  Effect.gen(function* () {
    const entries = SETTING_DECLARATIONS.keys
      .filter((key) => key.control !== undefined)
      .map((key) => ({
        id: key.id,
        section: key.section,
        title: key.title,
        description: key.description,
        shape: shapeOf(key),
        control: key.control,
        scopes: [...key.scopes],
        merge: key.merge,
        value: null,
        from: 'default',
        fallback: null,
        layers: {},
      }));
    const codec = Schema.fromJsonString(settingCatalogSchema);
    const encoded = yield* Schema.encodeUnknownEffect(codec)({ sections: [], entries, rejections: [] });
    const decoded = yield* Schema.decodeUnknownEffect(codec)(encoded);
    expect(decoded.entries.map(({ id, control }) => ({ id, control }))).toEqual(entries.map(({ id, control }) => ({ id, control })));
  }),
);

it.effect('a control kind the vocabulary does not declare is refused', () =>
  Effect.gen(function* () {
    const refused = yield* Effect.flip(
      Schema.encodeUnknownEffect(settingCatalogSchema)({
        sections: [],
        entries: [
          {
            id: 'x',
            section: 'agent',
            title: 'x',
            description: 'x',
            shape: 'number',
            control: { kind: 'invented' },
            scopes: ['user'],
            merge: 'replace',
            value: 1,
            from: 'default',
            fallback: 1,
            layers: {},
          },
        ],
        rejections: [],
      }),
    );
    expect(refused._tag).toBe('SchemaError');
  }),
);
