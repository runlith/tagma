import { Effect, FileSystem } from 'effect';
import { join } from 'node:path';

export const report = Effect.fn('posix.testing.report')(function* (state: string, fact: Record<string, unknown>) {
  const files = yield* FileSystem.FileSystem;
  yield* files.writeFileString(join(state, 'report.jsonl'), `${JSON.stringify(fact)}\n`, { flag: 'a' });
});
