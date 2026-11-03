import { Schema } from 'effect';
import { ActiveServer } from './junction.js';
import { startupStateSchema } from './restart.js';

export const processStateSchema = Schema.Struct({
  ...startupStateSchema.fields,
  held: Schema.Boolean,
  active: Schema.NullOr(Schema.Union([ActiveServer, Schema.Literal('unnamed')])),
});
export type ProcessState = typeof processStateSchema.Type;
