import { Schema } from 'effect';
import type { PluginFace } from '../../../platform/contract/wire/contribution.js';

export const PLUGIN_BINDING = 'plugin';

export const ENDED_REASON = 'ended';

export const ASKED_REASON = 'asked';

const HandlerTool = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]+$/u));

export const ThreadOn = Schema.Struct({
  ended: Schema.optional(
    HandlerTool.annotate({
      description:
        'The tool, named in contributes.tools with audience tagma, that Tagma calls when a turn of a thread whose bindings name this plugin under `plugin` ends, with { threadId, runId, status, failureReason }. Its answer confirms the delivery; an error or no answer delivers it again, so it is idempotent by runId.',
    }),
  ),
  asked: Schema.optional(
    HandlerTool.annotate({
      description:
        'The tool, named in contributes.tools with audience tagma, that takes the questions of threads bound to this plugin while it runs in their project, with { threadId, questionId, summary, prompts, deadlineAt }; prompts is null for a confirmation. Such a question leaves the person’s attention; the plugin answers it with answer_question. An error, no answer, or the answer { "question": "left" } hands it back to the person at once. A question may arrive again after a restart, so it is idempotent by questionId.',
    }),
  ),
});
export type ThreadOn = typeof ThreadOn.Type;

export const ON_FACE: PluginFace<ThreadOn> = {
  name: 'on',
  title: 'When a thread of this plugin ends or asks',
  schema: ThreadOn,
  calls: (value) => [value.ended, value.asked].filter((tool) => tool !== undefined),
};
