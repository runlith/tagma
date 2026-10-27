import { Effect, FileSystem, Path, type PlatformError } from 'effect';

export type RecordMeasurement =
  | { readonly _tag: 'Measured'; readonly bytes: number }
  | { readonly _tag: 'Unmeasured'; readonly failure: PlatformError.PlatformError };

export const makeRecordMeasure = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const recordBytes = Effect.fnUntraced(function* (directory: string): Effect.fn.Return<number, PlatformError.PlatformError> {
    let bytes = 0;
    const pending = [directory];
    while (pending.length > 0) {
      const next = pending.pop()!;
      const info = yield* fs.stat(next);
      if (info.type === 'Directory') {
        const entries = yield* fs.readDirectory(next);
        for (const entry of entries) pending.push(path.join(next, entry));
      } else if (info.type === 'File') {
        bytes += Number(info.size);
      }
    }
    return bytes;
  });
  return (directory: string): Effect.Effect<RecordMeasurement> =>
    recordBytes(directory).pipe(
      Effect.match({
        onSuccess: (bytes): RecordMeasurement => ({ _tag: 'Measured', bytes }),
        onFailure: (failure): RecordMeasurement => ({ _tag: 'Unmeasured', failure }),
      }),
    );
});
