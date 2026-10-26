import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Effect, Fiber, Layer, Tracer } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { ProcessPool } from './ProcessPool.js';
import { bulk, sqliteProcessLayer } from './SqliteProcess.js';

const directory = await mkdtemp(join(tmpdir(), 'sqlite-isolation-bench-'));
const spans: Tracer.NativeSpan[] = [];
const tracer = Tracer.make({
  span: (options) => {
    const span = new Tracer.NativeSpan(options);
    spans.push(span);
    return span;
  },
});
const counter = (rounds: number) =>
  `WITH RECURSIVE counter(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM counter WHERE x < ${rounds}) SELECT count(*) FROM counter`;
try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const processes = new ProcessPool(2);
        const clients: SqlClient[] = [];
        const pids = new Set<number>();
        for (const name of ['a', 'b']) {
          const context = yield* Layer.build(
            sqliteProcessLayer(
              {
                filename: join(directory, `${name}.db`),
                onLost: (reason) => {
                  throw new Error(reason);
                },
                onSpawned: ({ pid }) => {
                  pids.add(pid);
                  return () => {
                    pids.delete(pid);
                  };
                },
              },
              processes,
            ),
          );
          const sql = Context.get(context, SqlClient);
          yield* sql`CREATE TABLE item (value INTEGER)`;
          clients.push(sql);
        }
        const [a, b] = clients as [SqlClient, SqlClient];
        const pilots: number[] = [];
        for (let sample = 0; sample < 3; sample++) {
          yield* bulk(a.unsafe(counter(1_000_000)));
          pilots.push(Number(spans.at(-1)!.attributes.get('db.exec.ms')));
        }
        const rounds = Math.ceil((1_000_000 * 6500) / Math.min(...pilots));
        for (const kind of ['read', 'write'] as const) {
          let ended = false;
          const query =
            kind === 'read' ? bulk(a.unsafe(counter(rounds))) : a.withTransaction(a.unsafe(`INSERT INTO item ${counter(rounds)}`));
          const long = yield* Effect.forkChild(
            query.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  ended = true;
                }),
              ),
            ),
          );
          yield* Effect.yieldNow;
          const commits: number[] = [];
          for (let sample = 0; sample < 10; sample++) {
            const at = performance.now();
            yield* b.withTransaction(b`INSERT INTO item VALUES (${sample})`);
            commits.push(performance.now() - at);
            if (ended) return yield* Effect.die('the competing statement ended before the commit sample');
          }
          yield* Fiber.join(long);
          commits.sort((a, b) => a - b);
          const slow = spans.filter((span) => Number(span.attributes.get('db.exec.ms')) > 1000).at(-1)!;
          console.log(
            JSON.stringify({
              kind,
              children: pids.size,
              fingerprint: slow.attributes.get('db.query.fingerprint'),
              execMs: slow.attributes.get('db.exec.ms'),
              queueMs: slow.attributes.get('db.queue.ms'),
              commits: { n: commits.length, p50: commits[5], p95: commits[9] },
            }),
          );
        }
      }),
    ).pipe(Effect.withTracer(tracer)),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
