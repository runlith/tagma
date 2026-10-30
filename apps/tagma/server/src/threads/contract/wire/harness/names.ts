import { Schema } from 'effect';
import { harnessNameSchema } from '@runlith/tagma/adapter/harness';

export const HARNESS_AGENT_ID = 'harness';

export type HarnessName = typeof harnessNameSchema.Type;

export const isHarnessName = Schema.is(harnessNameSchema);

export const harnessTransportSchema = Schema.Literals(['terminal', 'acp']);
export type HarnessTransport = typeof harnessTransportSchema.Type;
