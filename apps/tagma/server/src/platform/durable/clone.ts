import { constants } from 'node:fs';
import { copyFile, cp, stat, utimes } from 'node:fs/promises';
import { Data, Effect } from 'effect';
import { answered, refusalOf } from '../command.js';
import { requireFree, SpaceShort, treeBytes } from './space.js';

export class CloneFailed extends Data.TaggedError('CloneFailed')<{
  readonly path: string;
  readonly reason: string;
  readonly needed?: number;
}> {
  override get message(): string {
    return `${this.path} could not be cloned: ${this.reason}`;
  }
}

type CloneOptions = { readonly times?: boolean };

const CP = '/bin/cp';

const UNCLONABLE = new Set(['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EINVAL']);

const failed = (path: string) => (cause: unknown) =>
  cause instanceof SpaceShort
    ? new CloneFailed({ path, reason: cause.message, needed: cause.needed })
    : new CloneFailed({ path, reason: cause instanceof Error ? cause.message : String(cause) });

export const cloneBytes = async (from: string, to: string, exclusive: boolean): Promise<void> => {
  const excl = exclusive ? constants.COPYFILE_EXCL : 0;
  try {
    await copyFile(from, to, constants.COPYFILE_FICLONE_FORCE | excl);
  } catch (cause) {
    if (!UNCLONABLE.has((cause as NodeJS.ErrnoException).code ?? '')) throw cause;
    requireFree(to, (await stat(from)).size);
    await copyFile(from, to, excl);
  }
};

const copied = (args: readonly string[]): Effect.Effect<string | null> => Effect.map(answered(CP, args), (answer) => refusalOf(CP, answer));

const clonedDirectory = Effect.fnUntraced(function* (from: string, to: string) {
  if (process.platform === 'darwin' && (yield* copied(['-Rc', `${from}/.`, to])) === null) return;
  yield* Effect.try({ try: () => requireFree(to, treeBytes(from)), catch: failed(to) });
  if (process.platform !== 'darwin') {
    return yield* Effect.tryPromise({
      try: () => cp(from, to, { recursive: true, verbatimSymlinks: true, force: true }),
      catch: failed(to),
    });
  }
  const refusal = yield* copied(['-R', `${from}/.`, to]);
  if (refusal !== null) return yield* new CloneFailed({ path: to, reason: refusal });
});

export const cloneTree = Effect.fn('platform.durable.cloneTree')(function* (from: string, to: string, options?: CloneOptions) {
  const source = yield* Effect.tryPromise({ try: () => stat(from), catch: failed(from) });
  if (source.isDirectory()) return yield* clonedDirectory(from, to);
  yield* Effect.tryPromise({
    try: async () => {
      await cloneBytes(from, to, false);
      if (options?.times === true) await utimes(to, source.atime, source.mtime);
    },
    catch: failed(to),
  });
});
