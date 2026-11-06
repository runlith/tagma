import { Schema } from 'effect';
import type { PluginFace } from '../../../platform/contract/wire/contribution.js';

export const PLUGIN_BINDING = 'plugin';

export const ENDED_REASON = 'ended';

export const EndingTools = Schema.Struct({
  ended: Schema.optional(
    Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]+$/u)).annotate({
      description:
        'The tool, named in contributes.tools with audience tagma, that Tagma calls when a turn of a thread whose bindings name this plugin under `plugin` ends, with { threadId, runId, status, failureReason }. Its answer confirms the delivery; an error or no answer delivers it again, so it is idempotent by runId.',
    }),
  ),
});
export type EndingTools = typeof EndingTools.Type;

export const ENDINGS_FACE: PluginFace<EndingTools> = {
  name: 'on',
  title: 'Actions when a thread ends',
  schema: EndingTools,
  calls: (value) => (value.ended === undefined ? [] : [value.ended]),
};
