import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import type { CheckoutState } from '../../../workspace/contract/wire/checkout.js';
import type { CheckoutCommitted } from '../../../landing/contract/wire/checkoutCommits.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { suiteGit, suiteGitText } from '../suiteGit.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';

const ROOT = join(import.meta.dir, '..', '..', '..', '..', '..', '..', '..');
const EXECUTION_HOST = join(ROOT, 'packages', 'execution-host');
const LIBRARY = join(EXECUTION_HOST, 'native', 'target', 'release', 'libexecution_platform.dylib');

const declared = Effect.fnUntraced(function* (run: readonly string[]) {
  const door = yield* DoorFixture;
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.realPath(yield* door.directory('steps-checkout'));
  const projectId = yield* door.stealthProject(root);
  yield* files.makeDirectory(join(root, 'tools'), { recursive: true });
  yield* files.writeFileString(
    join(root, 'tools', 'fmt.sh'),
    '#!/bin/sh\nfor file in "$@"; do sed \'s/[[:space:]]*$//\' "$file" > "$file.next" && mv "$file.next" "$file"; done\n',
  );
  yield* files.chmod(join(root, 'tools', 'fmt.sh'), 0o755);
  yield* files.writeFileString(
    join(root, 'tagma.config.ts'),
    [
      `import { defineConfig, Format, Loading } from '@runlith/tagma/rules';`,
      `export default defineConfig({`,
      `  inspections: { 'domain-no-ui': Loading.forbid({ from: ['packages/domain'], refuses: ['react'] }) },`,
      `  format: { fmt: Format.command({ run: ${JSON.stringify(run)}, files: ['*.txt'] }) },`,
      `});`,
    ].join('\n'),
  );
  yield* files.writeFileString(join(root, 'kept.txt'), 'one\n');
  yield* suiteGit(root, 'add', '-A');
  yield* suiteGit(root, 'commit', '-q', '-m', 'declare the steps');
  const coverage = yield* Context.get(door.runtime.workspace, Coverage).cover(projectId);
  const covered = coverage.roots.find((row) => row.path === root);
  if (covered === undefined) return yield* Effect.die(new Error(`the coverage of project ${projectId} answered no root for ${root}`));
  return { projectId, root, rootId: covered.rootId as RootId };
});

const committing = (projectId: number, rootId: RootId, body: object) =>
  Effect.flatMap(DoorFixture, (door) => door.op('commit_checkout', { rootId, ...body }, `project=${projectId}`));

const staged = Effect.fnUntraced(function* (projectId: number, rootId: RootId) {
  const door = yield* DoorFixture;
  const read = yield* door.op('read_checkout', { root: rootId }, `project=${projectId}`);
  return (read.body as { checkout: CheckoutState }).checkout.entries.staged.entries.length;
});

describe.skipIf(!existsSync(LIBRARY))('commit steps over a live execution host', () => {
  layer(Layer.merge(doorFixture(), BunFileSystem.layer), {
    excludeTestServices: true,
  })('a live host', (it) => {
    it.effect(
      'commit_checkout shapes the index version by the declared steps through the real program road, and the working file takes the same form',
      () =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { projectId, root, rootId } = yield* declared(['tools/fmt.sh']);
          yield* files.writeFileString(join(root, 'kept.txt'), 'two   \n');
          yield* suiteGit(root, 'add', '--', 'kept.txt');
          const committed = yield* committing(projectId, rootId, { message: 'shaped by its steps' });
          expect(committed.status).toBe(200);
          expect((committed.body as CheckoutCommitted).edited).toEqual(['kept.txt']);
          expect(yield* suiteGitText(root, 'show', 'HEAD:kept.txt')).toBe('two\n');
          expect(yield* files.readFileString(join(root, 'kept.txt'))).toBe('two\n');
          expect(yield* staged(projectId, rootId)).toBe(0);
        }),
    );
  });
});
