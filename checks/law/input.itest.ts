import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { ProgramAnswer, type ProgramInvocation } from '@tagma/inspection/program';
import { Effect, FileSystem, Layer, Schema } from 'effect';
import { gitLayer } from '../../packages/git/src/Git';
import { sideAt } from '../../apps/tagma/server/src/enforcement/programs/files';

const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const git = gitLayer.pipe(Layer.provide(host));
const runner = join(import.meta.dir, '../../apps/tagma/server/src/enforcement/programs/runner.ts');

it.live('a non-UTF-8 selected source is admitted and fails only when the program reads it, naming its path and encoding', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'law-input-' });
    const command = (args: readonly string[], input?: string | Uint8Array) => {
      const result = spawnSync('git', ['-C', root, ...args], { input });
      if (result.error !== undefined) throw result.error;
      if (result.status !== 0) throw new Error(result.stderr.toString());
      return result.stdout.toString().trim();
    };
    command(['init', '--bare', '-q']);
    const blob = command(['hash-object', '-w', '--stdin'], new Uint8Array([0xff]));
    const tree = command(['mktree'], `100644 blob ${blob}\tbad.ts\n`);
    const at = command(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit-tree', tree, '-m', 'fixture']);
    const side = yield* sideAt(root, at, ['bad.ts'], 'tree');
    expect(side.paths).toEqual(['bad.ts']);
    expect(side.files).toEqual([]);
    yield* files.writeFileString(
      join(root, 'check.js'),
      `export default { audit: async ({ tree }) => { await tree.read('bad.ts'); return { tree: { findings: [] } }; } };`,
    );
    const input: ProgramInvocation = {
      request: 'input',
      checker: 'check.js',
      root,
      tree: at,
      base: null,
      keys: [{ key: 'audit', id: 'audit', params: {}, reach: { places: [''] } }],
      sides: [side],
    };
    const ran = spawnSync(process.execPath, ['--no-install', runner, 'check.js'], { cwd: root, input: JSON.stringify(input) });
    expect(ran.status).toBe(0);
    const answer = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProgramAnswer))(ran.stdout.toString());
    expect(answer.readings).toEqual([]);
    expect(answer.unanswered).toEqual([{ key: 'audit', why: 'threw', reason: expect.stringMatching(/bad\.ts.*UTF-8/u) }]);
  }).pipe(Effect.provide(Layer.merge(git, BunFileSystem.layer))),
);
