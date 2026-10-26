import { Effect, Layer } from 'effect';
import { CallLog } from './contract/wire/CallLog.js';
import { endpointAnnotation } from './contract/wire/operations.js';

export const callLogLayer = Layer.succeed(
  CallLog,
  CallLog.of((endpoint, route) => Effect.annotateLogs(endpoint, endpointAnnotation(route.group.identifier, route.endpoint.identifier))),
);
