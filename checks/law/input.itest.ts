import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, Layer, Result } from 'effect';
import { gitLayer } from '../../packages/git/src/Git';
import { sideAt } from '../../apps/tagma/server/src/enforcement/programs/files';

const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const git = gitLayer.pipe(Layer.provide(host));

test('non-UTF-8 selected source refuses the program producer before a checker can judge it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'law-input-'));
  const command = (args: readonly string[], input?: string | Uint8Array) => {
    const result = spawnSync('git', ['-C', root, ...args], { input });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  try {
    command(['init', '--bare', '-q']);
    const blob = command(['hash-object', '-w', '--stdin'], new Uint8Array([0xff]));
    const tree = command(['mktree'], `100644 blob ${blob}\tbad.ts\n`);
    const at = command(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit-tree', tree, '-m', 'fixture']);
    const producer = await Effect.runPromise(sideAt(root, at, ['bad.ts'], 'tree').pipe(Effect.provide(git), Effect.result));
    expect(Result.isFailure(producer)).toBe(true);
    if (Result.isSuccess(producer)) throw new Error('unread source was admitted to the checker');
    expect(producer.failure._tag).toBe('InspectionFailed');
    expect(producer.failure.cause).toBe('git');
    expect(producer.failure.reason).toContain('UTF-8');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
