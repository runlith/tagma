import { statfs } from 'node:fs/promises';
import { Data, Effect } from 'effect';

export type VolumeReading = { readonly total: number; readonly available: number };

export type VolumeReader = (path: string) => Effect.Effect<VolumeReading | undefined>;

class VolumeUnreadable extends Data.TaggedError('VolumeUnreadable')<{ readonly path: string; readonly cause: unknown }> {
  override get message(): string {
    return `the volume of ${this.path} could not be read`;
  }
}

export const statVolume: VolumeReader = (path) =>
  Effect.tryPromise({ try: () => statfs(path), catch: (cause) => new VolumeUnreadable({ path, cause }) }).pipe(
    Effect.map((read) => ({
      total: Number(read.blocks) * Number(read.bsize),
      available: Number(read.bavail) * Number(read.bsize),
    })),
    Effect.catchTag('VolumeUnreadable', (failure) => Effect.as(Effect.logWarning(failure.message, failure.cause), undefined)),
  );
