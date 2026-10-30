import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Cause, Clock, Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Schema } from 'effect';
import { ProjectLifecycle } from '../../../graph/contract/service/serving.js';
import { HarnessReports } from '../../../external-harnesses/contract/service/reports.js';
import { HarnessCalls, ThreadHarness } from '../../../threads/contract/service/engine.js';
import { threadCauseOf } from '@runlith/agent/thread/ThreadBorder';
import { ThreadRunNotInterruptedError } from '@runlith/agent/thread/storage/runs';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { projectLeaving } from '../doorFixture.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { threadStack } from '../threadParts.js';
import { birthsOf, turnsOf, listOf, inboxOf, thread, threadRun, unmeasuredObservation } from '../../../threads/testing/doubles.js';
import { terminalArgv, terminalKernel } from '../../../external-harnesses/testing/doubles.js';
import { sessionStoreOver } from '../../../external-harnesses/testing/floor.js';

import { ENTRY_KINDS } from '../../manifest.js';
import { ThreadRollouts } from '../../../threads/contract/service/rollouts.js';
import { ModelChanges } from '../../../threads/contract/service/modelChanges.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';

const fixture = doorFixture();
const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const runtime = world.runtime;
  const project = { id: yield* world.plainProject() };
  yield* projectLeaving(world, project.id);
  const db = Context.get(runtime.graph, MachineStore).db;
  const units = Context.get(runtime.graph, MachineUnits);
  const context = yield* runtime.runtime.contextEffect;
  const records = yield* Effect.provide(makeThreadRecords, context);
  const { store, threads: parts } = yield* Effect.provide(threadStack({ db, units, records, kinds: ENTRY_KINDS }), context);
  const catalog = yield* Context.get(runtime.owners, ProviderRegistry).catalog;
  const selection = catalog.defaultModel;
  if (selection === null) return yield* Effect.die('The archive fixture serves no default model');
  const facets = yield* sessionStoreOver(db, units, parts.spells, records, Context.get(runtime.owners, ModelChanges), () => Effect.void);
  const made = new Set<string>();
  return {
    data: world.dataHome,
    world,
    runtime,
    projectId: project.id,
    db,
    units,
    records,
    store,
    parts,
    facets,
    models: catalog.models,
    selection,
    made,
  };
});
class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/ThreadArchiveWorld') {}
const born = Effect.fnUntraced(function* (title: string) {
  const { projectId, units, store, parts, selection, made } = yield* World;
  const id = yield* units.write('threadArchive.root', (unit) =>
    Effect.gen(function* () {
      const row = yield* store.insert({ ownerId: OPERATOR_PRINCIPAL, agentId: 'tagma', ...selection }, unit);
      yield* parts.rows.attachFacet({ threadId: row.id, projectId, title }, unit);
      return row.id;
    }),
  );
  made.add(id);
  return id;
});
const spawned = Effect.fn('testing.archiveChild')(function* (parentId: string, agentId: string, projectId?: number) {
  const { units, store, parts, made } = yield* World;
  const id = yield* units.write('threadArchive.spawned', (unit) =>
    Effect.gen(function* () {
      const child = yield* store.insertChild(parentId, { ownerId: OPERATOR_PRINCIPAL, agentId }, unit);
      if (projectId === undefined) yield* parts.rows.inheritFacet({ threadId: child.id, fromThreadId: parentId, agentId }, unit);
      else yield* parts.rows.attachFacet({ threadId: child.id, projectId }, unit);
      return child.id;
    }),
  );
  made.add(id);
  return id;
});
const ids = Effect.fnUntraced(function* (view: 'live' | 'archived') {
  const { runtime, projectId, made } = yield* World;
  return (yield* listOf(runtime.owners).list(projectId, { view, limit: made.size })).rows.map((row) => row.id);
});
const archivedAt = Effect.fnUntraced(function* (threadId: string) {
  const { runtime } = yield* World;
  const row = yield* listOf(runtime.owners).row(threadId);
  if (row === undefined) return yield* Effect.die(new Error(`no summary for ${threadId}`));
  return row.archivedAt?.getTime() ?? null;
});
const actor = (threadId: string, projectId: number) =>
  ({ kind: 'thread', threadId, projectId, principalId: 'owner-1', session: { harness: 'tagma', key: threadId } }) as const;
