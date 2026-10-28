import { Schema } from 'effect';

export const RELATES = 'relates';

export const DISCOVERED_FROM = 'discovered-from';

export const CORE_EDGES: readonly string[] = [RELATES, DISCOVERED_FROM, 'supersedes', 'amends'];

export const edgeNameSchema = Schema.NonEmptyString.annotate({
  description:
    'A non-empty edge name: relates or discovered-from, which every block carries, an edge the tags of the FROM block declare, or supersedes and amends, which their operations write.',
});
export type EdgeKind = typeof edgeNameSchema.Type;
