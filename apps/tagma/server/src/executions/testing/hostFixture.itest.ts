import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Cause, Data, Effect, Exit, FileSystem } from 'effect';
import { join } from 'node:path';
import { startHostFixture } from './hostFixture.js';

class PreparationRefused extends Data.TaggedError('PreparationRefused') {}

layer(BunFileSystem.layer, { excludeTestServices: true })('scoped host fixture', (it) => {
  it.effect('an exit before registration carries its stderr after both output streams close', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const state = yield* files.makeTempDirectoryScoped({ prefix: 'host-exited-' });
      const output = `bootstrap refused at ${state}`;
      const result = yield* Effect.exit(
        Effect.scoped(
          startHostFixture({
            state,
            command: [process.execPath, '-e', `process.stderr.write(${JSON.stringify(output)});process.exit(7);`],
          }),
        ),
      );

      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        expect(Cause.pretty(result.cause)).toContain('exited 7 before serving');
        expect(Cause.pretty(result.cause)).toContain(output);
      }
    }),
  );

  it.effect('failed setup after registration closes owned stdin and waits for the host to vacate', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const state = yield* files.makeTempDirectoryScoped({ prefix: 'host-released-' });
      const released = join(state, 'released');
      let child: Bun.Subprocess<'pipe', 'pipe', 'pipe'> | undefined;
      const outcome = yield* Effect.result(
        Effect.scoped(
          Effect.gen(function* () {
            child = yield* startHostFixture({
              state,
              command: [
                process.execPath,
                '-e',
                `process.stdout.write(${JSON.stringify(join(state, 'host.sock'))});for await(const _ of Bun.stdin.stream()){};await Bun.write(${JSON.stringify(released)},'EOF');`,
              ],
            });
            return yield* new PreparationRefused();
          }),
        ),
      );

      expect(outcome._tag).toBe('Failure');
      expect(yield* files.readFileString(released)).toBe('EOF');
      expect(child?.exitCode).toBe(0);
    }),
  );
});
