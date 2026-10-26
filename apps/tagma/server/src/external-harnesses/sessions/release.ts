import { Effect } from 'effect';
import type { TransportRegistry } from '@runlith/agent/thread/transport/contract';
import type { HarnessSessionStore } from '../store/sessions.js';

export const releaseResource = (store: HarnessSessionStore, transports: TransportRegistry) =>
  Effect.fnUntraced(function* (threadId: string) {
    const binding = yield* store.binding(threadId);
    if (binding === undefined) return 'not-running' as const;
    const transport = yield* Effect.orDie(transports.of(binding));
    return transport.resource === undefined ? ('not-running' as const) : yield* transport.resource.release(threadId);
  });
