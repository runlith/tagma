import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Effect, Fiber, FileSystem, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { join } from 'node:path';
import { makeDoorWorld } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';

it.live('storage moves commit checkout additions and removals only under the automatic graph policy', () =>
  Effect.gen(function* () {
    const clock = yield* TestClock.make();
    const idle = TestClock.adjust('10 minutes').pipe(Effect.provideService(Clock.Clock, clock));
    const world = yield* makeDoorWorld({ own: 'the graph committer captures a controlled clock' }).pipe(
      Effect.provideService(Clock.Clock, clock),
    );
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.realPath(yield* world.directory('storage-commit'));
    yield* suiteGit(root, 'init', '-q', '-b', 'main');
    yield* files.writeFileString(join(root, 'code.ts'), 'export const value = 1;\n');
    yield* suiteGit(root, 'add', 'code.ts');
    yield* suiteGit(root, 'commit', '-q', '-m', 'feat(core): seed the code');
    const project = yield* world.stealthProject(root);
    const roots = yield* world.op('list_root_blocks', { project });
    const parentId = (roots.body as { blocks: { name: string }[] }).blocks[0]!.name;
    expect(yield* world.op('create_block', { project, parentId, title: 'Carried knowledge', body: 'the existing tree' })).toMatchObject({
      status: 200,
    });
    const before = yield* suiteGit(root, 'rev-parse', 'HEAD');
    yield* files.writeFileString(join(root, 'peer.ts'), 'export const peer = 1;\n');
    yield* suiteGit(root, 'add', 'peer.ts');
    const nextCommit = Effect.fnUntraced(function* () {
      const head = yield* suiteGit(root, 'rev-parse', 'HEAD');
      return yield* Effect.forkScoped(
        Stream.runHead(
          files
            .watch(join(root, '.git', 'refs', 'heads'))
            .pipe(Stream.filterEffect(() => Effect.map(suiteGit(root, 'rev-parse', 'HEAD'), (standing) => standing !== head))),
        ),
      );
    });
    const settled = yield* nextCommit();
    expect(yield* world.op('set_project_storage', { ref: String(project), mode: 'team' })).toMatchObject({ status: 200 });
    yield* idle;
    yield* Fiber.join(settled);
    const tracked = (yield* suiteGit(root, 'ls-tree', '-r', '--name-only', 'HEAD', '--', '.tagma')).split('\n').filter(Boolean);
    const standing = (yield* suiteGit(root, 'ls-files', '--cached', '--others', '--exclude-standard', '--', '.tagma'))
      .split('\n')
      .filter(Boolean);
    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked).toEqual(standing);
    expect(yield* suiteGit(root, 'rev-parse', 'HEAD^')).toBe(before);
    expect(yield* suiteGit(root, 'diff', '--cached', '--name-only', '--', 'peer.ts')).toBe('peer.ts');
    for (const value of ['manual', 'off']) {
      expect(yield* world.op('write_setting', { project, key: 'graph.commit', value })).toMatchObject({ status: 200 });
      const head = yield* suiteGit(root, 'rev-parse', 'HEAD');
      expect(yield* world.op('set_project_storage', { ref: String(project), mode: 'stealth' })).toMatchObject({ status: 200 });
      yield* idle;
      expect(yield* suiteGit(root, 'rev-parse', 'HEAD')).toBe(head);
      expect(yield* suiteGit(root, 'diff', '--name-only', '--', '.tagma')).not.toBe('');
      expect(yield* world.op('set_project_storage', { ref: String(project), mode: 'team' })).toMatchObject({ status: 200 });
      yield* idle;
      expect(yield* suiteGit(root, 'rev-parse', 'HEAD')).toBe(head);
      expect(yield* suiteGit(root, 'diff', '--cached', '--name-only', '--', 'peer.ts')).toBe('peer.ts');
    }
    expect(yield* world.op('write_setting', { project, key: 'graph.commit', value: 'auto' })).toMatchObject({ status: 200 });
    const removed = yield* nextCommit();
    expect(yield* world.op('set_project_storage', { ref: String(project), mode: 'stealth' })).toMatchObject({ status: 200 });
    const hidden = yield* world.runtime.pool.hold({ projectId: project });
    const operation = yield* suiteGit(hidden.layout.treeRoot, 'rev-parse', '--git-path', 'MERGE_HEAD');
    yield* Effect.acquireRelease(files.writeFileString(operation, yield* suiteGit(hidden.layout.treeRoot, 'rev-parse', 'HEAD')), () =>
      Effect.orDie(files.remove(operation, { force: true })),
    );
    const privateTitle = 'Private knowledge after the move';
    expect(yield* world.op('create_block', { project, parentId, title: privateTitle })).toMatchObject({ status: 200 });
    yield* idle;
    yield* Fiber.join(removed);
    expect(yield* suiteGit(root, 'ls-tree', '-r', '--name-only', 'HEAD', '--', '.tagma')).toBe('');
    expect(yield* suiteGit(root, 'diff', '--cached', '--name-only', '--', 'peer.ts')).toBe('peer.ts');
    expect(yield* suiteGit(root, 'log', '-1', '--format=%B')).not.toContain(privateTitle);
    yield* files.remove(operation);
    yield* world.runtime.pool.releaseProject(project);
    expect(yield* suiteGit(hidden.layout.treeRoot, 'log', '-1', '--format=%B')).toContain(privateTitle);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
