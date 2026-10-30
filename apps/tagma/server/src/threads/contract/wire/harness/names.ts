import { Schema } from 'effect';

export const HARNESS_AGENT_ID = 'harness';

export const harnessNameSchema = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/u), Schema.isMaxLength(64));
export type HarnessName = typeof harnessNameSchema.Type;

export const harnessTransportSchema = Schema.Literals(['terminal', 'acp']);
export type HarnessTransport = typeof harnessTransportSchema.Type;
