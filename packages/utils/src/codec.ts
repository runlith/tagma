import { Schema } from 'effect';

export type JsonCodec<S extends Schema.Constraint> = Schema.Codec<S['Type'], Schema.Json, S['DecodingServices'], S['EncodingServices']>;

const jsonCodecs = new WeakMap<Schema.Constraint, Schema.toCodecJson<Schema.Constraint>>();

export function jsonCodec<S extends Schema.Constraint>(schema: S): JsonCodec<S> {
  const held = jsonCodecs.get(schema);
  if (held !== undefined) return held as JsonCodec<S>;
  const codec = Schema.toCodecJson(schema);
  jsonCodecs.set(schema, codec);
  return codec;
}
