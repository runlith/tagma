import { constants } from 'node:fs';
import { open, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pidAlive } from '@runlith/utils/process';
import { closeOnExec, lockExclusive, unlock } from '@runlith/file-lock/flock';
import { Data, Effect } from 'effect';
import { LOCK_FILE } from '../contract/wire/lock.js';

export const LEGACY_CLAIM_FILE = 'server.pid';

export class DataDirectoryConflict extends Data.TaggedError('DataDirectoryConflict')<{
  readonly path: string;
  readonly holder: number | null;
}> {
  override get message(): string {
    const who = this.holder === null ? 'another Tagma process' : `a Tagma server (pid ${this.holder})`;
    return `${who} already owns ${this.path}. One process owns this directory — its database, its thread rollouts and the event positions it mints from memory. Stop that process, or point this one at a directory of its own with TAGMA_DATABASE_PATH.`;
  }
}

export class DataDirectoryLockFailed extends Data.TaggedError('DataDirectoryLockFailed')<{
  readonly path: string;
  readonly reason: string;
}> {}

export type DataDirectoryLock = {
  readonly path: string;
  readonly release: Effect.Effect<void>;
};

export const pidOf = (text: string): number | null => {
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
};

const pidIn = (path: string): Promise<number | null> => readFile(path, 'utf8').then(pidOf, () => null);

const livePid = async (path: string): Promise<number | null> => {
  const pid = await pidIn(path);
  return pid !== null && pidAlive(pid) ? pid : null;
};

const locked = async (dataPath: string): Promise<DataDirectoryLock | DataDirectoryConflict> => {
  const path = join(dataPath, LOCK_FILE);
  const handle = await open(path, constants.O_RDWR | constants.O_CREAT, 0o600);
  const { fd } = handle;
  try {
    closeOnExec(fd);
    if (lockExclusive(fd) === 'held') {
      await handle.close();
      return new DataDirectoryConflict({ path: dataPath, holder: await livePid(path) });
    }
    const legacy = join(dataPath, LEGACY_CLAIM_FILE);
    const previous = await pidIn(path);
    const pid = Buffer.from(`${process.pid}\n`);
    for (let attempt = 0; ; attempt += 1) {
      const standing = await pidIn(legacy);
      if (standing !== null && standing !== process.pid && standing !== previous && pidAlive(standing)) {
        unlock(fd);
        await handle.close();
        return new DataDirectoryConflict({ path: dataPath, holder: standing });
      }
      await rm(legacy, { force: true });
      try {
        await writeFile(legacy, pid, { mode: 0o600, flag: 'wx' });
        break;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 2) throw cause;
      }
    }
    await handle.write(pid, 0, pid.length, 0);
    await handle.truncate(pid.length);
  } catch (cause) {
    await handle.close();
    throw cause;
  }
  let released = false;
  return {
    path: dataPath,
    release: Effect.promise(async () => {
      if (released) return;
      released = true;
      const legacy = join(dataPath, LEGACY_CLAIM_FILE);
      const steps: readonly (() => Promise<unknown> | void)[] = [
        async () => (await pidIn(legacy)) === process.pid && rm(legacy, { force: true }),
        () => handle.truncate(0),
        () => unlock(fd),
        () => handle.close(),
      ];
      for (const step of steps) {
        try {
          await step();
        } catch (cause) {
          console.warn(
            `[tagma] releasing ${dataPath} went on past a failed step: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }
    }),
  };
};

export const lockDataDirectory = (dataPath: string): Effect.Effect<DataDirectoryLock, DataDirectoryConflict | DataDirectoryLockFailed> =>
  Effect.flatMap(
    Effect.tryPromise({
      try: () => locked(dataPath),
      catch: (cause) => new DataDirectoryLockFailed({ path: dataPath, reason: cause instanceof Error ? cause.message : String(cause) }),
    }),
    (taken) => (taken instanceof DataDirectoryConflict ? Effect.fail(taken) : Effect.succeed(taken)),
  );
