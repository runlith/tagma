import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Deferred, Effect, Fiber, Layer, Tracer } from 'effect';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore } from '../contract/service/store.js';
import { seededStoreLayer } from './open.js';

const tracing = () => {
  const spans: Tracer.NativeSpan[] = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  return { spans, tracer };
};

const rootOf = (spans: readonly Tracer.NativeSpan[], operation: string) => {
  const root = spans.find((span) => span.name === 'Store.transaction' && span.attributes.get('opKind') === operation);
  if (root === undefined) throw new Error(`missing ${operation} transaction span`);
  return root;
};

const childrenOf = (spans: readonly Tracer.NativeSpan[], operation: string) => {
  const root = rootOf(spans, operation);
  return spans.filter((span) => span.parent._tag === 'Some' && span.parent.value.spanId === root.spanId);
};

layer(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations)), { excludeTestServices: true })('store transactions', (it) => {
  it.effect('a transaction separates permit wait, execution and commit', () =>
    Effect.gen(function* () {
      const { spans, tracer } = tracing();
      yield* Effect.gen(function* () {
        const store = yield* MachineStore;
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const first = yield* Effect.forkChild(
          store.transaction('first', () => Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release))),
        );
        yield* Deferred.await(entered);
        const second = yield* Effect.forkChild(store.transaction('second', () => Effect.void));
        yield* Effect.sleep('1 millis');

        const secondRoot = rootOf(spans, 'second');
        const waiting = spans.find(
          (span) => span.name === 'Store.permit.wait' && span.parent._tag === 'Some' && span.parent.value.spanId === secondRoot.spanId,
        );
        expect(waiting?.status._tag).toBe('Started');

        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
      }).pipe(Effect.withTracer(tracer));

      for (const operation of ['first', 'second']) {
        const children = childrenOf(spans, operation);
        expect(children.filter((span) => span.name.startsWith('Store.')).map((span) => span.name)).toEqual([
          'Store.permit.wait',
          'Store.execute',
          'Store.commit',
        ]);
        expect(children.some((span) => span.name === 'sql.transaction')).toBe(true);
        expect(children.every((span) => span.status._tag === 'Ended')).toBe(true);
      }
    }),
  );

  it.effect('the post-commit tail finishes before a pending interruption is observed', () =>
    Effect.gen(function* () {
      const store = yield* MachineStore;
      yield* store.db.run(sql`create table commit_tail_probe (value integer not null)`);
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let published = false;
      const writing = yield* Effect.forkChild(
        store.transaction('commit-tail', () => store.db.run(sql`insert into commit_tail_probe (value) values (1)`), {
          onCommit: Effect.fnUntraced(function* () {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
            published = true;
          }),
        }),
      );
      yield* Deferred.await(entered);
      const interrupting = yield* Effect.forkChild(Fiber.interrupt(writing));
      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, undefined);
      const exit = yield* Fiber.await(writing);
      yield* Fiber.await(interrupting);

      expect(exit._tag).toBe('Failure');
      expect(published).toBe(true);
      expect(yield* store.db.all<{ value: number }>(sql`select value from commit_tail_probe`)).toEqual([{ value: 1 }]);
    }),
  );

  it.effect('a savepoint publishes nothing until the outermost commit, and nothing when the outermost rolls back', () =>
    Effect.gen(function* () {
      const store = yield* MachineStore;
      yield* store.db.run(sql`create table savepoint_probe (value integer not null)`);
      const published: string[] = [];
      const inner = (value: number) =>
        store.transaction(
          'inner',
          (unit) =>
            Effect.andThen(
              unit.run(store.db.run(sql`insert into savepoint_probe (value) values (${value})`)),
              unit.afterCommit(Effect.sync(() => void published.push(`after ${value}`))),
            ),
          {
            onCommit: () =>
              Effect.orDie(
                Effect.andThen(
                  Effect.sync(() => void published.push(`commit ${value}`)),
                  store.transaction('tail', (unit) =>
                    unit.run(store.db.run(sql`insert into savepoint_probe (value) values (${value + 10})`)),
                  ),
                ),
              ),
          },
        );

      yield* Effect.ignore(store.transaction('rolled back', () => Effect.andThen(inner(1), Effect.fail('turn back'))));
      expect(published).toEqual([]);

      yield* store.transaction('kept', () =>
        Effect.andThen(
          inner(2),
          Effect.sync(() => void published.push('outer body')),
        ),
      );
      expect(published).toEqual(['outer body', 'after 2', 'commit 2']);
      expect(yield* store.db.all<{ value: number }>(sql`select value from savepoint_probe order by value`)).toEqual([
        { value: 2 },
        { value: 12 },
      ]);
    }),
  );

  it.effect('a transaction carries what its statements did on the writer', () =>
    Effect.gen(function* () {
      const { spans, tracer } = tracing();
      yield* Effect.gen(function* () {
        const store = yield* MachineStore;
        yield* store.transaction('verdict', () =>
          Effect.gen(function* () {
            yield* store.db.all(sql`select 1 as one`);
            yield* store.db.all(sql`select 2 as two`);
          }),
        );
        yield* Effect.catch(
          store.transaction('failed-verdict', () => Effect.andThen(store.db.all(sql`select 1 as one`), Effect.fail('turn back'))),
          () => Effect.void,
        );
      }).pipe(Effect.withTracer(tracer));

      const verdictKeys = [
        'db.writer.statements',
        'db.writer.execMs',
        'db.writer.queueMs',
        'db.writer.totalMs',
        'db.writer.maxExecMs',
        'db.writer.maxQueueMs',
      ];
      const execute = childrenOf(spans, 'verdict').find((span) => span.name === 'Store.execute');
      const commit = childrenOf(spans, 'verdict').find((span) => span.name === 'Store.commit');
      if (execute === undefined || commit === undefined) return yield* Effect.die('missing execute or commit span');
      for (const span of [execute, commit]) {
        for (const key of verdictKeys) expect(typeof span.attributes.get(key)).toBe('number');
      }
      expect(execute.attributes.get('db.writer.statements')).toBeGreaterThanOrEqual(2);
      expect(commit.attributes.get('db.writer.statements')).toBeGreaterThanOrEqual(1);
      const atMost = (span: Tracer.NativeSpan, max: string, sum: string): void => {
        expect(span.attributes.get(max) as number).toBeLessThanOrEqual(span.attributes.get(sum) as number);
      };
      atMost(execute, 'db.writer.maxExecMs', 'db.writer.execMs');
      atMost(execute, 'db.writer.maxQueueMs', 'db.writer.queueMs');
      atMost(commit, 'db.writer.maxExecMs', 'db.writer.execMs');
      const rollback = childrenOf(spans, 'failed-verdict').find((span) => span.name === 'Store.rollback');
      if (rollback === undefined) return yield* Effect.die('missing rollback span');
      for (const key of verdictKeys) expect(typeof rollback.attributes.get(key)).toBe('number');
      expect(rollback.attributes.get('db.writer.statements')).toBeGreaterThanOrEqual(1);
    }),
  );

  it.effect('a transaction waiting on the writer counts none of the holder statements', () =>
    Effect.gen(function* () {
      const { spans, tracer } = tracing();
      yield* Effect.gen(function* () {
        const store = yield* MachineStore;
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const holder = yield* Effect.forkChild(
          store.transaction('holder', () =>
            Effect.gen(function* () {
              yield* store.db.all(sql`select 1 as one`);
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
              yield* store.db.all(sql`select 2 as two`);
              yield* store.db.all(sql`select 3 as three`);
            }),
          ),
        );
        yield* Deferred.await(entered);
        const waiter = yield* Effect.forkChild(store.transaction('waiter', () => store.db.all(sql`select 4 as four`)));
        yield* Effect.sleep('1 millis');
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(holder);
        yield* Fiber.join(waiter);
      }).pipe(Effect.withTracer(tracer));

      const counted = (operation: string, name: string) =>
        childrenOf(spans, operation)
          .find((span) => span.name === name)
          ?.attributes.get('db.writer.statements');
      expect([counted('holder', 'Store.execute'), counted('holder', 'Store.commit')]).toEqual([3, 1]);
      expect([counted('waiter', 'Store.execute'), counted('waiter', 'Store.commit')]).toEqual([1, 1]);
    }),
  );
});
