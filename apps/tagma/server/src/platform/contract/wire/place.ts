import { PAGE_CURSOR, cursorSelection } from '@runlith/paging';
import { Schema } from 'effect';

export type OperationPlace = 'project' | 'home' | 'machine' | 'fixed';

export type SubjectKind = 'block' | 'path' | 'checkout' | 'worktree' | 'thread' | 'cursor';

export type FieldRole = SubjectKind | 'mention' | 'value' | 'selector';

export const SUBJECT_KINDS: readonly SubjectKind[] = ['block', 'path', 'checkout', 'worktree', 'thread', 'cursor'];

export const PLACE_ROLE = 'placeRole';

export const placeRole = (role: FieldRole) => ({ [PLACE_ROLE]: role });

export const Place = Schema.Struct({
  projectId: Schema.Number,
  checkout: Schema.NullOr(Schema.String.annotate(placeRole('value'))),
  branch: Schema.NullOr(Schema.String),
});
export type Place = typeof Place.Type;

export const isSubject = (role: FieldRole | undefined): role is SubjectKind =>
  role !== undefined && SUBJECT_KINDS.includes(role as SubjectKind);

export const placedCursor = PAGE_CURSOR.annotate(placeRole('cursor'));

export const cursorPlace = (cursor: string, operation: string): Place | null => {
  const selection = cursorSelection(cursor, operation);
  const projectId = selection?.projectId;
  if (typeof projectId !== 'number') return null;
  const checkout = selection?.checkout;
  return { projectId, checkout: typeof checkout === 'string' ? checkout : null, branch: null };
};

export const projectField = Schema.optional(Schema.Union([Schema.String, Schema.Int.check(Schema.isGreaterThan(0))])).annotate({
  ...placeRole('selector'),
  description:
    'Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project.',
});
