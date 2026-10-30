import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Tracer } from 'effect';
import { openConnection } from './connection.js';
import { makeReaderPool } from './ReaderPool.js';
import { ProcessPool } from './ProcessPool.js';
import { childHosting } from './children.js';

const directory = await mkdtemp(join(tmpdir(), 'sqlite-readers-bench-'));
const processes = new ProcessPool(2, 'stop', undefined, childHosting);
const pids = new Set<number>();
const spans: Tracer.NativeSpan[] = [];
const cold: number[] = [];
const warm: number[] = [];
const tracer = Tracer.make({
  span: (options) => {
    const span = new Tracer.NativeSpan(options);
    spans.push(span);
    return span;
  },
});
const distribution = (values: number[]) => {
  values.sort((a, b) => a - b);
  return { n: values.length, p50: values[Math.floor(values.length / 2)], p95: values[Math.floor(values.length * 0.95)] };
};
try {
  const files = Array.from({ length: 3 }, (_, index) => join(directory, `${index}.db`));
  for (const [index, filename] of files.entries()) {
    const db = new Database(filename);
    db.run('PRAGMA journal_mode = WAL');
    db.run('CREATE TABLE item (id INTEGER PRIMARY KEY, value TEXT)');
    db.run('INSERT INTO item VALUES (1, ?)', [`store-${index}`]);
    db.close();
  }
  const state = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const pools = yield* Effect.forEach(files, (filename) =>
          makeReaderPool({
            ceiling: 2,
            open: (onLost, lane) =>
              openConnection(
                processes,
                {
                  filename,
                  readonly: true,
                  onLost,
                  onSpawned: ({ pid }) => {
                    pids.add(pid);
                    return () => {
                      pids.delete(pid);
                    };
                  },
                },
                lane,
              ),
            lanes: processes.readers,
          }),
        );
        const read = (index: number) =>
          Effect.scoped(
            Effect.gen(function* () {
              const connection = yield* pools[index]!.take;
              const rows = yield* connection.execute('SELECT value FROM item WHERE id = ?', [1], undefined);
              if (rows[0]?.value !== `store-${index}`) return yield* Effect.die('wrong store');
            }),
          ).pipe(Effect.withSpan('sql.execute'));
        for (let index = 0; index < files.length; index++) {
          const at = performance.now();
          yield* read(index);
          cold.push(performance.now() - at);
        }
        for (let round = 0; round < 200; round++) {
          const at = performance.now();
          for (let index = 0; index < files.length; index++) yield* read(index);
          warm.push(performance.now() - at);
        }
        const rssBytes = yield* Effect.promise(async () => {
          const child = Bun.spawn(['ps', '-o', 'rss=', '-p', [...pids].join(',')], { stdout: 'pipe' });
          const values = (await new Response(child.stdout).text()).trim().split(/\s+/).map(Number);
          await child.exited;
          return values.reduce((sum, value) => sum + value, 0) * 1024;
        });
        return { stores: files.length, readers: pids.size, rssBytes };
      }),
    ).pipe(Effect.withTracer(tracer)),
  );
  console.log(
    JSON.stringify(
      {
        state,
        coldMs: distribution(cold),
        warmThreeReadsMs: distribution(warm),
        fingerprints: [...new Set(spans.map((span) => span.attributes.get('db.query.fingerprint')))],
        queueMs: distribution(spans.map((span) => Number(span.attributes.get('db.queue.ms')))),
        execMs: distribution(spans.map((span) => Number(span.attributes.get('db.exec.ms')))),
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
