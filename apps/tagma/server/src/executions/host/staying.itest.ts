import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Fiber, FileSystem, Option } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { hostsStaying } from './staying.js';

const root = mkdtempSync(join(tmpdir(), 'hosts-staying-'));
const store = join(root, 'tagma.sqlite');
const state = join(root, 'executions', 'environment');
mkdirSync(state, { recursive: true });
const claim = join(state, 'writer.lock');
writeFileSync(claim, '');

const HOLD = 'use Fcntl ":flock"; open(my $f, ">>", $ARGV[0]) or exit 2; flock($f, LOCK_EX) or exit 3; $| = 1; print "held\\n"; <STDIN>;';

const holders: Bun.Subprocess[] = [];
afterAll(() => {
  for (const holder of holders) holder.kill('SIGKILL');
  rmSync(root, { recursive: true, force: true });
});

const hold = () =>
  Effect.promise(async () => {
    const holder = Bun.spawn(['/usr/bin/perl', '-e', HOLD, claim], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
    holders.push(holder);
    const reader = holder.stdout.getReader();
    await reader.read();
    reader.releaseLock();
    return holder;
  });

const staying = Effect.flatMap(FileSystem.FileSystem, (files) => hostsStaying(files, store)).pipe(Effect.provide(BunFileSystem.layer));

(existsSync('/usr/sbin/lsof') ? it.live : it.live.skip)(
  'a live host claim keeps the wait pending until its holder exits and releases it',
  () =>
    Effect.gen(function* () {
      const holder = yield* hold();
      const waiting = yield* Effect.forkChild(staying);
      yield* Effect.yieldNow;
      expect(Option.isNone(yield* Fiber.await(waiting).pipe(Effect.timeoutOption(0)))).toBe(true);
      holder.stdin.end();
      yield* Effect.promise(() => holder.exited);
      expect(yield* Fiber.join(waiting)).toEqual([]);
    }),
  10_000,
);
