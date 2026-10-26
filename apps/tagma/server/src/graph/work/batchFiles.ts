import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Context, Data, Effect, FileSystem, Layer } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { uuidv7 } from 'uuidv7';
import { dataPathOf, GraphStore } from '../../platform/contract/service/store.js';

export class BatchFiles extends Context.Service<
  BatchFiles,
  {
    readonly read: (path: string) => Effect.Effect<{ readonly path: string; readonly source: string }, BatchSourceUnreadable>;
    readonly body: (
      base: string | undefined,
      path: string,
    ) => Effect.Effect<{ readonly path: string; readonly text: string }, BatchSourceUnreadable>;
    readonly write: (source: string) => Effect.Effect<string, PlatformError>;
  }
>()('tagma/graph/BatchFiles') {}

export class BatchSourceUnreadable extends Data.TaggedError('BatchSourceUnreadable')<{
  readonly path: string;
  readonly reason: string;
  readonly sourceTag?: PlatformError['reason']['_tag'];
  readonly sourceMessage?: string;
}> {
  override get message(): string {
    const source = this.sourceTag === undefined || this.sourceMessage === undefined ? '' : ` (${this.sourceTag}: ${this.sourceMessage})`;
    return `${this.path}: ${this.reason}${source}`;
  }
}

export const batchFilesLayer: Layer.Layer<BatchFiles, never, GraphStore | FileSystem.FileSystem> = Layer.effect(
  BatchFiles,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const store = yield* GraphStore;
    const root = join(dataPathOf(store.path) ?? tmpdir(), 'batch-sources');
    const openFile = (path: string) =>
      fs.readFileString(path).pipe(
        Effect.mapError(
          (error) =>
            new BatchSourceUnreadable({
              path,
              reason: 'cannot be read',
              sourceTag: error.reason._tag,
              sourceMessage: error.message,
            }),
        ),
      );
    return BatchFiles.of({
      read: (path) =>
        isAbsolute(path)
          ? openFile(path).pipe(Effect.map((source) => ({ path, source })))
          : new BatchSourceUnreadable({
              path,
              reason: 'is not an absolute path; the door that knows where a caller stands resolves a relative one',
            }),
      body: (base, path) => {
        if (!isAbsolute(path) && base === undefined) {
          return new BatchSourceUnreadable({
            path,
            reason: 'is relative, and this document has no directory to measure it from',
          });
        }
        const absolute = isAbsolute(path) ? path : resolve(base as string, path);
        return openFile(absolute).pipe(Effect.map((text) => ({ path: absolute, text })));
      },
      write: (source) =>
        Effect.suspend(() => {
          const path = join(root, `${uuidv7()}.json`);
          return fs.makeDirectory(root, { recursive: true }).pipe(Effect.andThen(fs.writeFileString(path, source)), Effect.as(path));
        }),
    });
  }),
);
