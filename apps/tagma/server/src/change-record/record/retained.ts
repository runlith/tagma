import { Clock, Effect } from 'effect';
import { and, inArray, isNull } from 'drizzle-orm';
import { chunk, unique } from '@runlith/utils/collection';
import type { Git } from '@runlith/git/Git';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { OPERATOR, holderKey } from '../../workspace/contract/wire/checkout.js';
import type { CommandSession } from '../contract/service/commands.js';
import { standingAmong } from '../prepared/eligible.js';
import type { CommandWrites } from './commands.js';
import type { StoreShape } from './places.js';

const OPERATOR_KEY = holderKey(OPERATOR);

const THREADS_PER_STATEMENT = rowsPerStatement(1);

const living = (
  units: MachineUnits['Service'],
  store: StoreShape,
  threads: readonly string[],
): Effect.Effect<ReadonlySet<string>, StoreFailure> =>
  Effect.map(
    Effect.forEach(chunk(unique(threads), THREADS_PER_STATEMENT), (ids) =>
      units.read((unit) =>
        unit.run(
          store.db
            .select({ id: threadRecord.id, projectId: threadRecord.projectId })
            .from(threadRecord)
            .where(and(inArray(threadRecord.id, ids), isNull(threadRecord.archivedAt))),
        ),
      ),
    ),
    (groups) => new Set(groups.flat().map((row) => `${row.projectId}\0${row.id}`)),
  );

export const sweepRetained = Effect.fn('ChangeRecord.sweepRetained')(function* (
  commands: CommandWrites,
  units: MachineUnits['Service'],
  store: StoreShape,
  git: Git['Service'],
  root: string,
  checkout: string,
): Effect.fn.Return<void, StoreFailure> {
  const before = yield* Clock.currentTimeMillis;
  const entries = commands.unattributedUnder(checkout, '');
  if (entries.length === 0) return;
  const sessions = new Map<string, CommandSession>();
  for (const one of entries) sessions.set(`${one.projectId}\0${one.threadId}`, { projectId: one.projectId, threadId: one.threadId });
  const alive = yield* living(
    units,
    store,
    [...sessions.values()].map((session) => session.threadId),
  );
  const ended = [...sessions].flatMap(([key, session]) => (session.threadId === OPERATOR_KEY || alive.has(key) ? [] : [session]));
  commands.retire(ended);
  const retired = new Set(ended.map((session) => `${session.projectId}\0${session.threadId}`));
  const paths = unique(entries.filter((one) => !retired.has(`${one.projectId}\0${one.threadId}`)).map((one) => one.path));
  if (paths.length === 0) return;
  commands.sweep(checkout, (yield* standingAmong(git, root, paths)).clean, before);
});
