import { toolInputSchema } from '@runlith/llm/schema/messages';
import { DOOR_FIELDS, offeringDoorFields } from '@runlith/agent/tool';
import { CHANNEL } from '@tagma/server/composition/channel';
import type { JsonObjectSchema, OperationsCli } from '../../cli/contract/service/operations.js';
import { harnessRows } from '../../external-harnesses/hooks/rows.js';
import { blockRefFlag } from '../../graph/cli/args.js';
import { PROGRAM_RELEASE } from '../../platform/contract/wire/program.js';
import type { OperationId } from '../../platform/contract/wire/ids.js';
import { Effect } from 'effect';
import { operationRegistry } from '../registry.js';
import { door } from './door.js';

export const operationsCli: OperationsCli<OperationId> = {
  registry: await Effect.runPromise(operationRegistry),
  inputSchema: (schema) => toolInputSchema(schema) as JsonObjectSchema,
  operationSchema: (entry) => {
    const own = toolInputSchema(entry.params) as JsonObjectSchema;
    return offeringDoorFields(own, DOOR_FIELDS) ?? own;
  },
  blockRefFlag,
  version: PROGRAM_RELEASE,
  harness: (id, at) =>
    Effect.map(
      harnessRows(async () => (await import('./harnessCatalog.js')).HARNESS_CATALOG, at, CHANNEL, id),
      (rows) => rows?.named ?? null,
    ),
  ask: door.ask,
  baseUrl: door.baseUrl,
  declareBridge: door.declareBridge,
};
