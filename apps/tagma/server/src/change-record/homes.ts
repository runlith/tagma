import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import type { HomeFollowing } from '../thread-record/contract/service/homes.js';
import { commandUnattributed, commandWindow } from './store/commandTables.js';
import { workspaceChange } from './store/tables.js';

export const changeHomes: HomeFollowing = {
  tables: [workspaceChange, commandWindow, commandUnattributed],
  follow: Effect.fn('ChangeRecord.followHome')(function* (unit, move) {
    const { db } = yield* MachineStore;
    yield* unit.run(
      db
        .update(workspaceChange)
        .set({ holderProjectId: move.to })
        .where(and(eq(workspaceChange.holder, move.threadId), eq(workspaceChange.holderProjectId, move.from))),
    );
    yield* unit.run(
      db
        .update(commandWindow)
        .set({ projectId: move.to })
        .where(and(eq(commandWindow.threadId, move.threadId), eq(commandWindow.projectId, move.from))),
    );
    yield* unit.run(
      db
        .update(commandUnattributed)
        .set({ projectId: move.to })
        .where(and(eq(commandUnattributed.threadId, move.threadId), eq(commandUnattributed.projectId, move.from))),
    );
  }),
};
