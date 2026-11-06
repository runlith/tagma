import { Schema } from 'effect';
import type { PluginFace } from '../../../platform/contract/wire/contribution.js';

export const BeforeBuild = Schema.Array(
  Schema.Struct({
    tool: Schema.NonEmptyString.annotate({
      description: 'The tool, named in contributes.tools with audience tagma, that Tagma calls before a build from this checkout.',
    }),
    title: Schema.NonEmptyString.annotate({ description: 'What the update card shows while the step runs.' }),
  }),
);
export type BeforeBuild = typeof BeforeBuild.Type;

export const StepVerdict = Schema.Union([
  Schema.Struct({ verdict: Schema.Literal('go') }),
  Schema.Struct({ verdict: Schema.Literal('pending') }),
  Schema.Struct({ verdict: Schema.Literal('stop'), reason: Schema.NonEmptyString, thread: Schema.optional(Schema.NonEmptyString) }),
]);
export type StepVerdict = typeof StepVerdict.Type;

export const BEFORE_BUILD_FACE: PluginFace<BeforeBuild> = {
  name: 'beforeBuild',
  title: 'Checks before Tagma builds a checkout',
  schema: BeforeBuild,
  answer: { name: 'BuildVerdict', schema: StepVerdict },
  calls: (steps) => steps.map((step) => step.tool),
};

export type StepAsk = { readonly offer: 'head' | 'tree'; readonly checkout: string };
