import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { fileHolders } from './holders';

const root = mkdtempSync(join(tmpdir(), 'macos-holders-'));
const claim = join(root, 'writer.lock');
writeFileSync(claim, '');

const HOLD = 'use Fcntl ":flock"; open(my $f, ">>", $ARGV[0]) or exit 2; flock($f, LOCK_EX) or exit 3; $| = 1; print "held\\n"; <STDIN>;';

const holders: Bun.Subprocess[] = [];
afterAll(() => {
  for (const holder of holders) holder.kill('SIGKILL');
  rmSync(root, { recursive: true, force: true });
});

it.live('a file is read as held by the process that opened it, and as free once that process is gone', () =>
  Effect.gen(function* () {
    expect(yield* fileHolders(claim)).toEqual({ _tag: 'Holders', pids: [] });
    const holder = Bun.spawn(['/usr/bin/perl', '-e', HOLD, claim], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
    holders.push(holder);
    const reader = holder.stdout.getReader();
    yield* Effect.promise(() => reader.read());
    reader.releaseLock();
    expect(yield* fileHolders(claim)).toEqual({ _tag: 'Holders', pids: [holder.pid] });
    holder.stdin.end();
    yield* Effect.promise(() => holder.exited);
    expect(yield* fileHolders(claim)).toEqual({ _tag: 'Holders', pids: [] });
  }),
);
