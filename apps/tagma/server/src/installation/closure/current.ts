import { Effect, FileSystem, Semaphore } from 'effect';
import type { InstallationManifest } from '../contract/wire/manifest.js';
import { manifestRevision } from './manifests.js';
import type { CurrentInstallation, Installation, InstallationFailure } from '../contract/wire/manifest.js';
import { readInstallation } from './read.js';
import { makeVersionWindow } from './projection.js';

export const makeCurrentProjection = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const reading = yield* Semaphore.make(1);
  const versions = makeVersionWindow<InstallationManifest>();
  const read = Effect.fn('installation.current')(function* (root: string) {
    for (;;) {
      const before = yield* Effect.result(Effect.try(() => manifestRevision(root)));
      if (before._tag === 'Failure') {
        return yield* readInstallation(root).pipe(Effect.provideService(FileSystem.FileSystem, files));
      }
      const held = versions.get(before.success);
      if (held !== undefined) return held;
      const manifest = yield* readInstallation(root, before.success.root).pipe(Effect.provideService(FileSystem.FileSystem, files));
      const after = yield* Effect.result(Effect.try(() => manifestRevision(root)));
      if (after._tag === 'Failure') {
        return yield* readInstallation(root).pipe(Effect.provideService(FileSystem.FileSystem, files));
      }
      if (before.success.root !== after.success.root || before.success.key !== after.success.key) continue;
      versions.set(before.success, manifest);
      return manifest;
    }
  });
  return { read: (root: string) => reading.withPermit(read(root)) };
});

export const readCurrent = Effect.fnUntraced(function* (
  entry: string,
  installed: string,
): Effect.fn.Return<CurrentInstallation, InstallationFailure, FileSystem.FileSystem> {
  const own = yield* Effect.result(readInstallation(entry));
  if (own._tag === 'Failure' && own.failure._tag !== 'InstallationMissing') return yield* Effect.fail(own.failure);
  if (own._tag === 'Success') {
    const here: Installation = { root: entry, manifest: own.success };
    return { runsFrom: here, handsOut: here, unreadable: undefined };
  }
  const machine = yield* Effect.result(readInstallation(installed));
  if (machine._tag === 'Success') {
    return { runsFrom: undefined, handsOut: { root: installed, manifest: machine.success }, unreadable: undefined };
  }
  return {
    runsFrom: undefined,
    handsOut: undefined,
    unreadable: machine.failure._tag === 'InstallationMissing' ? undefined : machine.failure,
  };
});
