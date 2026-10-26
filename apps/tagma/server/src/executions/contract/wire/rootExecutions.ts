import * as Schema from 'effect/Schema';
import { ExecutionRef } from '@runlith/executions/protocol/execution';

export const EndedExecution = Schema.Struct({
  kind: Schema.Literals(['terminal', 'command']),
  execution: ExecutionRef,
  program: Schema.NullOr(Schema.NonEmptyString),
  holder: Schema.NonEmptyString,
});
export type EndedExecution = typeof EndedExecution.Type;
