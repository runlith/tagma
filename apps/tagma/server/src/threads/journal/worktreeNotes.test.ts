import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { WorktreeEntry } from '../../worktrees/contract/wire/entries.js';
import type { WorktreeSetupStatus } from '../../worktrees/contract/wire/rows.js';
import { type WorktreeRecord, WorktreeRecords } from '../../worktrees/contract/service/worktrees.js';
import { makeWorktreeNotes } from './worktreeNotes.js';

const rootId = RootId.make('root-made');

it.live('a setup settling while the start record is being written lands after it, so the thread keeps the newest state', () =>
  Effect.gen(function* () {
    let setup: WorktreeSetupStatus = 'running';
    const record = (): WorktreeRecord => ({
      rootId,
      projectId: 1,
      name: 'made',
      path: '/trees/made',
      branch: 'tagma/made',
      baseBranch: 'main',
      baseCommit: 'abc',
      origin: 'op',
      hue: 0,
      setup,
      setupDetail: null,
      taskId: null,
      createdAt: new Date(0),
    });
    const written: { threadId: string; entry: WorktreeEntry }[] = [];
    const gate = yield* Deferred.make<void>();
    let first = true;
    const notes = yield* makeWorktreeNotes({
      placedIn: () => Effect.succeed([{ threadId: 'child' }]),
      append: Effect.fnUntraced(function* (threadId, events) {
        if (first) {
          first = false;
          yield* Deferred.await(gate);
        }
        for (const event of events) {
          if ('payload' in event) written.push({ threadId, entry: event.payload.entry as unknown as WorktreeEntry });
        }
      }),
    }).pipe(
      Effect.provideService(MachineUnits, {
        read: (work: (unit: { run: <A, E>(query: Effect.Effect<A, E>) => Effect.Effect<A, E> }) => unknown) =>
          work({ run: (query) => query }),
      } as unknown as MachineUnits['Service']),
      Effect.provideService(WorktreeRecords, { byRoot: () => Effect.sync(record) } as unknown as WorktreeRecords['Service']),
    );

    const starting = yield* Effect.forkChild(notes.created('child', rootId));
    yield* Effect.sleep('20 millis');
    setup = 'done';
    const settling = yield* Effect.forkChild(notes.setup(rootId));
    yield* Effect.sleep('20 millis');
    yield* Deferred.succeed(gate, undefined);
    yield* Fiber.join(starting);
    yield* Fiber.join(settling);

    const setups = written
      .filter((write) => write.entry.event === 'setup')
      .map((write) => (write.entry as { setup: WorktreeSetupStatus }).setup);
    expect(setups).toEqual(['running', 'done']);
    expect(written.map((write) => write.entry.event)).toEqual(['created', 'setup', 'setup']);
  }),
);
