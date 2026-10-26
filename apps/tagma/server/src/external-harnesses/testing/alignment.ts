import { Effect } from 'effect';
import { writes } from '../../platform/contract/service/writes.js';
import type { AlignAnswer, SessionAlignment } from '../sessions/alignment.js';
import type { HarnessSessionStore } from '../store/sessions.js';

export const standingAlignment = (store: HarnessSessionStore): SessionAlignment => ({
  writes: writes('testing.alignment', []),
  align: (threadId) =>
    Effect.map(store.read(threadId), (facet): AlignAnswer => (facet === null ? { _tag: 'Gone' } : { _tag: 'Aligned', facet })),
  due: () => Effect.succeed(false),
  taken: () => Effect.void,
  bound: (_unit, _threadId, facet) => Effect.succeed(facet),
});
