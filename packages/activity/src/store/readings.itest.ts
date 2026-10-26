import { expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layer } from '@runlith/effect-test';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { Effect, Layer } from 'effect';
import type { ActivityEnded, ActivityFact, ActivityOpened } from '../fact';
import { ActivityStore, activityStoreLayer } from './ActivityStore';
import { ActivityRecord } from './record';

const fixture = Layer.unwrap(
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'activity-readings-'))),
      (at) => Effect.sync(() => rmSync(at, { recursive: true, force: true })),
    );
    return Layer.orDie(
      activityStoreLayer({
        database: join(root, 'activity.sqlite'),
        bodies: join(root, 'bodies'),
        processes: yield* heldPool,
        readingsMax: 2,
        migrations: fileURLToPath(new URL('../../drizzle', import.meta.url)),
        keeping: () => ({ hours: 24, bodiesMaxBytes: 1024 * 1024 }),
        projectsOf: (threads) => Effect.succeed(new Map(threads.map((thread) => [thread, 7]))),
      }),
    );
  }),
);

const at = Date.now();
const scope = { project: 7, through: at + 1000, where: [] } as const;
const emit = (facts: readonly ActivityFact[]) =>
  Effect.flatMap(ActivityStore, (store) =>
    Effect.andThen(
      Effect.sync(() => {
        for (const fact of facts) store.log.record(fact);
      }),
      store.settled,
    ),
  );
const opened = (id: string, thread: string): ActivityOpened => ({
  _tag: 'Opened',
  id,
  thread,
  at,
  parent: null,
  run: null,
  project: null,
  kind: 'work',
  actor: { kind: 'operator' },
  trigger: null,
  attrs: {},
});
const ended = (activity: string, ms: number): ActivityEnded => ({
  _tag: 'Ended',
  activity,
  at: at + ms,
  outcome: 'ok',
  reason: null,
  message: null,
  result: {},
});
const read = <A>(ask: (record: ActivityRecord['Service']) => Effect.Effect<A, unknown>) => Effect.flatMap(ActivityRecord, ask);

layer(fixture, { excludeTestServices: true })('activity readings', (it) => {
  it.effect('an ordered cursor keeps its identities after an open row changes rank and refreshes the row revision', () =>
    Effect.gen(function* () {
      yield* emit([opened('ordered-a', 'ordered'), ended('ordered-a', 10), opened('ordered-b', 'ordered')]);
      const query = {
        ...scope,
        threads: ['ordered'],
        paths: ['id', 'durationMs'],
        order: { by: 'durationMs', dir: 'asc' } as const,
        limit: 1,
      };
      const first = yield* read((record) => record.rows(query));
      expect(first.rows.map((row) => row.values.id)).toEqual(['ordered-a']);
      yield* emit([ended('ordered-b', 1)]);
      const second = yield* read((record) => record.rows({ ...query, reading: first.reading, offset: first.next }));
      expect(second.rows.map((row) => row.values)).toEqual([{ id: 'ordered-b', durationMs: 1 }]);
      expect(second.more).toBe(false);
      expect(second.total).toBe(2);
    }),
  );

  it.effect('a group cursor continues the original aggregate when an open row changes outcome', () =>
    Effect.gen(function* () {
      yield* emit([opened('group-a', 'grouped'), ended('group-a', 10), opened('group-b', 'grouped')]);
      const query = { ...scope, threads: ['grouped'], group: ['outcome'], count: true, sum: [], offset: 0, limit: 1 };
      const first = yield* read((record) => record.groups(query));
      expect(first.groups).toEqual([{ by: { outcome: 'ok' }, absent: [], count: 1, sum: {}, unknown: {} }]);
      yield* emit([ended('group-b', 20)]);
      const second = yield* read((record) => record.groups({ ...query, reading: first.reading, offset: first.next }));
      expect(second.groups).toEqual([{ by: { outcome: 'open' }, absent: [], count: 1, sum: {}, unknown: {} }]);
      expect(second.matched).toBe(2);
      expect(second.total).toBe(2);
    }),
  );

  it.effect('a retained reading refuses a continuation with a different predicate', () =>
    Effect.gen(function* () {
      yield* emit([opened('predicate-a', 'predicate'), opened('predicate-b', 'predicate')]);
      const query = { ...scope, threads: ['predicate'], paths: ['id'], limit: 1 };
      const first = yield* read((record) => record.rows(query));
      const changed = yield* read((record) =>
        Effect.flip(
          record.rows({
            ...query,
            reading: first.reading,
            resumed: true,
            offset: first.next,
            where: [{ path: 'id', op: 'eq', value: 'predicate-b' }],
          }),
        ),
      );
      expect(changed).toMatchObject({ _tag: 'ActivityUnreadable' });
    }),
  );

  it.effect('the oldest reading is refused after the store reaches its live reading ceiling', () =>
    Effect.gen(function* () {
      yield* emit([opened('evicted-a', 'evicted'), opened('evicted-b', 'evicted')]);
      const query = { ...scope, threads: ['evicted'], paths: ['id'], limit: 1 };
      const first = yield* read((record) => record.rows(query));
      const second = yield* read((record) => record.rows(query));
      yield* read((record) => record.rows(query));
      const expired = yield* read((record) =>
        Effect.flip(record.rows({ ...query, reading: first.reading, resumed: true, offset: first.next })),
      );
      expect(expired).toMatchObject({ _tag: 'ActivityUnreadable' });
      const continued = yield* read((record) => record.rows({ ...query, reading: second.reading, resumed: true, offset: second.next }));
      expect(continued.rows.map((row) => row.values.id)).toEqual(['evicted-b']);
    }),
  );

  it.effect('oversized metadata is counted as loss without losing adjacent admissible facts', () =>
    Effect.gen(function* () {
      const huge = { text: 'я'.repeat(9 * 1024) };
      const open = opened('metadata-open', 'metadata');
      yield* emit([
        { ...open, attrs: huge },
        opened('metadata-ok', 'metadata'),
        { _tag: 'Noted', activity: 'metadata-ok', at, note: { type: 'huge', ...huge } },
        { ...ended('metadata-ok', 1), result: huge },
      ]);
      const answer = yield* read((record) => record.rows({ ...scope, threads: ['metadata'], paths: ['id', 'outcome'], limit: 2 }));
      expect(answer.rows.map((row) => row.values)).toEqual([{ id: 'metadata-ok', outcome: 'open' }]);
      expect(answer.lost).toContainEqual(expect.objectContaining({ cause: 'metadata-ceiling', facts: 3 }));
    }),
  );

  it.effect('thread populations are total-bearing pages and a stored membership can aggregate without returning its population', () =>
    Effect.gen(function* () {
      yield* emit([opened('population-a', 'population-a'), opened('population-b', 'population-b')]);
      const query = { project: 7, ids: ['population-a', 'population-b'], limit: 1 };
      const first = yield* read((record) => record.threads(query));
      expect(first).toEqual({ threads: ['population-a'], total: 2, reading: expect.any(String), after: 'population-a' });
      const second = yield* read((record) => record.threads({ ...query, reading: first.reading, after: first.after! }));
      expect(second).toEqual({ threads: ['population-b'], total: 2, reading: first.reading, after: null });
      yield* read((record) => record.members('population', first.threads));
      yield* read((record) => record.members('population', second.threads));
      const groups = yield* read((record) =>
        record.groups({ ...scope, members: 'population', group: [], count: true, sum: [], offset: 0, limit: 1 }),
      );
      expect(groups.groups).toEqual([{ by: {}, absent: [], count: 2, sum: {}, unknown: {} }]);
    }),
  );
});
