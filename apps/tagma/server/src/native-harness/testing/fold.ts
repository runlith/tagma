import { Clock, Effect } from 'effect';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import type { ThreadPortFailure } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadAtomicPatch } from '@runlith/agent/thread/storage/aggregate';
import type { ThreadHold } from '@runlith/agent/thread/transition/port';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import type { ThreadStore } from '../rows/threadRow.js';
import { makeTransitions } from '../runs/transitionStore.js';

export type ThreadFolder = <E>(
  id: string,
  work: (row: ThreadRow, tx: WriteUnit<'machine'>) => Effect.Effect<ThreadAtomicPatch | null, E>,
  tx?: WriteUnit<'machine'>,
) => Effect.Effect<ThreadRow | undefined, E | ThreadPortFailure>;

export const threadFolder = Effect.fnUntraced(function* (threads: ThreadStore) {
  const transitions = yield* makeTransitions({ threads });
  const folder: ThreadFolder = (id, work, tx) => {
    const held = Effect.fnUntraced(function* ({ version, tx: unit }: ThreadHold<WriteUnit<'machine'>>) {
      const row = yield* threads.find(id, unit);
      if (row === undefined) return undefined;
      const fold = yield* work(row, unit);
      if (fold !== null) {
        yield* transitions.writeFold(
          id,
          { fold, standing: version.head, head: version.head, at: new Date(yield* Clock.currentTimeMillis) },
          unit,
        );
      }
      return yield* threads.find(id, unit);
    });
    return tx === undefined ? transitions.writeAt(id, held) : transitions.writeAtIn(id, held, tx);
  };
  return folder;
});
