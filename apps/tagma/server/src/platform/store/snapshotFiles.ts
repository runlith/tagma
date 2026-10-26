import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { Effect } from 'effect';
import { cloneFile, flushFile as flushDurably, replaceFile } from '../durable/files.js';
import { SnapshotFailed } from '../contract/service/snapshots.js';

export const snapshotIO = <A>(path: string, run: () => Promise<A>): Effect.Effect<A, SnapshotFailed> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new SnapshotFailed({ path, reason: cause instanceof Error ? cause.message : String(cause) }),
  });

export const snapshotPaths = (path: string) => ({
  root: `${path}.snapshots`,
  current: `${path}.snapshot.json`,
  intent: `${path}.restore.json`,
  staging: `${path}.snapshot-restoring`,
});

export const flushFile = Effect.fnUntraced(function* (path: string) {
  const durability = yield* flushDurably(path).pipe(Effect.mapError((cause) => new SnapshotFailed({ path, reason: cause.reason })));
  if (durability !== 'full')
    return yield* new SnapshotFailed({ path, reason: 'full flush is unavailable; a snapshot cannot be the rollback guarantee' });
});

export const syncDirectory = (path: string): Effect.Effect<void, SnapshotFailed> =>
  snapshotIO(path, async () => {
    if (process.platform === 'win32') return;
    const file = await open(path, 'r');
    try {
      await file.sync();
    } finally {
      await file.close();
    }
  });

export const snapshotDocument = Effect.fnUntraced(function* (path: string, value: unknown) {
  const durability = yield* replaceFile(path, `${JSON.stringify(value)}\n`).pipe(
    Effect.mapError((cause) => new SnapshotFailed({ path, reason: cause.reason })),
  );
  if (durability !== 'full') return yield* new SnapshotFailed({ path, reason: 'full flush is unavailable' });
});

export const cloneStore = Effect.fnUntraced(function* (from: string, to: string) {
  const durability = yield* cloneFile(from, to).pipe(Effect.mapError((cause) => new SnapshotFailed({ path: to, reason: cause.reason })));
  if (durability !== 'full') return yield* new SnapshotFailed({ path: to, reason: 'full flush is unavailable' });
});

export const snapshotDigest = (path: string): Effect.Effect<string, SnapshotFailed> =>
  snapshotIO(path, async () => {
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    return hash.digest('hex');
  });

export const snapshotFile = (path: string, id: string): string => join(snapshotPaths(path).root, id, basename(path));
