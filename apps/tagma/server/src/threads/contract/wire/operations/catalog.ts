import { Schema } from 'effect';
import { threadInput } from '../project.js';
import { threadAgentSubject } from '@runlith/agent/permissions/threadSubject';
import { THREAD_QUERY_FIELDS, THREAD_QUERY_OPS, THREAD_QUERY_SOURCES } from '@runlith/agent/protocol/threadQuery';
import { signerPrincipal, threadIdOf, type Actor } from '../../../../platform/contract/wire/actor.js';
import type { ThreadRelation } from '../../../../thread-record/contract/wire/record.js';
import { type Raised } from '@runlith/agent/permissions';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { threadArchiveSweepSchema } from '../sweep.js';
import { threadTitleAnswerSchema } from '../titles.js';
import { threadTitleSchema } from '../creation.js';
import { threadWireSnapshotPayloadSchema } from '../snapshot.js';
import { threadListRowSchema } from '../list.js';
import {
  evidenceAnswerSchema,
  expandedRecordSchema,
  rolloutRepairSchema,
  threadFactsSchema,
  threadRolloutSchema,
  threadShapeSchema,
} from '../evidence.js';
import { conversationWindowSchema } from '../conversation.js';
import { ENDING_REFUSALS } from './turns.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import { placeRole } from '../../../../platform/contract/wire/place.js';
import { APPROVER_OPERATIONS } from './approvals.js';
import { TEAM_OPERATIONS } from './team.js';
import {
  CHANGE_REFUSALS,
  ThreadTargetApplied,
  ThreadTargetFailureState,
  ThreadTargetOperationKey,
  ThreadTargetPending,
  ThreadTargetSelected,
} from '../target.js';
import { SelectionRevision } from '../../../../workspace/contract/wire/assignments.js';
import { sweepFacts, THREAD_INSTANT, THREAD_SELECTOR, THREAD_SELECTOR_GRAMMAR } from '../selection.js';
import { WorkspaceGeneration } from '../../../../workspace/contract/wire/ids.js';
import { family, PageCursor } from '@runlith/paging';
import { limitOf } from '../../../../platform/contract/wire/pageFamily.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { OUTSIDE_SUBTREE, OWN_LINEAGE, THREAD_RUNNING } from '../../../../platform/contract/wire/conditions.js';
import { Duration } from 'effect';

export const THREADS = family('threads', 1, 'text', { text: 240, json: 865 }, 20, () => ({
  threadId: '01a0cab9-6847-7602-bed6-3503d2788ccf',
  title: 'x'.repeat(80),
  model: 'claude-fable-5-1',
  state: 'idle',
  updatedAt: '2026-09-22T20:24:16.059Z',
}));
const subject = (kind: 'read' | 'write', address: string, actor: Actor) =>
  actor.kind !== 'operator' ? [{ kind, value: threadAgentSubject(signerPrincipal(actor), address) }] : [];
const beyondRaised = (relation: ThreadRelation | null | undefined): readonly Raised[] =>
  relation === 'beyond'
    ? [{ condition: OUTSIDE_SUBTREE.id, fact: "Putting away a thread outside this agent's own subtree needs your word." }]
    : [];
type EvidenceTargets = {
  readonly request: { readonly threads: readonly string[] } | null;
};

export type ArchiveTerms = { readonly relation: ThreadRelation | null; readonly consents: readonly Raised[] };

const OWN_LINEAGE_GRAMMAR =
  'Your own thread and its ancestors refuse `own-lineage` in every mode: deleting them ends the thread that asks.';
const ARCHIVE_GRAMMAR = `Archive a thread on the operator's word, or your own throwaway child once its report is in. A thread outside your own subtree is asked about under trust. \`archived: false\` restores exactly the archived group. While archived, messages and tasks from another thread stay queued; the reader’s words or an explicit continuation can open a run and bring the thread back.`;

const deleteThreadConsequence = (): string => 'Everything spawned under it goes too, and nothing of it comes back.';

const THREAD_GRAMMAR = `Without \`select\` this is the thread's shape: its row, frozen prompt, log size, runs and graph acts. With \`select\` it queries facts.
Record kinds: message, tool, context, system-prompt, question, reasoning, compaction, failure, signal, interruption, step, step-finished, measurement, withdrawal.`;

