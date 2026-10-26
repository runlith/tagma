import { Context, type Effect } from 'effect';
import type { ByteCursor } from './protocol/record';
import type { ExecutionsFailure, RecordChunk } from './Executions';

export class ExecutionRecord extends Context.Service<
  ExecutionRecord,
  {
    readonly read: (cursor: ByteCursor, limit: number) => Effect.Effect<RecordChunk, ExecutionsFailure>;
  }
>()('@runlith/executions/ExecutionRecord') {}
