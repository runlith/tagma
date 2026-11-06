import { Clock, Effect } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { ShelfAsk, ShelfMessage, ShelfRequest, ShelfJobs, ShelfJob } from './protocol.js';
import { VersionedShelf } from './storage.js';

declare const self: Worker;

let shelf: VersionedShelf | undefined;

const execute = (store: VersionedShelf, request: ShelfRequest): ShelfJobs[ShelfJob]['output'] => {
  switch (request.kind) {
    case 'publish':
      return store.publish(request.input, () => Effect.runSync(Clock.currentTimeMillis));
    case 'remove':
      return store.remove(request.input);
    case 'draft':
      return store.draft(request.input);
    case 'list':
      return store.list(request.input);
    case 'page':
      return store.page(request.input.id, request.input.version);
    case 'versions':
      return store.versions(request.input);
    case 'state':
      return store.state(request.input);
    case 'videos':
      return store.videos(request.input);
    case 'pages':
      return store.pages(request.input.threads, request.input.limit);
    case 'follow':
      return store.follow(request.input.id, request.input.threads, request.input.limit);
    case 'unfollow':
      return store.unfollow(request.input);
    case 'maintain':
      return store.maintain();
  }
};

self.addEventListener('message', (event: MessageEvent<ShelfAsk>) => {
  const { id, root, origin, request } = event.data;
  try {
    shelf ??= new VersionedShelf(root, origin);
    self.postMessage({ id, kind: 'done', value: execute(shelf, request) } satisfies ShelfMessage);
  } catch (failure) {
    self.postMessage(
      failure instanceof GateRefusal
        ? ({
            id,
            kind: 'refused',
            refusal: { code: failure.code, reason: failure.reason, unblock: failure.unblock },
          } satisfies ShelfMessage)
        : ({
            id,
            kind: 'failed',
            reason: failure instanceof Error ? (failure.stack ?? failure.message) : String(failure),
          } satisfies ShelfMessage),
    );
  }
});
self.postMessage({ kind: 'ready' } satisfies ShelfMessage);
