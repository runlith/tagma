import { Context, type Stream } from 'effect';
import type { RefusalBody } from '../../../platform/contract/wire/refusal.js';
import type { ATTENTION_FEED, PULSE_FEED, THREAD_FEED, THREADS_FEED } from '../wire/feeds.js';
import type { PRESENCE_FEED } from '../wire/presence.js';

export class ThreadFeeds extends Context.Service<
  ThreadFeeds,
  {
    readonly 'attention.subscribe': (input: typeof ATTENTION_FEED.input.Type) => Stream.Stream<typeof ATTENTION_FEED.event.Type>;
    readonly 'threads.pulse': (input: typeof PULSE_FEED.input.Type) => Stream.Stream<typeof PULSE_FEED.event.Type>;
    readonly 'threads.subscribe': (input: typeof THREADS_FEED.input.Type) => Stream.Stream<typeof THREADS_FEED.event.Type, RefusalBody>;
    readonly 'threads.presence': (input: typeof PRESENCE_FEED.input.Type) => Stream.Stream<typeof PRESENCE_FEED.event.Type, RefusalBody>;
    readonly 'thread.subscribe': (input: typeof THREAD_FEED.input.Type) => Stream.Stream<typeof THREAD_FEED.event.Type, RefusalBody>;
  }
>()('tagma/threads/ThreadFeeds') {}
