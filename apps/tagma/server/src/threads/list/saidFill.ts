import { Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ThreadList } from '../contract/service/list.js';
import { threadRun } from '../store/kernel.js';
import { saidOfShown, unsaidThreads } from './said.js';

const PORTION_MS = 25;

const filling = writes('thread.said.fill', [threadRun]);

export const fillSaid = Effect.fn('ThreadList.said.fill')(function* (
  db: StoreDb<'machine'>,
  units: MachineUnits['Service'],
  list: ThreadList['Service'],
): Effect.fn.Return<number, StoreFailure> {
  const threads = yield* units.read((unit) => unit.run(unsaidThreads(db)));
  for (const { id } of threads) {
    const started = performance.now();
    const filled = yield* units.write(
      filling,
      Effect.fnUntraced(function* (unit) {
        if ((yield* unit.run(unsaidThreads(db, id))).length === 0) return false;
        yield* unit.run(saidOfShown(db, id));
        return true;
      }),
    );
    const heldMs = performance.now() - started;
    if (filled) yield* list.announceThread(id);
    yield* Effect.sleep(Math.max(PORTION_MS, heldMs));
  }
  return threads.length;
});
