import { Schema } from 'effect';
import { threadInput } from '../project.js';
import { type Actor, signerPrincipal } from '../../../../platform/contract/wire/actor.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import { threadAgentSubject } from '@runlith/agent/permissions/threadSubject';

const subject = (kind: 'read' | 'write', address: string, actor: Actor) =>
  actor.kind === 'operator' ? [] : [{ kind, value: threadAgentSubject(signerPrincipal(actor), address) }];

const threadAt = { threadId: Schema.String };

export const APPROVER_OPERATIONS = {
  set_thread_approves: operation('set_thread_approves', {
    approval: ASKS_NEVER,
    doors: { socket: true, http: true },
    tool: undefined,
    callers: 'operator',
    place: 'project',
    graph: 'none',
    subject: 'none',
    waits: [],
    lifetimes: [],
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({
      set: {
        ...threadAt,
        own: Schema.NullOr(Schema.Array(Schema.String)),
        approves: Schema.Array(Schema.String),
        origin: Schema.Literals(['own', 'lineage', 'setting']),
        setAt: Schema.NullOr(Schema.String),
      },
    }),
    meaning:
      'Narrow which questions of its children a thread answers instead of the operator, for it and the team below it. Absent an own list the nearest list up its lineage decides, else the `agent.approves` setting, `*` by default.',
    grammar:
      '`*` covers every question, approvals and ask_user alike; an action name (`delete_thread`, `bash`) every question of that action; a condition id (`outside-subtree`) that reason on any action. A question the list does not cover goes to the operator. `null` hands the thread back to what it inherits; an empty list sends every question here and below to the operator.',
    input: Schema.Struct({
      threadId: ThreadId,
      approves: Schema.NullOr(Schema.Array(Schema.String)).annotate({
        description: 'What this thread answers for its children: `*`, actions and condition ids; null — inherit; [] — nothing.',
      }),
    }),
    refusals: ['not-found', 'foreign-project'],
    subjects: (input, _prepared, actor) => subject('write', input.threadId, actor),
    confirmation: (input) => ({ summary: `Change what ${input.threadId} answers for its children?` }),
    confirmLabel: 'Set',
    presentation: { running: 'Setting what a thread answers for its children', done: 'Set what a thread answers for its children' },
  }),
  set_thread_approver: operation('set_thread_approver', {
    approval: ASKS_NEVER,
    doors: { socket: true, http: true },
    tool: undefined,
    callers: 'operator',
    place: 'project',
    graph: 'none',
    subject: 'none',
    waits: [],
    lifetimes: [],
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ set: { ...threadAt, approver: Schema.Literals(['you', 'default']) } }),
    meaning:
      "Make the operator the approver of one thread's questions (`you`), or hand them back to its parent (`default`). Writing to a sub-agent does the first by itself while `agent.takeover` is on.",
    input: Schema.Struct({ threadId: ThreadId, approver: Schema.Literals(['you', 'default']) }),
    refusals: ['not-found', 'foreign-project'],
    subjects: (input, _prepared, actor) => subject('write', input.threadId, actor),
    confirmation: (input) => ({
      summary: `Make ${input.approver === 'you' ? 'yourself' : 'the default route'} the approver of ${input.threadId}?`,
    }),
    confirmLabel: 'Set',
    presentation: { running: 'Setting an approver', done: 'Set an approver' },
  }),
};
