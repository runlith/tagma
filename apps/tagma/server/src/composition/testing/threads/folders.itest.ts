import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { shelveRecord } from '../../../thread-record/testing/records.js';
import { makeThreadFolders } from '../../../thread-record/folders.js';
import { type ThreadStoreFixture, threadStoreFixture } from '../threadStoreFixture.js';

const project = Effect.fnUntraced(function* (demo: ThreadStoreFixture, count: number) {
  const { store, threads } = demo;
  const ids = yield* demo.units.write('ThreadStore.ids', (unit) =>
    Effect.gen(function* () {
      const made: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const created = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* threads.rows.attachFacet({ threadId: created.id, projectId: demo.projectId }, unit);
        yield* unit.run(shelveRecord(demo.db, created.id, { readerOrderAt: new Date(Date.UTC(2026, 0, 1 + index)) }));
        made.push(created.id);
      }
      return made;
    }),
  );
  const child = yield* demo.units.write('ThreadStore.child', (unit) =>
    Effect.gen(function* () {
      const born = yield* store.insertChild(ids[0] as string, { ownerId: 'operator', agentId: 'tagma' }, unit);
      yield* threads.rows.inheritFacet({ threadId: born.id, fromThreadId: ids[0] as string, agentId: 'tagma' }, unit);
      return born.id;
    }),
  );
  return { threads, ids, child, folders: yield* Effect.provide(makeThreadFolders, demo.context) };
});

it.live(
  'a filed tree rides the window however old it is, loses its pin, and goes back to the idle cut when its folder is removed',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { threads, ids, child, folders } = yield* project(demo, 3);
    const [oldest, middle, newest] = ids as [string, string, string];
    yield* threads.list.setPinned(oldest, new Date('2026-02-01T00:00:00.000Z'));
    const made = yield* folders.create(demo.projectId, 'Waves', null, [child]);
    if (made.status !== 'created') return yield* Effect.die(new Error(`the folder was not made: ${made.status}`));
    expect(made.moved as readonly string[]).toEqual([oldest]);
    const window = Effect.fnUntraced(function* () {
      return (yield* threads.list.rootWindow('operator', demo.projectId, { limit: 1 })).rows.map((row) => row.id);
    });
    const filed = yield* threads.list.summary(oldest);
    expect(filed?.folderId).toBe(made.folder.id);
    expect(filed?.pinnedAt).toBeNull();
    expect(yield* window()).toEqual(expect.arrayContaining([oldest, child, newest]));
    expect(yield* window()).not.toContain(middle);
    const removed = yield* folders.remove(demo.projectId, made.folder.id);
    expect(removed?.released.map((tree) => ({ ...tree, threadId: tree.threadId as string }))).toEqual([
      { threadId: oldest, folderId: made.folder.id },
    ]);
    expect((yield* threads.list.summary(oldest))?.folderId).toBeNull();
    expect(yield* window()).not.toContain(oldest);
  }),
);

it.live(
  'filing names every thread of the project or moves nothing, and folders keep the order they are moved into',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { threads, ids, folders } = yield* project(demo, 2);
    const [first, second] = ids as [string, string];
    const research = yield* folders.create(demo.projectId, 'Research', null, []);
    const waves = yield* folders.create(demo.projectId, 'Waves', null, []);
    if (research.status !== 'created' || waves.status !== 'created') return yield* Effect.die(new Error('the folders were not made'));
    expect(yield* folders.file(demo.projectId, [first, 'no-such-thread'], research.folder.id)).toEqual({
      status: 'missing',
      missing: ['no-such-thread'],
    });
    expect((yield* threads.list.summary(first))?.folderId).toBeNull();
    expect(yield* folders.file(demo.projectId, [second], 'no-such-folder')).toEqual({ status: 'no-folder' });
    const filed = yield* folders.file(demo.projectId, [first, second], research.folder.id);
    expect(filed).toMatchObject({ status: 'filed', moved: expect.arrayContaining([first, second]) });
    expect(yield* folders.file(demo.projectId, [first], research.folder.id)).toMatchObject({ status: 'filed', moved: [] });
    const order = yield* folders.move(demo.projectId, waves.folder.id, undefined, 0);
    expect(order.status === 'moved' && order.folders.map((folder) => [folder.name, folder.position])).toEqual([
      ['Waves', 0],
      ['Research', 1],
    ]);
    expect((yield* folders.list(demo.projectId)).map((folder) => folder.name)).toEqual(['Waves', 'Research']);
  }),
);

it.live(
  'folders nest to any depth: a move reparents and renumbers both sibling sets, refuses a cycle, and a delete takes the subtree and releases every tree in it',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const { threads, ids, folders } = yield* project(demo, 2);
    const [first, second] = ids as [string, string];
    const make = Effect.fnUntraced(function* (name: string, parentId: string | null, threadIds: readonly string[] = []) {
      const made = yield* folders.create(demo.projectId, name, parentId, threadIds);
      if (made.status !== 'created') return yield* Effect.die(new Error(`the folder ${name} was not made: ${made.status}`));
      return made.folder;
    });
    const top = yield* make('Top', null);
    const other = yield* make('Other', null);
    const a = yield* make('A', top.id, [first]);
    const b = yield* make('B', top.id);
    const deep = yield* make('Deep', a.id, [second]);
    expect([a.position, b.position, deep.position]).toEqual([0, 1, 0]);
    expect(yield* folders.create(demo.projectId, 'Orphan', 'no-such-folder', [])).toEqual({ status: 'no-parent' });
    expect(yield* folders.move(demo.projectId, top.id, deep.id, 0)).toEqual({ status: 'cycle' });
    expect(yield* folders.move(demo.projectId, a.id, a.id, 0)).toEqual({ status: 'cycle' });
    expect(yield* folders.move(demo.projectId, a.id, 'no-such-folder', 0)).toEqual({ status: 'no-parent' });
    const moved = yield* folders.move(demo.projectId, a.id, other.id, 5);
    if (moved.status !== 'moved') return yield* Effect.die(new Error(`the move was refused: ${moved.status}`));
    const placeOf = (name: string) => {
      const folder = moved.folders.find((held) => held.name === name);
      return [folder?.parentId, folder?.position];
    };
    expect(placeOf('A')).toEqual([other.id, 0]);
    expect(placeOf('B')).toEqual([top.id, 0]);
    expect(placeOf('Deep')).toEqual([a.id, 0]);
    expect(moved.folders.map((folder) => folder.id)).toEqual((yield* folders.list(demo.projectId)).map((folder) => folder.id));
    const removed = yield* folders.remove(demo.projectId, other.id);
    expect(removed?.removed).toEqual([other.id, a.id, deep.id]);
    expect(
      [...(removed?.released ?? [])]
        .map((tree) => ({ ...tree, threadId: tree.threadId as string }))
        .sort((x, y) => (x.threadId < y.threadId ? -1 : 1)),
    ).toEqual(
      [
        { threadId: first, folderId: a.id },
        { threadId: second, folderId: deep.id },
      ].sort((x, y) => (x.threadId < y.threadId ? -1 : 1)),
    );
    expect((yield* threads.list.summary(first))?.folderId).toBeNull();
    expect((yield* threads.list.summary(second))?.folderId).toBeNull();
    expect((yield* folders.list(demo.projectId)).map((folder) => [folder.name, folder.position])).toEqual([
      ['Top', 0],
      ['B', 0],
    ]);
  }),
);
