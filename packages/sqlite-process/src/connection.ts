import type { ProcessPool } from './ProcessPool.js';
import { CurrentCost, type CostCause } from '@runlith/performance/CostLedger';
import { CurrentWriter, type WriterFrame } from '@runlith/performance/WriterMetrics';
import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Deferred from 'effect/Deferred';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Fiber from 'effect/Fiber';
import * as Latch from 'effect/Latch';
import * as Stream from 'effect/Stream';
import * as Tracer from 'effect/Tracer';
import * as Option from 'effect/Option';
import * as Client from 'effect/sql/SqlClient';
import type { Connection } from 'effect/sql/SqlConnection';
import { classifySqliteError, SqlError } from 'effect/sql/SqlError';
import type { Committed, ProgramBatch, SqliteAsk, SqliteSaid, ThrownShape } from './channel.js';
import { prepareEngine } from './engine.js';
import { parameterBytes, rowBytes, scalarBytes } from './payload.js';

export type StatementTiming = {
  readonly operation: string;
  readonly totalMs: number;
  readonly queueMs: number;
  readonly execMs: number;
  readonly source?: 'writer' | 'reader' | undefined;
};

export type ConnectionOptions = {
  readonly filename: string;
  readonly readonly?: boolean | undefined;
  readonly readwrite?: boolean | undefined;
  readonly create?: boolean | undefined;
  readonly disableWAL?: boolean | undefined;
  readonly durable?: boolean | undefined;
  readonly busyTimeout?: Duration.Input | undefined;
  readonly mmapBytes?: number | undefined;
  readonly onLost: (reason: string) => void;
  readonly onStatement?: ((timing: StatementTiming) => void) | undefined;
  readonly onSpawned?: ((spawned: SpawnedChild) => () => void) | undefined;
  readonly checkConnection?: Effect.Effect<void, SqlError> | undefined;
  readonly checkStatement?: ((sql: string) => Effect.Effect<void, SqlError>) | undefined;
};

export type SpawnedChild = { readonly pid: number };

export type ProcessConnection = Connection & {
  readonly export: Effect.Effect<Uint8Array, SqlError>;
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>;
  readonly pid: number;
  readonly quietSince: () => number | null;
  readonly retire: Effect.Effect<void, SqlError>;
  readonly handover: Effect.Effect<void, SqlError>;
  readonly programs: (batch: ProgramBatch) => Effect.Effect<Committed, SqlError>;
};

const MAX_BUSY_TIMEOUT = 2_147_483_647;
const DEFAULT_BUSY_TIMEOUT = Duration.seconds(5);

const GRANTED_MMAP_BYTES = 1_073_741_824;

const CLOSE_DEADLINE = Duration.seconds(2);

const SLOW_STATEMENT_MS = 5_000;

const STATEMENT_SPAN = 'sql.execute';

const ABANDONED = 'a read was left by its caller while its statement ran, so its reader process was stopped';

const QUERY_TEXTS = 4096;
const QUERY_TEXT_BYTES = 16_384;

type Query = { readonly fingerprint: string; readonly summary: string };

const queries = new Map<string, Query>();

