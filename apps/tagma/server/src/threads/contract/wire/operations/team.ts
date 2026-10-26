import { ReviewPolicy, Team, TeamEdit, TeamLayer } from '@runlith/agent/collaboration/team';
import { Schema } from 'effect';
import { threadInput } from '../project.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { SETTABLE_SCOPES } from '../../../../platform/contract/wire/setting.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';

const OPERATOR_DOOR = {
  approval: ASKS_NEVER,
  doors: { socket: true, http: true },
  tool: undefined,
  callers: 'operator',
  place: 'project',
  graph: 'none',
  subject: 'none',
  waits: [],
  lifetimes: [],
} as const;

const standing = { own: Schema.NullOr(TeamLayer), setAt: Schema.NullOr(Schema.String) };

export const TEAM_OPERATIONS = {
  read_team: operation('read_team', {
    ...OPERATOR_DOOR,
    effect: 'read',
    identity: 'none',
    answer: arms({
      read: { threadId: Schema.NullOr(Schema.String), team: Team, edits: Schema.Array(TeamEdit), differs: Schema.Boolean, ...standing },
    }),
    meaning:
      "The sub-agent team a thread of this project resolves to — the rows of `agent.models` its children may run on, the providers switched off, and the review policy — and the thread layer it stands under. Without `threadId`, the project's own team; with `team`, what that copy resolves to.",
    grammar:
      'Rows are the shipped ratings of every connected provider with `edits` applied — the thread copy its lineage holds, else the machine edits then the project’s — each row with its own `on`; `off` names providers switched off as a whole. A thread copy starts from `edits` and `team.review`. `setAt` is the thread whose copy decides, `own` that copy when it is the named thread itself, and `differs` whether the thread resolves another team than the project.',
    input: threadInput({
      threadId: Schema.optional(ThreadId),
      layer: Schema.optional(Schema.Literals(SETTABLE_SCOPES)).annotate({
        description:
          'Without threadId: `user` resolves the machine’s edits alone, `project` (the default) the machine’s then the project’s.',
      }),
      team: Schema.optional(TeamLayer).annotate({
        description:
          'A copy not yet stored — a draft’s — resolved in place of any the thread holds; `differs` compares it with the project.',
      }),
    }),
    refusals: ['not-found', 'foreign-project', 'token-store', 'provider-not-installed'],
    subjects: () => [],
    confirmation: () => ({ summary: 'Read the sub-agent team?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the sub-agent team', done: 'Read the sub-agent team' },
  }),
  set_thread_team: operation('set_thread_team', {
    ...OPERATOR_DOOR,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ set: { threadId: Schema.String, ...standing } }),
    meaning:
      'Give one thread and the team it starts a copy of their own of the sub-agent team: while it stands, the machine and project settings no longer reach them. Its running agents are told at their next step.',
    grammar:
      '`team.models` is the whole edit list over the shipped rows, `team.review` the whole policy — a copy of what read_team answered with the change made. It replaces any copy the thread had. `null` drops the copy: the thread follows its lineage, then the project, as they stand now.',
    input: Schema.Struct({
      threadId: ThreadId,
      team: Schema.NullOr(TeamLayer).annotate({ description: 'The thread copy; null — follow the project.' }),
    }),
    refusals: ['not-found', 'foreign-project'],
    subjects: () => [],
    confirmation: (input) => ({ summary: `Change the sub-agent team of ${input.threadId}?` }),
    confirmLabel: 'Set',
    presentation: { running: 'Setting a thread’s sub-agent team', done: 'Set a thread’s sub-agent team' },
  }),
  promote_thread_team: operation('promote_thread_team', {
    ...OPERATOR_DOOR,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({
      promoted: {
        threadId: Schema.NullOr(Schema.String),
        promoted: Schema.NullOr(TeamLayer),
        previous: Schema.Struct({ models: Schema.NullOr(Schema.Array(TeamEdit)), review: Schema.NullOr(ReviewPolicy) }),
      },
    }),
    meaning:
      "Make the team a thread resolves, or the copy a draft holds before its thread is born, the project's for every thread: the copy becomes the project's own `agent.models` and `agent.review`, and the thread's copy is dropped, so it follows the project again. A write that fails puts the project back as it was.",
    grammar:
      '`threadId` names the thread whose copy is promoted; `team` instead gives the copy itself, and no thread changes. `previous` is what the project held of its own before — null where it held nothing and inherited the machine — so writing it back with write_setting, and `promoted` with set_thread_team, undoes the act. A thread without a copy changes nothing and answers `promoted: null`.',
    input: Schema.Union([Schema.Struct({ threadId: ThreadId }), Schema.Struct({ team: TeamLayer })]),
    refusals: ['not-found', 'foreign-project', 'setting-value', 'setting-conflict'],
    subjects: () => [],
    confirmation: (input) => ({
      summary: `Use the sub-agent team of ${'threadId' in input ? input.threadId : 'this draft'} for every thread of the project?`,
    }),
    confirmLabel: 'Use for all threads',
    presentation: { running: 'Using a thread’s team for the project', done: 'Used a thread’s team for the project' },
  }),
};
