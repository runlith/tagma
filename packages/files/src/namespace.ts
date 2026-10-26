import * as Schema from 'effect/Schema';

export const NamespaceId = Schema.NonEmptyString.pipe(Schema.brand('NamespaceId'));
export type NamespaceId = typeof NamespaceId.Type;

export const IdentityWitness = Schema.Struct({
  provider: Schema.NonEmptyString,
  format: Schema.NonEmptyString,
  token: Schema.NonEmptyString,
});
export type IdentityWitness = typeof IdentityWitness.Type;
