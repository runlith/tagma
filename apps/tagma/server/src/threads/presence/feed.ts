import { Effect, Stream } from 'effect';
import { WIRE_PAGE_MAX_ENTRIES } from '@runlith/agent/protocol/cap';
import { refusing } from '../../platform/contract/service/body.js';
import type { RefusalBody } from '../../platform/contract/wire/refusal.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import type { PRESENCE_FEED, PresenceEvent, PresenceTailStep } from '../contract/wire/presence.js';
import { harnessRefusal } from '../refusals.js';
import { snapshotFeed } from '../list/snapshotFeed.js';
import type { Listener, Opens, PresenceNotice } from './watches.js';

const asking = <A, R>(work: Effect.Effect<A, HarnessFailure, R>) => refusing(harnessRefusal(work));

type QueuedTail = { readonly kind: 'tail'; readonly threadId: string; revision: number; tail: PresenceTailStep | null };

export const presenceFeed =
  (watches: Opens) =>
  ({ projectId, threadIds }: typeof PRESENCE_FEED.input.Type): Stream.Stream<PresenceEvent, RefusalBody> =>
    Stream.suspend(() => {
      const opening = watches.open(projectId, threadIds);
      const queued = new Map<string, QueuedTail>();
      const subscribe = (listener: Listener) =>
        opening.subscribe((notice) => {
          if (notice.kind === 'failed') return listener(notice);
          if (notice.kind !== 'tail') {
            queued.delete(notice.threadId);
            return listener(notice);
          }
          const waiting = queued.get(notice.threadId);
          if (waiting === undefined) {
            const fresh: QueuedTail = { ...notice };
            queued.set(notice.threadId, fresh);
            return listener(fresh);
          }
          const whole = opening.tailOf(notice.threadId);
          waiting.revision = notice.revision;
          waiting.tail = whole === null ? null : { restart: true, ...whole };
        });
      return snapshotFeed(
        subscribe,
        () => {
          queued.clear();
          return Effect.map(asking(opening.snapshot()), ({ entries, covered }) => ({
            value: { type: 'initial', entries } satisfies PresenceEvent,
            covered,
          }));
        },
        (notice: PresenceNotice): Effect.Effect<PresenceEvent, RefusalBody> => {
          switch (notice.kind) {
            case 'changed':
              return Effect.succeed({ type: 'changed', threadId: notice.threadId, revision: notice.revision, fields: notice.fields });
            case 'tail':
              if (queued.get(notice.threadId) === notice) queued.delete(notice.threadId);
              return Effect.succeed({ type: 'tail', threadId: notice.threadId, revision: notice.revision, tail: notice.tail });
            case 'missing':
              return Effect.succeed({ type: 'missing', threadId: notice.threadId, reason: 'deleted' });
            case 'failed':
              return asking(Effect.fail(notice.failure));
          }
        },
        WIRE_PAGE_MAX_ENTRIES,
      );
    });
