import { Schema } from 'effect';

export const HOST_REFUSAL_ENV = 'TAGMA_HOST_REFUSAL';

export const HostRefusal = Schema.Struct({
  detail: Schema.String,
  unblock: Schema.Array(Schema.String),
});

export type HostRefusal = typeof HostRefusal.Type;