const queryOf = (sql: string): Query => {
  const known = queries.get(sql);
  if (known !== undefined) return known;
  const normalized = sql
    .replace(
      /"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|(?:\s|--[^\r\n]*|\/\*[\s\S]*?\*\/)+|'(?:''|[^'])*'|\?\d*|[:@$]\w+|\b(?:0x[\da-f]+|\d+(?:\.\d*)?(?:e[+-]?\d+)?)\b/gi,
      (token) => (/^["`\[]/.test(token) ? token : /^\s|^--|^\/\*/.test(token) ? ' ' : '?'),
    )
    .trim();
  const query = { fingerprint: Bun.hash(normalized).toString(16), summary: normalized.slice(0, 512) };
  if (sql.length > QUERY_TEXT_BYTES) return query;
  if (queries.size >= QUERY_TEXTS) queries.clear();
  queries.set(sql, query);
  return query;
};

const brokenChannel = (message: string, operation: string) =>
  new SqlError({ reason: classifySqliteError(new Error(message), { message, operation }) });

const failureOf = (thrown: ThrownShape, message: string, operation: string) =>
  new SqlError({ reason: classifySqliteError(thrown, { message, operation }) });

type Outstanding = {
  readonly cell: Deferred.Deferred<SqliteSaid, SqlError>;
  readonly operation: string;
  readonly ask: SqliteAsk;
  readonly sentAt: number;
  readonly cost: CostCause | null;
  readonly writer: WriterFrame | null;
  due: number;
};

export const openConnection = Effect.fnUntraced(function* (processes: ProcessPool, options: ConnectionOptions, lane?: number) {
  yield* Effect.tryPromise({
    try: prepareEngine,
    catch: (cause) => brokenChannel(`The SQLite native asset could not be prepared: ${String(cause)}`, 'open'),
  });
  const readonly = options.readonly === true;
  const clock = Context.get(Context.empty(), Clock.Clock);
  const nowMs = () => Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000;
  const pending = new Map<number, Outstanding>();
  let quietSince: number | null = nowMs();
  const answered = (id: number): void => {
    pending.delete(id);
    if (pending.size === 0 && quietSince === null) quietSince = nowMs();
  };
  let gone: SqlError | null = null;
  let counter = 0;
  const probes = new Map<number, number>();
  const outstanding = Latch.makeUnsafe();

  const report = (line: string, thrown?: unknown): void => {
    try {
      console.error(`[sqlite] ${options.filename}: ${line}${thrown === undefined ? '' : `: ${String(thrown)}`}`);
    } catch {}
  };

  const seal = (message: string): ReadonlyArray<Outstanding> | null => {
    if (gone !== null) return null;
    gone = brokenChannel(message, 'execute');
    const stranded = [...pending.values()];
    for (const waiting of stranded) if (waiting.writer !== null) waiting.writer.repliesComplete = false;
    pending.clear();
    quietSince ??= nowMs();
    probes.clear();
    outstanding.openUnsafe();
    return stranded;
  };

  const wake = (stranded: ReadonlyArray<Outstanding>, message: string): void => {
    for (const waiting of stranded) {
      Deferred.doneUnsafe(waiting.cell, Effect.fail(brokenChannel(message, waiting.operation)));
    }
  };

  const breaks = (message: string): void => {
    const stranded = seal(message);
    if (stranded !== null) wake(stranded, message);
  };

  let announced = false;
  const losing = (reason: string) => {
    const stranded = seal(reason);
    return {
      announce: () => {
        if (announced) return;
        announced = true;
        try {
          options.onLost(reason);
        } catch (thrown) {
          report('the onLost handler threw', thrown);
        }
      },
      wake: () => {
        if (stranded !== null) wake(stranded, reason);
      },
    };
  };
  const lost = (reason: string): void => {
    const loss = losing(reason);
    loss.announce();
    loss.wake();
  };

  const probe = (asked: number): void => {
    if (gone !== null) return;
    const id = (counter += 1);
    probes.set(id, asked);
    const ping: SqliteAsk = { _tag: 'Ping', id };
    try {
      connected.send(ping);
    } catch {
      probes.delete(id);
    }
  };

  const receive = (said: SqliteSaid): void => {
    const tested = probes.get(said.id);
    if (tested !== undefined) {
      probes.delete(said.id);
      if (pending.has(tested)) lost('the sqlite process read past a statement it never answered');
      return;
    }
    const waiting = pending.get(said.id);
    if (waiting === undefined) return;
    answered(said.id);
    if (waiting.writer !== null) {
      if (said._tag === 'Rows' || said._tag === 'Failed') {
        waiting.writer.childMs += said.execMs;
        waiting.writer.writerPid = connected.pid;
        if (said._tag === 'Rows' && said.commitReturnedAt !== undefined) waiting.writer.commitReturnedAt = said.commitReturnedAt;
      } else waiting.writer.repliesComplete = false;
    }
    if (waiting.cost !== null && waiting.ask._tag === 'Run') {
      if (said._tag === 'Rows') waiting.cost.counts.responseBytes += rowBytes(said.rows);
      else if (said._tag === 'Failed') {
        const thrown = said.thrown;
        waiting.cost.counts.responseBytes +=
          scalarBytes(thrown.name) +
          scalarBytes(thrown.message) +
          scalarBytes(thrown.code) +
          scalarBytes(thrown.errno) +
          scalarBytes(thrown.constraint);
      }
    }
    if ((said._tag === 'Rows' || said._tag === 'Failed') && waiting.ask._tag === 'Run' && options.onStatement !== undefined) {
      try {
        options.onStatement({
          operation: waiting.operation,
          totalMs: nowMs() - waiting.sentAt,
          queueMs: said.queueMs,
          execMs: said.execMs,
        });
      } catch {}
    }
    Deferred.doneUnsafe(waiting.cell, Effect.succeed(said));
  };

  const connected = yield* Effect.acquireRelease(
    Effect.sync(() => processes.connect(lane, receive, losing, options.onSpawned)),
    (channel) =>
      Effect.promise(async () => {
        breaks('the sqlite connection closed');
        await channel.release();
      }),
  );

  const soonest = (): Outstanding | undefined => {
    let first: Outstanding | undefined;
    for (const waiting of pending.values()) if (first === undefined || waiting.due < first.due) first = waiting;
    return first;
  };

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (gone === null) {
        outstanding.closeUnsafe();
        const waiting = soonest();
        if (waiting === undefined) {
          yield* outstanding.await;
          continue;
        }
        const remaining = waiting.due - nowMs();
        if (remaining > 0) {
          yield* clock.sleep(Duration.millis(remaining));
          continue;
        }
        const now = nowMs();
        waiting.due = now + SLOW_STATEMENT_MS;
        console.warn(
          `[sqlite] ${options.filename}: a statement has been running ${Math.round((now - waiting.sentAt) / 1000)}s — ${
            waiting.ask._tag === 'Run' ? waiting.ask.sql.slice(0, 200) : waiting.ask._tag
          }`,
        );
        probe(waiting.ask.id);
      }
    }),
  );

  const abandon = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      lost(ABANDONED);
      return Effect.flatMap(Effect.exit(Effect.tryPromise(() => connected.kill(ABANDONED))), (killed) =>
        Exit.isFailure(killed) ? Effect.sync(() => report('the abandoned reader process did not stop', killed.cause)) : Effect.void,
      );
    });

  const call = (
    ask: SqliteAsk,
    operation: string,
    cost: CostCause | null = null,
    writer: WriterFrame | null = null,
  ): Effect.Effect<SqliteSaid, SqlError> =>
    Effect.suspend(() => {
      if (gone !== null) return Effect.fail(gone);
      const cell = Deferred.makeUnsafe<SqliteSaid, SqlError>();
      const sentAt = nowMs();
      pending.set(ask.id, { cell, operation, ask, sentAt, cost, writer, due: sentAt + SLOW_STATEMENT_MS });
      quietSince = null;
      try {
        connected.send(ask);
      } catch (cause) {
        answered(ask.id);
        if (writer !== null) writer.repliesComplete = false;
        return Effect.fail(brokenChannel(`the sqlite process would not take a statement: ${String(cause)}`, operation));
      }
      if (cost !== null && ask._tag === 'Run') {
        cost.counts.statements += 1;
        cost.counts.requestBytes += Buffer.byteLength(ask.sql, 'utf8') + parameterBytes(ask.params);
      }
      outstanding.openUnsafe();
      const answer = Deferred.await(cell).pipe(Effect.ensuring(Effect.sync(() => answered(ask.id))));
      return lane !== undefined && ask._tag === 'Run'
        ? Effect.onInterrupt(answer, () => (Deferred.isDoneUnsafe(cell) ? Effect.void : abandon()))
        : Effect.uninterruptible(answer);
    });

  const answeredWrong = (said: SqliteSaid, message: string, operation: string) =>
    said._tag === 'Failed'
      ? failureOf(said.thrown, message, operation)
      : brokenChannel(`the sqlite process answered a ${operation} with ${said._tag}`, operation);

  const run = (
    shape: 'rows' | 'values',
    sql: string,
    params: ReadonlyArray<unknown>,
    operation: string,
  ): Effect.Effect<Array<any>, SqlError> =>
    Effect.andThen(
      options.checkConnection ?? Effect.void,
      Effect.andThen(
        options.checkStatement?.(sql) ?? Effect.void,
        Effect.withFiber<Array<any>, SqlError>((fiber) => {
          const cost = Context.get(fiber.context, CurrentCost);
          const observed = Context.get(fiber.context, CurrentWriter);
          const writer = lane === undefined && observed?.owner === connection ? observed : null;
          const measured = (span: Tracer.Span): Effect.Effect<Array<any>, SqlError> => {
            if (span.sampled) {
              const query = queryOf(sql);
              span.attribute('db.query.fingerprint', query.fingerprint);
              span.attribute('db.query.summary', query.summary);
            }
            return call(
              {
                _tag: 'Run',
                id: (counter += 1),
                shape,
                sql,
                params,
                safeIntegers: Context.get(fiber.context, Client.SafeIntegers),
                sentAt: Date.now(),
              },
              operation,
              cost,
              writer,
            ).pipe(
              Effect.flatMap((said) => {
                if (span.sampled && (said._tag === 'Rows' || said._tag === 'Failed')) {
                  span.attribute('db.queue.ms', said.queueMs);
                  span.attribute('db.exec.ms', said.execMs);
                }
                return said._tag === 'Rows'
                  ? Effect.succeed(said.rows as Array<any>)
                  : Effect.fail(answeredWrong(said, 'Failed to execute statement', operation));
              }),
            );
          };
          const parent = Option.getOrUndefined(Context.getOption(fiber.context, Tracer.ParentSpan));
          return parent?._tag === 'Span' && parent.name === STATEMENT_SPAN
            ? measured(parent)
            : Effect.useSpan(
                STATEMENT_SPAN,
                { kind: 'client', attributes: { 'db.system.name': 'sqlite', 'db.operation.name': operation } },
                measured,
              );
        }),
      ),
    );

  yield* Effect.addFinalizer(() =>
    gone !== null
      ? Effect.void
      : Effect.gen(function* () {
          const closing = yield* Effect.forkChild(call({ _tag: 'Close', id: (counter += 1) }, 'close'));
          const closed = yield* Fiber.await(closing).pipe(Effect.timeoutOption(CLOSE_DEADLINE), Effect.provideService(Clock.Clock, clock));
          if (Option.isSome(closed)) {
            if (Exit.isFailure(closed.value) || closed.value.value._tag !== 'Did') {
              console.error(
                `[sqlite] ${options.filename} did not close cleanly: ${String(Exit.isFailure(closed.value) ? closed.value.cause : closed.value.value._tag).slice(0, 200)}`,
              );
            }
            return;
          }
          const reason = `the sqlite connection did not close within ${Duration.toMillis(CLOSE_DEADLINE)} ms and its process was retired`;
          breaks(reason);
          const retired = yield* Effect.exit(Effect.tryPromise(() => connected.retire()));
          console.error(
            `[sqlite] ${options.filename}: ${reason}${Exit.isFailure(retired) ? `; ${String(retired.cause).slice(0, 200)}` : ''}`,
          );
        }),
  );

  yield* call(
    {
      _tag: 'Open',
      id: (counter += 1),
      config: {
        filename: options.filename,
        readonly,
        readwrite: readonly ? false : (options.readwrite ?? true),
        create: readonly ? false : (options.create ?? true),
        disableWAL: options.disableWAL === true,
        durable: options.durable !== false,
        busyTimeoutMs: Math.min(MAX_BUSY_TIMEOUT, Math.max(0, Math.round(Duration.toMillis(options.busyTimeout ?? DEFAULT_BUSY_TIMEOUT)))),
        mmapBytes: Math.max(0, Math.round(options.mmapBytes ?? GRANTED_MMAP_BYTES)),
      },
    },
    'open',
  ).pipe(
    Effect.flatMap((said) => (said._tag === 'Did' ? Effect.void : Effect.fail(answeredWrong(said, 'Failed to open database', 'open')))),
  );

  const connection: ProcessConnection = {
    execute(sql, params, transform) {
      const rows = run('rows', sql, params, 'execute');
      return transform ? Effect.map(rows, transform) : rows;
    },
    executeRaw(sql, params) {
      return run('rows', sql, params, 'execute');
    },
    executeValues(sql, params) {
      return run('values', sql, params, 'executeValues');
    },
    executeValuesUnprepared(sql, params) {
      return run('values', sql, params, 'executeValues');
    },
    executeUnprepared(sql, params, transform) {
      return this.execute(sql, params, transform);
    },
    executeStream() {
      return Stream.die('executeStream not implemented');
    },
    pid: connected.pid,
    quietSince: () => quietSince,
    retire: Effect.andThen(
      Effect.sync(() => lost('the owner retired this sqlite connection')),
      Effect.tryPromise({
        try: () => connected.retire(),
        catch: (cause) => brokenChannel(`Failed to retire sqlite connection: ${String(cause)}`, 'retire'),
      }),
    ),
    handover: Effect.uninterruptible(
      Effect.gen(function* () {
        if (lane !== undefined && gone === null) {
          const closing = yield* Effect.forkChild(call({ _tag: 'Close', id: (counter += 1) }, 'handover'));
          const closed = yield* Fiber.await(closing).pipe(Effect.timeoutOption(CLOSE_DEADLINE), Effect.provideService(Clock.Clock, clock));
          if (Option.isNone(closed)) {
            breaks('the shared sqlite handle did not close before handover; its reader process is retired');
            return yield* Effect.tryPromise({
              try: () => connected.retire(),
              catch: (cause) => brokenChannel(`Failed to retire the stalled shared sqlite handle: ${String(cause)}`, 'handover'),
            });
          }
          if (Exit.isFailure(closed.value)) return yield* Effect.failCause(closed.value.cause);
          if (closed.value.value._tag !== 'Did')
            return yield* answeredWrong(closed.value.value, 'Failed to hand over shared sqlite handle', 'handover');
        }
        breaks('the owner handed over this sqlite connection');
        yield* Effect.tryPromise({
          try: () => (lane === undefined ? connected.retire() : connected.release()),
          catch: (cause) => brokenChannel(`Failed to hand over sqlite connection: ${String(cause)}`, 'handover'),
        });
      }),
    ),
    export: Effect.andThen(
      options.checkConnection ?? Effect.void,
      Effect.suspend(() =>
        call({ _tag: 'Export', id: (counter += 1) }, 'export').pipe(
          Effect.flatMap((said) =>
            said._tag === 'Exported' ? Effect.succeed(said.bytes) : Effect.fail(answeredWrong(said, 'Failed to export database', 'export')),
          ),
        ),
      ),
    ),
    programs: (batch) =>
      Effect.andThen(
        options.checkConnection ?? Effect.void,
        Effect.suspend(() =>
          call({ _tag: 'Programs', id: (counter += 1), sentAt: Date.now(), ...batch }, 'programs').pipe(
            Effect.flatMap((said) =>
              said._tag === 'Committed' ? Effect.succeed(said) : Effect.fail(answeredWrong(said, 'Failed to commit programs', 'programs')),
            ),
          ),
        ),
      ),
    loadExtension: (path: string) =>
      Effect.andThen(
        options.checkConnection ?? Effect.void,
        call({ _tag: 'LoadExtension', id: (counter += 1), path }, 'loadExtension').pipe(
          Effect.flatMap((said) =>
            said._tag === 'Did' ? Effect.void : Effect.fail(answeredWrong(said, 'Failed to load extension', 'loadExtension')),
          ),
        ),
      ),
  };

  return connection;
});
