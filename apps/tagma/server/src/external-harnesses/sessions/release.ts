import { Effect } from 'effect';
import type { TransportRegistry } from '@runlith/agent/thread/transport/contract';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessSessionStore } from '../store/sessions.js';

const STOP_ELSEWHERE = [
  'read this session’s execution in the project’s terminal inventory and stop it there',
  'set_thread_transport again once it ended',
] as const;

export const releaseResource = (store: HarnessSessionStore, transports: TransportRegistry) =>
  Effect.fnUntraced(function* (threadId: string) {
    const binding = yield* store.binding(threadId);
    if (binding === undefined) return 'not-running' as const;
    const transport = yield* transports.of(binding).pipe(
      Effect.catchTags({
        TransportUnread: () =>
          Effect.fail(
            new GateRefusal(
              'session-uncertain',
              `Thread ${threadId} holds a CLI process, and its stored transport did not read, so Tagma cannot tell which transport to stop it through.`,
              STOP_ELSEWHERE,
            ),
          ),
        TransportUnregistered: (unregistered) =>
          Effect.fail(
            new GateRefusal(
              'session-uncertain',
              `Thread ${threadId} holds a CLI process on ${unregistered.adapter}, which no transport of this server serves, so Tagma cannot stop it.`,
              STOP_ELSEWHERE,
            ),
          ),
      }),
    );
    return transport.resource === undefined ? ('not-running' as const) : yield* transport.resource.release(threadId);
  });
