import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Context, Deferred, Effect, Layer, Stream } from 'effect';
import { parseThreadInboxItem } from '@runlith/agent/thread/persisted';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { APPROVAL_WAIT_HEADER } from '../../../invocation/contract/wire/headers.js';
import { NativeStorage, ThreadHarness } from '../../../threads/contract/service/engine.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { birthsOf, listOf, threadInbox, turnsOf } from '../../../threads/testing/doubles.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { nativeLeads, subscriptionLogin } from '../claudeLogin.js';
import { projectLeaving } from '../doorFixture.js';

const fixture = doorFixture({
  models: (standing) => ({
    ...standing,
    request: () => ({
      plannedOutputTokens: 1,
      stream: () => Stream.never,
      text: () => Effect.die(new Error('the team fixture streams only')),
      object: () => Effect.die(new Error('the team fixture streams only')),
    }),
  }),
});
const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const account = yield* subscriptionLogin(world);
  yield* nativeLeads(world, account);
  const a = yield* world.plainProject();
  const b = yield* world.plainProject();
  yield* projectLeaving(world, a, b);
  return {
    world,
    a,
    b,
    account,
    native: Context.get(world.runtime.owners, NativeStorage),
    records: Context.get(world.runtime.owners, ThreadRecords),
  };
});
class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/TeamPlacesWorld') {}
const family = Effect.fn('testing.crossHomeFamily')(function* () {
  const { world, a, b, account, native, records } = yield* World;
  const births = birthsOf(world.runtime.owners);
  const root = yield* births.create({ projectId: a, createdBySessionId: null, title: 'parent', account, approvalMode: 'trust' });
  const parent = root.thread.id;
  const outsider = (yield* births.create({ projectId: b, createdBySessionId: null, title: 'outside', account })).thread.id;
  const child = yield* native.threads.transaction((unit) =>
    Effect.gen(function* () {
      const row = yield* native.threads.insertChild(
        parent,
        {
          ownerId: 'operator',
          agentId: 'tagma',
          name: 'worker',
          account,
          provider: root.thread.provider,
          model: root.thread.model,
          reasoning: root.thread.reasoning,
        },
        unit,
      );
      yield* records.scope(unit, row.id, { projectId: b, title: 'worker', titleOrigin: 'agent' });
      return row.id;
    }),
  );
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* turnsOf(world.runtime.owners).delete(parent, a);
      yield* turnsOf(world.runtime.owners).delete(outsider, b);
    }).pipe(Effect.orDie),
  );
  return { parent, child, outsider };
});
const asThread = Effect.fnUntraced(function* (threadId: string, projectId: number, id: string, input: unknown) {
  const { world } = yield* World;
  return (yield* world.op(id, input, `project=${projectId}`, { [GRANT_HEADER]: grantFor(threadId), [APPROVAL_WAIT_HEADER]: '0' })).body;
});
const received = Effect.fnUntraced(function* (threadId: string) {
  const { world } = yield* World;
  const db = Context.get(world.runtime.graph, MachineStore).db;
  const units = Context.get(world.runtime.graph, MachineUnits);
  const rows = yield* units.read((unit) => unit.run(db.select().from(threadInbox()).where(eq(threadInbox().threadId, threadId))));
  return yield* Effect.forEach(rows, (row) => Effect.try(() => parseThreadInboxItem(row)));
});

layer(Layer.effect(World, setup).pipe(Layer.provide(fixture)), { excludeTestServices: true })('families crossing project homes', (it) => {
  it.effect('approvals and operator notices cross homes, and archive and deletion update both project windows', () =>
    Effect.gen(function* () {
      const { world, a, b } = yield* World;
      const { parent, child, outsider } = yield* family();
      const harness = Context.get(world.runtime.owners, ThreadHarness);
      expect((yield* world.op('set_thread_approves', { threadId: parent, approves: ['pin_thread'] }, `project=${a}`)).status).toBe(200);
      expect(yield* asThread(child, b, 'pin_thread', { threadId: outsider })).toMatchObject({ code: 'approval-pending' });
      const asked = (yield* harness.runs.questions().open(child)).at(-1)!;
      expect(asked.approver).toBe(parent);
      expect(
        (yield* received(parent)).some(
          (item) =>
            item.kind === 'envelope' &&
            item.id === `approval:${child}:${asked.runId}:${asked.questionId}:${parent}` &&
            item.body.intent === 'approval',
        ),
      ).toBe(true);
      expect(yield* asThread(parent, a, 'answer_approval', { threadId: child, questionId: asked.questionId, allow: true })).toMatchObject({
        status: 'answered',
      });
      expect((yield* world.op('set_thread_operator_notice', { threadId: child, notice: true }, `project=${b}`)).status).toBe(200);
      expect(
        (yield* world.op('start_turn', { threadId: child, text: 'Inspect the second boundary.', key: 'operator-boundary' }, `project=${b}`))
          .status,
      ).toBe(200);
      expect(
        (yield* received(parent)).filter((item) => item.kind === 'envelope' && item.id.startsWith(`operator-message:${child}:`)),
      ).toMatchObject([{ threadId: parent, sender: { kind: 'host' }, body: { intent: 'message' } }]);
      yield* turnsOf(world.runtime.owners).stop(child, b);
      expect((yield* harness.runs.questions().open(child)).at(-1)?.approver).toBeUndefined();
      expect(yield* asThread(child, b, 'pin_thread', { threadId: outsider, pinned: false })).toMatchObject({ code: 'approval-pending' });
      expect((yield* harness.runs.questions().open(child)).at(-1)?.approver).toBeUndefined();
      yield* turnsOf(world.runtime.owners).stop(child, b);
      const list = listOf(world.runtime.owners);
      const aRows = new Set<string>();
      const bRows = new Set<string>();
      const removed = yield* Deferred.make<void>();
      let deleting = false;
      for (const [projectId, rows] of [
        [a, aRows],
        [b, bRows],
      ] as const) {
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            list.subscribe(projectId, (event) => {
              if (event.kind === 'row') rows.add(event.row.id);
              if (event.kind === 'removed') rows.delete(event.threadId);
              if (deleting && projectId === a && event.kind === 'removed' && event.threadId === child)
                Deferred.doneUnsafe(removed, Effect.void);
            }),
          ),
          (stop) => Effect.sync(stop),
        );
        for (const row of (yield* list.openWindow(projectId)).rows) rows.add(row.id);
      }
      yield* list.setArchivedMatching(b, { ids: [child] }, true, { kind: 'operator' });
      expect(aRows.has(child)).toBe(false);
      expect(bRows.has(child)).toBe(false);
      yield* list.setArchived(child, b, false);
      expect(aRows.has(child)).toBe(true);
      expect(bRows.has(child)).toBe(true);
      yield* list.setArchived(parent, a, true);
      expect(aRows.has(parent)).toBe(false);
      expect(aRows.has(child)).toBe(false);
      expect(bRows.has(child)).toBe(false);
      yield* list.setArchived(parent, a, false);
      expect(aRows.has(child)).toBe(true);
      expect(bRows.has(child)).toBe(true);
      deleting = true;
      expect((yield* world.op('delete_thread', { threadId: child }, `project=${b}`)).status).toBe(200);
      yield* Deferred.await(removed);
      expect(aRows.has(child)).toBe(false);
      expect(bRows.has(child)).toBe(false);
    }),
  );
});
