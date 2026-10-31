import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import type { ThreadEntry } from '@runlith/agent/transcript/entries';
import { eq } from 'drizzle-orm';
import { Clock, Effect, Layer } from 'effect';
import { threadEntry, threadRun } from '../../../threads/testing/doubles.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { shelveRecord } from '../../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { threadStack } from '../threadParts.js';
import { ENTRY_KINDS } from '../composed.js';

const argument = (name: string, fallback: number): number => {
  const raw = Bun.argv.find((value) => value.startsWith(`--${name}=`));
  const value = raw === undefined ? fallback : Number.parseInt(raw.slice(name.length + 3), 10);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`);
  return value;
};

const families = argument('families', 50);
const children = argument('children', 2);
const loners = argument('loners', 50);
const entries = argument('entries', 60);
const reads = argument('reads', 200);
const answerChars = argument('answer-chars', 20_000);
const answer = `Found 3 issues\n\n${'x'.repeat(answerChars)}`;

const main = withDemo((demo) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000;
    const db = demo.graph.store.db;
    const records = yield* makeThreadRecords;
    const { store, threads } = yield* threadStack({ db, units: demo.graph.units, records, kinds: ENTRY_KINDS });
    const made = yield* demo.graph.units.write('threadListWindow.bench.made', (unit) =>
      Effect.gen(function* () {
        let count = 0;
        const one = Effect.fn('testing.listWindowSeed')(function* (order: number, parent: string | null) {
          const created = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* threads.rows.attachFacet({ threadId: created.id, projectId: demo.projectId }, unit);
          yield* shelveRecord(db, created.id, { readerOrderAt: new Date(Date.UTC(2026, 0, 1, 0, order)) });
          if (parent !== null) {
            yield* unit.run(
              db.update(threadRecord()).set({ parentId: parent, spawnRootId: parent }).where(eq(threadRecord().id, created.id)),
            );
          }
          for (let run = 0; run < 3; run += 1) {
            const runId = `${created.id}-run-${run}`;
            yield* unit.run(
              db.insert(threadRun()).values({
                id: runId,
                threadId: created.id,
                ownerId: 'operator',
                status: 'completed',
                saidFinal: answer,
                finishedAt: new Date(Date.UTC(2026, 0, 1, run)),
              }),
            );
            const rows = Array.from({ length: entries }, (_, index) => {
              const last = index === entries - 1;
              const tool = !last && index % 2 === 0;
              const id = `${runId}-${index}`;
              const entry: ThreadEntry = tool
                ? { type: 'tool', id, runId, toolName: 'read', toolCallId: id, toolState: 'output-available', toolOutput: 'x'.repeat(4000) }
                : { type: 'message', id, runId, role: 'assistant', text: last ? answer : 'Reading the next file.' };
              return { threadId: created.id, ord: run * entries + index, entryId: id, runId, type: entry.type, entry };
            });
            yield* unit.run(db.insert(threadEntry()).values(rows));
          }
          count += 1;
          return created.id;
        });
        for (let index = 0; index < loners; index += 1) yield* one(index, null);
        for (let index = 0; index < families; index += 1) {
          const root = yield* one(loners + index * (children + 1), null);
          for (let child = 0; child < children; child += 1) yield* one(loners + index * (children + 1) + child + 1, root);
        }
        return count;
      }),
    );
    const window = threads.list.rootWindow('operator', [demo.projectId], { limit: 50 });
    const samples = { said: [] as number[], silent: [] as number[] };
    let rows = 0;
    let saying = 0;
    for (let round = 0; round < 10; round += 1) {
      for (const status of ['completed', 'failed'] as const) {
        yield* db.update(threadRun()).set({ status });
        for (let index = 0; index < 5; index += 1) yield* window;
        for (let index = 0; index < reads / 10; index += 1) {
          const started = now();
          const read = yield* window;
          (status === 'completed' ? samples.said : samples.silent).push(now() - started);
          rows = read.rows.length;
          const withSaid = read.rows.filter((row) => row.saidLine !== null).length;
          if (withSaid !== (status === 'completed' ? rows : 0)) {
            return yield* Effect.die(new Error(`the ${status} sample contains ${withSaid} said lines across ${rows} rows`));
          }
          if (status === 'completed') saying = withSaid;
        }
      }
    }
    const reading = (values: readonly number[]) => {
      const ordered = [...values].sort((left, right) => left - right);
      const at = (share: number): number => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * share))] ?? 0;
      return { meanMs: values.reduce((sum, value) => sum + value, 0) / values.length, p50Ms: at(0.5), p95Ms: at(0.95) };
    };
    console.log(
      JSON.stringify(
        {
          threads: made,
          windowRows: rows,
          rowsSaying: saying,
          answerChars,
          withSaidLine: reading(samples.said),
          withoutSaidLine: reading(samples.silent),
        },
        null,
        2,
      ),
    );
  }),
);

BunRuntime.runMain(main.pipe(Effect.provide(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer))), Effect.scoped));
