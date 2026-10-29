import { Schema } from 'effect';

export const TAGMA_APP_BINDING = 'app';

export const ENDED_REASON = 'ended';

export const EndingTools = Schema.Struct({
  ended: Schema.optional(
    Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]+$/u)).annotate({
      description:
        'The tool Tagma calls when a turn of a thread whose bindings name this app under `app` ends, with { threadId, runId, status, failureReason }. Its answer confirms the delivery; an error or no answer delivers it again, so it is idempotent by runId.',
    }),
  ),
});
export type EndingTools = typeof EndingTools.Type;
