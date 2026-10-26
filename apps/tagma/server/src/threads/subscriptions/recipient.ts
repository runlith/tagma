import { Effect } from 'effect';
import { THREAD_EVENT_KINDS, THREAD_EVENT_SIGNAL_TYPE, WAKING_THREAD_EVENTS, type ThreadEventKind } from '@runlith/agent/contracts';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadLookup } from '../contract/service/reads.js';
import type { ThreadSubscriptions } from '../contract/service/subscriptions.js';
import type { SubscribedEvent, ThreadEvent, ThreadEventRecipient } from '../events/happened.js';
import type { EventReads } from '../events/reads.js';
import { stateLines, type EventLines } from './delivery.js';
import { eventLine } from './lines.js';

export const SUBSCRIPTIONS_RECIPIENT = 'thread subscriptions';

const subscribed = (event: ThreadEvent): event is SubscribedEvent => (THREAD_EVENT_KINDS as readonly string[]).includes(event.kind);

const waking = (kind: ThreadEventKind) => (WAKING_THREAD_EVENTS as readonly ThreadEventKind[]).includes(kind);

const keyOf = (event: SubscribedEvent): string => {
  switch (event.kind) {
    case 'rested':
    case 'failed':
    case 'stopped':
    case 'addresses-human':
      return event.run.runId;
    case 'stalled':
      return `${event.stalled.id}:${event.stalled.runId}:${event.stalled.since}`;
    case 'awaiting':
      return event.eventId;
    case 'committed':
      return event.commit;
    case 'task-closed':
      return event.id;
  }
};

export const makeSubscriptionRecipient = ({
  subscriptions,
  threads,
  lines,
  reads,
}: {
  readonly subscriptions: ThreadSubscriptions['Service'];
  readonly threads: ThreadLookup['Service'];
  readonly lines: EventLines;
  readonly reads: EventReads;
}): ThreadEventRecipient => ({
  name: SUBSCRIPTIONS_RECIPIENT,
  takes: THREAD_EVENT_KINDS,
  follows: (thread) =>
    subscriptions.subscribersOf(thread.id).pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.mapError((cause) => new ThreadCallBroke({ cause })),
    ),
  handle: Effect.fn('ThreadSubscriptions.told')(
    function* (event: ThreadEvent) {
      if (!subscribed(event)) return;
      const target = event.thread;
      for (const subscription of yield* subscriptions.subscribersOf(target.id)) {
        const subscriber = yield* threads.summary(subscription.subscriberId);
        if (subscriber === undefined || subscriber.archivedAt !== null) continue;
        const byOperator = event.kind === 'rested' && event.byOperator;
        const answered = event.kind === 'rested' && (yield* reads.answered(subscriber.id, target.id, event.run.runId));
        const wakes =
          !byOperator && !answered && waking(event.kind) && (subscription.wakes as readonly ThreadEventKind[]).includes(event.kind);
        yield* lines({
          subscriberId: subscriber.id,
          about: target.id,
          type: THREAD_EVENT_SIGNAL_TYPE,
          key: `${subscriber.id}:${event.kind}:${keyOf(event)}`,
          text: eventLine(event, answered),
          notice: {
            kind: 'thread-event',
            thread: { threadId: target.id, projectId: target.projectId, name: target.name },
            event: event.kind,
            wakes,
            forOperator: byOperator,
          },
          wakes,
          replaces: stateLines(target.id),
        });
      }
    },
    Effect.mapError((cause) => new ThreadCallBroke({ cause })),
  ),
});
