import { Schema } from 'effect';
import { PLACE_REFUSALS } from './refusals.js';
import { GIT_REFUSALS } from '../../../platform/contract/wire/refusal.js';
import type { PermissionSubject } from '@runlith/agent/permissions';
import { lexicalPath } from './place.js';
import { RootId } from './ids.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ASKS_IN_REVIEW } from '../../../platform/contract/wire/conditions.js';
import { placeRole } from '../../../platform/contract/wire/place.js';

export const checkoutActSubjects = (path: string): readonly PermissionSubject[] => [
  { kind: 'write', value: lexicalPath(path), file: true },
];

export const rootId = RootId.annotate({
  description: 'The registered root to act in, as `read_checkout` answers it.',
});

export const ACT_PATHS = Schema.Array(Schema.NonEmptyString.annotate(placeRole('value')))
  .check(Schema.isMinLength(1))
  .annotate({
    description: 'Paths relative to the checkout root, as the row spells them. At least one.',
  });

const GRAPH = 'graph-path';

const NO_OPERATION = 'no-operation';

const STALE = 'row-stale';

export const RECORD_UNREAD = 'record-unread';

export const WRITING_UNKNOWN = `A record that cannot be read after git ran refuses \`${RECORD_UNREAD}\`: the act landed, and which threads are writing the paths it touched is not known.`;

const NO_PATHS = 'no-paths';

export const MOVED = 'root-moved';

const NO_REMOTE = 'no-remote';

const discardConsequence = (): string =>
  'A tracked path is written back from the index and an untracked one is removed from the disk. Neither is recoverable from this server: nothing is stashed, and what a path held before this act is gone unless git already carried it.';
const abortConsequence = (): string =>
  'The merge, rebase, am, cherry-pick or revert is abandoned and the tree returns to where it stood before it began. Whatever the operation had resolved so far is discarded, and nothing here can give it back.';

export type CheckoutActPlace = { readonly at: { readonly judged: string | null } | null };

export const checkoutLabel = (input: { readonly rootId: string }, prepared?: CheckoutActPlace): string =>
  prepared?.at?.judged ?? input.rootId;

export const subjects = (_input: unknown, prepared?: CheckoutActPlace) =>
  prepared?.at?.judged == null ? [] : checkoutActSubjects(prepared.at.judged);

const ACTED = Schema.Struct({
  paths: Schema.Array(Schema.NonEmptyString),
  writing: Schema.Array(Schema.NonEmptyString),
});

export const CheckoutActed = ACTED;
export type CheckoutActed = typeof ACTED.Type;

export const CheckoutDiscarded = Schema.Struct({
  ...ACTED.fields,
  restored: Schema.Array(Schema.NonEmptyString),
  deleted: Schema.Array(Schema.NonEmptyString),
});
export type CheckoutDiscarded = typeof CheckoutDiscarded.Type;

export const CheckoutPushed = Schema.Struct({
  ...ACTED.fields,
  moved: Schema.Array(Schema.NonEmptyString),
});
export type CheckoutPushed = typeof CheckoutPushed.Type;

export const CheckoutFetched = ACTED;
export type CheckoutFetched = typeof ACTED.Type;

export const CheckoutAborted = Schema.Struct({
  ...ACTED.fields,
  operation: Schema.Literals(['merge', 'rebase', 'am', 'cherry-pick', 'revert']),
});
export type CheckoutAborted = typeof CheckoutAborted.Type;

export const ACT = {
  doors: { http: true },
  tool: undefined,
  callers: 'any',
  subject: 'none',
  place: 'project',
  waits: [],
  lifetimes: [],
  effect: 'write',
  identity: { key: 'call' },
} as const;

