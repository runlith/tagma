import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { OperationId } from '../../../platform/contract/wire/ids.js';
import { SocketOperations } from '../../../invocation/contract/service/socketOperations.js';
import { THREAD_STOP } from '../../../threads/contract/wire/feeds.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { socketDoorLayer } from '../socketDoor.js';

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('graph admission', (it) => {
  it.effect('a cold conflicted graph leaves stop and chat operations available while graph reads retain their refusal', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const project = yield* world.stealthProject();
      const query = `project=${project}`;
      const born = yield* world.op('create_thread', { title: 'Recovery' }, query);
      expect(born.status).toBe(200);
      const threadId = (born.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
      const graph = yield* world.runtime.pool.resolve({ projectId: project });
      yield* world.runtime.pool.releaseProject(project);
      yield* files.writeFileString(join(graph.layout.treeRoot, 'conflicted.md'), '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic\n');

      const door = yield* Layer.build(socketDoorLayer(world.runtime, yield* world.directory('socket')));
      const stopped = yield* Context.get(door, SocketOperations).perform(OperationId.make('stop_run'), project, { threadId }, THREAD_STOP);
      expect(stopped).toEqual({ status: 'nothing-running' });
      const overHttp = yield* world.op('stop_run', { threadId }, `${query}&scope=0123abcd`);
      expect(overHttp.body).toMatchObject({ code: 'thread-channel' });
      expect(world.runtime.pool.held().map((copy) => copy.treeRoot)).not.toContain(graph.layout.treeRoot);

      const tree = yield* world.op('read_tree', {}, query);
      expect(tree.status).toBe(409);
      expect(tree.body).toMatchObject({ code: 'graph-unmerged' });
      const listed = yield* world.op('list_threads', { limit: 10 }, query);
      expect(listed.status).toBe(200);
      expect(JSON.stringify(listed.body)).toContain(threadId);
      const read = yield* world.op('read_thread_snapshot', { threadId }, query);
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ snapshot: { thread: { id: threadId } } });
      const changed = yield* world.op('set_thread_title', { threadId, title: 'Recovery available' }, query);
      expect(changed.status).toBe(200);
      const reread = yield* world.op('read_thread_snapshot', { threadId }, query);
      expect(reread.body).toMatchObject({ snapshot: { thread: { id: threadId, title: 'Recovery available' } } });
      const stillRefused = yield* world.op('read_tree', {}, query);
      expect(stillRefused.status).toBe(409);
      expect(stillRefused.body).toEqual(tree.body);
    }),
  );
});
