import { Schema } from 'effect';
import { COVERAGE_REFUSALS, REPOSITORY_REFUSALS, ROOT_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { PAGE_CURSOR } from '@runlith/paging';
import { AuthorshipSide, PathAuthorship } from './authorship.js';
import { ChangesRead, ThreadHistoryRead } from './changes.js';
import { CHANGE_PAGE_ROWS, CHANGES, THREAD_HISTORY } from './pages.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ceilingOf, limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { CHANGE_WRITES } from './writes.js';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { placedCursor, placeRole } from '../../../platform/contract/wire/place.js';

const READING = ['git-unreadable', 'git-incomplete', 'path-unread', 'path-oversized', 'record-unread'] as const;

export const AUTHORSHIP_ANSWER_LINES = 30_000;

export const AuthorshipContext = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const AuthorshipOpen = Schema.Struct({
  at: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  lines: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type AuthorshipOpen = typeof AuthorshipOpen.Type;

export const AuthorshipOpens = Schema.Array(AuthorshipOpen);

export const CHANGE_READS = {
  read_authorship: operation('read_authorship', {
    approval: ASKS_NEVER,
    doors: { http: true },
    tool: { capability: 'worktrees', needs: ['shared'] },
    callers: 'any',
    subject: 'head',
    place: 'project',
    waits: [],
    lifetimes: ['workspace'],
    effect: 'read',
    identity: 'none',
    meaning:
      "Read who wrote each line of ONE open path: the patch between HEAD's blob and the working file, with the holder that last wrote each changed line — a thread or the operator — or nobody.",
    grammar: `\`rootId\` names the registered checkout and \`path\` is spelled relative to its root, exactly as every other reading of this family spells one.
Every changed line carries one mark, the change record's current judgement of the path: the holder that wrote it LAST — a thread, or the operator for what they saved in Tagma's editor — or nobody where something outside the record wrote it. A holder whose line another wrote over keeps no claim to it, and a line HEAD already carries is not in the patch, so the question never reaches it: this is not blame into history. A path whose judgement is not proven names nobody on any line.
A binary file answers \`binary\` and no lines. The answer is kept against all THREE things it was read from — the working bytes, the judgement of that path, and the object HEAD holds for it — so a moved HEAD voids it even where nothing else changed. A repeat still spends the one listing that reads the object; what it saves is the blob's content and the marking over it.
The path is confined to the checkout before anything is read: a spelling that leaves the root refuses \`path-outside-tree\`, and the graph's own tree refuses \`graph-path\` as the acts beside this do. This reading opens the file itself, where they reach the tree only through git.
\`context\` is how many unchanged lines frame EVERY stretch, three unless you name one. Every changed line carries \`spans\`, the character ranges that moved inside it, and the first line of each stretch carries \`hiddenBefore\`, the lines standing above it that this width did not show, beside \`hiddenAt\`, where that run starts on HEAD's side.
To OPEN one run, name it in \`open\` — \`{at, lines}\`, \`at\` being the \`hiddenAt\` the answer gave you — and those lines arrive while every other stretch keeps \`context\`. Widening \`context\` to open one gap widens all of them and mints a reading of the file; this does not. Ask for several runs at once and they all stand open, and \`at\` is HEAD's own numbering because a stretch's place in the answer moves whenever a neighbouring change appears. An \`at\` inside no hidden run refuses \`stretch-gone\` rather than silently opening nothing. \`timedOut\` says the comparison ran out of its clock and marked nothing rather than marking wrongly. What is bounded is the ANSWER, not the width: stretches merge while the gap between them is twice the width, so a wide enough reading answers the whole file, and a width whose answer would pass ${AUTHORSHIP_ANSWER_LINES} lines refuses \`context-too-wide\` naming what it would have carried. Ask narrower. A working file past the capture this reading declares refuses \`path-oversized\`, as HEAD's side already refuses \`git-incomplete\`.
With \`commit\` the patch is instead the one that commit made: its first parent's blob of the path — of the old name where the commit renamed it, nothing for a root commit or a path it added — against the commit's own, read from git alone, with every line's author null because no record is consulted. \`hiddenAt\` and \`open\` then number the parent's side. A path the commit did not touch answers its unchanged patch rather than refusing; a revision naming no commit, or a path standing in neither side, refuses \`not-found\`. A commit never moves, so this reading is kept against the commit alone.
With \`base\` the patch spans a range instead: \`base\`'s blob of the path against \`commit\`'s — HEAD's where \`commit\` is not named — as one change, the way a branch differs from where it left its base; name the merge-base to read a worktree's committed change to one file. \`hiddenAt\` and \`open\` number \`base\`'s side, a path renamed between the two takes its base from the old name, and the reading is kept against the two commits. A revision naming no commit refuses \`not-found\`.
\`side\` reads one half of the working change, the way git lists them apart: \`staged\` is HEAD's blob against the index's, \`unstaged\` the index's against the working file, and \`hiddenAt\` and \`open\` then number the half's base — HEAD's side, or the index's. Where that half is the whole working change — the index holding the working bytes, or HEAD's — it is the plain reading, authors and all; a half standing between two different texts names nobody, because the record describes the working file. \`side\` is not combined with \`commit\` or \`base\`: that refuses \`side-with-commit\`.
\`sides\` in the answer names the path each end holds the file at — \`before\` the base's, which is the old name where a commit or a range renamed it, \`after\` the path asked — and null for an end that holds none, so an empty file added or deleted still says which.
An end past the capture whose first bytes hold a NUL answers \`binary\` rather than refusing: a large picture is still a file whose two ends can be shown.`,
    input: Schema.Struct({
      rootId: Schema.NonEmptyString.annotate({ ...placeRole('checkout'), description: "The registered checkout's root id." }),
      path: Schema.NonEmptyString.annotate({ ...placeRole('value'), description: 'The path, relative to the checkout root.' }),
      context: Schema.optional(
        AuthorshipContext.annotate({
          description: `Unchanged lines framing EVERY stretch, three unless named. An answer past ${AUTHORSHIP_ANSWER_LINES} lines refuses.`,
        }),
      ),
      open: Schema.optional(
        AuthorshipOpens.annotate({
          description:
            'Hidden runs to open, each `{at, lines}` with `at` the `hiddenAt` of the line that stands below the run. Opens those lines alone; every other stretch keeps `context`.',
        }),
      ),
      commit: Schema.optional(
        Schema.NonEmptyString.annotate({
          description:
            'A revision naming one commit: read the change that commit made to the path, from its first parent, naming no authors.',
        }),
      ),
      base: Schema.optional(
        Schema.NonEmptyString.annotate({
          description: "A revision naming the commit the patch starts from, instead of `commit`'s first parent; `commit` defaults to HEAD.",
        }),
      ),
      side: Schema.optional(
        AuthorshipSide.annotate({
          description: '`staged`: HEAD against the index. `unstaged`: the index against the working file. Not with `commit` or `base`.',
        }),
      ),
    }),
    answer: arms({ ok: { authorship: PathAuthorship } }),
    refusals: [
      'not-found',
      'path-outside-tree',
      'graph-path',
      'context-too-wide',
      'stretch-gone',
      'side-with-commit',
      ...READING,
      ...COVERAGE_REFUSALS,
      ...ROOT_REFUSALS,
      ...REPOSITORY_REFUSALS,
    ],
    confirmation: (input) => ({ summary: `Read authorship of ${input.path} in ${input.rootId}?` }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading file authorship',
      done: 'Read file authorship',
      many: (count) => `Read file authorship ${count} times`,
    },
    subjects: (input) => [{ kind: 'read', value: input.rootId }],
  }),
  read_changes: operation('read_changes', {
    approval: ASKS_NEVER,
    doors: { http: true },
    tool: { capability: 'files', direct: true, needs: ['shared'] },
    callers: 'any',
    subject: 'head',
    place: 'machine',
    waits: [],
    lifetimes: ['workspace'],
    effect: 'read',
    identity: 'none',
    meaning:
      'What a session holds and wrote across checkouts and projects, read from the change record’s current judgement rather than from git: one session’s held paths and the history of its turns, or the judgement of one path — whose lines stand there, held meaning nobody committed them.',
    grammar:
      'Bare: this session. `checkouts` lists, per checkout it holds lines in, its paths in three sections — `uncommitted` with its own `+/−` and the other sessions whose lines stand beside, `unproven` with the reason its lines could not be told apart, and `outside` for paths git ignores — under that checkout’s `state`, its `uncommitted` summing that section’s `+/−`; `held` counts them. `commits` are the commits its lines landed in that HEAD still reaches, `ends` how its other lines left, by reason. `turns` page the paths each of its turns wrote, newest first, with what stands of each now: `writing`, `held` where its lines still stand, `cleared` where none stand and the record has not yet ended them, `committed` with the commit, or `withdrawn` with the reason. An `agent` reads that teammate the same way, and an address nobody answers to refuses. A `path` answers `holdings`: the judgement of that path — of every judged path under it for a directory — naming each thread with its lines, nobody’s lines and why, or an unproven verdict with its reason, beside the commit-step debts standing on it. `unattributed` carries command-window observations, naming the thread whose command met a change, never its author; reason `team` names in `team` the root of the one thread tree whose commands alone met it, and that root lands it with `taking` of the thread. `limit` bounds the whole selection: session reads page checkout entries first (an empty checkout counts as one row), then `turns`, then `unattributed`; path reads page `holdings` then `unattributed`. Observations stay in record order; a removed checkout or observation anchor refuses `cursor-stale`. `total` counts all rows, `totals` counts each set (`checkouts` counts checkout rows), and `next` continues the same selection with `cursor` alone. `held` and checkout `uncommitted` remain full totals even when their entries are paged. Commits and endings remain alongside the page.',
    input: Schema.Struct({
      path: Schema.optional(
        Schema.String.check(Schema.isMinLength(1)).annotate({
          ...placeRole('value'),
          description: 'A path relative to your working checkout, or an absolute path in another checkout; omit for a session’s changes.',
        }),
      ),
      agent: Schema.optional(
        Schema.String.check(Schema.isMinLength(1)).annotate({
          description: 'A team name or thread id; omit for this session.',
        }),
      ),
      limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(ceilingOf(CHANGES)))).annotate({
        description: `How many rows to answer, ${CHANGE_PAGE_ROWS} by default and ${ceilingOf(CHANGES)} at most. The answer carries the total and the cursor, so a cut is never silent.`,
      }),
      cursor: PAGE_CURSOR,
    }),
    answer: arms({ ok: ChangesRead }),
    refusals: [
      'selection-shape',
      'unknown-address',
      'no-record',
      'record-unread',
      'not-found',
      'bad-cursor',
      'cursor-stale',
      ...ROOT_REFUSALS,
    ],
    confirmation: () => ({ summary: 'Read the checkout change record?' }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading what a session changed',
      done: 'Read what a session changed',
      many: (count) => `Read ${count} change records`,
    },
    subjects: () => [],
  }),
  read_thread_history: operation('read_thread_history', {
    approval: ASKS_NEVER,
    doors: { http: true },
    callers: 'operator',
    subject: 'none',
    place: 'project',
    waits: [],
    lifetimes: ['workspace'],
    effect: 'read',
    identity: 'none',
    meaning:
      'Read every path one thread of this project wrote, turn by turn, newest first, with what stands of each now: still held, committed, or how its lines left.',
    grammar:
      '`turns` are the same rows `read_changes` answers for that thread: one per path a turn wrote, with `state` — `writing`, `held` where its lines still stand, `cleared` where the checkout’s current judgement holds none of them, `committed` with the commit, or `withdrawn` with the reason. `next` continues the walk.',
    input: Schema.Struct({
      threadId: Schema.NonEmptyString.annotate({ ...placeRole('thread'), description: 'The thread whose history to read.' }),
      limit: limitOf(THREAD_HISTORY),
      cursor: placedCursor,
    }),
    answer: arms({ ok: ThreadHistoryRead }),
    refusals: ['bad-cursor', 'cursor-stale', 'record-unread'],
    page: THREAD_HISTORY,
    confirmation: () => ({ summary: 'Read the thread’s change history?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the thread’s change history', done: 'Read the thread’s change history' },
    subjects: () => [],
  }),
};

export type ChangeOperationId = keyof typeof CHANGE_READS | keyof typeof CHANGE_WRITES;
export const CHANGE_OPERATION_IDS: readonly ChangeOperationId[] = [
  ...(Object.keys(CHANGE_READS) as (keyof typeof CHANGE_READS)[]),
  ...(Object.keys(CHANGE_WRITES) as (keyof typeof CHANGE_WRITES)[]),
];
export const AUTHORSHIP_OPERATION: ChangeOperationId = 'read_authorship';
