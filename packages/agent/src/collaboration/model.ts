import { Context, Data, type Effect } from 'effect';
import type { ModelOption } from '@runlith/llm/models/catalog';
import type { KeyedRequest, KeyedSpent } from '../thread/keyed';
import type { ThreadCallBroke, ThreadMissing } from '../thread/ThreadBorder';
import type { ThreadStorageFailed } from '../thread/persisted';
import type { ThreadModelSelection } from '../thread/record';

export class ThreadModelRefused extends Data.TaggedError('ThreadModelRefused')<{
  readonly threadId: string;
  readonly reason: 'model-pinned' | 'thread-running' | 'self-move' | 'step-unreached';
}> {}

export class ThreadModelConflict extends Data.TaggedError('ThreadModelConflict')<{
  readonly threadId: string;
  readonly reason: 'act-id-reused';
  readonly key: string;
}> {}

export class ThreadModelUnavailable extends Data.TaggedError('ThreadModelUnavailable')<{
  readonly threadId: string;
  readonly reason: 'deadline';
}> {}

export class ThreadModelLost extends Data.TaggedError('ThreadModelLost')<{
  readonly threadId: string;
  readonly key: string;
}> {}

export type ThreadModelFailure =
  | ThreadMissing
  | ThreadModelRefused
  | ThreadModelConflict
  | ThreadModelUnavailable
  | ThreadModelLost
  | ThreadStorageFailed
  | ThreadCallBroke;

export class ThreadModel extends Context.Service<
  ThreadModel,
  {
    move(
      threadId: string,
      input: { readonly request: KeyedRequest; readonly option: ModelOption; readonly reasoning: string | null; readonly resume?: string },
    ): Effect.Effect<
      | {
          readonly status: 'moved';
          readonly from: ThreadModelSelection;
          readonly to: ThreadModelSelection;
          readonly acted: boolean;
          readonly resume?: string;
        }
      | KeyedSpent,
      ThreadModelFailure
    >;
    adapted<E>(
      threadId: string,
      input: { readonly request: KeyedRequest; readonly option: ModelOption; readonly reasoning: string | null; readonly resume?: string },
      act: Effect.Effect<{ readonly from: ThreadModelSelection | null; readonly to: ThreadModelSelection } | null, E>,
    ): Effect.Effect<
      | {
          readonly status: 'moved';
          readonly from: ThreadModelSelection;
          readonly to: ThreadModelSelection;
          readonly acted: boolean;
          readonly resume?: string;
        }
      | KeyedSpent
      | null,
      ThreadModelFailure | E
    >;
  }
>()('@runlith/agent/ThreadModel') {}
