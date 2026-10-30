import { mkdtemp, rm } from 'node:fs/promises';
import { availableParallelism, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { Context, Effect, Layer, Tracer } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { sqliteProcessLayer } from './SqliteProcess.js';
import { ProcessPool } from './ProcessPool.js';
import { childHosting } from './children.js';

const samples: Record<string, number[]> = {};
const fingerprints = new Set<string>();
const note = (name: string, value: number) => (samples[name] ??= []).push(value);
const tracer = Tracer.make({
  span: (options) => {
    const span = new Tracer.NativeSpan(options);
    if (span.name === 'sql.execute') {
      const end = span.end.bind(span);
      span.end = (...args) => {
        end(...args);
        fingerprints.add(String(span.attributes.get('db.query.fingerprint')));
        note('queueMs', Number(span.attributes.get('db.queue.ms')));
        note('execMs', Number(span.attributes.get('db.exec.ms')));
      };
    }
    return span;
  },
});
const directory = await mkdtemp(join(tmpdir(), 'sqlite-process-bench-'));
const pids = new Set<number>();
const processes = new ProcessPool(2, 'stop', undefined, childHosting);
const layer = (filename: string) =>
  sqliteProcessLayer(
    {
      filename,
      readers: 0,
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
  );
const rss = async () => {
  const probe = Bun.spawn(['ps', '-o', 'rss=', '-p', [...pids].join(',')], { stdout: 'pipe' });
  const values = (await new Response(probe.stdout).text()).trim().split(/\s+/).map(Number);
  await probe.exited;
  return values.reduce((sum, value) => sum + value, 0) * 1024;
};
try {
  for (let round = 0; round < 8; round++) {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = performance.now();
          const context = yield* Layer.build(layer(':memory:'));
          note('openMs', performance.now() - started);
          const sql = Context.get(context, SqlClient);
          for (let query = 0; query < 100; query++) {
            const at = performance.now();
            const rows = yield* sql<{ value: number }>`SELECT ${query} AS value`;
            if (rows[0]?.value !== query) return yield* Effect.die('wrong row');
            note('roundTripMs', performance.now() - at);
          }
          note('oneChildRssBytes', yield* Effect.promise(rss));
        }),
      ).pipe(Effect.withTracer(tracer)),
    );
  }
  const stores = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const clients: SqlClient[] = [];
        for (let store = 0; store < 3; store++) {
          const context = yield* Layer.build(layer(join(directory, `${store}.db`)));
          const sql = Context.get(context, SqlClient);
          yield* sql`CREATE TABLE item (id INTEGER PRIMARY KEY, value TEXT)`;
          yield* sql`INSERT INTO item (id, value) VALUES (1, ${`store-${store}`})`;
          clients.push(sql);
        }
        for (let round = 0; round < 200; round++) {
          const started = performance.now();
          yield* Effect.forEach(
            clients,
            (sql, index) =>
              Effect.map(sql<{ value: string }>`SELECT value FROM item WHERE id = ${1}`, (rows) => {
                if (rows[0]?.value !== `store-${index}`) throw new Error('wrong store');
              }),
            { concurrency: 3 },
          );
          note('threeStoreBatchMs', performance.now() - started);
        }
        return { count: clients.length, children: pids.size, rssBytes: yield* Effect.promise(rss) };
      }),
    ).pipe(Effect.withTracer(tracer)),
  );
  const distributions = Object.fromEntries(
    Object.entries(samples).map(([name, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return [
        name,
        {
          n: values.length,
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
          max: sorted.at(-1),
        },
      ];
    }),
  );
  console.log(
    JSON.stringify(
      {
        machine: {
          platform: process.platform,
          arch: process.arch,
          cores: availableParallelism(),
          memoryBytes: totalmem(),
          bun: Bun.version,
        },
        stores,
        fingerprints: [...fingerprints],
        distributions,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
