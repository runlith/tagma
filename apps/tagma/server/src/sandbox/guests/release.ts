import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Clock, Effect, FileSystem, Layer } from 'effect';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { uuidv7 } from 'uuidv7';
import type { SandboxRecord, SandboxExport } from '../contract/wire/sandbox.js';
import type { GuestBackend } from '../contract/service/backends.js';
import { SandboxReadConflict, SandboxUnavailable } from '../contract/service/sandboxes.js';
import type { SandboxStore } from '../store/sandboxes.js';

const hostFiles = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

export const releaseGuest = Effect.fn('sandbox.releaseGuest')(function* (
  row: SandboxRecord,
  runtime: GuestBackend,
  store: SandboxStore,
  exportsRoot: string,
  readers: number,
): Effect.fn.Return<SandboxExport, SandboxUnavailable | SandboxReadConflict | ThreadStorageFailed> {
  if (readers > 0) return yield* new SandboxReadConflict({ sandbox: row.id, readers });
  const guest = yield* runtime.inspect(row.runtime);
  let path = row.exportPath;
  if (guest.status !== 'gone') {
    if (guest.status === 'running') yield* runtime.stop(row.runtime);
    if (path === null) {
      const fresh = yield* freshExportArchive(row.id, exportsRoot);
      yield* runtime.export(row.runtime, fresh).pipe(Effect.tapError(() => dropPartial(fresh)));
      yield* store.exported(row.id, fresh);
      path = fresh;
    }
  }
  yield* runtime.remove(row.runtime);
  yield* store.released(row.id);
  return { sandbox: row.id, path: path ?? '' };
});

const freshExportArchive = Effect.fnUntraced(function* (sandbox: string, exportsRoot: string) {
  const within = `${exportsRoot}/${sandbox}`;
  const path = `${within}/${(yield* Clock.currentTimeMillis).toString(36)}-${uuidv7().slice(-12)}.tar`;
  return yield* Effect.flatMap(FileSystem.FileSystem, (files) => files.makeDirectory(within, { recursive: true })).pipe(
    Effect.provide(hostFiles),
    Effect.mapError(
      (cause) =>
        new SandboxUnavailable({
          sandbox,
          reason: `its export directory could not be made: ${cause.message}`,
        }),
    ),
    Effect.as(path),
  );
});

const dropPartial = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (files) => files.remove(path, { force: true })).pipe(
    Effect.provide(hostFiles),
    Effect.tapError((failure) => Effect.logWarning('Failed sandbox export left a partial archive', { path, failure })),
    Effect.ignore,
  );
