import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { CostLedger, costLedgerLayer, CurrentCost } from '@runlith/performance/CostLedger';
import { Clock, Context, Effect, Layer, Tracer } from 'effect';
import { SafeIntegers, SqlClient } from 'effect/sql/SqlClient';
import { classifySqliteError, SqlError } from 'effect/sql/SqlError';
import { sqliteProcessLayer } from './SqliteProcess.js';
import { Programs } from './programs.js';
import { sharedPool } from './testing/pool.js';

it.live('unsampled Run costs count logical UTF-8, scalar and blob payloads before row transforms', () =>
  Effect.gen(function* () {
    const pool = yield* sharedPool;
    const ledger = yield* CostLedger.pipe(
      Effect.provide(costLedgerLayer({ capacity: 1, unattributedStatements: () => pool.unattributedStatements })),
    );
    const cause = ledger.open('read');
    const censusBefore = pool.statements.read({ limit: 2048 });
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan({ ...options, sampled: false });
        spans.push(span);
        return span;
      },
    });
    const rejected = new SqlError({ reason: classifySqliteError(new Error('rejected'), { operation: 'execute' }) });
    const context = yield* Layer.build(
      sqliteProcessLayer(
        {
          filename: ':memory:',
          onLost: () => {},
          transformResultNames: (name) => (name === 'row_name' ? 'rowName' : name),
          checkStatement: (sql) => (sql === 'rejected' ? Effect.fail(rejected) : Effect.void),
        },
        pool,
      ),
    );
    const sql = Context.get(context, SqlClient);
    const query = 'SELECT ? AS row_name, ? AS n, ? AS absent, ? AS payload, ? AS real, ? AS flag';
    const blob = new Uint8Array([0, 1, 255]);
    const params = ['漢🙂', 9007199254740993n, null, blob, 1.5, true];
    yield* Effect.gen(function* () {
      const values = yield* sql.unsafe(query, params).values;
      expect(values).toEqual([['漢🙂', 9007199254740993n, null, blob, 1.5, 1n]]);
      expect(cause.counts.statements).toBe(1);
      expect(cause.counts.requestBytes).toBe(Buffer.byteLength(query) + 7 + 8 + 1 + 3 + 8 + 1);
      expect(cause.counts.responseBytes).toBe(7 + 8 + 1 + 3 + 8 + 8);
      const rows = yield* sql.unsafe(query, params);
      expect(rows).toEqual([{ rowName: '漢🙂', n: 9007199254740993n, absent: null, payload: blob, real: 1.5, flag: 1n }]);
      expect(cause.counts.statements).toBe(2);
      expect(cause.counts.requestBytes).toBe(2 * (Buffer.byteLength(query) + 7 + 8 + 1 + 3 + 8 + 1));
      expect(cause.counts.responseBytes).toBe(2 * (7 + 8 + 1 + 3 + 8 + 8) + Buffer.byteLength('row_namenabsentpayloadrealflag'));
      const beforeFailure = cause.counts.responseBytes;
      const failure = yield* Effect.result(sql.unsafe('SELECT absent_column'));
      expect(failure._tag).toBe('Failure');
      expect(cause.counts.statements).toBe(3);
      expect(cause.counts.requestBytes).toBe(
        2 * (Buffer.byteLength(query) + 7 + 8 + 1 + 3 + 8 + 1) + Buffer.byteLength('SELECT absent_column'),
      );
      expect(cause.counts.responseBytes).toBeGreaterThan(beforeFailure);
      const rejectedResult = yield* Effect.result(sql.unsafe('rejected'));
      expect(rejectedResult._tag).toBe('Failure');
      expect(cause.counts.statements).toBe(3);
      const beforeUnattributed = { ...cause.counts };
      const beforeUnattributedStatements = ledger.read({ limit: 1 }).unattributedStatements!;
      expect((yield* Effect.result(sql.unsafe('rejected').pipe(Effect.provideService(CurrentCost, null))))._tag).toBe('Failure');
      expect(ledger.read({ limit: 1 }).unattributedStatements).toBe(beforeUnattributedStatements);
      expect(yield* sql.unsafe('SELECT 1 AS value').pipe(Effect.provideService(CurrentCost, null))).toEqual([{ value: 1n }]);
      expect(cause.counts).toEqual(beforeUnattributed);
      expect(ledger.read({ limit: 1 }).unattributedStatements).toBe(beforeUnattributedStatements + 1);
    }).pipe(Effect.provideService(CurrentCost, cause), Effect.provideService(SafeIntegers, true), Effect.withTracer(tracer));
    expect(spans.some((span) => span.name === 'sql.execute' && !span.sampled)).toBe(true);
    const census = pool.statements.read({ limit: 2048 });
    const measured = census.rows.find((row) => row.summary.startsWith('SELECT ? AS row_name'))!;
    const previous = censusBefore.rows.find((row) => row.fingerprint === measured.fingerprint);
    expect(measured.statements - (previous?.statements ?? 0)).toBe(2);
    expect(measured.completed - (previous?.completed ?? 0)).toBe(2);
    expect(measured.failed - (previous?.failed ?? 0)).toBe(0);
    expect(measured.totalMs - (previous?.totalMs ?? 0)).toBeGreaterThan(0);
    expect(cause.counts.statementMs).toBeGreaterThanOrEqual(cause.counts.statementExecMs);
    const submitted = yield* Context.get(context, Programs).submit({
      operation: 'costs',
      program: {
        statements: [
          { sql: query, params, counts: 'rows', expect: 0 },
          { sql: query, params, counts: 'rows', expect: null },
        ],
      },
      synchronous: null,
    });
    expect(submitted.outcome._tag).toBe('Conflict');
    const carried = pool.statements.read({ limit: 2048 }).rows.find((row) => row.fingerprint === measured.fingerprint)!;
    expect(carried.programStatements - measured.programStatements).toBe(2);
    expect(carried.statements).toBe(measured.statements);
  }),
);

it.live('nested transactions share one physical writer lease including begin and commit', () =>
  Effect.gen(function* () {
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 2 })));
    const outer = ledger.open('outer');
    const nested = ledger.open('nested');
    const context = yield* Layer.build(sqliteProcessLayer({ filename: ':memory:', onLost: () => {} }, yield* sharedPool));
    const sql = Context.get(context, SqlClient);
    const before = yield* Clock.monotonicTimeNanos;
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          expect(yield* sql`SELECT 1 AS value`).toEqual([{ value: 1 }]);
          yield* sql.withTransaction(sql`SELECT 2 AS value`).pipe(Effect.provideService(CurrentCost, nested));
          expect(outer.counts.writerHoldMs).toBe(0);
          expect(nested.counts.writerHoldMs).toBe(0);
          expect(nested.counts.writerWaitMs).toBe(0);
        }),
      )
      .pipe(Effect.provideService(CurrentCost, outer));
    const elapsed = Number((yield* Clock.monotonicTimeNanos) - before) / 1_000_000;
    expect(outer.counts.statements).toBe(3);
    expect(nested.counts.statements).toBe(2);
    expect(outer.counts.writerHoldMs).toBeGreaterThan(0);
    expect(outer.counts.writerWaitMs + outer.counts.writerHoldMs).toBeLessThanOrEqual(elapsed);
    expect(nested.counts.writerHoldMs).toBe(0);
    expect(nested.counts.writerWaitMs).toBe(0);
  }),
);
