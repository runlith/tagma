import { Schema } from 'effect';

export const Endpoint = Schema.Struct({
  transport: Schema.NonEmptyString,
  path: Schema.NonEmptyString,
});
export type Endpoint = typeof Endpoint.Type;