const RECORDS_PER_QUERY = 30_000;
const FIELD_ROOTS = THREAD_QUERY_SOURCES.map((source) => `- \`${source}\`: ${THREAD_QUERY_FIELDS[source].join(', ')}`).join('\n');
const EVIDENCE_GRAMMAR = `Sources: \`runs\` (run ledger, its own usage total), \`steps\` (canonical per-step bill), \`measurements\` (per model-call attempt, retries separate), \`entries\` (latest recorded revision of each logical fact — one tool call, not its transitions), \`records\` (raw immutable events: revisions, not bills), \`activity\` (what the product did over the thread for the last \`activity.keepHours\`: runs, model calls with their provider, model, rung, account and usage, tool calls, compactions, settlements, reports, titles and recaps — each with its actor, trigger, parent, outcome and notes; \`steps\` and \`measurements\` name their model call in \`activity\`, and read_thread_record on an activity's \`at\` answers its bodies whole within one envelope shared by every address: a body that does not fit stands with its \`size\` and \`unread: true\`, and an address past the envelope answers \`unread\` — read it in a call of its own).
\`where\` predicates are ANDed. A field is a dotted path whose root the source declares; below that root it reaches recorded payload (\`entry.toolInput.path\`), where a missing key is a missing value and \`exists\` distinguishes it from a recorded null. Values are compared by type — 7 is not "7". \`contains\` matches text ignoring Unicode case, a member of an array or a key of an object; an array index is decimal \`0\` or a positive decimal without leading zeros; object segments name keys verbatim. Text orders by its UTF-8 bytes; numbers rank before text, text before booleans, booleans before everything else, and a missing value orders last. Objects group as equal whatever the order of their members.
The roots each source declares — for \`where\`, \`fields\`, \`group\`, \`sum\` and an ungrouped \`order\`; any other root refuses \`unknown-field\`:
${FIELD_ROOTS}
Default rows are compact metadata and always carry their expansion address. Bodies need explicit \`fields\` or read_thread_record.
\`group\`/\`count\`/\`sum\` and \`order\` cover the WHOLE selected population and answer once; \`limit\` cuts the answer and \`coverage.truncated\` says so. Absent or non-numeric summed values count as unknown, never zero.
A \`cursor\` alone continues its saved question, including its page size. The reading's membership, order, per-thread log heads and the instant it opened were fixed at its start — activity that opens later is not read; a changed question or selection refuses. An \`order\`, \`group\`, \`count\` or \`sum\` covers that whole fixed population before its answer is cut, and its cursor continues the ANSWER — so \`coverage.complete\` (the population was read whole) and \`coverage.truncated\` (more rows or groups stand behind this page) are separate facts. \`coverage.unavailable\` names what the reading named but can no longer read, which is not an absence of facts.
\`activity\` filters, groups, sums and orders in its own store over the whole selected population, so it has no read ceiling; \`coverage.lost\` names facts the activity record could not keep in the window read, and \`complete\` is false when any fact was lost. Every other source walks at most ${RECORDS_PER_QUERY} facts per reading, whatever it was asked: past that it stops, answers \`coverage.cut: read-ceiling\` with \`complete: false\`, and carries the \`at\` it stopped at. An aggregate or a ranking answered that way totals the facts EXAMINED and not the population, never a total. A \`group\`/\`count\`/\`sum\` answered that way is a running total: once its last page is read, its cursor walks on from where it stopped and carries the totals, so each continuation answers them grown, and the one with \`complete: true\` covers the whole population. A ranking without \`group\` does not continue: narrow the selection (fewer threads, a tighter \`where\`, a time range).`;

const threadAt = { threadId: Schema.String };

const moved = <F extends { readonly status: Schema.Top }>({ status: _status, ...fields }: F) => ({ ...fields, ...threadAt });

const titled = { ...threadAt, ...threadTitleAnswerSchema.fields };

const THREAD_TOOL = {
  doors: { http: true },
  tool: { capability: 'threads' },
  callers: 'any',
  place: 'project',
  graph: 'none',
  subject: 'none',
  waits: [],
  lifetimes: [],
} as const;

