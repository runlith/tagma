import { Schema } from 'effect';
import { COVERAGE_REFUSALS, REPOSITORY_REFUSALS, ROOT_REFUSALS } from './refusals.js';
import { GIT_REFUSALS } from '../../../platform/contract/wire/refusal.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { CheckoutHolder, CheckoutState } from './checkout.js';
import { CommitReading, PathHistory } from './history.js';
import type { PermissionSubject } from '@runlith/agent/permissions';
import { lexicalPath } from './place.js';
import { family } from '@runlith/paging';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { placedCursor, placeRole, projectField } from '../../../platform/contract/wire/place.js';

export const resolutionSubjects = (path: string): readonly PermissionSubject[] => [{ kind: 'read', value: lexicalPath(path), file: true }];

export const CHECKOUT_HISTORY = family('checkout-history', 1, 'json', { text: 427, json: 427 }, 100, () => ({
  sha: 'f'.repeat(40),
  parents: ['a'.repeat(40)],
  author: 'x'.repeat(40),
  date: '2026-09-22T20:24:16+03:00',
  subject: 'x'.repeat(140),
  graph: false,
}));
export const COMMIT_FILES = family('commit-files', 1, 'json', { text: 541, json: 541 }, 100, () => ({
  path: 'x'.repeat(478),
  status: 'modified',
  lines: { added: 120, removed: 30 },
}));

export const CHECKOUT_DOORS = { http: true } as const;
export const CHECKOUT_TOOL = { capability: 'worktrees', needs: ['shared'] } as const;

const READ = {
  doors: CHECKOUT_DOORS,
  tool: CHECKOUT_TOOL,
  callers: 'any',
  subject: 'head',
  place: 'project',
  waits: [],
  lifetimes: [],
  effect: 'read',
  identity: 'none',
} as const;

const root = Schema.optional(
  Schema.NonEmptyString.annotate({
    ...placeRole('checkout'),
    description: "A registered root's id, or an absolute path you stand in. Omitted: the checkout this call stands in.",
  }),
);

