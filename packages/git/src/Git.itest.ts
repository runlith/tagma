import { afterAll, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Fiber } from 'effect';
import { onGit, release, tempRepo, tempRoot } from './testing/fixture.js';

afterAll(release);

test('git drains stdout and stderr larger than the process pipe while it waits for exit', async () => {
  const repo = await tempRepo('git-output-');
  const payload = 'x'.repeat(256 * 1024);
  const stored = await onGit((git) => git.run(['-C', repo, 'hash-object', '-w', '--stdin'], { stdin: payload }));
  expect(stored.status).toBe(0);

  const read = await onGit((git) => git.run(['-C', repo, 'cat-file', 'blob', stored.stdout.trim()]));
  expect(read.status).toBe(0);
  expect(read.stdout).toBe(payload);
  expect(read.overflow).toBe(false);

  const loud = await onGit((git) => git.run(['-c', `alias.loud=!head -c ${payload.length} /dev/zero >&2; exit 7`, 'loud']));
  expect(loud.status).toBe(7);
  expect(loud.stderr).toHaveLength(payload.length);
});

test('a declared capture answers overflow rather than an answer that reads whole', async () => {
  const repo = await tempRepo('git-capture-');
  const payload = 'x'.repeat(64 * 1024);
  const stored = await onGit((git) => git.run(['-C', repo, 'hash-object', '-w', '--stdin'], { stdin: payload }));

  const bounded = await onGit((git) => git.run(['-C', repo, 'cat-file', 'blob', stored.stdout.trim()], { capture: 32 }));
  const boundedBytes = await onGit((git) =>
    git.run(['-C', repo, 'cat-file', 'blob', stored.stdout.trim()], { capture: 32, stdoutBytes: true }),
  );

  expect(bounded.status).toBe(0);
  expect(bounded.overflow).toBe(true);
  expect(bounded.stdout).toBe('x'.repeat(32));
  expect(boundedBytes.overflow).toBe(true);
  expect(boundedBytes.stdoutBytes).toEqual(new TextEncoder().encode('x'.repeat(32)));

  const noisy = await onGit((git) =>
    git.run(['-c', `alias.noisy=!head -c ${payload.length} /dev/zero | tr '\\0' 'y' >&2; exit 5`, 'noisy'], {
      capture: 32,
    }),
  );

  expect(noisy.status).toBe(5);
  expect(noisy.stderr).toBe('y'.repeat(32));
  expect(noisy.overflow).toBe(false);
});

test('interrupting git terminates the child process group', async () => {
  const repo = await tempRepo('git-interrupt-');
  const marker = join(tempRoot('git-marker-'), 'child.pid');
  const alias = `alias.block=!sh -c 'echo $$ > "$1"; exec sleep 30' -`;

  await onGit((git) =>
    Effect.scoped(
      Effect.gen(function* () {
        const child = yield* Effect.forkScoped(git.run(['-C', repo, '-c', alias, 'block', marker]));
        while (!existsSync(marker)) yield* Effect.sleep('5 millis');
        yield* Fiber.interrupt(child);
      }),
    ),
  );

  const pid = Number(readFileSync(marker, 'utf8').trim());
  expect(Number.isInteger(pid)).toBe(true);
  expect(() => process.kill(pid, 0)).toThrow();
});

test('a child of git that ignores the terminate signal is dead once the interrupt returns', async () => {
  const repo = await tempRepo('git-stubborn-');
  const marker = join(tempRoot('git-stubborn-marker-'), 'child.pid');
  const alias = `alias.stubborn=!sh -c 'trap "" TERM; sleep 30 & echo $! > "$1"; wait' -`;

  await onGit((git) =>
    Effect.scoped(
      Effect.gen(function* () {
        const child = yield* Effect.forkScoped(git.run(['-C', repo, '-c', alias, 'stubborn', marker]));
        while (!existsSync(marker) || readFileSync(marker, 'utf8').trim() === '') yield* Effect.sleep('5 millis');
        yield* Fiber.interrupt(child);
      }),
    ),
  );

  const pid = Number(readFileSync(marker, 'utf8').trim());
  expect(Number.isInteger(pid)).toBe(true);
  const reaped = () => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  };
  while (!reaped()) await Bun.sleep(5);
  expect(reaped()).toBe(true);
});