const harnessChild = Effect.fn('testing.archivableHarnessChild')(function* (parentId: string, work: 'idle' | 'working', within?: number) {
  const world = yield* World;
  const { runtime, units, store, parts, facets, records, models, made } = world;
  const projectId = within ?? world.projectId;
  const child = yield* units.write('threadArchive.child', (unit) =>
    Effect.gen(function* () {
      const row = yield* store.insertChild(parentId, { ownerId: OPERATOR_PRINCIPAL, agentId: 'harness' }, unit);
      yield* parts.rows.attachFacet(
        {
          threadId: row.id,
          projectId,
          harness: {
            facet: {
              name: 'devin',
              presentation: harnessPresentation('devin'),
              sessionKey: null,
              execution: null,
              observation: unmeasuredObservation(),
            },
            kernel: terminalKernel('devin', undefined, false, {}),
          },
        },
        unit,
      );
      return row.id;
    }),
  );
  made.add(child);
  yield* facets.open(child, '', 'a departed server', terminalArgv(models, ''));
  yield* Effect.addFinalizer(() =>
    facets
      .change(child, (facet) =>
        Effect.succeed({
          facet: { ...facet, session: facet.session === undefined ? facet.session : { ...facet.session, ownerId: null } },
          value: undefined,
        }),
      )
      .pipe(Effect.asVoid, Effect.orDie),
  );
  yield* facets.change(child, (facet) =>
    Effect.succeed({
      facet: { ...facet, session: facet.session === undefined ? facet.session : { ...facet.session, state: 'running', ownerId: null } },
      value: undefined,
    }),
  );
  if (work === 'working')
    yield* Context.get(runtime.owners, HarnessReports).reported(child, {
      event: { hook_event_name: 'UserPromptSubmit', session_id: 'archive-child' },
      capturedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    });
  const runId = (yield* records.facts(child))?.runningRunId ?? null;
  return { child, facets, runId };
});
const lineSchema = Schema.fromJsonString(Schema.Struct({ kind: Schema.optional(Schema.String), meta: Schema.optional(Schema.Unknown) }));
const metaSchema = Schema.Struct({
  record: Schema.Struct({ id: Schema.String, projectId: Schema.Number, archivedAt: Schema.NullOr(Schema.String) }),
  mandate: Schema.Struct({ id: Schema.String }),
  native: Schema.Struct({ id: Schema.String }),
  external: Schema.Unknown,
  opener: Schema.Unknown,
});

