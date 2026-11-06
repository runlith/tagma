import type { McpResourceEvent } from '@tagma/server/mcp/contract/wire/feeds';
import type { Stream } from 'effect';
import type { LiveConnection, ServerClient } from '$lib/wire/Live.js';
import type { LiveError } from '$lib/wire/liveFailure.js';
import type { ViewHost, ViewSubscription } from './ViewBridge.js';

type ResourceFeed = (uri: string) => (client: ServerClient) => Stream.Stream<McpResourceEvent, LiveError>;

export const resourceSubscription =
  (live: LiveConnection, feed: ResourceFeed): NonNullable<ViewHost['subscribe']> =>
  (uri: string, { updated, ended, signal }: ViewSubscription): Promise<() => void> =>
    new Promise((resolve, reject) => {
      let acquired = false;
      const fail = (failure: string) => {
        held.unsubscribe();
        if (acquired) ended();
        else reject(new Error(failure));
        acquired = true;
      };
      const held = live.hold(
        feed(uri),
        (event) => {
          if (event.kind === 'updated') {
            updated({ uri: event.uri, _meta: event._meta });
            return;
          }
          if (acquired) {
            updated({ uri });
            return;
          }
          acquired = true;
          resolve(() => held.unsubscribe());
        },
        (failure) => {
          if (failure.kind === 'subscription') fail(failure.message);
        },
      );
      if (signal.aborted) fail('the view was torn down');
      else signal.addEventListener('abort', () => !acquired && fail('the view was torn down'), { once: true });
    });
