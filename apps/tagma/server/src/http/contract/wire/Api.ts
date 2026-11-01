import { HttpApi, OpenApi } from 'effect/http-api';
import { CallLog } from './CallLog.js';
import { CallerMiddleware, OperationCaller } from './Caller.js';
import { SchemaRefusal } from './SchemaRefusal.js';
import { ThreadsGroup } from './threads.js';
import { HealthGroup } from './health.js';
import { OperationsGroup } from './operations.js';
import { CheckoutsGroup } from './checkouts.js';

export const Api = HttpApi.make('tagma')
  .add(HealthGroup)
  .add(OperationsGroup.middleware(OperationCaller))
  .add(ThreadsGroup.middleware(CallerMiddleware))
  .add(CheckoutsGroup.middleware(CallerMiddleware))
  .middleware(SchemaRefusal)
  .middleware(CallLog)
  .annotateMerge(
    OpenApi.annotations({
      title: 'Tagma',
      version: '0.1.0',
      description: 'The graph server: blocks and their lifecycle, sources, orientation and threads.',
    }),
  );
