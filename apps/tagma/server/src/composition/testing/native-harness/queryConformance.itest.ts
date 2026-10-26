import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { activity } from '@runlith/activity/Activity';
import { activityKind } from '@runlith/activity/fact';
import { ActivityLog } from '@runlith/activity/log';
import { ActivityStore } from '@runlith/activity/store';
import {
  matchesThreadQuery,
  orderThreadRows,
  ThreadQueryFold,
  type ThreadQueryPredicate,
  type ThreadQueryRow,
} from '@runlith/agent/thread/ThreadQuery';
import { asEvidenceAnswer } from '../../../threads/testing/doubles.js';
import { makeDoorWorld } from '../doorFixture.js';

const PROBE = activityKind<Record<string, unknown>>('probe');

const DOCUMENTS: readonly Record<string, unknown>[] = [
  { name: 'upper', label: 'ТЕСТ', box: { 0: 'zero', '00': 'zero', '0e0': 'zero' }, shape: { a: 1, b: 2 } },
  { name: 'lower', label: 'тестовый', box: ['zero'], shape: { b: 2, a: 1 } },
  { name: 'latin', label: 'B', box: { 1: 'one' }, shape: [1] },
  { name: 'small', label: 'a', shape: 's' },
  { name: 'astral', label: '😀' },
  { name: 'compat', label: 'ﬀ' },
  { name: 'accent', label: 'é', shape: 2 },
];

const rows: readonly ThreadQueryRow[] = DOCUMENTS.map((attrs) => ({ attrs }));

const makeReader = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  const projectId = yield* world.stealthProject();
  const created = yield* world.call(`/api/op/create_thread?project=${projectId}`, { method: 'POST', body: {} });
  const threadId = (created.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
  const store = yield* Effect.provide(ActivityStore, yield* Effect.promise(() => world.runtime.runtime.context()));
  yield* Effect.forEach(DOCUMENTS, (attrs) => activity(PROBE, attrs, Effect.void, { thread: threadId }), { discard: true }).pipe(
    Effect.provideService(ActivityLog, store.log),
  );
  yield* store.settled;

  return Effect.fnUntraced(function* (payload: Record<string, unknown>) {
    const answered = yield* world.call(`/api/op/read_thread?project=${projectId}`, {
      method: 'POST',
      body: {
        threadId,
        select: 'activity',
        limit: 50,
        ...payload,
        where: [{ field: 'kind', op: 'eq', value: 'probe' }, ...((payload.where as unknown[]) ?? [])],
      },
    });
    expect(answered.status).toBe(200);
    return (answered.body as { evidence: ReturnType<typeof asEvidenceAnswer> }).evidence;
  });
});

class Reader extends Context.Service<Reader, Effect.Success<typeof makeReader>>()('testing/QueryReader') {}

layer(Layer.effect(Reader, makeReader), { excludeTestServices: true })('query conformance', (it) => {
  it.effect('a predicate selects the same activities the kernel query selects', () =>
    Effect.gen(function* () {
      const read = yield* Reader;
      const cases: readonly ThreadQueryPredicate[][] = [
        [{ field: 'attrs.label', op: 'contains', value: 'тест' }],
        [{ field: 'attrs.box.0', op: 'eq', value: 'zero' }],
        [{ field: 'attrs.box.00', op: 'eq', value: 'zero' }],
        [{ field: 'attrs.box.0e0', op: 'eq', value: 'zero' }],
        [{ field: 'attrs.box', op: 'contains', value: '1' }],
        [{ field: 'attrs.box', op: 'contains', value: 'zero' }],
        [{ field: 'attrs.label', op: 'gt', value: 'ﬀ' }],
      ];
      for (const where of cases) {
        const answered = yield* read({ where, fields: ['attrs.name'] });
        const kernel = rows.filter((row) => matchesThreadQuery(row, where)).map((row) => (row.attrs as { name: string }).name);
        expect(answered.rows.map((row) => row['attrs.name']).toSorted()).toEqual(kernel.toSorted());
      }
    }),
  );

  it.effect('an order ranks text by its UTF-8 bytes in every source', () =>
    Effect.gen(function* () {
      const read = yield* Reader;
      for (const dir of ['asc', 'desc'] as const) {
        const answered = yield* read({ order: { by: 'attrs.label', dir }, fields: ['attrs.name'] });
        const kernel = orderThreadRows(rows, { by: 'attrs.label', dir }).map((row) => (row.attrs as { name: string }).name);
        expect(answered.rows.map((row) => row['attrs.name'])).toEqual(kernel);
      }
    }),
  );

  it.effect('groups are equal by value whatever the member order, and stand in the same order', () =>
    Effect.gen(function* () {
      const read = yield* Reader;
      const fold = new ThreadQueryFold({ select: 'activity', group: ['attrs.shape'], count: true });
      for (const row of rows) fold.take(row);
      const answered = yield* read({ group: ['attrs.shape'], count: true });
      expect(answered.groups?.map((group) => [group.by, group.count])).toEqual(
        fold.answer().groups.map((group) => [group.by, group.count]),
      );
    }),
  );
});
