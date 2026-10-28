import { Data, Effect, FileSystem, Schema } from 'effect';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const Config = Schema.Struct({
  compilerOptions: Schema.Struct({
    paths: Schema.Struct({
      '@feed/*': Schema.Array(Schema.String),
      '@runlith/markdown/render': Schema.Array(Schema.String),
    }),
  }),
});

class HistoricalCheckFailed extends Data.TaggedError('HistoricalCheckFailed')<{ readonly message: string; readonly cause?: unknown }> {}

export const checkHistorical = Effect.fn('stand.checkHistorical')(function* (source: string | undefined) {
  if (source === undefined) return;
  const files = yield* FileSystem.FileSystem;
  const configPath = fileURLToPath(new URL('./historical/tsconfig.json', import.meta.url));
  const config = yield* files.readFileString(configPath).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Config))));
  const feed = config.compilerOptions.paths['@feed/*'];
  const markdown = config.compilerOptions.paths['@runlith/markdown/render'];
  if (feed.length !== 1 || markdown.length !== 1 || !feed[0]!.endsWith('/*')) {
    return yield* new HistoricalCheckFailed({ message: 'Historical adapter aliases do not identify one source tree' });
  }
  const expectedFeed = yield* files.realPath(resolve(source));
  const configuredFeed = yield* files.realPath(resolve(dirname(configPath), feed[0]!.slice(0, -2)));
  const expectedMarkdown = yield* files.realPath(resolve(source, '../../../packages/markdown/src/render.ts'));
  const configuredMarkdown = yield* files.realPath(resolve(dirname(configPath), markdown[0]!));
  if (expectedFeed !== configuredFeed || expectedMarkdown !== configuredMarkdown) {
    return yield* new HistoricalCheckFailed({ message: `Historical adapter aliases do not match FEED_STAND_SOURCE: ${source}` });
  }
  yield* Effect.tryPromise({
    try: async () => {
      const child = Bun.spawn(['bun', 'run', 'typecheck', '--project', 'stand/historical/tsconfig.json'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        stdout: 'inherit',
        stderr: 'inherit',
      });
      const status = await child.exited;
      if (status !== 0) throw new Error(`typecheck exited ${status}`);
    },
    catch: (cause) => new HistoricalCheckFailed({ message: 'Historical adapter typecheck failed', cause }),
  });
});
