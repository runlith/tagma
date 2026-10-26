import { Schema } from 'effect';
import { family, PAGE_CURSOR } from '@runlith/paging';
import { WAKING_THREAD_EVENTS } from '@runlith/agent/contracts';
import { runLifeSchema } from '@runlith/agent/protocol/http';
import { AgentAddress, ThreadWakes } from '@runlith/agent/collaboration/collaborationVerbs';
import { recipientsTitle } from '@runlith/agent/collaboration/label';
import { threadAgentSubject } from '@runlith/agent/permissions/threadSubject';
import { signerPrincipal, type Actor } from '../../../../platform/contract/wire/actor.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { ceilingOf, limitOf } from '../../../../platform/contract/wire/pageFamily.js';
import { SAID_LINE_CHARS } from '../list.js';

const verb = {
  doors: { http: true },
  tool: { capability: 'peers' },
  callers: 'thread',
  subject: 'none',
  place: 'machine',
  graph: 'none',
  waits: [],
  lifetimes: [],
} as const;

const agent = (kind: 'read' | 'write', address: string, actor: Actor) =>
  actor.kind === 'operator' ? [] : [{ kind, value: threadAgentSubject(signerPrincipal(actor), address) }];

const Followed = Schema.Struct({
  threadId: Schema.String,
  projectId: Schema.optional(Schema.Int),
  name: Schema.NullOr(Schema.String),
});

export const threadNowSchema = Schema.Struct({
  title: Schema.String,
  life: runLifeSchema.annotate({ description: 'working, awaiting an answer, stalled without movement, or idle with no run going.' }),
  asks: Schema.NullOr(Schema.String).annotate({ description: 'The question the thread waits on.' }),
  failed: Schema.NullOr(Schema.String).annotate({ description: 'Why its last run failed or was cut, while no run goes.' }),
  movedAt: Schema.String.annotate({ description: 'When the thread last moved.' }),
  said: Schema.NullOr(Schema.String).annotate({ description: 'The last line it said.' }),
});
export type ThreadNow = typeof threadNowSchema.Type;

const Subscribed = Schema.Struct({
  ...Followed.fields,
  wakes: Schema.Array(Schema.Literals(WAKING_THREAD_EVENTS)),
  now: Schema.NullOr(threadNowSchema),
});

const ADDRESSING_REFUSALS = ['no-calling-thread', 'thread-unknown', 'collaboration-refused'] as const;

const ID = '01a121d6-3d32-71e9-bb7e-606acf893aa6';

const LINE = '語'.repeat(SAID_LINE_CHARS);

export const SUBSCRIPTIONS = family('subscriptions', 1, 'json', { text: 1700, json: 1700 }, 20, () => ({
  threadId: ID,
  projectId: Number.MAX_SAFE_INTEGER,
  name: '語'.repeat(64),
  wakes: WAKING_THREAD_EVENTS,
  now: { title: '語'.repeat(64), life: 'awaiting', asks: LINE, failed: null, movedAt: '2026-10-22T16:37:29.774Z', said: LINE },
  since: '2026-10-22T16:37:29.774Z',
}));

const BATCH = ceilingOf(SUBSCRIPTIONS);

const Threads = Schema.Array(AgentAddress)
  .check(Schema.isMinLength(1), Schema.isMaxLength(BATCH))
  .annotate({
    description: `The threads, always a list of at most ${BATCH}: a name inside your team or a thread id, as send_message addresses them.`,
  });

export const SUBSCRIPTION_OPERATIONS = {
  subscribe_threads: operation('subscribe_threads', {
    ...verb,
    approval: ASKS_IN_REVIEW,
    effect: 'write',
    identity: { key: 'call' },
    meaning:
      'Subscribe to threads you can address: each of their events — rested, failed, stalled, awaiting the operator, addressing a human, stopped, committed, task closed — reaches you as a short line at your next step. ' +
      'An idle subscriber is woken only by the kinds in `wakes`. Subscribing again to a thread replaces its `wakes`. A subscription ends with unsubscribe_threads, or when either thread is archived or deleted. ' +
      'Each thread answers with `now`, where it stands at this moment: a thread already at rest sends no event until it moves again.',
    input: Schema.Struct({ threads: Threads, wakes: Schema.optional(ThreadWakes) }),
    answer: arms({ subscribed: { threads: Schema.Array(Subscribed) } }),
    refusals: [...ADDRESSING_REFUSALS, 'subscribe-self'],
    subjects: (input, _prepared, actor) => input.threads.flatMap((address) => agent('write', address, actor)),
    confirmation: (input) => ({ summary: `Follow the events of ${recipientsTitle(input.threads)}?` }),
    confirmLabel: 'Subscribe',
    presentation: { running: 'Subscribing to threads', done: 'Subscribed to threads' },
  }),
  unsubscribe_threads: operation('unsubscribe_threads', {
    ...verb,
    approval: ASKS_IN_REVIEW,
    effect: 'write',
    identity: { key: 'call' },
    meaning:
      'End your subscriptions to threads, addressed as subscribe_threads takes them. `unsubscribed` names the subscriptions ended, `unheld` the threads you were not subscribed to.',
    input: Schema.Struct({ threads: Threads }),
    answer: arms({ unsubscribed: { unsubscribed: Schema.Array(Followed), unheld: Schema.Array(Followed) } }),
    refusals: ADDRESSING_REFUSALS,
    subjects: (input, _prepared, actor) => input.threads.flatMap((address) => agent('write', address, actor)),
    confirmation: (input) => ({ summary: `Stop following ${recipientsTitle(input.threads)}?` }),
    confirmLabel: 'Unsubscribe',
    presentation: { running: 'Unsubscribing from threads', done: 'Unsubscribed from threads' },
  }),
  read_subscriptions: operation('read_subscriptions', {
    ...verb,
    approval: ASKS_NEVER,
    effect: 'read',
    identity: 'none',
    meaning:
      'The threads you are subscribed to, oldest subscription first, each with the events that wake you, where it stands now and when you subscribed. The page carries the total and the cursor that continues it.',
    input: Schema.Struct({ limit: limitOf(SUBSCRIPTIONS), cursor: PAGE_CURSOR }),
    answer: arms({
      read: {
        threads: Schema.Array(Schema.Struct({ ...Subscribed.fields, since: Schema.String })),
        total: Schema.Int,
        cursor: Schema.NullOr(Schema.String),
      },
    }),
    refusals: ['no-calling-thread', 'bad-cursor', 'cursor-stale', 'collaboration-refused'],
    subjects: (_input, _prepared, actor) => agent('read', '*', actor),
    confirmation: () => ({ summary: 'Read the threads you follow?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading subscriptions', done: 'Read subscriptions' },
  }),
};

export type SubscriptionOperationId = keyof typeof SUBSCRIPTION_OPERATIONS;
