import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Effect, Layer } from 'effect';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { batchDocument } from '../../../graph/contract/wire/batch.js';
import { event } from '../../../graph/store/tables.js';
import { GraphStore } from '../../../platform/contract/service/store.js';
import type { Project } from '../../../graph/contract/wire/rows.js';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';

const shared = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const registered = yield* world.op('add_project', {
    name: world.uniqueName(),
    rootPath: yield* world.directory('journal'),
    storage: 'stealth',
  });
  expect(registered.status).toBe(200);
  const { id, rootPath } = (registered.body as { project: Project }).project;
  yield* projectLeaving(world, id);
  return { root: rootPath, id };
});
class JournalProject extends Context.Service<JournalProject, Effect.Success<typeof shared>>()('testing/JournalProject') {}
const op = (id: string, input: unknown, project: number) =>
  Effect.flatMap(DoorFixture, (world) => world.op(id, input, `project=${project}`));
const born = (project: number, input: unknown) =>
  Effect.map(op('create_block', input, project), (answer) => (answer.body as { block: { name: string } }).block.name);

layer(Layer.effect(JournalProject, shared).pipe(Layer.provideMerge(doorFixture())), { excludeTestServices: true, timeout: 60_000 })(
  'journal door',
  (it) => {
    it.effect('journal pages preserve missing-block events and filter their tag and operation windows', () =>
      Effect.gen(function* () {
        const { id: projectId } = yield* JournalProject;
        const filled = yield* op(
          'apply_batch',
          batchDocument(Array.from({ length: 3 }, (_, index) => ({ op: 'create', tags: ['idea'], title: `d${index}` }))),
          projectId,
        );
        expect(filled.status).toBe(200);

        type Page = { events: { id: number }[]; next: string | null };
        const paged = (yield* op('read_events', { limit: 2 }, projectId)).body as Page;
        expect(paged.events.length).toBe(2);
        expect(paged.next).not.toBeNull();
        const delta = (yield* op('read_events', { sinceId: 0 }, projectId)).body as Page;
        expect(delta.events.length).toBeGreaterThan(2);
        const newest = paged.events[0];
        const oldest = paged.events.at(-1);
        const older = (yield* op('read_events', { cursor: paged.next }, projectId)).body as Page;
        expect(older.events.length).toBeGreaterThan(0);
        expect(older.events.every((row) => row.id < (oldest?.id ?? 0))).toBe(true);
        expect(newest?.id).toBeGreaterThan(oldest?.id ?? 0);
        yield* Effect.gen(function* () {
          const world = yield* DoorFixture;
          yield* born(projectId, { tags: ['idea'], title: 'kept' });
          const served = yield* world.runtime.pool.resolve({ projectId }).pipe(Effect.provide(world.runtime.owners));
          yield* Context.get(served.context, GraphStore)
            .db.insert(event)
            .values({ ts: new Date(yield* Clock.currentTimeMillis), op: 'update', blockId: 999_999, projectId, payload: '{}' })
            .pipe(Effect.provide(served.context));

          const read = yield* op('read_events', {}, projectId);
          expect(read.status).toBe(200);
          const rows = (read.body as { events: { op: string; blockName: string | null }[] }).events;
          expect(rows[0]).toMatchObject({ op: 'update', blockName: null });
          expect(rows.some((row) => row.op === 'create' && row.blockName !== null)).toBe(true);
        });
        yield* Effect.gen(function* () {
          const doc = yield* born(projectId, { tags: ['idea'], title: 'd' });
          yield* born(projectId, { tags: ['spec'], title: 's' });
          yield* op('update_block', { blockId: doc, title: 'd2' }, projectId);
          const tagged = yield* op('read_journal', { tags: ['spec'] }, projectId);
          expect((tagged.body as { batches: unknown[] }).batches.length).toBe(1);
          const created = yield* op('read_journal', { ops: ['create'] }, projectId);
          expect((created.body as { batches: { ops: string[] }[] }).batches.every((batch) => batch.ops.includes('create'))).toBe(true);
          const vocabulary = yield* op('read_journal_vocabulary', {}, projectId);
          expect(vocabulary.body).toMatchObject({ tags: expect.arrayContaining(['idea', 'spec']) });
        });
      }),
    );

    it.effect('an installation the reading cannot open is a line in the report, not a dead door', () =>
      Effect.gen(function* () {
        const { root, id: projectId } = yield* JournalProject;
        mkdirSync(join(root, '.agents', 'skills'), { recursive: true });
        const blocked = join(root, '.agents', 'skills', 'tagma');
        yield* Effect.acquireRelease(
          Effect.sync(() => writeFileSync(blocked, 'not a directory\n')),
          () => Effect.sync(() => rmSync(blocked)),
        );
        const report = yield* op('read_installation_status', {}, projectId);
        expect(report.status).toBe(200);
        const skill = (report.body as { skill: { state: string; path?: string; reason?: string }[] }).skill[0]!;
        expect(skill.state).toBe('unreadable');
        expect(skill.path).toBe(blocked);
        expect(skill.reason?.length).toBeGreaterThan(0);
      }),
    );
  },
);