export const CHECKOUT_ACT_OPERATIONS = {
  stage_checkout: operation('stage_checkout', {
    approval: ASKS_IN_REVIEW,
    ...ACT,
    answer: arms({ ok: CheckoutActed.fields }),
    meaning: 'Stage paths of a registered checkout: what stands in the working tree enters the index.',
    grammar: `The paths land in the index as they stand on disk — modified, added or deleted alike — and each is taken as a NAME rather than a pattern, so a path holding a bracket stages itself and nothing else.
A path under the graph's own tree refuses \`${GRAPH}\`: the server commits that tree as its own stream, and sync_graph is its door.
The row moves on its own once git has answered; nothing here waits for the next frame.
Naming no path at all refuses \`${NO_PATHS}\`: an empty list is how git spells the whole tree, which no act here reaches by default.
${WRITING_UNKNOWN}`,
    input: Schema.Struct({ rootId, paths: ACT_PATHS }),
    refusals: [...PLACE_REFUSALS, GRAPH, NO_PATHS, MOVED, RECORD_UNREAD, ...GIT_REFUSALS],
    subjects,
    confirmation: (input, prepared?: CheckoutActPlace) => ({
      summary: `Stage ${input.paths.join(', ')} in ${checkoutLabel(input, prepared)}?`,
    }),
    confirmLabel: 'Stage',
    presentation: {
      running: 'Staging checkout paths',
      done: 'Staged checkout paths',
    },
  }),
  unstage_checkout: operation('unstage_checkout', {
    approval: ASKS_IN_REVIEW,
    ...ACT,
    answer: arms({ ok: CheckoutActed.fields }),
    meaning: 'Unstage paths of a registered checkout: the index entry returns to what HEAD carries.',
    grammar: `The working tree is untouched — only the index moves — and a path HEAD carries nothing for leaves the index instead.
A path under the graph's own tree refuses \`${GRAPH}\`, and naming no path at all refuses \`${NO_PATHS}\`: an empty list is how git spells the whole tree, which no act here reaches by default.
${WRITING_UNKNOWN}`,
    input: Schema.Struct({ rootId, paths: ACT_PATHS }),
    refusals: [...PLACE_REFUSALS, GRAPH, NO_PATHS, MOVED, RECORD_UNREAD, ...GIT_REFUSALS],
    subjects,
    confirmation: (input, prepared?: CheckoutActPlace) => ({
      summary: `Unstage ${input.paths.join(', ')} in ${checkoutLabel(input, prepared)}?`,
    }),
    confirmLabel: 'Unstage',
    presentation: {
      running: 'Unstaging checkout paths',
      done: 'Unstaged checkout paths',
    },
  }),
  discard_checkout: operation('discard_checkout', {
    approval: ASKS_IN_REVIEW,
    ...ACT,
    answer: arms({ ok: CheckoutDiscarded.fields }),
    meaning: 'Discard the working-tree changes of paths in a registered checkout, and delete the untracked ones.',
    grammar: `What the row holds decides the side each path is taken from: a tracked path is written back from the index, an untracked one is DELETED. The caller names paths; the door splits them by the reading it already holds and answers both lists.
The bytes do not go anywhere they can be read back from. A path under the graph's own tree refuses \`${GRAPH}\`.
A row whose last reading did NOT happen refuses \`${STALE}\`: the areas standing then describe a tree that may have moved, and this act would delete by them. Read the checkout again and act on a row that was taken.
${WRITING_UNKNOWN}`,
    input: Schema.Struct({ rootId, paths: ACT_PATHS }),
    refusals: [...PLACE_REFUSALS, GRAPH, NO_PATHS, STALE, MOVED, RECORD_UNREAD, ...GIT_REFUSALS],
    subjects,
    confirmation: (input, prepared?: CheckoutActPlace) => ({
      summary: `Discard these paths in ${checkoutLabel(input, prepared)}, deleting the untracked ones?`,
      consequence: discardConsequence(),
    }),
    confirmLabel: 'Discard',
    intent: 'destructive',
    destructiveConsequence: discardConsequence,
    presentation: {
      running: 'Discarding checkout paths',
      done: 'Discarded checkout paths',
    },
  }),
  push_checkout: operation('push_checkout', {
    approval: ASKS_IN_REVIEW,
    ...ACT,
    answer: arms({ ok: CheckoutPushed.fields }),
    meaning: 'Push the branch of a registered checkout to its remote, and answer the refs that moved.',
    grammar: `Without a remote the branch's own upstream decides, which is what \`git push\` alone does; \`setUpstream\` records it for the next one.
A branch names a target BESIDE a remote: git reads a lone word after \`push\` as the repository, so a branch given without one refuses \`${NO_REMOTE}\` rather than pushing somewhere nobody named.
Never forced: a rejection is git's own, and its words are the reason. Both words ride behind git's own end-of-options, so a name opening with a dash is that name and never a flag.
The answer names the refs that actually moved; a ref already at the pushed commit moved nothing and is absent from it.`,
    input: Schema.Struct({
      rootId,
      remote: Schema.optional(Schema.NonEmptyString.annotate({ description: "Omitted: the branch's own upstream." })),
      branch: Schema.optional(
        Schema.NonEmptyString.annotate({ description: 'Which branch of that remote to move; needs the remote beside it.' }),
      ),
      setUpstream: Schema.optional(Schema.Boolean.annotate({ description: 'Record the pushed branch as this one’s upstream.' })),
    }),
    refusals: [...PLACE_REFUSALS, NO_REMOTE, MOVED, ...GIT_REFUSALS],
    subjects,
    confirmation: (input, prepared?: CheckoutActPlace) => ({
      summary: `Push ${input.branch ?? 'the current branch'} from ${checkoutLabel(input, prepared)}${input.remote === undefined ? '' : ` to ${input.remote}`}?`,
    }),
    confirmLabel: 'Push',
    presentation: {
      running: 'Pushing a checkout',
      done: 'Pushed a checkout',
    },
  }),
  fetch_checkout: operation('fetch_checkout', {
    approval: ASKS_IN_REVIEW,
    ...ACT,
    answer: arms({ ok: CheckoutFetched.fields }),
    meaning:
      "Fetch the remote a registered checkout's branch tracks, pruning remote branches that are gone, so the row's ahead and behind measure what the remote holds now.",
    grammar: `Only remote-tracking refs move: no branch, index or file of the checkout does. The branch's own remote is fetched, else \`origin\`; a checkout with neither refuses in git's words.
Git asks for no credentials here: a remote that wants a password it cannot find refuses instead of waiting on a terminal nobody watches.`,
    input: Schema.Struct({ rootId }),
    refusals: [...PLACE_REFUSALS, MOVED, ...GIT_REFUSALS],
    subjects,
    confirmation: (input, prepared?: CheckoutActPlace) => ({ summary: `Fetch the branch's remote in ${checkoutLabel(input, prepared)}?` }),
    confirmLabel: 'Fetch',
    presentation: {
      running: 'Fetching a checkout',
      done: 'Fetched a checkout',
    },
  }),
  abort_checkout: operation('abort_checkout', {
    approval: ASKS_IN_REVIEW,
    ...ACT,
    answer: arms({ ok: CheckoutAborted.fields }),
    meaning:
      'End the operation in progress in a registered checkout — a merge, a rebase, an am, a cherry-pick or a revert — and return the tree to where it stood before it began.',
    grammar: `Which operation is ended is the ROW's answer, not a parameter: the reading standing over the checkout already says what is in progress, and a caller naming one could name a different operation than the one running.
A tree with no operation in progress refuses \`${NO_OPERATION}\` before git runs, because there is nothing for git to say no to.
What the abort discards is the operation's own work — the merged and conflicted state it had built — and that is not recoverable from this server. The paths the row listed as unmerged are answered beside the operation, with the threads still typing in them.
${WRITING_UNKNOWN}`,
    input: Schema.Struct({ rootId }),
    refusals: [...PLACE_REFUSALS, NO_OPERATION, MOVED, RECORD_UNREAD, ...GIT_REFUSALS],
    subjects,
    confirmation: (input, prepared?: CheckoutActPlace) => ({
      summary: `End the operation in progress in ${checkoutLabel(input, prepared)}?`,
      consequence: abortConsequence(),
    }),
    confirmLabel: 'Abort',
    intent: 'destructive',
    destructiveConsequence: abortConsequence,
    presentation: {
      running: 'Aborting a checkout operation',
      done: 'Aborted a checkout operation',
    },
  }),
};

export type CheckoutActOperationId = keyof typeof CHECKOUT_ACT_OPERATIONS;
export const CHECKOUT_ACT_OPERATION_IDS = Object.keys(CHECKOUT_ACT_OPERATIONS) as readonly CheckoutActOperationId[];
