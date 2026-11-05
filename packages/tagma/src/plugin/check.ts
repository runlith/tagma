import { JsonSchema, Result, Schema, SchemaRepresentation } from 'effect';
import schemas from './schemas.generated.json' with { type: 'json' };

type Revived = Schema.Codec<unknown, unknown>;

const revived = new Map<string, Revived>();

const schemaOf = (key: string, jsonSchema: unknown): Revived => {
  const held = revived.get(key);
  if (held !== undefined) return held;
  const schema = SchemaRepresentation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft2020_12(jsonSchema as JsonSchema.JsonSchema), {
    patterns: 'apply',
  }) as Revived;
  revived.set(key, schema);
  return schema;
};

const refusalOf = (key: string, jsonSchema: unknown, value: unknown): string | null => {
  const decoded = Schema.decodeUnknownResult(schemaOf(key, jsonSchema))(value, { onExcessProperty: 'error' });
  return Result.isFailure(decoded) ? decoded.failure.message : null;
};

const points: Readonly<Record<string, unknown>> = schemas.points;

export const manifestRefusal = (manifest: unknown): string | null => {
  const envelope = refusalOf('envelope', schemas.envelope, manifest);
  if (envelope !== null) return envelope;
  const contributes = (manifest as { readonly contributes?: Readonly<Record<string, unknown>> }).contributes ?? {};
  const unknown = Object.keys(contributes).filter((name) => !Object.hasOwn(points, name));
  if (unknown.length > 0)
    return `${unknown.join(', ')} ${unknown.length === 1 ? 'is a point' : 'are points'} no owner declares; the points are ${Object.keys(points).join(', ')}`;
  for (const [name, value] of Object.entries(contributes)) {
    const refused = refusalOf(name, points[name], value);
    if (refused !== null) return `contributes.${name}: ${refused}`;
  }
  return null;
};
