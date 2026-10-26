import { Schema } from 'effect';

export const ReachAsk = Schema.Union([
  Schema.Literals(['current', 'all']),
  Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1)),
]);
export type ReachAsk = typeof ReachAsk.Type;

export const reachField = Schema.optional(ReachAsk).annotate({
  description: 'current (default): the call’s own project; all: every project on this machine; or projects by name or id.',
});

export type Reach =
  | { readonly kind: 'all'; readonly removed: readonly number[] }
  | { readonly kind: 'projects'; readonly ids: readonly number[] };
