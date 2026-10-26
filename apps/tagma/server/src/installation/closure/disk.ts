import { Effect, FileSystem, Layer } from 'effect';
import { InstallationClosure } from '../contract/service/closure.js';
import { readCurrent } from './current.js';
import { partsAt, readInstallation, verifyInstallation } from './read.js';
import { writeInstallation } from './write.js';

export const installationClosureLayer: Layer.Layer<InstallationClosure, never, FileSystem.FileSystem> = Layer.effect(
  InstallationClosure,
  Effect.gen(function* () {
    const here = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);
    return InstallationClosure.of({
      read: (root) => here(readInstallation(root)),
      verify: (root) => here(verifyInstallation(root)),
      current: (entry, installed) => here(readCurrent(entry, installed)),
      write: (root, platform, build, parts, origin, tree) => here(writeInstallation(root, platform, build, parts, origin, tree)),
      parts: (root, role, relative) => here(partsAt(root, role, relative)),
    });
  }),
);
