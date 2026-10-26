import { Schema } from 'effect';
import { feedPositionSchema } from '@runlith/agent/protocol/http';
import {
  threadAuthoritySchema,
  threadQuestionAnswerSchema,
  threadSaidResultSchema,
  threadSendSchema,
  threadSteerSchema,
  threadStopResultSchema,
  threadStopSchema,
  threadTurnResultSchema,
  threadUnqueueResultSchema,
  threadUnqueueSchema,
} from '@runlith/agent/protocol/realtime';
import { feed, feedPlaceSchema } from '../../../platform/contract/wire/operation.js';
import { attentionFeedEventSchema } from './attention.js';
import { threadsFeedEventSchema } from './list.js';
import { PRESENCE_FEED } from './presence.js';
import { threadWireFeedEventSchema, threadWireSnapshotPayloadSchema } from './snapshot.js';

export const THREAD_AIM = {
  projectId: Schema.Int.check(Schema.isGreaterThan(0)),
  threadId: Schema.String.check(Schema.isMinLength(1)),
} as const;

const TURN_REFUSALS = ['not-found', 'foreign-project', 'thread-gone', 'run-active', 'unknown-project'] as const;

const KEYED_REFUSALS = [...TURN_REFUSALS, 'key-reused', 'act-spent', 'sequence-unavailable'] as const;

export const THREAD_FEED = feed('thread.subscribe', {
  graph: 'none',
  input: Schema.Struct({ ...THREAD_AIM, since: Schema.optional(feedPositionSchema) }),
  event: threadWireFeedEventSchema,
  place: feedPlaceSchema,
  refusals: ['not-found', 'foreign-project', 'thread-gone', 'unknown-project'],
  callers: 'operator',
});

export const THREADS_FEED = feed('threads.subscribe', {
  graph: 'none',
  input: Schema.Struct({ projectId: THREAD_AIM.projectId }),
  event: threadsFeedEventSchema,
  refusals: ['not-found', 'unknown-project'],
  callers: 'operator',
});

export const ATTENTION_FEED = feed('attention.subscribe', {
  graph: 'none',
  input: Schema.Struct({}),
  event: attentionFeedEventSchema,
  refusals: [],
  callers: 'operator',
});

export const pulseCountsSchema = Schema.Struct({
  working: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  awaiting: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type PulseCounts = typeof pulseCountsSchema.Type;

const projectPulseFields = { projectId: THREAD_AIM.projectId, ...pulseCountsSchema.fields };

export const PULSE_FEED = feed('threads.pulse', {
  graph: 'none',
  input: Schema.Struct({}),
  event: Schema.Union([
    Schema.Struct({ type: Schema.Literal('all'), projects: Schema.Array(Schema.Struct(projectPulseFields)) }),
    Schema.Struct({ type: Schema.Literal('changed'), ...projectPulseFields }),
  ]),
  refusals: [],
  callers: 'operator',
});

export type PulseFeedEvent = typeof PULSE_FEED.event.Type;

const act = <
  const Id extends string,
  Params extends Schema.Codec<any, unknown, never, never>,
  Result extends Schema.Codec<any, unknown, never, never>,
>(
  id: Id,
  performs: string,
  params: Params,
  event: Result,
  refusals: readonly string[] = TURN_REFUSALS,
) =>
  feed(id, {
    graph: 'none',
    input: Schema.Struct({ ...THREAD_AIM, params }),
    event,
    refusals,
    callers: 'operator',
    stream: false,
    performs,
  });

export const THREAD_SEND = act('thread.send', 'start_turn', threadSendSchema, threadSaidResultSchema, KEYED_REFUSALS);
export const THREAD_QUEUE = act('thread.queue', 'queue_turn', threadSendSchema, threadSaidResultSchema, KEYED_REFUSALS);
export const THREAD_STEER = act('thread.steer', 'steer_turn', threadSteerSchema, threadSaidResultSchema, KEYED_REFUSALS);
export const THREAD_UNQUEUE = act('thread.unqueue', 'unqueue_turn', threadUnqueueSchema, threadUnqueueResultSchema);
export const THREAD_ANSWER = act('thread.answer', 'answer_question', threadQuestionAnswerSchema, threadTurnResultSchema, KEYED_REFUSALS);
export const THREAD_STOP = act('thread.stop', 'stop_run', threadStopSchema, threadStopResultSchema);
export const THREAD_AUTHORITY = act('thread.authority', 'set_thread_authority', threadAuthoritySchema, threadWireSnapshotPayloadSchema);

export const THREAD_CONTINUE = feed('thread.continue', {
  graph: 'none',
  input: Schema.Struct(THREAD_AIM),
  event: threadTurnResultSchema,
  refusals: [...TURN_REFUSALS, 'run-not-interrupted'],
  callers: 'operator',
  stream: false,
  performs: 'continue_thread',
});

export const THREAD_FEEDS = [
  THREAD_FEED,
  THREADS_FEED,
  PRESENCE_FEED,
  ATTENTION_FEED,
  PULSE_FEED,
  THREAD_SEND,
  THREAD_QUEUE,
  THREAD_STEER,
  THREAD_UNQUEUE,
  THREAD_ANSWER,
  THREAD_STOP,
  THREAD_AUTHORITY,
  THREAD_CONTINUE,
] as const;