layer(Layer.effect(World, setup).pipe(Layer.provide(fixture), Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'thread archival',
  (it) => {
    it.effect('archiving a root stamps the whole subtree once, and the sets never mix', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const list = listOf(runtime.owners);
        const root = yield* born('a team');
        const child = yield* spawned(root, 'worker');
        const grandchild = yield* spawned(child, 'helper');
        expect(yield* ids('live')).toEqual(expect.arrayContaining([root, child, grandchild]));
        expect((yield* list.setArchived(root, projectId, true)).archivedAt).not.toBeNull();
        const stamp = yield* archivedAt(root);
        expect(yield* archivedAt(child)).toBe(stamp);
        expect(yield* archivedAt(grandchild)).toBe(stamp);
        const live = yield* ids('live');
        expect(live).not.toContain(root);
        expect(live).not.toContain(child);
        expect(live).not.toContain(grandchild);
        const archived = yield* ids('archived');
        expect(archived).toEqual(expect.arrayContaining([root, child, grandchild]));
        for (const id of live) expect(archived).not.toContain(id);
      }),
    );

    it.effect('single and bulk archive end a descendant’s background call before putting the subtree away', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const calls = Context.get(runtime.owners, HarnessCalls);
        const list = listOf(runtime.owners);
        for (const bulk of [false, true]) {
          const root = yield* born(bulk ? 'bulk background team' : 'single background team');
          const child = yield* spawned(root, 'tagma');
          const signal = `background-ended:${child}`;
          const call = calls.open({ threadId: child, runId: `run-ended:${child}`, toolCallId: 'background', name: 'read', input: {} });
          const entered = yield* Deferred.make<void>();
          let released = false;
          const waiter = yield* Effect.forkScoped(
            call.run({
              work: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
              background: () => 'receipt',
              stopped: () => Effect.succeed('stopped'),
              completed: () =>
                Context.get(runtime.owners, ThreadHarness)
                  .threads.handle(child, OPERATOR_PRINCIPAL)
                  .sendSignal(
                    { id: signal, type: 'tool-result', addressee: 'transport', text: 'The background call ended.' },
                    { ifActive: 'deliver', ifIdle: 'wake' },
                  )
                  .pipe(Effect.asVoid, Effect.orDie),
              release: Effect.sync(() => {
                released = true;
              }),
            }),
          );
          yield* Deferred.await(entered);
          expect((yield* call.handOff()).status).toBe('changed');
          expect(yield* Fiber.join(waiter)).toBe('receipt');
          if (bulk)
            expect((yield* list.setArchivedMatching(projectId, { ids: [root] }, true, { kind: 'operator' })).moved).toEqual(
              expect.arrayContaining([root, child]),
            );
          else yield* turnsOf(runtime.owners).archive(root, projectId, { kind: 'operator' });
          expect(call.record.phase).toBe('stopped');
          expect(released).toBe(true);
          expect(yield* archivedAt(root)).not.toBeNull();
          expect(yield* archivedAt(child)).toBe(yield* archivedAt(root));
          expect((yield* list.row(child))?.activeRun).toBeNull();
          expect(yield* inboxOf(runtime.owners).receipt(signal)).toMatchObject({ state: 'queued', deliveredToRunId: null });
        }
      }),
    );

    it.effect('bulk archive keeps a descendant in a removed home project reachable through its living ancestor', () =>
      Effect.gen(function* () {
        const { world, projectId, db, units } = yield* World;
        const root = yield* born('a team with a removed home');
        const removed = yield* world.plainProject();
        const child = yield* spawned(root, 'tagma', removed);
        expect((yield* world.op('remove_project', { ref: String(removed) })).status).toBe(200);
        const stamp = new Date('2000-01-01T00:00:00.000Z');
        yield* units.write('threadArchive.dateRemovedFamily', (unit) =>
          unit.run(db.update(thread()).set({ updatedAt: stamp }).where(eq(thread().id, root))),
        );
        const archived = yield* world.op(
          'archive_threads',
          { updatedSince: stamp.toISOString(), updatedBefore: new Date(stamp.getTime() + 1).toISOString() },
          `project=${projectId}`,
        );
        expect(archived.body).toMatchObject({ status: 'swept', moved: expect.arrayContaining([root, child]) });
        expect(yield* archivedAt(root)).not.toBeNull();
        expect(yield* archivedAt(child)).toBe(yield* archivedAt(root));
      }),
    );

    it.effect('deleting an active half-born child completes its missing first rollout and removes the thread', () =>
      Effect.gen(function* () {
        const { world, runtime, projectId, db, units } = yield* World;
        const child = yield* spawned(yield* born('parent of an interrupted birth'), 'tagma');
        const files = yield* FileSystem.FileSystem;
        const path = Context.get(runtime.owners, ThreadRollouts).pathOf(projectId, child);
        if (path === undefined) return yield* Effect.die('The archive fixture has no rollout place.');
        expect(yield* files.exists(path)).toBe(false);
        const departed = new Date(0);
        yield* units.write('threadArchive.halfBornRun', (unit) =>
          unit.run(
            db.insert(threadRun()).values({
              threadId: child,
              ownerId: 'departed-birth',
              startedAt: departed,
              heartbeatAt: departed,
              createdAt: departed,
              updatedAt: departed,
            }),
          ),
        );
        expect((yield* listOf(runtime.owners).row(child))?.activeRun).not.toBeNull();
        expect((yield* world.op('delete_thread', { threadId: child }, `project=${projectId}`)).body).toMatchObject({
          status: 'deleted',
          threadId: child,
        });
        expect(yield* listOf(runtime.owners).row(child)).toBeUndefined();
      }),
    );

    it.effect('a bulk candidate that opens a run before admission is held stays live and is named working', () =>
      Effect.gen(function* () {
        const { runtime, projectId, db, units, parts } = yield* World;
        const id = yield* born('archive admission race');
        let opened = '';
        const now = new Date(yield* Clock.currentTimeMillis);
        const answer = yield* parts.list.setArchivedWhere(
          OPERATOR_PRINCIPAL,
          projectId,
          { view: 'live', ids: [id] },
          now,
          null,
          (_ids, work) =>
            Effect.gen(function* () {
              const row = yield* units.write('threadArchive.openedDuringAdmission', (unit) =>
                unit.run(
                  db
                    .insert(threadRun())
                    .values({ threadId: id, ownerId: OPERATOR_PRINCIPAL, startedAt: now, heartbeatAt: now, createdAt: now, updatedAt: now })
                    .returning({ id: threadRun().id })
                    .get(),
                ),
              );
              if (row === undefined) return yield* Effect.die(new Error('the racing run could not be opened'));
              opened = row.id;
              return yield* work(() => Effect.void);
            }),
        );
        expect(answer.moved).toEqual([]);
        expect(answer.working).toEqual([{ threadId: id, runId: opened }]);
        expect(yield* archivedAt(id)).toBeNull();
        yield* units.write('threadArchive.closeRacingRun', (unit) =>
          unit.run(db.update(threadRun()).set({ status: 'aborted', finishedAt: now }).where(eq(threadRun().id, opened))),
        );
      }),
    );

    it.effect('a child archived on its own keeps resting when its parent comes back', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const list = listOf(runtime.owners);
        const root = yield* born('a team with a retired member');
        const retired = yield* spawned(root, 'retired');
        const active = yield* spawned(root, 'active');
        yield* list.setArchived(retired, projectId, true);
        const own = yield* archivedAt(retired);
        yield* list.setArchived(root, projectId, true);
        expect(yield* archivedAt(retired)).toBe(own);
        yield* list.setArchived(root, projectId, false);
        expect(yield* archivedAt(root)).toBeNull();
        expect(yield* archivedAt(active)).toBeNull();
        expect(yield* archivedAt(retired)).toBe(own);
      }),
    );

    it.effect('a thread put away and moved again leaves the live list instead of returning to it', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const list = listOf(runtime.owners);
        const root = yield* born('a parent whose child finished');
        const child = yield* spawned(root, 'finished');
        yield* list.setArchived(child, projectId, true);
        const seen: string[] = [];
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.acquireRelease(
              Effect.sync(() =>
                list.subscribe(projectId, (event) => {
                  if (event.kind === 'row' && event.row.id === child) seen.push('row');
                  if (event.kind === 'removed' && event.threadId === child) seen.push('removed');
                }),
              ),
              (stop) => Effect.sync(stop),
            );
            yield* list.announceThread(child);
          }),
        );
        expect(seen).toEqual(['removed']);
      }),
    );

    it.effect(
      'the spawn tree names each thread own lineage, subtree or beyond for the caller, and a sweep beyond when it selects past the subtree',
      () =>
        Effect.gen(function* () {
          const { runtime, projectId } = yield* World;
          const list = listOf(runtime.owners);
          const root = yield* born('relations');
          const child = yield* spawned(root, 'child');
          const grandchild = yield* spawned(child, 'grandchild');
          const sibling = yield* spawned(root, 'sibling');
          expect([
            yield* list.relation(child, child),
            yield* list.relation(root, child),
            yield* list.relation(grandchild, child),
            yield* list.relation(sibling, child),
          ]).toEqual(['lineage', 'lineage', 'subtree', 'beyond']);
          expect(yield* list.sweepRelation(projectId, { ids: [root, child, grandchild] }, true, child)).toBe('subtree');
          expect(yield* list.sweepRelation(projectId, { ids: [grandchild, sibling] }, true, child)).toBe('beyond');
        }),
    );

    it.effect('an agent that archives its own lineage puts it away with everything under it', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const root = yield* born('lineage');
        const child = yield* spawned(root, 'child');
        const grandchild = yield* spawned(child, 'grandchild');
        yield* turnsOf(runtime.owners).archive(root, projectId, actor(child, projectId));
        expect(yield* archivedAt(root)).not.toBeNull();
        expect([yield* archivedAt(child), yield* archivedAt(grandchild)]).toEqual([yield* archivedAt(root), yield* archivedAt(root)]);
      }),
    );

    it.effect('a sweep stamps every matched thread and its descendants at once, and names what it left working', () =>
      Effect.gen(function* () {
        const { runtime, projectId, db, units } = yield* World;
        const list = listOf(runtime.owners);
        const now = new Date(yield* Clock.currentTimeMillis);
        const weekAgo = new Date(now.getTime() - 8 * 86_400_000);
        const stale = yield* born('idle a week');
        const staleChild = yield* spawned(stale, 'idle child');
        const busy = yield* born('idle a week, but a child is working');
        const busyChild = yield* spawned(busy, 'still working');
        const fresh = yield* born('moved today');
        const runId = yield* units.write('threadArchive.runId', (unit) =>
          Effect.gen(function* () {
            for (const id of [stale, staleChild, busy, busyChild])
              yield* unit.run(db.update(thread()).set({ updatedAt: weekAgo }).where(eq(thread().id, id)));
            const row = yield* unit.run(
              db
                .insert(threadRun())
                .values({
                  threadId: busyChild,
                  ownerId: OPERATOR_PRINCIPAL,
                  startedAt: now,
                  heartbeatAt: now,
                  createdAt: now,
                  updatedAt: now,
                })
                .returning({ id: threadRun().id })
                .get(),
            );
            if (row === undefined) return yield* Effect.die(new Error('the busy child has no run'));
            return row.id;
          }),
        );
        const cutoff = new Date(now.getTime() - 7 * 86_400_000);
        const sweep = yield* list.setArchivedMatching(projectId, { updatedAt: { before: cutoff } }, true, { kind: 'operator' });
        expect(sweep.moved).toEqual(expect.arrayContaining([stale, staleChild]));
        expect(sweep.moved).not.toContain(busy);
        expect(sweep.moved).not.toContain(fresh);
        expect(sweep.working).toHaveLength(2);
        expect(sweep.working).toEqual(
          expect.arrayContaining([
            { threadId: busy, runId },
            { threadId: busyChild, runId },
          ]),
        );
        expect(yield* archivedAt(stale)).toBe(yield* archivedAt(staleChild));
        expect(yield* archivedAt(busy)).toBeNull();
        expect(yield* archivedAt(fresh)).toBeNull();
        expect((yield* list.setArchivedMatching(projectId, { updatedAt: { before: cutoff } }, false, { kind: 'operator' })).moved).toEqual(
          expect.arrayContaining([stale, staleChild]),
        );
        expect(yield* archivedAt(stale)).toBeNull();
        expect(yield* archivedAt(staleChild)).toBeNull();
        const mine = yield* born('a parent that sweeps');
        const mineChild = yield* spawned(mine, 'finished child');
        yield* units.write('threadArchive', (unit) =>
          unit.run(db.update(thread()).set({ updatedAt: weekAgo }).where(eq(thread().id, mineChild))),
        );
        expect((yield* list.setArchivedMatching(projectId, { ids: [mine, mineChild] }, true, actor(mineChild, projectId))).moved).toEqual(
          [],
        );
        expect(yield* archivedAt(mine)).toBeNull();
        expect((yield* list.setArchivedMatching(projectId, { ids: [mine, mineChild] }, true, actor(mine, projectId))).moved).toEqual([
          mineChild,
        ]);
        const finishedAt = new Date(yield* Clock.currentTimeMillis);
        yield* units.write('threadArchive', (unit) =>
          unit.run(db.update(threadRun()).set({ status: 'aborted', finishedAt }).where(eq(threadRun().id, runId))),
        );
      }),
    );

    it.effect('archiving stops a run whose owner has departed anywhere in the subtree and puts the thread away', () =>
      Effect.gen(function* () {
        const { runtime, projectId, db, units } = yield* World;
        const root = yield* born('busy team');
        const child = yield* spawned(root, 'busy child');
        const now = new Date(yield* Clock.currentTimeMillis);
        yield* units.write('threadArchive.runId', (unit) =>
          unit.run(
            db.insert(threadRun()).values({
              threadId: child,
              ownerId: 'departed-owner',
              startedAt: now,
              heartbeatAt: new Date(0),
              createdAt: now,
              updatedAt: now,
            }),
          ),
        );
        yield* turnsOf(runtime.owners).archive(root, projectId, { kind: 'operator' });
        expect(yield* archivedAt(root)).not.toBeNull();
        expect(yield* archivedAt(child)).toBe(yield* archivedAt(root));
      }),
    );

    it.effect('reader words revive an archived thread and put it at the top of the live list', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const id = yield* born('put away, then written to');
        yield* listOf(runtime.owners).setArchived(id, projectId, true);
        expect(yield* ids('live')).not.toContain(id);
        yield* turnsOf(runtime.owners).send(id, projectId, 'a word from the reader');
        expect(yield* archivedAt(id)).toBeNull();
        expect((yield* ids('live'))[0]).toBe(id);
      }),
    );

    it.effect('archive and restoration carry each subtree member’s stamp and owned facets into its rollout', () =>
      Effect.gen(function* () {
        const { runtime, projectId, data } = yield* World;
        const files = yield* FileSystem.FileSystem;
        const root = yield* born('archived on disk');
        const child = yield* spawned(root, 'tagma');
        const rollouts = Context.get(runtime.owners, ThreadRollouts);
        for (const id of [root, child]) yield* rollouts.ensure(id);
        for (const archived of [true, false]) {
          yield* listOf(runtime.owners).setArchived(root, projectId, archived);
          for (const id of [root, child]) {
            const lines = (yield* files.readFileString(join(data, 'threads', String(projectId), `${id}.jsonl`)))
              .split('\n')
              .filter((line) => line.length > 0);
            const parsed = yield* Effect.forEach(lines, (line) => Schema.decodeUnknownEffect(lineSchema)(line));
            const meta = yield* Schema.decodeUnknownEffect(metaSchema)(parsed.filter((line) => line.kind === 'meta').at(-1)?.meta);
            expect(meta.record).toMatchObject({
              id,
              projectId,
              archivedAt: archived ? new Date((yield* archivedAt(id)) ?? 0).toISOString() : null,
            });
            expect(meta.mandate.id).toBe(id);
            expect(meta.native.id).toBe(id);
            expect(meta.external).toBeNull();
            expect(meta.opener).toBeNull();
          }
        }
      }),
    );

    it.effect('the selection cuts by a clock, counts the whole, and refuses a clock the set does not carry', () =>
      Effect.gen(function* () {
        const { runtime, projectId, db, units, made } = yield* World;
        const list = listOf(runtime.owners);
        const idle = yield* born('idle for a week');
        const fresh = yield* born('moved today');
        const now = yield* Clock.currentTimeMillis;
        const weekAgo = new Date(now - 7 * 86_400_000);
        yield* units.write('threadArchive', (unit) =>
          unit.run(db.update(thread()).set({ updatedAt: weekAgo }).where(eq(thread().id, idle))),
        );
        const stale = yield* list.list(projectId, {
          view: 'live',
          updatedAt: { before: new Date(now - 3 * 86_400_000) },
          limit: made.size,
        });
        expect(stale.rows.map((row) => row.id)).toContain(idle);
        expect(stale.rows.map((row) => row.id)).not.toContain(fresh);
        expect(stale.total).toBe(stale.rows.length);
        const paged = yield* list.list(projectId, { view: 'live', limit: 1 });
        expect(paged.rows).toHaveLength(1);
        expect(paged.total).toBeGreaterThan(1);
        const refused = yield* Effect.exit(list.list(projectId, { view: 'live', archivedAt: { since: weekAgo }, limit: 1 }));
        if (Exit.isSuccess(refused)) return yield* Effect.die(new Error('the live set admitted an archived clock'));
        expect(threadCauseOf(Cause.squash(refused.cause))).toMatchObject({ code: 'selection-shape' });
      }),
    );

    it.effect('a harness child at rest is put away in one act, and its CLI ends with it', () =>
      Effect.gen(function* () {
        const { runtime, projectId, models } = yield* World;
        const root = yield* born('parent of a resting CLI');
        const { child, facets } = yield* harnessChild(root, 'idle');
        yield* listOf(runtime.owners).setArchived(root, projectId, true);
        expect(yield* archivedAt(root)).not.toBeNull();
        expect(yield* archivedAt(child)).toBe(yield* archivedAt(root));
        expect((yield* facets.read(child))?.session?.state).toBe('ended');
        yield* listOf(runtime.owners).setArchived(root, projectId, false);
        yield* facets.open(child, '', 'a word after the thread came back', terminalArgv(models, ''));
        expect((yield* facets.read(child))?.session?.state).not.toBe('ended');
      }),
    );

    it.effect('continuing a CLI thread with no prior turn refuses without opening one', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const { child } = yield* harnessChild(yield* born('parent of a CLI with no prior turn'), 'idle');
        expect(threadCauseOf(yield* Effect.flip(turnsOf(runtime.owners).continueThread(child, projectId)))).toBeInstanceOf(
          ThreadRunNotInterruptedError,
        );
        expect((yield* listOf(runtime.owners).row(child))?.activeRun).toBeNull();
      }),
    );

    it.effect('a harness child mid-turn is put away and its CLI ended', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const busy = yield* born('parent of a working CLI');
        const { child, facets } = yield* harnessChild(busy, 'working');
        yield* listOf(runtime.owners).setArchived(busy, projectId, true);
        expect(yield* archivedAt(child)).toBe(yield* archivedAt(busy));
        expect((yield* facets.read(child))?.session?.state).toBe('ended');
      }),
    );

    it.effect('removing a project ends the turn and the CLI of its agent and keeps the thread unarchived', () =>
      Effect.gen(function* () {
        const { runtime, records } = yield* World;
        const files = yield* FileSystem.FileSystem;
        const lifecycle = Context.get(runtime.graph, ProjectLifecycle);
        const rootPath = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-ar-leaving-' });
        const leaving = yield* lifecycle.create({ name: 'leaving', rootPath, storage: 'stealth' }).pipe(Effect.provide(runtime.owners));
        const parent = (yield* birthsOf(runtime.owners).create({ projectId: leaving.id, createdBySessionId: null, title: 'leaving' }))
          .thread.id;
        const { child, facets, runId } = yield* harnessChild(parent, 'working', leaving.id);
        expect(runId).not.toBeNull();
        yield* lifecycle.remove({ ref: 'leaving' }).pipe(Effect.provide(runtime.owners));
        expect((yield* facets.read(child))?.session?.state).toBe('ended');
        expect(yield* records.facts(child)).toMatchObject({ runningRunId: null });
        expect(yield* listOf(runtime.owners).row(child)).toMatchObject({ archivedAt: null });
      }),
    );

    it.effect('a sweep puts away a resting harness thread and ends its CLI, and names a mid-turn one as working', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const resting = yield* born('sweep: parent of a resting CLI');
        const { child: restingChild, facets } = yield* harnessChild(resting, 'idle');
        const busy = yield* born('sweep: parent of a working CLI');
        const { child: busyChild, runId: busyRun } = yield* harnessChild(busy, 'working');
        const sweep = yield* listOf(runtime.owners).setArchivedMatching(projectId, { ids: [resting, busy] }, true, { kind: 'operator' });
        expect(sweep.moved).toEqual(expect.arrayContaining([resting, restingChild]));
        expect(sweep.moved).not.toContain(busy);
        expect(busyRun).not.toBeNull();
        expect(sweep.working).toEqual([{ threadId: busy, runId: busyRun ?? '' }]);
        expect(yield* archivedAt(restingChild)).toBe(yield* archivedAt(resting));
        expect(yield* archivedAt(busy)).toBeNull();
        expect((yield* facets.read(restingChild))?.session?.state).toBe('ended');
        expect((yield* facets.read(busyChild))?.session?.state).toBe('running');
      }),
    );

    it.effect('a child spawned under an archived parent is born archived', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const root = yield* born('archived parent');
        yield* listOf(runtime.owners).setArchived(root, projectId, true);
        const child = yield* spawned(root, 'late child');
        expect(yield* archivedAt(child)).toBe(yield* archivedAt(root));
        expect(yield* ids('live')).not.toContain(child);
      }),
    );
  },
);
