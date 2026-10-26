import { createHash } from 'node:crypto';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Data, Effect, Layer, type PlatformError, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { OWN_GIT_VARIABLE } from '../../platform/contract/service/credentials.js';
import type { TreeArchive } from '../contract/service/backends.js';

export class SnapshotFailed extends Data.TaggedError('SnapshotFailed')<{
  readonly reason: string;
}> {
  override get message(): string {
    return `its source could not be read: ${this.reason}`;
  }
}

export const ALWAYS_EXCLUDED = [':(exclude).git'] as const;

const hostPlatform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const hostRuntime = Layer.mergeAll(hostPlatform, BunChildProcessSpawner.layer.pipe(Layer.provide(hostPlatform)));

export const resolveCommit = (checkout: string, name: string): Effect.Effect<string, SnapshotFailed> =>
  git(checkout, ['rev-parse', '--verify', `${name}^{commit}`]);

export const snapshotInto = Effect.fn('sandbox.snapshotInto')(function* <E>(
  source: { readonly checkout: string; readonly commit: string; readonly exclusions: readonly string[] },
  sink: (archive: TreeArchive) => Effect.Effect<void, E>,
): Effect.fn.Return<string, SnapshotFailed | E> {
  const commit = yield* resolveCommit(source.checkout, source.commit);
  if (!commit.startsWith(source.commit)) {
    return yield* new SnapshotFailed({ reason: `${source.commit} does not name a commit of its project` });
  }
  const digest = createHash('sha256');
  yield* Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const archive = yield* spawner.spawn(
        ChildProcess.make('git', ['-C', source.checkout, 'archive', '--format=tar', commit, '--', '.', ...source.exclusions], {
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          env: { [OWN_GIT_VARIABLE]: '1' },
          extendEnv: true,
        }),
      );
      const measured = archive.stdout.pipe(
        Stream.tap((chunk) =>
          Effect.sync(() => {
            digest.update(chunk);
          }),
        ),
      );
      const [, refused, code] = yield* Effect.all(
        [sink(measured), archive.stderr.pipe(Stream.decodeText(), Stream.mkString), archive.exitCode],
        { concurrency: 'unbounded' },
      );
      if (Number(code) !== 0) {
        return yield* new SnapshotFailed({ reason: `it could not be exported: ${refused.trim()}` });
      }
    }),
  ).pipe(
    Effect.provide(hostRuntime),
    Effect.catch((cause: SnapshotFailed | E | PlatformError.PlatformError) =>
      Effect.fail(platformFailure(cause) ? new SnapshotFailed({ reason: `it could not be exported: ${cause.message}` }) : cause),
    ),
  );
  return digest.digest('hex');
});

const platformFailure = (cause: unknown): cause is PlatformError.PlatformError =>
  typeof cause === 'object' && cause !== null && '_tag' in cause && (cause as { readonly _tag: unknown })._tag === 'PlatformError';

const git = (checkout: string, argv: readonly string[]): Effect.Effect<string, SnapshotFailed> =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const handle = yield* spawner.spawn(
        ChildProcess.make('git', ['-C', checkout, ...argv], { stdin: 'ignore', env: { [OWN_GIT_VARIABLE]: '1' }, extendEnv: true }),
      );
      const output = yield* handle.all.pipe(Stream.decodeText(), Stream.mkString);
      const code = Number(yield* handle.exitCode);
      if (code !== 0) return yield* new SnapshotFailed({ reason: output.trim() });
      return output.trim();
    }),
  ).pipe(
    Effect.provide(hostRuntime),
    Effect.catch((cause) => Effect.fail(cause._tag === 'SnapshotFailed' ? cause : new SnapshotFailed({ reason: cause.message }))),
  );
