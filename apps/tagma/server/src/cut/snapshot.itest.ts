import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Git, gitLayer } from '@runlith/git/Git';
import { gitTree } from '../platform/git/readings.js';
import { captureSource } from './snapshot.js';

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), spawning, BunFileSystem.layer);

it.live(
  'a captured working tree carries the revision the checkout reading measures, declared ignored inputs included and other ignored files left out',
  () =>
    Effect.gen(function* () {
      const tree = yield* Effect.acquireRelease(
        Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'tagma-snapshot-')))),
        (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
      );
      const git = (...args: string[]) => {
        const ran = Bun.spawnSync(['git', '-C', tree, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stderr: 'pipe' });
        expect(ran.exitCode).toBe(0);
      };
      writeFileSync(join(tree, '.gitignore'), 'skills/_probe-*\n.env\n');
      writeFileSync(join(tree, 'value.ts'), 'committed\n');
      writeFileSync(join(tree, 'removed.ts'), 'removed\n');
      writeFileSync(join(tree, 'old.ts'), 'renamed\n');
      git('init', '-q');
      git('add', '.');
      git('commit', '-q', '-m', 'first');
      writeFileSync(join(tree, 'value.ts'), 'staged\n');
      git('add', 'value.ts');
      git('rm', '-q', 'removed.ts');
      git('mv', 'old.ts', 'new.ts');
      mkdirSync(join(tree, 'fresh'));
      writeFileSync(join(tree, 'fresh/new.ts'), 'untracked\n');
      mkdirSync(join(tree, 'skills/_probe-peer'), { recursive: true });
      writeFileSync(join(tree, 'skills/_probe-peer/SKILL.md'), 'skill one\n');
      writeFileSync(join(tree, '.env'), 'SECRET=1\n');
      const inputs = ['skills/_probe-peer/SKILL.md'];
      const measured = () => Effect.flatMap(Git, (service) => gitTree(service, tree, inputs));

      const first = yield* Effect.scoped(
        Effect.gen(function* () {
          const captured = yield* captureSource({ checkout: tree, kind: 'tree', inputs });
          expect(readFileSync(join(captured.root, 'value.ts'), 'utf8')).toBe('staged\n');
          expect(readFileSync(join(captured.root, 'fresh/new.ts'), 'utf8')).toBe('untracked\n');
          expect(readFileSync(join(captured.root, inputs[0] as string), 'utf8')).toBe('skill one\n');
          expect(existsSync(join(captured.root, '.env'))).toBe(false);
          expect(existsSync(join(captured.root, 'removed.ts'))).toBe(false);
          expect(existsSync(join(captured.root, 'old.ts'))).toBe(false);
          expect(readFileSync(join(captured.root, 'new.ts'), 'utf8')).toBe('renamed\n');
          return captured;
        }),
      );
      expect(first).toMatchObject({ dirty: true, inputs });
      expect((yield* measured()).fingerprint).toBe(first.tree);

      writeFileSync(join(tree, '.env'), 'SECRET=2\n');
      expect((yield* measured()).fingerprint).toBe(first.tree);
      writeFileSync(join(tree, inputs[0] as string), 'skill two\n');
      const second = yield* Effect.scoped(captureSource({ checkout: tree, kind: 'tree', inputs }));
      expect(second.tree).not.toBe(first.tree);
      expect((yield* measured()).fingerprint).toBe(second.tree);

      git('add', '-A');
      git('commit', '-q', '-m', 'second');
      writeFileSync(join(tree, 'value.ts'), 'staged only\n');
      git('add', 'value.ts');
      writeFileSync(join(tree, 'value.ts'), 'staged\n');
      const restored = yield* Effect.scoped(captureSource({ checkout: tree, kind: 'tree', inputs: [] }));
      expect(restored).toMatchObject({ dirty: false, tree: null });
      expect(yield* Effect.flatMap(Git, (service) => gitTree(service, tree))).toEqual({ changed: 0, fingerprint: null });
    }).pipe(Effect.provide(machine)),
);

it.live(
  'a captured working tree takes a file turned directory and an untracked nested repository with the revision the checkout reading measures',
  () =>
    Effect.gen(function* () {
      const tree = yield* Effect.acquireRelease(
        Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'tagma-snapshot-')))),
        (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
      );
      const git = (at: string, ...args: string[]) => {
        const ran = Bun.spawnSync(['git', '-C', at, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stderr: 'pipe' });
        expect(ran.exitCode).toBe(0);
      };
      writeFileSync(join(tree, 'part'), 'a file\n');
      git(tree, 'init', '-q');
      git(tree, 'add', '.');
      git(tree, 'commit', '-q', '-m', 'first');
      rmSync(join(tree, 'part'));
      mkdirSync(join(tree, 'part'));
      writeFileSync(join(tree, 'part/main.ts'), 'a directory\n');
      git(tree, 'add', '-A');
      const nested = join(tree, 'nested');
      mkdirSync(nested);
      writeFileSync(join(nested, '.gitignore'), 'kept.txt\n');
      writeFileSync(join(nested, 'kept.txt'), 'forced\n');
      git(nested, 'init', '-q');
      git(nested, 'add', '-f', '.gitignore', 'kept.txt');

      const captured = yield* Effect.scoped(
        Effect.gen(function* () {
          const taken = yield* captureSource({ checkout: tree, kind: 'tree', inputs: [] });
          expect(readFileSync(join(taken.root, 'part/main.ts'), 'utf8')).toBe('a directory\n');
          expect(readFileSync(join(taken.root, 'nested/kept.txt'), 'utf8')).toBe('forced\n');
          return taken;
        }),
      );
      expect(captured.dirty).toBe(true);
      expect((yield* Effect.flatMap(Git, (service) => gitTree(service, tree))).fingerprint).toBe(captured.tree);
    }).pipe(Effect.provide(machine)),
);
