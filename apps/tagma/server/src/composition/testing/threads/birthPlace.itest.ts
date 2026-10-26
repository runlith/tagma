import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer, Schema, Stream } from 'effect';
import { parseThreadInboxItem } from '@runlith/agent/thread/persisted';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { APPROVAL_WAIT_HEADER } from '../../../invocation/contract/wire/headers.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { NativeStorage, ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf, threadInbox } from '../../../threads/testing/doubles.js';
import { COLLABORATION_OPERATIONS } from '../../../threads/contract/wire/operations/collaboration.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { refusalSchema } from '../../../platform/contract/wire/refusal.js';
import type { ModelAccess } from '../../../providers/contract/service/access.js';
import { storeLayer } from '../../../platform/store/open.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { fixtureMigrations } from '../migrations.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';
import { projectLeaving } from '../doorFixture.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';

const held = (standing: ModelAccess['Service']): ModelAccess['Service'] => ({
  ...standing,
  request: () => ({
    plannedOutputTokens: 1,
    text: () => Effect.die(new Error('the place fixture streams only')),
    object: () => Effect.die(new Error('the place fixture streams only')),
    stream: () => Stream.never,
  }),
});
const fixture = doorFixture({ models: held }).pipe(Layer.provideMerge(BunFileSystem.layer));
const setup = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const world = yield* DoorFixture;
  const account = yield* subscriptionLogin(world);
  yield* nativeLeads(world, account);
  const a = yield* world.stealthProject();
  const rootB = yield* world.directory('project-b');
  const b = yield* world.stealthProject(rootB);
  yield* projectLeaving(world, a, b);
  yield* files.makeDirectory(join(rootB, '.agents'), { recursive: true });
  yield* files.writeFileString(
    join(rootB, '.agents', 'scout.md'),
    '---\ndescription: Scouts the codebase.\ncapabilities: []\n---\nScout.\n',
  );
  expect(
    (yield* world.op('write_setting', { key: 'agent.offered', value: [{ type: 'scout', to: 'agents' }] }, `project=${b}`)).status,
  ).toBe(200);
  const births = birthsOf(world.runtime.owners);
  const parent = (yield* births.create({ projectId: a, createdBySessionId: null, title: 'parent', account, approvalMode: 'bypass' })).thread
    .id;
  return { world, a, b, parent };
});
class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/BirthPlaceWorld') {}
const asThread = Effect.fnUntraced(function* (threadId: string, id: string, input: unknown, query = '') {
  const { world } = yield* World;
  return (yield* world.op(id, input, query, { [GRANT_HEADER]: grantFor(threadId), [APPROVAL_WAIT_HEADER]: '0' })).body;
});
const inPlace = Effect.fnUntraced(function* (threadId: string, id: string, input: unknown) {
  const first = yield* asThread(threadId, id, input);
  return Schema.is(refusalSchema)(first) && first.code === 'instructions-unread' ? yield* asThread(threadId, id, input) : first;
});
const decodeSpawn = Schema.decodeUnknownEffect(knownAnswer(COLLABORATION_OPERATIONS.spawn_agent.answer));

layer(Layer.effect(World, setup).pipe(Layer.provide(fixture)), { excludeTestServices: true })('cross-project birth and placement', (it) => {
  it.effect('a child born in B keeps its home, type and cross-home parent, and its detachment survives reopening', () =>
    Effect.gen(function* () {
      const { world, a, b, parent } = yield* World;
      const db = Context.get(world.runtime.graph, MachineStore).db;
      const units = Context.get(world.runtime.graph, MachineUnits);
      const records = Context.get(world.runtime.owners, ThreadRecords);
      const harness = Context.get(world.runtime.owners, ThreadHarness);
      expect(yield* asThread(parent, 'spawn_agent', { agentId: 'scout', task: 'Map the module.' })).toMatchObject({
        code: 'unknown-type',
      });
      const started = yield* decodeSpawn(
        yield* inPlace(parent, 'spawn_agent', { agentId: 'scout', task: 'Map the module.', name: 'scout', project: b }),
      );
      if (started.status !== 'started') return yield* Effect.die(new Error(`the scout was ${started.status}`));
      const child = started.threadId;
      expect(started).toMatchObject({ status: 'started', projectId: b });
      expect(yield* records.projectOf(child)).toBe(b);
      expect(yield* harness.reads.snapshot(child)).toMatchObject({ place: null, parent: { id: parent, projectId: a } });
      expect(yield* Context.get(world.runtime.owners, NativeStorage).threads.find(child)).toMatchObject({
        parentThreadId: parent,
        spawnRootId: parent,
        profile: { id: 'scout' },
      });
      expect(yield* asThread(child, 'send_message', { to: [parent], message: 'Mapped.', final: true }, `project=${b}`)).toMatchObject({
        status: 'sent',
        deliveries: [{ recipient: { threadId: parent, projectId: a } }],
      });
      const inbox = yield* units.read((unit) => unit.run(db.select().from(threadInbox()).where(eq(threadInbox().threadId, parent))));
      const parsed = yield* Effect.forEach(inbox, (row) => Effect.try(() => parseThreadInboxItem(row)));
      expect(parsed.filter((item) => item.kind === 'envelope' && item.body.intent === 'report')).toMatchObject([
        { sender: { kind: 'thread', threadId: child }, body: { text: 'Mapped.' } },
      ]);
      const stopped = yield* asThread(parent, 'stop_agent', { threadId: child });
      expect(stopped).toMatchObject({
        threadId: child,
        projectId: b,
        _meta: { toolDisplay: { reference: { kind: 'agent', id: child, projectId: b } } },
      });
      expect((yield* world.op('detach_thread', { threadId: child }, `project=${b}`)).body).toMatchObject({
        status: 'detached',
        from: parent,
      });
      expect(yield* harness.reads.snapshot(child)).toMatchObject({
        thread: { parentThreadId: null },
        detachedFrom: { id: parent, projectId: a },
      });
      yield* Effect.gen(function* () {
        const reopened = yield* makeThreadRecords;
        expect(yield* reopened.projectOf(child)).toBe(b);
        expect(yield* reopened.projectOf(parent)).toBe(a);
        expect(yield* reopened.facts(child)).toMatchObject({ parentId: null, detachedFrom: parent });
      }).pipe(
        Effect.provide(
          unitsLayer(MachineUnits, MachineStore).pipe(
            Layer.provideMerge(storeLayer(MachineStore, join(world.dataHome, 'tagma.sqlite'), fixtureMigrations, {}, yield* sharedPool)),
          ),
        ),
      );
      expect((yield* world.op('delete_thread', { threadId: parent }, `project=${a}`)).body).toMatchObject({ status: 'deleted' });
      const orphan = yield* harness.reads.snapshot(child);
      expect(orphan.thread.id).toBe(child);
      expect(orphan.detachedFrom).toBeUndefined();
    }),
  );
});
