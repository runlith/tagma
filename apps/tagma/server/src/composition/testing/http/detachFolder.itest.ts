import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Schema, Stream } from 'effect';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { ROUTE_OPERATIONS } from '../../../threads/contract/wire/operations/routes.js';
import { FOLDER_OPERATIONS } from '../../../threads/contract/wire/operations/folders.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';
import { holdThreads } from '../threadScope.js';
import { turnsOf } from '../../../threads/testing/doubles.js';

const created = Schema.decodeUnknownEffect(knownAnswer(ROUTE_OPERATIONS.create_thread.answer));
const folderCreated = Schema.decodeUnknownEffect(knownAnswer(FOLDER_OPERATIONS.create_thread_folder.answer));
const listed = Schema.decodeUnknownEffect(knownAnswer(ROUTE_OPERATIONS.list_thread_window.answer));

const fixture = doorFixture({
  models: (standing) => ({
    ...standing,
    request: (selection) => ({ ...standing.request(selection), stream: () => Stream.never }),
  }),
});

layer(fixture, { excludeTestServices: true })('detach folder placement', (it) => {
  it.effect('detach keeps a pinned child and a deeper descendant beside the former tree in its current folder', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      yield* nativeLeads(world, yield* subscriptionLogin(world));
      yield* holdThreads(world);
      const projectId = yield* world.plainProject();
      const query = `project=${projectId}`;
      const birth = Effect.fnUntraced(function* (title: string, parent?: string) {
        const response = yield* world.op(
          'create_thread',
          parent === undefined ? { title, approvalMode: 'bypass' } : { parent, name: title, task: '' },
          query,
        );
        expect(response.body).toMatchObject({ status: 'loaded' });
        const answer = yield* created(response.body);
        const id = answer.snapshot.thread.id;
        if (parent !== undefined) yield* turnsOf(world.runtime.owners).stop(id, projectId);
        return id;
      });
      const root = yield* birth('root');
      const child = yield* birth('child', root);
      const leaf = yield* birth('leaf', child);
      const outer = yield* folderCreated((yield* world.op('create_thread_folder', { name: 'Outer' }, query)).body);
      const inner = yield* folderCreated(
        (yield* world.op('create_thread_folder', { name: 'Inner', parentId: outer.folder.id, threadIds: [root] }, query)).body,
      );
      const window = Effect.fnUntraced(function* () {
        const answer = yield* listed((yield* world.op('list_thread_window', { readerBefore: '1970-01-01T00:00:00.000Z' }, query)).body);
        return answer.rows.map(({ id, parentThreadId, folderId, pinnedAt, activeRunId }) => ({
          id,
          parentThreadId,
          folderId,
          pinnedAt,
          activeRunId,
        }));
      });
      expect(yield* window()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: child, parentThreadId: root, activeRunId: null })]),
      );
      expect((yield* world.op('pin_thread', { threadId: child }, query)).body).toMatchObject({ status: 'pinned' });
      expect((yield* world.op('detach_thread', { threadId: child }, query)).body).toMatchObject({ status: 'detached', from: root });
      expect(yield* window()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: root, folderId: inner.folder.id }),
          expect.objectContaining({ id: child, parentThreadId: null, folderId: inner.folder.id, pinnedAt: null }),
          expect.objectContaining({ id: leaf, parentThreadId: child }),
        ]),
      );
      expect((yield* world.op('detach_thread', { threadId: child, detached: false }, query)).body).toMatchObject({ status: 'reattached' });
      expect(yield* window()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: child, parentThreadId: root, folderId: null })]),
      );
      expect((yield* world.op('file_threads', { threadIds: [root], folderId: outer.folder.id }, query)).body).toMatchObject({
        status: 'filed',
      });
      expect((yield* world.op('detach_thread', { threadId: leaf }, query)).body).toMatchObject({ status: 'detached', from: child });
      expect(yield* window()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: root, folderId: outer.folder.id }),
          expect.objectContaining({ id: leaf, parentThreadId: null, folderId: outer.folder.id }),
        ]),
      );
      expect((yield* world.op('detach_thread', { threadId: leaf, detached: false }, query)).body).toMatchObject({ status: 'reattached' });
      expect((yield* world.op('archive_thread', { threadId: root }, query)).body).toMatchObject({ status: 'archived' });
      expect((yield* world.op('archive_thread', { threadId: child, archived: false }, query)).body).toMatchObject({ status: 'unarchived' });
      expect((yield* world.op('file_threads', { threadIds: [child], folderId: inner.folder.id }, query)).body).toMatchObject({
        status: 'filed',
      });
      expect((yield* window()).map((row) => row.id).sort()).toEqual([child, leaf].sort());
      expect((yield* world.op('detach_thread', { threadId: leaf }, query)).body).toMatchObject({ status: 'detached', from: child });
      expect(yield* window()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: child, folderId: inner.folder.id }),
          expect.objectContaining({ id: leaf, parentThreadId: null, folderId: inner.folder.id }),
        ]),
      );
    }),
  );
});
