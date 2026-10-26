import { Effect, FileSystem, Layer } from 'effect';
import * as MemoryFileSystem from '@runlith/testbed/memory';
import { NamespaceId } from '@runlith/files/namespace';
import { Environments, type AcquiredEnvironment } from '../../workspace/contract/service/environments.js';
import { EnvironmentId, type EnvironmentBinding } from '../../workspace/contract/wire/environments.js';

const unused = () => Effect.die('The memory transcript environment performs no command or environment mutation.');

export const transcriptFiles = Effect.fnUntraced(function* () {
  const files = yield* MemoryFileSystem.make;
  yield* files.makeDirectory('/data', { recursive: true });
  const binding: EnvironmentBinding = {
    environmentId: EnvironmentId.make('memory'),
    kind: 'host',
    namespaceId: NamespaceId.make('memory'),
    identityWitness: { provider: 'memory', format: 'v1', token: 'memory' },
  };
  const acquired: AcquiredEnvironment = {
    binding,
    accessGeneration: 0,
    use: { _tag: 'Intrinsic', binding },
    commandEnvironment: { materialize: unused },
    world: {
      files: Layer.succeed(FileSystem.FileSystem, files),
      environment: { platform: 'linux', shell: '/bin/sh', tmp: '/tmp', executables: { ripgrep: unused() } },
    },
  };
  const access = Environments.of({
    inspect: unused,
    activate: unused,
    release: unused,
    releaseUse: unused,
    heldUses: unused,
    acquireActive: () => Effect.succeed(acquired),
  });
  return { files, binding, access };
});
