import { Schema } from 'effect';
import { installationCutSchema } from './source.js';

const waitingSchema = Schema.Struct({
  root: Schema.String,
  release: Schema.String,
  over: Schema.NullOr(Schema.String),
});
export type Waiting = typeof waitingSchema.Type;

export const pendingRefusalSchema = Schema.Struct({
  successor: Schema.NullOr(installationCutSchema),
  detail: Schema.String,
  waits: Schema.NullOr(waitingSchema),
});
export type PendingRefusal = typeof pendingRefusalSchema.Type;
