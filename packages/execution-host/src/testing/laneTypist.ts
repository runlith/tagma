import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Effect, FileSystem, Queue } from 'effect';

const CLIENT = join(import.meta.dir, 'laneClient.ts');

type Measured = {
  readonly started: number;
  readonly finished: number;
  readonly command: number;
  readonly size: string | undefined;
  readonly keys: ReadonlyArray<number>;
  readonly receipts: ReadonlyArray<number>;
};

export type Typed = Measured & {
  readonly from: number;
  readonly to: number;
  readonly said: string;
};

export const laneTypist = Effect.fnUntraced(function* (url: string, token: string, next: number) {
  const files = yield* FileSystem.FileSystem;
  const result = join(yield* files.makeTempDirectoryScoped({ prefix: 'lane-typist-' }), 'typed.json');
  const lines = yield* Queue.unbounded<string>();
  const child = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn([process.execPath, CLIENT, url, token, String(next), result], { stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' }),
    ),
    (spawned) =>
      Effect.promise(async () => {
        spawned.kill('SIGKILL');
        await spawned.exited;
      }),
  );
  yield* Effect.forkScoped(
    Effect.promise(async () => {
      const decoder = new TextDecoder();
      let held = '';
      for await (const chunk of child.stdout) {
        held += decoder.decode(chunk, { stream: true });
        for (let at = held.indexOf('\n'); at >= 0; at = held.indexOf('\n')) {
          Queue.offerUnsafe(lines, held.slice(0, at));
          held = held.slice(at + 1);
        }
      }
    }),
  );
  const typed = Effect.gen(function* () {
    process.kill(child.pid, 'SIGUSR2');
    const from = yield* Clock.currentTimeMillis;
    //! the loop stays blocked until the typist has seen every echo, so nothing on it can carry them
    yield* Effect.sync(() => {
      while (!existsSync(result));
    });
    const to = yield* Clock.currentTimeMillis;
    const said = yield* files.readFileString(result);
    return { ...(JSON.parse(said) as Measured), from, to, said } satisfies Typed;
  });
  return { line: Effect.map(Queue.take(lines), (line) => JSON.parse(line) as Record<string, unknown>), typed };
}, Effect.provide(BunFileSystem.layer));