export const CHECKOUT_OPERATIONS = {
  read_checkout: operation('read_checkout', {
    approval: ASKS_NEVER,
    ...READ,
    answer: arms({
      ok: {
        checkout: CheckoutState,
        holders: Schema.Array(Schema.Struct({ path: Schema.NonEmptyString, holders: Schema.Array(CheckoutHolder) })),
        taskLabels: Schema.Literals(['read', 'unavailable']),
      },
    }),
    meaning:
      'Read what one registered checkout holds: its branch and upstream, the operation in progress, every path by area with its line counts, and the comparison against the upstream.',
    grammar: `\`root\` names the checkout — a registered root's id, or an absolute path, which answers the checkout that contains it. Omitted, it is the checkout this call itself stands in.
The row is kept by the server and re-read only when something marks that tree, so asking twice costs no git. It says how it was made: \`stale\` where the last reading could not be taken and what stands is the row before it, \`incomplete\` where the answer passed the capture the reading declared, and \`unwatched\` where nothing watches the tree, so edits made outside Tagma's own doors reach the row on the next mark.
\`holders\` names, for each listed path whose lines are held, its holders as the change record's current judgement of the checkout gives them — sessions, and the operator (\`{kind: 'operator'}\`) for what they saved in Tagma's editor; a path whose lines are nobody's or not yet judged names none. \`taskLabels\` is \`read\` when holder tasks were read from the graph, or \`unavailable\` when it could not answer; the holders still stand, but their empty task lists then say nothing about what they hold.
Every path is spelled relative to the checkout root and raw: a name holding a newline arrives as its own bytes. An untracked file weighs what it holds, because nothing in the index carries its content; a conflicted path weighs nothing, because git weighs its two sides separately.
A branch with no upstream answers \`publishTo\`: the remote a publish would push it to — the repository's \`remote.pushDefault\`, else its only remote — and null where it has several and names no default, or none.
\`base\` is what the comparison is measured against, and \`compare\` answers which one it took. Omitted, the branch's own upstream; a branch that names none has no comparison at all. A base git cannot resolve costs the COMPARISON alone — everything the tree holds still stands in the row — so a mistyped base never takes the staged and unstaged sides with it.
A named root is looked for among the checkouts of every registered project on the machine, this project's first, and the answer reads that checkout under its own project. A checkout two other projects share refuses \`root-inconclusive\`; a root no project's checkout answers to refuses \`not-found\`.`,
    input: Schema.Struct({
      project: projectField,
      root,
      base: Schema.optional(
        Schema.NonEmptyString.annotate({
          description: "What the comparison is measured against — any revision git resolves. Omitted: the branch's own upstream.",
        }),
      ),
    }),
    refusals: ['not-found', ...COVERAGE_REFUSALS, ...ROOT_REFUSALS, ...REPOSITORY_REFUSALS],
    subjects: (input) => (input.root === undefined ? [] : resolutionSubjects(input.root)),
    confirmation: (input) => ({ summary: `Read checkout ${input.root ?? 'this call stands in'}?` }),
    confirmLabel: 'Read checkout',
    presentation: {
      running: 'Reading a checkout',
      done: 'Read a checkout',
      many: (count) => `Read ${count} checkouts`,
    },
  }),

  read_checkout_history: operation('read_checkout_history', {
    approval: ASKS_NEVER,
    ...READ,
    page: CHECKOUT_HISTORY,
    answer: arms({ ok: { history: PathHistory } }),
    meaning:
      "Read a registered checkout's commits newest first — the branch's own log, or the commits that touched ONE path — each with its sha, its parents, its author, its date, its subject and whether the graph's own sync authored it.",
    grammar: `\`root\` names the checkout exactly as the reading beside this one does. Without \`path\` this answers the log of HEAD, the commits the branch holds; with \`path\`, spelled relative to the root, it answers the commits that TOUCHED that path — a file nobody has changed since it was born answers one commit on a branch of a thousand, and a path this tree never held answers no commits rather than refusing: nothing touched it, and that is an answer.
The page's \`limit\` defaults to 100 commits and is capped by the checkout-history family's measured carrier ceiling. A \`cursor\` handed back alone continues the same walk — the same path, or the same pathless log — on the head its first page pinned, so a commit landing mid-walk neither shifts nor repeats a row. \`next\` continues a cut; \`total: null\` says no one counted the whole log. Another path, another \`grep\`, another walk or another project refuses a stale cursor rather than walking a different history.
\`grep\` is a plain substring of the commit message, matched without regard to case — never a pattern; it composes with \`path\`, and \`total\` stays null under it too.
\`graph\` is true where the commit's author is the identity this server's graph sync commits under, so a reader can fold the graph's own commits away from the work.
This is history and not blame: it says which commits reached the file, never which line came from where. Who wrote each line of the file as it stands now is read_authorship; what one commit changed is read_commit.
A named root is found across the machine's projects exactly as on the reading beside this one.`,
    input: Schema.Struct({
      project: projectField,
      root,
      path: Schema.optional(Schema.NonEmptyString.annotate(placeRole('value'))).annotate({
        description: 'The path, relative to the checkout root. Omitted: the branch log, or the walk the cursor carries.',
      }),
      grep: Schema.optional(Schema.NonEmptyString).annotate({
        description:
          'Keeps only the commits whose message holds this text, ignoring case. Omitted: every commit, or the filter the cursor carries.',
      }),
      limit: limitOf(CHECKOUT_HISTORY),
      cursor: placedCursor,
    }),
    refusals: ['not-found', 'bad-cursor', 'cursor-stale', ...GIT_REFUSALS, ...COVERAGE_REFUSALS, ...ROOT_REFUSALS, ...REPOSITORY_REFUSALS],
    subjects: (input) => (input.root === undefined ? [] : resolutionSubjects(input.root)),
    confirmation: (input) => ({
      summary: `Read the history of ${input.path ?? 'the branch'} in ${input.root ?? 'the checkout this call stands in'}?`,
    }),
    confirmLabel: 'Read history',
    presentation: {
      running: 'Reading checkout history',
      done: 'Read checkout history',
      many: (count) => `Read checkout history ${count} times`,
    },
  }),

  read_commit: operation('read_commit', {
    approval: ASKS_NEVER,
    ...READ,
    page: COMMIT_FILES,
    answer: arms({ ok: { commit: CommitReading } }),
    meaning:
      "Read what ONE commit of a registered checkout changed: its sha, parents, author, date and subject, and its paths from its first parent with each one's status and line counts — or only the paths one thread's change record was stamped with that commit.",
    grammar: `\`root\` names the checkout exactly as the readings beside this one do, and \`commit\` is any revision git resolves to a commit there; the answer names the full sha it resolved to.
The paths are read from the commit's first parent to the commit, the way \`git show\` reads them — a root commit against nothing — with renames paired: \`oldPath\` names where a renamed path came from. \`added\` and \`removed\` weigh every path the read covers, a binary path weighing nothing in them.
\`thread\` narrows the paths to those that thread's change-record rows were stamped with this commit; \`total\` then counts that narrowed set, while \`changed\` always counts every path the commit changed, so \`changed − total\` is how many more the commit carries.
The page's \`limit\` is capped by the commit-files family's measured carrier ceiling, which is also its default; a \`cursor\` continues the same commit, thread and checkout, and names the commit it pinned, so asking for a moving name such as HEAD after it moved refuses stale.
A revision naming no commit refuses \`not-found\`, as does a root no project's checkout on the machine answers to; \`thread\` narrows by the change record of the checkout's own project. What a commit did to one path, line by line, is read_authorship with \`commit\`.`,
    input: Schema.Struct({
      project: projectField,
      root,
      commit: Schema.NonEmptyString.annotate({ description: 'A revision that names one commit: a sha, a short sha, a branch or HEAD.' }),
      thread: Schema.optional(
        Schema.NonEmptyString.annotate({
          description: "A thread id: narrows the paths to those this thread's change record was stamped with this commit.",
        }),
      ),
      limit: limitOf(COMMIT_FILES),
      cursor: placedCursor,
    }),
    refusals: [
      'not-found',
      'bad-cursor',
      'cursor-stale',
      'record-unread',
      ...GIT_REFUSALS,
      ...COVERAGE_REFUSALS,
      ...ROOT_REFUSALS,
      ...REPOSITORY_REFUSALS,
    ],
    subjects: (input) => (input.root === undefined ? [] : resolutionSubjects(input.root)),
    confirmation: (input) => ({
      summary: `Read commit ${input.commit} in ${input.root ?? 'the checkout this call stands in'}?`,
    }),
    confirmLabel: 'Read commit',
    presentation: {
      running: 'Reading a commit',
      done: 'Read a commit',
      many: (count) => `Read ${count} commits`,
    },
  }),
};

export type CheckoutOperationId = keyof typeof CHECKOUT_OPERATIONS;
export const CHECKOUT_OPERATION_IDS = Object.keys(CHECKOUT_OPERATIONS) as readonly CheckoutOperationId[];
