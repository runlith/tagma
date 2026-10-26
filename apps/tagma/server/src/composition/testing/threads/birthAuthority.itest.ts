import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer, Schema } from 'effect';
import { Settings } from '../../../settings/contract/service/values.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { birthsOf, adjustmentsOf, evidenceOf } from '../../../threads/testing/doubles.js';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { APPROVAL_WAIT_HEADER } from '../../../invocation/contract/wire/headers.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { harnessRefusal } from '../../../threads/refusals.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';

const fixture = doorFixture();
const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const projectId = yield* world.stealthProject();
  yield* projectLeaving(world, projectId);
  return { world, projectId };
});

class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/BirthAuthorityWorld') {}

const fresh = Effect.gen(function* () {
  const fixture = yield* World;
  yield* Context.get(fixture.world.runtime.graph, Settings).write({
    key: 'agent.approvalMode',
    value: undefined,
    scope: 'project',
    projectId: fixture.projectId,
  });
  return fixture;
});

layer(Layer.effect(World, setup).pipe(Layer.provide(fixture)), { excludeTestServices: true })('thread authority', (it) => {
  it.effect('a thread is born asking what the project configured, and a project that configured nothing opens trusting', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* fresh;
      const settings = Context.get(world.runtime.graph, Settings);
      const births = birthsOf(world.runtime.owners);
      const trusting = yield* births.create({ projectId, createdBySessionId: null });
      expect(trusting.thread.authority.mode).toBe('trust');
      yield* settings.write({ key: 'agent.approvalMode', value: 'bypass', scope: 'project', projectId });
      const bypassing = yield* births.create({ projectId, createdBySessionId: null });
      expect(bypassing.thread.authority.mode).toBe('bypass');
      expect((yield* evidenceOf(world.runtime.owners).snapshot(trusting.thread.id, projectId)).thread.authority.mode).toBe('trust');
    }),
  );

  it.effect('a named mode wins over the project setting', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* fresh;
      const settings = Context.get(world.runtime.graph, Settings);
      const births = birthsOf(world.runtime.owners);
      yield* settings.write({ key: 'agent.approvalMode', value: 'trust', scope: 'project', projectId });
      const asked = yield* births.create({ projectId, createdBySessionId: null, approvalMode: 'review' });
      expect(asked.thread.authority.mode).toBe('review');
      expect(
        yield* Effect.flip(
          births.create({ projectId, createdBySessionId: null, parent: asked.thread.id, task: '', approvalMode: 'bypass' }),
        ),
      ).toMatchObject({ code: 'child-inherits' });
    }),
  );

  it.effect('an operator may change a spawned thread’s mode without changing its parent', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* fresh;
      const births = birthsOf(world.runtime.owners);
      const defaults = adjustmentsOf(world.runtime.owners);
      const evidence = evidenceOf(world.runtime.owners);
      const parent = yield* births.create({ projectId, createdBySessionId: null, approvalMode: 'review' });
      const child = yield* births.create({ projectId, createdBySessionId: null, parent: parent.thread.id, task: '' });
      expect(child.thread.authority.mode).toBe('review');
      expect((yield* defaults.setAuthorityMode(child.thread.id, projectId, 'trust')).thread.authority.mode).toBe('trust');
      const bypassing = yield* defaults.setAuthorityMode(child.thread.id, projectId, 'bypass');
      expect(bypassing.thread.authority).toMatchObject({ mode: 'bypass', bypassFrom: child.thread.id });
      expect((yield* evidence.snapshot(parent.thread.id, projectId)).thread.authority.mode).toBe('review');
    }),
  );

  it.effect('the mode the operator sets on a CLI terminal thread decides its next call to Tagma', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* fresh;
      const created = yield* world.op('create_thread', { type: 'harness:devin', task: '', approvalMode: 'review' }, `project=${projectId}`);
      expect(created.status).toBe(200);
      const threadId = (yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(created.body)).snapshot.thread.id;
      const call = () =>
        world.op('set_thread_delegation', { threadId, delegation: null }, `project=${projectId}`, {
          [GRANT_HEADER]: grantFor(threadId),
          [APPROVAL_WAIT_HEADER]: '0',
        });
      expect((yield* call()).status).toBe(409);
      const bypassing = yield* adjustmentsOf(world.runtime.owners).setAuthorityMode(threadId, projectId, 'bypass');
      expect(bypassing.thread.authority).toMatchObject({ mode: 'bypass', bypassFrom: threadId });
      expect((yield* call()).status).toBe(200);
    }),
  );

  it.effect('a mode nobody registered refuses mode-unknown at birth, from the project setting, and on a move', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* fresh;
      const settings = Context.get(world.runtime.graph, Settings);
      const births = birthsOf(world.runtime.owners);
      expect(yield* Effect.flip(births.create({ projectId, createdBySessionId: null, approvalMode: 'plan' }))).toMatchObject({
        code: 'mode-unknown',
      });
      const trusting = yield* births.create({ projectId, createdBySessionId: null });
      yield* settings.write({ key: 'agent.approvalMode', value: 'plan', scope: 'project', projectId });
      expect(yield* Effect.flip(births.create({ projectId, createdBySessionId: null }))).toMatchObject({ code: 'mode-unknown' });
      expect(
        yield* Effect.flip(harnessRefusal(adjustmentsOf(world.runtime.owners).setAuthorityMode(trusting.thread.id, projectId, 'plan'))),
      ).toMatchObject({ code: 'mode-unknown' });
      const kept = yield* evidenceOf(world.runtime.owners).snapshot(trusting.thread.id, projectId);
      expect(kept.thread.authority.mode).toBe('trust');
    }),
  );
});
