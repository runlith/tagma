import { toolInputSchema } from '@runlith/llm/schema/messages';
import { DOOR_FIELDS, offeringDoorFields } from '@runlith/agent/tool';
import type { JsonObjectSchema, OperationsCli } from '../../cli/contract/service/operations.js';
import { harnessAdapter } from '../../external-harnesses/contract/service/table.js';
import { blockRefFlag } from '../../graph/cli/args.js';
import { PROGRAM_RELEASE } from '../../platform/contract/wire/program.js';
import type { OperationId } from '../../platform/contract/wire/ids.js';
import { HARNESS_NAMES, type HarnessName } from '../../threads/contract/wire/harness/names.js';
import { Effect } from 'effect';
import { operationRegistry } from '../registry.js';
import { door } from './door.js';

export const operationsCli: OperationsCli<OperationId, HarnessName> = {
  registry: await Effect.runPromise(operationRegistry),
  inputSchema: (schema) => toolInputSchema(schema) as JsonObjectSchema,
  operationSchema: (entry) => {
    const own = toolInputSchema(entry.params) as JsonObjectSchema;
    return offeringDoorFields(own, DOOR_FIELDS) ?? own;
  },
  blockRefFlag,
  version: PROGRAM_RELEASE,
  harnesses: HARNESS_NAMES,
  harness: harnessAdapter,
  ask: door.ask,
  baseUrl: door.baseUrl,
  declareBridge: door.declareBridge,
};
