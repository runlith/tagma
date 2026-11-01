import { Context, Effect, Layer } from 'effect';
import { WIRE_PAGE_MAX_BYTES, WIRE_PAGE_MAX_ENTRIES } from '@runlith/agent/protocol/cap';
import { presenceFeed } from '../presence/feed.js';
import { makePresenceWatches } from '../presence/watches.js';
import { snapshotFeed } from './snapshotFeed.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import { CacheWarmth, EvidenceFeed, ThreadEvidence } from '../contract/service/evidence.js';
import { ThreadFeeds } from '../contract/service/feeds.js';
import { ThreadList, type ThreadsEvent } from '../contract/service/list.js';
import type { NativeThreadState } from '../contract/service/state.js';
import type { ThreadWireFeedEvent } from '../contract/wire/snapshot.js';
import type { ThreadsFeedEvent } from '../contract/wire/list.js';
import type { ThreadLiveEvent } from '@runlith/agent/thread/run/ThreadLiveFeed';
import type { FeedPosition } from '@runlith/agent/transcript/live';
import { type BasisServices, basisOf, frameBasis, rowThreads, stateThreads } from './basis.js';
import { ContextLimits } from '../contract/service/limits.js';
import { wireOpenEvent, wireResumeEvent, wireSnapshotEvent, wireStateEvent, wireThread, wireThreadListWindow } from './wire.js';
import { harnessRefusal } from '../refusals.js';
import { refusing } from '../../platform/contract/service/body.js';
import { ThreadFolders } from '../../thread-record/contract/service/folders.js';
import { ProjectChanges } from '../../projects/contract/service/changes.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { attentionChanges, attentionFeed } from './attentionFeed.js';
import { Attention } from '../contract/service/attention.js';
import { ATTENTION_FEED_ROWS } from '../contract/wire/attention.js';
import { pulseFeed } from './pulseFeed.js';

type Thread = { readonly projectId: number; readonly threadId: string };

const THREAD_FEED_QUEUE_BYTES = 4 * WIRE_PAGE_MAX_BYTES;

const asking = <A, R>(work: Effect.Effect<A, HarnessFailure, R>) => refusing(harnessRefusal(work));

export type FeedServices = {
  readonly list: ThreadList['Service'];
  readonly folders: ThreadFolders['Service'];
  readonly evidence: ThreadEvidence['Service'];
  readonly feed: EvidenceFeed['Service'];
  readonly basis: BasisServices;
};

export const threadFeeds = ({ list, folders, evidence, feed, basis: services }: FeedServices) => ({
  'threads.subscribe': ({ projectId }: { readonly projectId: number }) =>
    snapshotFeed(
      (listener: (event: ThreadsEvent) => void) => list.subscribe(projectId, listener),
      Effect.fn('ThreadFeeds.openList')(function* (first: boolean) {
        yield* Effect.annotateCurrentSpan({ project: projectId, openPath: first ? 'open' : 'overflow' });
        const window = yield* asking(list.openWindow(projectId));
        const value: ThreadsFeedEvent = {
          type: 'list',
          ...wireThreadListWindow(window, yield* asking(basisOf(services, rowThreads(window.rows)))),
          folders: yield* asking(folders.list(projectId)),
        };
        return { value, covered: () => false };
      }),
      (event): Effect.Effect<ThreadsFeedEvent> => {
        switch (event.kind) {
          case 'list':
            return Effect.map(frameBasis(services, rowThreads(event.rows)), (basis) => ({
              type: 'list',
              ...wireThreadListWindow(event, basis),
            }));
          case 'row':
            return Effect.map(frameBasis(services, rowThreads([event.row])), (basis) => ({
              type: 'row',
              row: wireThread(event.row, basis),
            }));
          case 'removed':
            return Effect.succeed({ type: 'removed', threadId: event.threadId });
          case 'folders':
            return Effect.succeed({ type: 'folders', folders: event.folders });
        }
      },
      WIRE_PAGE_MAX_ENTRIES,
    ),

  'thread.subscribe': ({ projectId, threadId, since }: Thread & { readonly since?: FeedPosition | undefined }) => {
    let delivered = since;
    let rewritten = false;
    return snapshotFeed(
      (listener: (event: ThreadLiveEvent<NativeThreadState>) => void) => feed.subscribe(threadId, listener),
      Effect.fn('ThreadFeeds.open')(function* (first: boolean) {
        yield* Effect.annotateCurrentSpan({ threadId, project: projectId });
        const from = rewritten ? undefined : delivered;
        rewritten = false;
        const value = yield* asking(openingFrame(evidence, services, threadId, projectId, from));
        yield* Effect.annotateCurrentSpan({ openPath: `${first ? 'open' : 'overflow'}:${value.type}` });
        delivered = value.at;
        const cut = value.at.seq;
        return { value, covered: (event: ThreadLiveEvent<NativeThreadState>) => event.at.seq <= cut };
      }),
      (event): Effect.Effect<ThreadWireFeedEvent> => {
        const epoch = delivered?.epoch;
        const position = Math.max(delivered?.position ?? 0, event.at.position);
        delivered = epoch === undefined ? { position, seq: event.at.seq } : { position, seq: event.at.seq, epoch };
        return event.type === 'open'
          ? Effect.succeed(wireOpenEvent(event))
          : Effect.map(frameBasis(services, stateThreads(event.frame.state, projectId)), (basis) => wireStateEvent(event, basis));
      },
      WIRE_PAGE_MAX_ENTRIES,
      { limit: THREAD_FEED_QUEUE_BYTES, weigh: (event) => event.weight },
      (event) => {
        if (event.type !== 'state' || event.frame.rewritten !== true) return false;
        rewritten = true;
        return true;
      },
    );
  },
});

export const threadFeedsLayer = Layer.effectContext(
  Effect.gen(function* () {
    const list = yield* ThreadList;
    const changes = attentionChanges(list, yield* Projects, yield* ProjectChanges, WIRE_PAGE_MAX_ENTRIES);
    const evidence = yield* ThreadEvidence;
    const feed = yield* EvidenceFeed;
    const watches = yield* makePresenceWatches;
    return Context.make(ThreadFeeds, {
      ...threadFeeds({
        list,
        folders: yield* ThreadFolders,
        evidence,
        feed,
        basis: { warmth: yield* CacheWarmth, limits: yield* ContextLimits },
      }),
      'threads.presence': presenceFeed(watches),
      'attention.subscribe': () => attentionFeed(changes, ATTENTION_FEED_ROWS),
      'threads.pulse': () => pulseFeed(list, WIRE_PAGE_MAX_ENTRIES),
    }).pipe(Context.add(Attention, { changes }));
  }),
);

const openingFrame = Effect.fnUntraced(function* (
  evidence: ThreadEvidence['Service'],
  services: BasisServices,
  threadId: string,
  projectId: number,
  since: FeedPosition | undefined,
) {
  if (since !== undefined) {
    const resumed = yield* evidence.attachFrom(threadId, projectId, since);
    if (resumed) return wireResumeEvent(resumed, since, yield* basisOf(services, stateThreads(resumed.state, projectId)));
  }
  const snapshot = yield* evidence.snapshot(threadId, projectId);
  return wireSnapshotEvent(snapshot, yield* basisOf(services, stateThreads(snapshot, projectId)));
});