export const THREAD_OPERATIONS = {
  list_threads: operation('list_threads', {
    approval: ASKS_NEVER,
    ...THREAD_TOOL,
    effect: 'read',
    identity: 'none',
    answer: arms({
      ok: {
        threads: Schema.Array(threadFactsSchema),
        total: Schema.Int,
        cursor: Schema.NullOr(PageCursor),
        set: Schema.Literals(['live', 'archived', 'all']),
      },
      rows: {
        rows: Schema.Array(threadListRowSchema),
        total: Schema.Int,
        before: Schema.NullOr(PageCursor),
      },
    }),
    meaning:
      'Select the threads of one project — by id, title, lineage, clocks or what their runs actually did. A thread is one agent session; the row names its lineage, its state and both the model it is set to and the model its latest run used.',
    grammar: THREAD_SELECTOR_GRAMMAR,
    input: threadInput({
      ...THREAD_SELECTOR,
      cursor: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        ...placeRole('cursor'),
        description:
          'The `cursor` the previous page answered. It continues the membership this selection FIXED when it opened: a thread that moves, or is put away, while the set is paged keeps its place and is answered once. A changed selection refuses.',
      }),
      limit: limitOf(THREADS),
      shape: Schema.optional(Schema.Literals(['facts', 'rows'])).annotate({
        description: 'facts (default): compact ThreadFacts rows. rows: the full ThreadListRow page the retired list route answered.',
      }),
    }),
    refusals: [
      'not-found',
      'unknown-project',
      'ambiguous-project',
      'selection-shape',
      'cursor-stale',
      'read-unreadable',
      'read-inaccessible',
      'read-failed',
      'read-not-retained',
    ],
    confirmation: () => ({ summary: 'Read the selected threads?' }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Listing the threads',
      done: 'Listed the threads',
      many: (count) => `Listed the threads ${count} times`,
    },
    subjects: (_input, _prepared, actor) => subject('read', '*', actor),
  }),

  read_thread: operation('read_thread', {
    approval: ASKS_NEVER,
    ...THREAD_TOOL,
    tool: { capability: 'threads', companions: ['read_thread_record'] },
    external: true,
    effect: 'read',
    identity: 'none',
    answer: arms({
      ok: {
        shape: Schema.optional(threadShapeSchema),
        evidence: Schema.optional(evidenceAnswerSchema),
      },
    }),
    meaning:
      'What one thread IS — its row, frozen prompt, log size, runs with model, usage and timing, and the graph acts its session signed — or a query over the facts of one thread or a selected set: runs, steps, model-call measurements, logical entries, raw records and the activity record.',
    grammar: `${THREAD_GRAMMAR}\n\n${EVIDENCE_GRAMMAR}\n\n\`selection\` takes the terms list_threads takes. For source \`activity\`, its default \`set\` is \`all\`: archiving a thread after an event preserves that event in the window. Explicit \`set: live\` restricts it to live threads. Other sources default to \`live\`.`,
    input: threadInput({
      threadId: Schema.optional(ThreadId).annotate({ description: 'One thread. Its shape, or the facts queried.' }),
      threads: Schema.optional(Schema.Array(ThreadId)).annotate({
        description: 'A set of threads to query across. Every one is admitted before any fact is answered.',
      }),
      selection: Schema.optional(Schema.Struct(THREAD_SELECTOR)).annotate({
        description: 'A set named the way list_threads names one, instead of by id.',
      }),
      select: Schema.optional(Schema.Literals(THREAD_QUERY_SOURCES)).annotate({
        description: 'Which body of facts. Omit for the thread shape, or with a cursor to continue its saved question.',
      }),
      where: Schema.optional(
        Schema.Array(
          Schema.Struct({
            field: Schema.String.check(Schema.isMinLength(1)),
            op: Schema.Literals(THREAD_QUERY_OPS),
            value: Schema.optional(Schema.Unknown),
          }),
        ),
      ),
      fields: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
      group: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
      count: Schema.optional(Schema.Boolean),
      sum: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
      order: Schema.optional(Schema.Struct({ by: Schema.String.check(Schema.isMinLength(1)), dir: Schema.Literals(['asc', 'desc']) })),
      limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
        description: 'How many rows to answer with. An aggregate is not cut by it.',
      }),
      cursor: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate(placeRole('cursor')),
    }),
    refusals: [
      'not-found',
      'foreign-project',
      'unknown-project',
      'ambiguous-project',
      'selection-shape',
      'unknown-field',
      'cursor-stale',
      'read-unreadable',
      'read-inaccessible',
      'read-failed',
      'read-not-retained',
    ],
    confirmation: (input) => ({
      summary: input.select === undefined ? `Read ${input.threadId ?? 'one thread'}?` : 'Read thread evidence?',
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading a thread',
      done: 'Read a thread',
      many: (count) => `Read ${count} threads`,
    },
    subjects: (input, prepared: EvidenceTargets | undefined, actor) =>
      prepared?.request === null || prepared?.request === undefined || prepared.request.threads.length === 0
        ? subject('read', input.threadId ?? '*', actor)
        : prepared.request.threads.flatMap((threadId) => subject('read', threadId, actor)),
  }),

  continue_thread: operation('continue_thread', {
    approval: ASKS_IN_REVIEW,
    graph: 'none',
    external: true,
    doors: { socket: true, http: true },
    tool: { capability: 'threads' },
    callers: 'any',
    place: 'project',
    subject: 'none',
    waits: [],
    lifetimes: [],
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ started: { runId: Schema.String }, 'already-running': { runId: Schema.String } }),
    meaning:
      'Continue one interrupted thread by opening exactly one new run over the history and queue it kept. A run a restart cut, a run somebody stopped and a run that broke are all taken up; a concurrent start answers with the run already going, and a thread whose newest run finished its turn refuses.',
    input: Schema.Struct({ threadId: ThreadId }),
    refusals: ['not-found', 'foreign-project', 'run-not-interrupted', 'transport-cannot'],
    subjects: (input, _prepared, actor) => subject('write', input.threadId, actor),
    confirmation: (input) => ({ summary: `Continue ${input.threadId}?` }),
    confirmLabel: 'Continue',
    presentation: { running: 'Continuing a thread', done: 'Continued a thread' },
  }),

  restart_thread: operation('restart_thread', {
    approval: ASKS_IN_REVIEW,
    graph: 'none',
    external: true,
    doors: { socket: true, http: true },
    tool: { capability: 'threads' },
    callers: 'any',
    place: 'project',
    subject: 'none',
    waits: [],
    lifetimes: [],
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ restarted: { stoppedRunId: Schema.NullOr(Schema.String), runId: Schema.NullOr(Schema.String) } }),
    meaning:
      "Restart one thread's agent: stop its running turn, end the agent process its transport holds so the next turn starts one from the installed build, and continue the stopped turn over its history. A transport that cannot continue without words, and a thread with no turn, only lose the process; their next words start the new one. Each restart leaves one feed entry naming who restarted, the stopped turn and the calls it closed.",
    input: Schema.Struct({ threadId: ThreadId }),
    refusals: ['not-found', 'foreign-project', 'session-owned', 'session-uncertain'],
    subjects: (input, _prepared, actor) => subject('write', input.threadId, actor),
    confirmation: (input) => ({ summary: `Restart the agent of ${input.threadId}?` }),
    confirmLabel: 'Restart',
    presentation: { running: 'Restarting an agent', done: 'Restarted an agent' },
  }),

  move_thread: operation('move_thread', {
    approval: { ...ASKS_IN_REVIEW, when: [OUTSIDE_SUBTREE] },
    ...THREAD_TOOL,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({
      pending: moved(ThreadTargetPending.fields),
      selected: moved(ThreadTargetSelected.fields),
      applied: moved(ThreadTargetApplied.fields),
      failed: moved(ThreadTargetFailureState.fields),
    }),
    meaning: 'Move a thread into another worktree of this project, so the commands and file tools of its next step work there.',
    grammar: `\`worktree\` names where it goes: \`main\`, a worktree's name as list_worktrees answers it, or a root id. A thread with no run going moves at once. A running thread keeps the step in flight where it was and moves at its next step boundary: the answer is \`pending\` until then, and read it again under the same \`operationKey\` to see it \`applied\` or \`failed\`. The moved thread's next turn is told where it now stands and where its earlier reads were.
The same \`operationKey\` with the same move answers what that move reached; the same key carrying another move refuses. A thread moves itself and the threads it spawned; the operator moves any thread of the project. A thread born on a guest host keeps its world and refuses \`guest-mobility\`, and a CLI thread running its own agent refuses \`harness-pinned\` while a turn of it runs, because that agent works in the folder it launched in; a Tagma agent on any transport moves like a native one. Making a new worktree is its own act — prepare_worktree and create_worktree — and this moves into one that stands.`,
    input: Schema.Struct({
      threadId: ThreadId,
      worktree: Schema.NonEmptyString.annotate({
        ...placeRole('value'),
        description: '`main`, a worktree name list_worktrees answers, or a root id.',
      }),
      operationKey: Schema.optional(ThreadTargetOperationKey).annotate({
        description:
          'Your own name for this move, chosen before the call; the same name answers the same move. Omitted: a fresh one, answered back.',
      }),
      expectedSelectionRevision: Schema.optional(SelectionRevision).annotate({
        description: 'The placement revision you decided against. Omitted: whatever stands.',
      }),
      expectedGeneration: Schema.optional(WorkspaceGeneration).annotate({
        description: 'The context generation a running thread leaves. Omitted: whatever the run has reached.',
      }),
    }),
    refusals: [...CHANGE_REFUSALS, 'worktree-unknown', 'worktree-unavailable', 'placement-refused', 'harness-pinned', ...ENDING_REFUSALS],
    subjects: (input, consents: readonly Raised[] | undefined, actor) => [...subject('write', input.threadId, actor)],
    raises: (input, consents: readonly Raised[] | undefined, actor) => consents ?? [],
    confirmation: (input) => ({
      summary: `Move ${input.threadId} into ${input.worktree}?`,
      consequence: 'Its next step runs its commands and file tools in that worktree; a step already running finishes where it was.',
    }),
    confirmLabel: 'Move',
    presentation: {
      running: 'Moving a thread',
      done: 'Moved a thread',
      many: (count) => `Moved threads ${count} times`,
    },
  }),

  archive_thread: operation('archive_thread', {
    external: true,
    approval: {
      ...ASKS_IN_REVIEW,
      when: [{ condition: OUTSIDE_SUBTREE, asksFrom: 'trust', timeout: Duration.minutes(10) }, OWN_LINEAGE, THREAD_RUNNING],
    },
    ...THREAD_TOOL,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ archived: threadAt, unarchived: threadAt }),
    meaning:
      "Put one thread away, or bring it back: it leaves the project's thread list with everything spawned under it, and nothing is destroyed — its transcript, its runs and every read of it stay as they were.",
    grammar: `Every run and CLI still working under it is stopped and the thread put away in one act; putting away a thread of the agent's own subtree, working or not, asks nobody under trust; one that would stop work outside that subtree, or put away its own thread or an ancestor, asks the operator first — the calling run itself goes on to its end. An external caller plugin:<id> may archive or restore a thread whose bindings.plugin names that id; the same subtree semantics apply. ${ARCHIVE_GRAMMAR}`,
    input: Schema.Struct({
      threadId: ThreadId,
      archived: Schema.optional(Schema.Boolean).annotate({
        description: 'true — put away (the default); false — bring back what was put away with it.',
      }),
    }),
    refusals: [
      'not-found',
      'foreign-project',
      'thread-gone',
      'external-refused',
      'plugin-thread-mismatch',
      ...ENDING_REFUSALS,
      'rollout-io',
      'rollout-meta-missing',
      'rollout-meta-json',
      'rollout-item-json',
      'rollout-thread-missing',
      'rollout-record-shape',
    ],
    subjects: (input, _terms: ArchiveTerms | undefined, actor) => subject('write', input.threadId, actor),
    raises: (_input, terms: ArchiveTerms | undefined) => [...beyondRaised(terms?.relation), ...(terms?.consents ?? [])],
    confirmation: (input, terms?: ArchiveTerms) => ({
      summary: input.archived === false ? `Bring ${input.threadId} back?` : `Archive ${input.threadId}?`,
      consequence: terms?.relation === 'beyond' ? "This thread stands outside the agent's own subtree." : undefined,
    }),
    confirmLabel: 'Archive',
    presentation: {
      running: 'Archiving a thread',
      done: 'Archived a thread',
      many: (count) => `Archived ${count} threads`,
    },
  }),

  delete_thread: operation('delete_thread', {
    approval: {
      asksFrom: 'trust',
      timeout: 'none',
      why: 'Deleting a thread ends it and everything spawned under it, and nothing of it comes back.',
    },
    ...THREAD_TOOL,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ deleted: threadAt }),
    meaning:
      'End one thread for good, with everything spawned under it: its run is stopped, the processes, executions and guest it stands over are ended, and its transcript and records go with the row. Nothing comes back, where archiving keeps it all.',
    grammar: `${OWN_LINEAGE_GRAMMAR} Every run under the thread settles before any row goes: one that will not settle inside the ending's patience refuses \`still-settling\` and the whole tree stands; read that run, or stop the thread, and delete it again.`,
    input: Schema.Struct({ threadId: ThreadId }),
    refusals: [
      'not-found',
      'foreign-project',
      'own-lineage',
      'still-settling',
      'delete-conflict',
      ...ENDING_REFUSALS,
      'rollout-io',
      'rollout-meta-missing',
      'rollout-meta-json',
      'rollout-item-json',
      'rollout-thread-missing',
      'rollout-record-shape',
    ],
    subjects: (input, _prepared, actor) => subject('write', input.threadId, actor),
    intent: 'destructive',
    destructiveConsequence: deleteThreadConsequence,
    confirmation: (input) => ({
      summary: `Delete ${input.threadId}?`,
      consequence: deleteThreadConsequence(),
    }),
    confirmLabel: 'Delete',
    presentation: {
      running: 'Deleting a thread',
      done: 'Deleted a thread',
      many: (count) => `Deleted ${count} threads`,
    },
  }),

  archive_threads: operation('archive_threads', {
    approval: {
      ...ASKS_IN_REVIEW,
      when: [{ condition: OUTSIDE_SUBTREE, asksFrom: 'trust', timeout: Duration.minutes(10) }, OWN_LINEAGE, THREAD_RUNNING],
    },
    ...THREAD_TOOL,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ swept: threadArchiveSweepSchema.fields, restored: threadArchiveSweepSchema.fields }),
    meaning:
      'Put every thread a selection matches away, or bring them back, as ONE act: a window on the clocks names them, each takes the same stamp with everything spawned under it, and a thread still working is left standing and named in the answer with its run.',
    grammar: `${ARCHIVE_GRAMMAR} Putting away passes over your own thread and its ancestors; bulk archiving skips and reports running threads. The selection is the one list_threads speaks: ISO instants on the four clocks; \`archived\` names the direction and so the set read — putting away reads the live threads, bringing back the archived ones. A selection matching nothing answers empty. Nothing is refused for being busy: the answer says what was left.`,
    input: threadInput({
      archived: Schema.optional(Schema.Boolean).annotate({
        description: 'true — put away (the default); false — bring back.',
      }),
      createdSince: Schema.optional(THREAD_INSTANT),
      createdBefore: Schema.optional(THREAD_INSTANT),
      updatedSince: Schema.optional(THREAD_INSTANT),
      updatedBefore: Schema.optional(THREAD_INSTANT).annotate({
        description: 'No durable movement since this instant: "idle for a week" is now minus seven days here.',
      }),
      readerSince: Schema.optional(THREAD_INSTANT),
      readerBefore: Schema.optional(THREAD_INSTANT),
      archivedSince: Schema.optional(THREAD_INSTANT),
      archivedBefore: Schema.optional(THREAD_INSTANT),
    }),
    refusals: ['not-found', 'unknown-project', 'selection-shape', ...ENDING_REFUSALS],
    subjects: (_input, _relation: ThreadRelation | null | undefined, actor) => subject('write', '*', actor),
    raises: (_input, relation: ThreadRelation | null | undefined) => beyondRaised(relation),
    confirmation: (input, relation?: ThreadRelation | null) => ({
      summary: input.archived === false ? 'Bring every matching thread back?' : 'Archive every matching thread?',
      facts: sweepFacts(input),
      consequence: relation === 'beyond' ? "Threads outside the agent's own subtree are included." : undefined,
    }),
    confirmLabel: 'Archive',
    presentation: {
      running: 'Sweeping threads into the archive',
      done: 'Swept threads into the archive',
      many: (count) => `Swept threads ${count} times`,
    },
  }),

  pin_thread: operation('pin_thread', {
    approval: { asksFrom: 'trust', timeout: Duration.minutes(10) },
    ...THREAD_TOOL,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ pinned: threadAt, unpinned: threadAt }),
    meaning:
      "One thread held in view in the project's list, or released. A pinned root stands above every other root in the order pinned — the oldest pin at the very top — and nothing reorders it: not a reader's message, not a run, not age, not falling out of the live window. A pinned sub-agent stands under its parent once it finishes, above the fold of its finished siblings, and keeps its whole tree in the list however old.",
    grammar:
      "A pin names the thread itself at any depth. The operator's own words to a sub-agent pin it. Pinning a pinned thread keeps the place it holds. `pinned: false` releases it: a root drops back to the position its reader clock earned, a sub-agent folds with its finished siblings — nothing else about it moves, so a pinned thread put away comes back still pinned. It is the reader's own arrangement of a surface you cannot see.",
    input: Schema.Struct({
      threadId: ThreadId,
      pinned: Schema.optional(Schema.Boolean).annotate({
        description: 'true — hold it at the top (the default); false — release it back into the ordinary order.',
      }),
    }),
    refusals: ['not-found', 'foreign-project'],
    subjects: (input, _prepared, actor) => subject('write', input.threadId, actor),
    confirmation: (input) => ({
      summary: input.pinned === false ? `Unpin ${input.threadId}?` : `Pin ${input.threadId}?`,
      consequence: "This changes what the reader's thread list keeps in view.",
    }),
    confirmLabel: 'Pin',
    presentation: {
      running: 'Pinning a thread',
      done: 'Pinned a thread',
      many: (count) => `Pinned threads ${count} times`,
    },
  }),

  set_thread_delegation: operation('set_thread_delegation', {
    approval: ASKS_IN_REVIEW,
    ...THREAD_TOOL,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({
      switched: {
        ...threadAt,
        delegation: Schema.Literals(['on', 'off']),
        own: Schema.NullOr(Schema.Boolean),
        setAt: Schema.NullOr(Schema.String),
        decidedBy: Schema.String,
      },
    }),
    meaning:
      "Switch delegation on or off for one thread and the team it starts, or hand it back to what it inherits — its spawn lineage's nearest switch, else the machine's `agent.delegation`. Off, `spawn_agent` refuses there; agents already running are untouched.",
    grammar:
      "Act on the operator's word alone, never on your own reading of the work. `delegation: false` switches it off for the thread and every descendant without a switch of its own; `true` switches it on there, depth still bounding; `null` clears the thread's own switch. `threadId` defaults to your own thread; the operator names one. The answer is what the thread now resolves to and where that was decided.",
    input: threadInput({
      threadId: Schema.optional(ThreadId).annotate({ description: 'The thread to switch; your own when omitted.' }),
      delegation: Schema.NullOr(Schema.Boolean).annotate({
        description: 'true — agents may start agents here; false — they may not; null — inherit.',
      }),
    }),
    refusals: ['not-found', 'foreign-project', 'thread-required'],
    subjects: (input, _prepared, actor) => subject('write', input.threadId ?? threadIdOf(actor) ?? '*', actor),
    confirmation: (input) => ({
      summary:
        input.delegation === null
          ? `Let ${input.threadId ?? 'this thread'} inherit whether agents may start agents?`
          : `Switch delegation ${input.delegation ? 'on' : 'off'} for ${input.threadId ?? 'this thread'} and its team?`,
    }),
    confirmLabel: 'Switch',
    presentation: {
      running: 'Switching delegation',
      done: 'Switched delegation',
      many: (count) => `Switched delegation ${count} times`,
    },
  }),

  ...APPROVER_OPERATIONS,
  ...TEAM_OPERATIONS,
  set_thread_operator_notice: operation('set_thread_operator_notice', {
    approval: { ...ASKS_IN_REVIEW, when: [OUTSIDE_SUBTREE] },
    ...THREAD_TOOL,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ set: { ...threadAt, notice: Schema.NullOr(Schema.Boolean) } }),
    meaning:
      "Whether you are told, as a message that wakes you, each time the operator writes directly to one child of yours. Absent an answer here the project's `agent.operatorNotice` setting decides, and that is off unless the operator switched it on.",
    grammar:
      '`notice: true` asks for the notice on this child, `false` declines it even where the setting is on, `null` hands the child back to the setting. It reaches only the child it names; nothing is queued for words the operator wrote before it was on.',
    input: Schema.Struct({
      threadId: ThreadId,
      notice: Schema.NullOr(Schema.Boolean).annotate({
        description: 'true — tell me; false — do not; null — follow the setting.',
      }),
    }),
    refusals: ['not-found', 'foreign-project'],
    subjects: (input, consents: readonly Raised[] | undefined, actor) => [...subject('write', input.threadId, actor)],
    raises: (input, consents: readonly Raised[] | undefined, actor) => consents ?? [],
    confirmation: (input) => ({ summary: `Change whether you are told when the operator writes to ${input.threadId}?` }),
    confirmLabel: 'Set',
    presentation: {
      running: 'Setting an operator notice',
      done: 'Set an operator notice',
      many: (count) => `Set operator notices ${count} times`,
    },
  }),

  generate_thread_title: operation('generate_thread_title', {
    approval: ASKS_IN_REVIEW,
    ...THREAD_TOOL,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ named: titled, 'no-topic': titled, superseded: titled, failed: titled }),
    meaning:
      "One thread named by a model, whatever the project's naming setting says. It asks over the prompt the thread's last answer was sent over while that prompt is still cached, and otherwise sends a bounded excerpt of the reader's words to the first that can answer: the Title model setting, the light model of the thread's provider, one sessionless call of the thread's own CLI, the thread's own model at its lowest rung.",
    grammar:
      "A name is written only when the model answers with one — a short name, never a sentence, in the language of the reader's own messages. It answers `named` with that name, `no-topic` when the conversation carries no subject yet, `superseded` when a rename landed while the name was being written, and `failed` when the model did not answer usably. A rename after it always wins. Roots only: a spawned thread refuses `not-a-root`, because its list row prints the address its team writes to. The result names its source, fresh reason and failure reason. A rejected completed captured answer permits one compact fresh call; transport failures do not trigger that extra call. A thread none of them can name refuses `title-model-missing`.",
    input: Schema.Struct({ threadId: ThreadId }),
    refusals: ['not-found', 'foreign-project', 'title-model-missing'],
    subjects: (input, _prepared, actor) => subject('write', input.threadId, actor),
    confirmation: (input) => ({
      summary: `Name thread ${input.threadId} from its own conversation?`,
      consequence: 'This asks the model for a name. A rejected captured answer may spend one additional compact naming call.',
    }),
    confirmLabel: 'Name',
    presentation: {
      running: 'Naming a thread',
      done: 'Named a thread',
      many: (count) => `Named threads ${count} times`,
    },
  }),

  set_thread_title: operation('set_thread_title', {
    approval: { ...ASKS_IN_REVIEW, when: [OUTSIDE_SUBTREE] },
    ...THREAD_TOOL,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ loaded: { snapshot: threadWireSnapshotPayloadSchema.fields.snapshot } }),
    meaning: 'Rename a thread: the title becomes its name in the list.',
    grammar:
      "The title is kept exactly as sent, trimmed; a blank one refuses `title-empty`. It stands as chosen by hand, so automatic naming never replaces it and a later rename wins. Any thread of the project can be renamed, a spawned one included, though its list row also prints the address its team writes to. A thread outside your own subtree needs the operator's word.",
    input: Schema.Struct({ threadId: ThreadId, ...threadTitleSchema.fields }),
    refusals: ['not-found', 'unknown-project', 'project-required', 'foreign-project', 'thread-gone', 'title-empty'],
    subjects: (input, consents: readonly Raised[] | undefined, actor) => [...subject('write', input.threadId, actor)],
    raises: (input, consents: readonly Raised[] | undefined, actor) => consents ?? [],
    confirmation: (input) => ({ summary: `Rename ${input.threadId}?` }),
    confirmLabel: 'Rename',
    presentation: {
      running: 'Renaming a thread',
      done: 'Renamed a thread',
      many: (count) => `Renamed threads ${count} times`,
    },
  }),

  read_thread_record: operation('read_thread_record', {
    approval: ASKS_NEVER,
    ...THREAD_TOOL,
    effect: 'read',
    identity: 'none',
    answer: arms({
      ok: { expanded: Schema.Array(expandedRecordSchema) },
      conversation: { windows: Schema.Array(conversationWindowSchema) },
    }),
    meaning:
      'Expand addressed evidence whole, across threads: every recorded payload facet of each named record — the entry, the model messages, the step bill and its request, the call measurement, a withdrawal, a compaction fold — with optional neighbouring records around each.',
    grammar:
      'An address is the log’s `at`, the record id an entry carries, or `activity:<uuid>` as a `select: activity` row answered it — activity expansion reads its metadata, notes and whole fitting bodies. One thread is named once: `threadId` stands for every address that names none, exactly as the thread reads take it, and an address may still name another thread of the same project. An address the log never wrote refuses `not-found`; a thread this caller may not read refuses before any body is answered. `fields` narrows what each record carries — a tool argument without its result — and `around` carries that many records each side.',
    input: threadInput({
      threadId: Schema.optional(ThreadId).annotate({
        description: 'The thread every address stands in unless it names its own.',
      }),
      at: Schema.Array(
        Schema.Struct({
          threadId: Schema.optional(ThreadId).annotate({
            description: 'The thread this address stands in; omitted, the call’s own `threadId`.',
          }),
          at: Schema.Union([Schema.Int.check(Schema.isGreaterThan(0)), Schema.String.check(Schema.isMinLength(1))]).annotate({
            description: '`at` in the log, or the record id an entry carries.',
          }),
        }),
      ).annotate({ description: 'The addresses to expand; they may name different threads of one project.' }),
      fields: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))).annotate({
        description: 'Dotted paths of each record to answer with. Absent carries every recorded facet.',
      }),
      around: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
        description: 'How many neighbouring records each side of every found address.',
      }),
      outputFrom: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
        description:
          'Read each addressed record’s tool output or activity body as text from this byte: a page as large as the answer holds, with `next` naming the following byte, null at the end. Activity pages read body 1 unless `body` names another body number.',
      }),
      body: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
        description: 'The activity body’s `n` to page with outputFrom; defaults to 1.',
      }),
      conversation: Schema.optional(Schema.Boolean).annotate({
        description:
          'Answer the conversation around each address — a search_threads match’s entryId or the log’s `at` — with `around` counted in messages said, 25 at most each side: a wider window refuses `selection-shape`, and the next window opens from its outermost message.',
      }),
    }),
    refusals: ['not-found', 'foreign-project', 'unknown-project', 'ambiguous-project', 'selection-shape'],
    confirmation: () => ({ summary: 'Expand the addressed thread evidence?' }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Expanding thread evidence',
      done: 'Expanded thread evidence',
      many: (count) => `Expanded thread evidence ${count} times`,
    },
    subjects: (input, _prepared, actor) =>
      (input.at ?? []).flatMap((address: { readonly threadId?: string; readonly at: string | number }) => {
        const thread = address.threadId ?? input.threadId;
        return thread === undefined ? [] : subject('read', thread, actor);
      }),
  }),

  read_thread_rollout: operation('read_thread_rollout', {
    approval: ASKS_NEVER,
    ...THREAD_TOOL,
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: { rollout: threadRolloutSchema } }),
    meaning:
      "Where one thread's rollout and its projected rows disagreed at boot: the recorded refusal and a bounded window of plain-file records and corresponding rows. A compressed file stays compressed and is named without expanding it; no recorded refusal does not prove that the entire file matches the rows.",
    input: Schema.Struct({
      threadId: ThreadId,
      records: Schema.optional(
        Schema.Int.check(Schema.isGreaterThan(0)).annotate({
          description: 'How many of the file’s own records to carry; the answer says when the file held more.',
        }),
      ),
    }),
    refusals: ['not-found', 'foreign-project', 'unknown-project', 'ambiguous-project'],
    confirmation: (input) => ({ summary: `Read the rollout disagreement of ${input.threadId}?` }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading where a rollout and its rows disagree',
      done: 'Read where a rollout and its rows disagree',
      many: (count) => `Read ${count} rollout disagreements`,
    },
    subjects: (input, _prepared, actor) => subject('read', input.threadId, actor),
  }),

  repair_thread_rollout: operation('repair_thread_rollout', {
    approval: ASKS_IN_REVIEW,
    ...THREAD_TOOL,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ ok: { repaired: rolloutRepairSchema } }),
    meaning:
      "One thread's rollout renumbered into the ascending sequence its records must carry, then projected again. Every record survives with its id, payload and order; only the duplicated number is rewritten, the original is kept beside the file, and a line nobody can read is refused, never invented.",
    input: Schema.Struct({ threadId: ThreadId }),
    refusals: ['not-found', 'foreign-project', 'no-rollout-home', 'rollout-corrupt', 'rollout-io'],
    subjects: (input, _prepared, actor) => subject('write', input.threadId, actor),
    confirmation: (input) => ({
      summary: `Renumber the rollout of ${input.threadId} and project it again?`,
      consequence: 'The file is rewritten in place; the original is kept beside it.',
    }),
    confirmLabel: 'Repair',
    presentation: {
      running: 'Renumbering a rollout',
      done: 'Renumbered a rollout',
      many: (count) => `Renumbered ${count} rollouts`,
    },
  }),
};

export type ThreadOperationId = keyof typeof THREAD_OPERATIONS;
export const THREAD_OPERATION_IDS = Object.keys(THREAD_OPERATIONS) as readonly ThreadOperationId[];
