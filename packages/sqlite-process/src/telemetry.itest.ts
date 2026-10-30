import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Tracer } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { sqliteProcessLayer } from './SqliteProcess.js';
import { ProcessPool } from './ProcessPool.js';
import { childHosting } from './children.js';

const fresh = () => new ProcessPool(undefined, 'stop', undefined, childHosting);

const recording = () => {
  const spans: Tracer.NativeSpan[] = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  return { spans, tracer };
};

it.live('SQL spans identify statement shapes and retain engine timing for success and failure', () =>
  Effect.gen(function* () {
    const { spans, tracer } = recording();
    const result = yield* Effect.gen(function* () {
      const sql = yield* SqlClient;
      const first = yield* sql`SELECT ${'secret-one'} AS value`;
      const second = yield* sql`SELECT ${'secret-two'} AS value`;
      const failed = yield* Effect.result(sql`SELECT value FROM absent_table`);
      yield* sql.unsafe('SELECT 10 AS "1 -- label"');
      yield* sql.unsafe('SELECT 11 AS "2 -- label"');
      return { first, second, failed: failed._tag };
    }).pipe(Effect.provide(sqliteProcessLayer({ filename: ':memory:', onLost: () => {} }, fresh())), Effect.withTracer(tracer));
    expect(result).toEqual({ first: [{ value: 'secret-one' }], second: [{ value: 'secret-two' }], failed: 'Failure' });
    const queries = spans.filter((span) => span.name === 'sql.execute');
    expect(queries).toHaveLength(5);
    expect(queries[3]?.attributes.get('db.query.summary')).toBe('SELECT ? AS "1 -- label"');
    expect(queries[4]?.attributes.get('db.query.fingerprint')).not.toBe(queries[3]?.attributes.get('db.query.fingerprint'));
    expect(queries[0]?.attributes.get('db.query.summary')).toBe('SELECT ? AS value');
    expect(queries[0]?.attributes.get('db.query.fingerprint')).toBe(queries[1]?.attributes.get('db.query.fingerprint'));
    expect(queries[2]?.attributes.get('db.query.fingerprint')).not.toBe(queries[0]?.attributes.get('db.query.fingerprint'));
    for (const span of queries) {
      expect(span.attributes.get('db.queue.ms')).toBeGreaterThanOrEqual(0);
      expect(span.attributes.get('db.exec.ms')).toBeGreaterThanOrEqual(0);
    }
  }),
);

it.live('transaction control statements are measured on statement spans of their own, never on the caller span', () =>
  Effect.gen(function* () {
    const { spans, tracer } = recording();
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient;
      yield* sql.withTransaction(sql`SELECT 1 AS value`);
    }).pipe(
      Effect.withSpan('caller'),
      Effect.provide(sqliteProcessLayer({ filename: ':memory:', onLost: () => {} }, fresh())),
      Effect.withTracer(tracer),
    );
    const caller = spans.find((span) => span.name === 'caller');
    expect([...(caller?.attributes.keys() ?? [])].filter((key) => key.startsWith('db.'))).toEqual([]);
    const statements = spans.filter((span) => span.name === 'sql.execute').map((span) => span.attributes.get('db.query.summary'));
    expect(statements).toEqual(['BEGIN IMMEDIATE', 'SELECT ? AS value', 'COMMIT']);
    for (const span of spans.filter((span) => span.name === 'sql.execute'))
      expect(span.attributes.get('db.exec.ms')).toBeGreaterThanOrEqual(0);
  }),
);
