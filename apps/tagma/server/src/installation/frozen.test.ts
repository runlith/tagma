import { expect, test } from 'bun:test';
import { Schema } from 'effect';
import { fixtureRegistry } from '../composition/testing/migrations.js';
import { attemptSchema, returnSchema } from './contract/wire/attempt.js';
import { feedSchema } from './contract/wire/feed.js';
import { InstallationManifest } from './contract/wire/manifest.js';
import { restartRecordSchema } from './contract/wire/restart.js';
import { updateRecordSchema } from './contract/wire/update.js';
import { NEXT } from './testing/frozen.js';

const shapeOf = (schema: Schema.Top) => Schema.toJsonSchemaDocument(Schema.toType(schema));

const registryShape = async () => {
  const sections = new Map<string, { fields: Schema.Struct.Fields; optional: boolean }>();
  for (const part of await Promise.all(fixtureRegistry.map((owner) => owner.load()))) {
    const standing = sections.get(part.section);
    sections.set(part.section, {
      fields: { ...standing?.fields, ...part.fields },
      optional: (standing?.optional ?? true) && part.optional === true,
    });
  }
  return Schema.Struct(
    Object.fromEntries(
      [...sections].map(([section, { fields, optional }]) => {
        const rows = Schema.Array(Schema.Struct(fields));
        return [section, optional ? Schema.optional(rows) : rows];
      }),
    ),
  );
};

test('the shape this tree writes is frozen as the next release’s, so a changed shape keeps the previous one and freezes itself', async () => {
  expect(shapeOf(InstallationManifest)).toEqual(shapeOf(NEXT.manifest));
  expect(shapeOf(attemptSchema)).toEqual(shapeOf(NEXT.attempt));
  expect(shapeOf(returnSchema)).toEqual(shapeOf(NEXT.returned));
  expect(shapeOf(restartRecordSchema)).toEqual(shapeOf(NEXT.restart));
  expect(shapeOf(feedSchema)).toEqual(shapeOf(NEXT.feed));
  expect(shapeOf(updateRecordSchema)).toEqual(shapeOf(NEXT.update));
  expect(shapeOf(await registryShape())).toEqual(shapeOf(NEXT.registry));
});
