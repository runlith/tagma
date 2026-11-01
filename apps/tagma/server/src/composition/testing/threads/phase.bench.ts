import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import type { ThreadLivePosition, ThreadOpenChange } from '@runlith/agent/transcript/live';
import { Clock, Effect, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { threadPhaseFeed, asThreadSummary } from '../../../threads/testing/doubles.js';
import { threadStack } from '../threadParts.js';
import { ENTRY_KINDS } from '../composed.js';

const runsArgument = Bun.argv.find((argument) => argument.startsWith('--runs='));
const perRunArgument = Bun.argv.find((argument) => argument.startsWith('--per-run='));
const runs = runsArgument ? Number.parseInt(runsArgument.slice('--runs='.length), 10) : 12;
const perRun = perRunArgument ? Number.parseInt(perRunArgument.slice('--per-run='.length), 10) : 200;
if (!Number.isSafeInteger(runs) || runs <= 0) throw new Error('--runs must be a positive integer');
if (!Number.isSafeInteger(perRun) || perRun <= 0) throw new Error('--per-run must be a positive integer');

type Reading = {
  readonly count: number;
  readonly totalMs: number;
  readonly announcesPerSecond: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
};

function reading(samples: readonly number[], totalMs: number): Reading {
  const ordered = [...samples].sort((left, right) => left - right);
  const percentile = (share: number): number => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * share))] ?? 0;
  return {
    count: samples.length,
    totalMs,
    announcesPerSecond: samples.length / (totalMs / 1_000),
    meanMs: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
  };
}

const main = withDemo((demo) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const now = () => Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000;
    const records = yield* makeThreadRecords;
    const { store, threads } = yield* threadStack({ db: demo.graph.store.db, units: demo.graph.units, records, kinds: ENTRY_KINDS });
    const ids = yield* demo.graph.units.write('phaseAnnounce.bench.ids', (unit) =>
      Effect.gen(function* () {
        const made: string[] = [];
        for (let index = 0; index < runs; index += 1) {
          const thread = yield* store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* threads.rows.attachFacet({ threadId: thread.id, projectId: demo.projectId }, unit);
          made.push(thread.id);
        }
        return made;
      }),
    );
    const emitters = new Map<string, (changes: readonly ThreadOpenChange[], at: ThreadLivePosition) => void>();
    const phases = yield* Effect.acquireRelease(
      Effect.sync(() =>
        threadPhaseFeed({
          watch: (threadId, listener) => {
            emitters.set(threadId, listener);
            return () => {
              emitters.delete(threadId);
            };
          },
          cut: (_threadId, deliver) => deliver(null),
          onChanged: () => {},
        }),
      ),
      (phases) => Effect.sync(() => phases.dispose()),
    );
    for (const [index, id] of ids.entries()) {
      phases.follow(id, `run-${index}`);
      emitters.get(id)?.(
        [
          {
            op: 'put',
            entry: { type: 'tool', id: `call-${index}`, toolCallId: `call-${index}`, toolName: 'read', toolState: 'input-available' },
          },
        ],
        { incarnation: 'bench', runId: `run-${index}`, at: { position: 1, seq: 1 } },
      );
    }
    let published = 0;
    const publish = (_row: ReturnType<typeof asThreadSummary> & { readonly phase: ReturnType<typeof phases.phaseOf> }): void => {
      published += 1;
    };
    const announce = Effect.fn('testing.phaseAnnounce')(function* (threadId: string) {
      const started = now();
      const row = yield* threads.list.summary(threadId);
      if (row === undefined) return yield* Effect.die(new Error(`thread ${threadId} vanished during its announce`));
      publish({ ...row, phase: phases.phaseOf(row.id) });
      return now() - started;
    });
    for (let index = 0; index < 100; index += 1) yield* announce(ids[index % ids.length]!);
    published = 0;
    const aloneSamples: number[] = [];
    const aloneStarted = now();
    for (let index = 0; index < perRun; index += 1) aloneSamples.push(yield* announce(ids[index % ids.length]!));
    const aloneMs = now() - aloneStarted;
    const loadedSamples: number[] = [];
    const loadedStarted = now();
    yield* Effect.forEach(
      ids,
      (threadId) =>
        Effect.gen(function* () {
          for (let index = 0; index < perRun; index += 1) loadedSamples.push(yield* announce(threadId));
        }),
      { concurrency: runs },
    );
    const loadedMs = now() - loadedStarted;
    const expected = perRun + runs * perRun;
    if (published !== expected) return yield* Effect.die(new Error(`published ${published} rows; expected ${expected}`));
    console.log(
      JSON.stringify(
        {
          runs,
          perRun,
          database: 'separate sqlite process',
          alone: reading(aloneSamples, aloneMs),
          loaded: reading(loadedSamples, loadedMs),
        },
        null,
        2,
      ),
    );
  }),
);

BunRuntime.runMain(main.pipe(Effect.provide(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer))), Effect.scoped));
