import { randomUUID } from 'node:crypto';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Clock, Context, Deferred, Effect } from 'effect';
import { ProjectGroups } from '../../../projects/contract/service/registry.js';
import { project as projectTable } from '../../../projects/testing/doubles.js';
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
      return (yield* threads.list.rootWindow('operator', [demo.projectId], { limit: 1 })).rows.map((row) => row.id);
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

const registered = Effect.fnUntraced(function* (demo: ThreadStoreFixture) {
  const name = `member-${randomUUID()}`;
  const createdAt = new Date(yield* Clock.currentTimeMillis);
  const row = yield* demo.units.write('testing.groupMember', (unit) =>
    unit.run(
      demo.db
        .insert(projectTable())
        .values({ name, repoKey: `/${name}`, rootPath: `/${name}`, createdAt })
        .returning()
        .get(),
    ),
  );
  if (row === undefined) return yield* Effect.die(new Error('the member project was not registered'));
  yield* Effect.addFinalizer(() =>
    demo.units
      .write('testing.groupMemberRelease', (unit) => unit.run(demo.db.delete(projectTable()).where(eq(projectTable().id, row.id))))
      .pipe(Effect.orDie),
  );
  return row;
});

it.live(
  'folders a dissolved group still holds for a member that has joined another group since reach that group on the next start',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const groups = Context.get(demo.context, ProjectGroups);
    const alpha = yield* registered(demo);
    const beta = yield* registered(demo);
    const gamma = yield* registered(demo);
    const thread = yield* demo.units.write('ThreadStore.member', (unit) =>
      Effect.gen(function* () {
        const created = yield* demo.store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* demo.threads.rows.attachFacet({ threadId: created.id, projectId: beta.id }, unit);
        return created.id;
      }),
    );
    const formed = (members: readonly (typeof beta)[]) =>
      demo.units.write('testing.formGroup', (unit) => groups.form(unit, { name: `group-${randomUUID()}`, members }));
    const first = yield* formed([alpha, beta]);
    const site = yield* Effect.scoped(
      Effect.flatMap(Effect.provide(makeThreadFolders, demo.context), (folders) => folders.create(beta.id, 'Site', null, [thread])),
    );
    if (site.status !== 'created') return yield* Effect.die(new Error(`the folder was not made: ${site.status}`));

    yield* demo.units.write('testing.leaveGroup', (unit) => groups.leave(unit, beta));
    yield* formed([beta, gamma]);
    yield* Effect.addFinalizer(() => Effect.orDie(demo.units.write('testing.leaveGroup', (unit) => groups.leave(unit, beta))));

    const settled = yield* Deferred.make<void>();
    const folders = yield* Effect.provide(makeThreadFolders, demo.context);
    folders.regrouped((event) =>
      event.groupId === first.group.graph.id ? Effect.asVoid(Deferred.succeed(settled, undefined)) : Effect.void,
    );
    yield* Deferred.await(settled);
    expect((yield* folders.list(beta.id)).map((folder) => [folder.id, folder.name])).toEqual([[site.folder.id, 'Site']]);
    expect((yield* demo.threads.list.summary(thread))?.folderId).toBe(site.folder.id);
  }),
);
