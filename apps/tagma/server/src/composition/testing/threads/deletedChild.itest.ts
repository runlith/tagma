import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, Layer, Stream } from 'effect';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { APPROVAL_WAIT_HEADER } from '../../../invocation/contract/wire/headers.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf, inboxOf } from '../../../threads/testing/doubles.js';
import { makeDoorWorld } from '../doorFixture.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';
import { holdThreads } from '../threadScope.js';

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld({
    models: (standing) => ({ ...standing, request: (input) => ({ ...standing.request(input), stream: () => Stream.never }) }),
  });
  const account = yield* subscriptionLogin(world);
  yield* nativeLeads(world, account);
  const projectId = yield* world.stealthProject();
  yield* holdThreads(world);
  return { world, account, projectId };
});
class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/DeletedChild') {}

const asThread = Effect.fnUntraced(function* (threadId: string, id: string, input: unknown) {
  const { world, projectId } = yield* World;
  return (yield* world.op(id, input, `project=${projectId}`, { [GRANT_HEADER]: grantFor(threadId), [APPROVAL_WAIT_HEADER]: '0' })).body as {
    readonly status?: string;
    readonly code?: string;
    readonly reason?: string;
    readonly threadId?: string;
  };
});

layer(Layer.effect(World, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('a deleted child', (it) => {
  it.effect('the operator deleting a working child tells its parent once, and later acts on it name the deletion', () =>
    Effect.gen(function* () {
      const { world, account, projectId } = yield* World;
      const parent = (yield* birthsOf(world.runtime.owners).create({
        projectId,
        createdBySessionId: null,
        account,
        approvalMode: 'bypass',
      })).thread.id;
      yield* world.op('read_settings', {}, `project=${projectId}`, { [GRANT_HEADER]: grantFor(parent) });
      const spawned = yield* asThread(parent, 'spawn_agent', { agentId: 'tagma', task: 'Review the diff.', name: 'reviewer' });
      expect(spawned.status).toBe('started');
      const child = spawned.threadId!;
      expect((yield* Context.get(world.runtime.owners, ThreadHarness).reads.snapshot(child)).activeRun).not.toBeNull();

      expect((yield* world.op('delete_thread', { threadId: child }, `project=${projectId}`)).body).toMatchObject({ status: 'deleted' });

      const lines = (yield* inboxOf(world.runtime.owners).pending(parent)).flatMap((item) =>
        item.kind === 'signal' && item.id.includes(child) ? [item.body.notice] : [],
      );
      expect(lines).toMatchObject([
        { event: 'deleted', child: { threadId: child, name: 'reviewer' }, by: 'the operator', ended: { run: true, owed: true } },
      ]);
      for (const address of [child, 'reviewer']) {
        expect(yield* asThread(parent, 'stop_agent', { threadId: address })).toMatchObject({
          code: 'thread-unknown',
          reason: expect.stringContaining(`thread ${child} (reviewer) was deleted by the operator at`),
        });
      }
      expect(yield* asThread(parent, 'send_message', { to: ['reviewer'], message: 'Status?' })).toMatchObject({
        status: 'not-found',
        reason: expect.stringContaining(`${child} (reviewer) was deleted by the operator at`),
      });
    }),
  );
});
