import { Effect, FileSystem } from 'effect';
import type { CurrentInstallation, Installation, InstallationFailure } from '../contract/wire/manifest.js';
import { readInstallation } from './read.js';

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
