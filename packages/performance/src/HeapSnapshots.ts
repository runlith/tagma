import { heapStats } from 'bun:jsc';
import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { declare } from '@runlith/held/Held';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { HeapSnapshot, HeapSnapshotRequest, HeapSnapshotStep } from './HeapSnapshot.js';
import { monotonicMs } from './monotonic.js';

const KEPT_SNAPSHOTS = 4;

const SNAPSHOT = '.heapsnapshot';
const PARTIAL = `${SNAPSHOT}.partial`;

export type Options = {
  readonly instanceId: string;
  readonly directory: string;
};

export class HeapSnapshotFailed extends Data.TaggedError('HeapSnapshotFailed')<{
  readonly step: HeapSnapshotStep;
  readonly message: string;
}> {}

export class HeapSnapshots extends Context.Service<
  HeapSnapshots,
  {
    readonly capture: (request: HeapSnapshotRequest) => Effect.Effect<HeapSnapshot, HeapSnapshotFailed>;
  }
>()('@runlith/performance/HeapSnapshots') {}

export const heapSnapshotsLayer = (options: Options) => Layer.sync(HeapSnapshots, () => make(options));

const make = (options: Options) => {
  const gate = declare<string>({
    name: 'heap-snapshots',
    owner: 'performance',
    rank: 724,
    key: (key: string) => key,
    concurrency: 1,
    threshold: Duration.minutes(2),
    ceilings: {
      hold: Duration.minutes(10),
      wait: Duration.minutes(15),
      leaves: 'a cut capture may leave a partial snapshot file, which the next capture removes',
    },
    external: 'none',
  });

  const failed = (step: HeapSnapshotStep) => (cause: unknown) => new HeapSnapshotFailed({ step, message: String(cause) });

  const capture = (request: HeapSnapshotRequest) =>
    gate
      .hold(
        'sole',
        Effect.gen(function* () {
          const standing = yield* Effect.tryPromise({ try: () => prune(options.directory), catch: failed('prune') });
          const id = randomUUID();
          const wallTime = yield* Clock.currentTimeMillis;
          const started = yield* monotonicMs;
          const buffer = yield* Effect.try({ try: () => Bun.generateHeapSnapshot('v8', 'arraybuffer'), catch: failed('snapshot') }).pipe(
            Effect.ensuring(Effect.sync(releaseRetained)),
          );
          const snapshotMs = (yield* monotonicMs) - started;
          const stats = heapStats();
          const file = join(options.directory, `${wallTime}-${id}${SNAPSHOT}`);
          const writing = yield* monotonicMs;
          yield* Effect.tryPromise({ try: () => keep(file, buffer), catch: failed('write') });
          const snapshot: HeapSnapshot = {
            id,
            instanceId: options.instanceId,
            requestedBy: request.requestedBy,
            wallTime,
            file,
            bytes: buffer.byteLength,
            snapshotMs,
            writeMs: (yield* monotonicMs) - writing,
            heap: { sizeBytes: stats.heapSize, extraMemoryBytes: stats.extraMemorySize, objectCount: stats.objectCount },
            kept: [file, ...standing],
          };
          return snapshot;
        }),
      )
      .pipe(
        Effect.catchTag('HoldStalled', (stall) =>
          Effect.fail(new HeapSnapshotFailed({ step: 'admit', message: `the capture waited ${stall.waitedMs} ms for the capture door` })),
        ),
        Effect.catchTag('HoldCut', (cut) =>
          Effect.fail(
            new HeapSnapshotFailed({ step: 'hold', message: `the capture held the capture door ${cut.heldMs} ms; ${cut.leaves}` }),
          ),
        ),
        Effect.withTracerEnabled(false),
      );

  return HeapSnapshots.of({ capture });
};

//! Bun keeps the last snapshot in JSC's heap profiler, slowing every collection until it is cleared; an unknown format clears it and throws before building another.
const releaseRetained = (): void => {
  try {
    (Bun.generateHeapSnapshot as (format: string) => unknown)(RELEASE_FORMAT);
  } catch {
    return;
  }
  throw new Error('Bun built a heap snapshot for a format it should refuse; the retained snapshot was not released');
};

const RELEASE_FORMAT = 'release';

async function prune(directory: string): Promise<readonly string[]> {
  await mkdir(directory, { recursive: true });
  const names = await readdir(directory);
  const snapshots = names
    .filter((name) => name.endsWith(SNAPSHOT))
    .sort()
    .reverse();
  const stale = [...names.filter((name) => name.endsWith(PARTIAL)), ...snapshots.slice(KEPT_SNAPSHOTS - 1)];
  await Promise.all(stale.map((name) => rm(join(directory, name), { force: true })));
  return snapshots.slice(0, KEPT_SNAPSHOTS - 1).map((name) => join(directory, name));
}

async function keep(file: string, buffer: ArrayBuffer): Promise<void> {
  const partial = `${file}.partial`;
  try {
    await Bun.write(partial, buffer);
    await rename(partial, file);
  } catch (cause) {
    await rm(partial, { force: true });
    throw cause;
  }
}
