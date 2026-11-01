import { type Context, Effect } from 'effect';
import type { WordsWait } from '../../transcript/live';
import type { ThreadMetadataRow } from '../rows';
import type { ThreadBorderFailed } from '../ThreadBorder';
import type { ThreadResting, ThreadTx } from '../ThreadPorts';
import type { Transports } from '../transport/Transports';
import type { LaunchGate } from './LaunchGate';
import type { WordsInFlight } from './WordsInFlight';

export type WordsWaitOwners = {
  readonly resting: Context.Service.Shape<typeof ThreadResting>;
  readonly gate: Context.Service.Shape<typeof LaunchGate>;
  readonly inflight: Context.Service.Shape<typeof WordsInFlight>;
};

export const idleWaitOf = (
  owners: WordsWaitOwners,
  threadId: string,
  after: string | null,
  tx?: ThreadTx,
): Effect.Effect<WordsWait | null, ThreadBorderFailed> =>
  Effect.map(owners.resting === null ? Effect.succeed(false) : owners.resting.resting(threadId, tx), (archived): WordsWait | null => {
    if (archived) return 'archived';
    if (owners.gate.blocked(threadId)) return 'launch-refused';
    return after !== null && owners.inflight.live(after) ? 'words-unsettled' : null;
  });

export const wordsWaitOf = (
  owners: WordsWaitOwners,
  transports: Context.Service.Shape<typeof Transports>,
  thread: ThreadMetadataRow,
  standing: { readonly active: boolean; readonly after: string | null },
  tx?: ThreadTx,
): Effect.Effect<WordsWait | null, ThreadBorderFailed> =>
  transports.of(thread.transport).pipe(
    Effect.map((transport): WordsWait | null => transport.runs.wordsWait?.(thread.id) ?? null),
    Effect.catchTag('TransportUnregistered', () => Effect.succeed(null)),
    Effect.flatMap((declared) =>
      declared !== null || standing.active ? Effect.succeed(declared) : idleWaitOf(owners, thread.id, standing.after, tx),
    ),
  );
