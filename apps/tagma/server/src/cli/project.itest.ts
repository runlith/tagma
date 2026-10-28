import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { TerminalFixture, terminalFixture } from '../composition/testing/fixture.js';
import { spawnedEffect } from '../platform/testing/spawn.js';

const op = Effect.fnUntraced(function* (cwd: string, id: string, input: unknown, project?: string) {
  const world = yield* TerminalFixture;
  return yield* world.tagma(['op', id, '--json', ...(project === undefined ? [] : ['--project', project]), JSON.stringify(input)], { cwd });
});

layer(terminalFixture, { excludeTestServices: true })('project selection', (it) => {
  it.effect('an explicit project preserves its current worktree and still selects another project', () =>
    Effect.gen(function* () {
      const world = yield* TerminalFixture;
      const root = yield* world.directory('branching');
      const branch = yield* world.directory('branch');
      for (const args of [
        ['init', '-b', 'main'],
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.com',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '--allow-empty',
          '-m',
          'born',
        ],
        ['worktree', 'add', '-b', 'feature', branch],
      ]) {
        const result = yield* spawnedEffect(['git', ...args], { cwd: root });
        expect(result.exitCode, result.stderr.toString()).toBe(0);
      }
      const registered = yield* op(root, 'add_project', { name: 'branching', rootPath: root, storage: 'stealth' });
      expect(registered.code, registered.out).toBe(0);
      const projectId = (JSON.parse(registered.out) as { project: { id: number } }).project.id;
      const names: string[] = [];
      for (const project of ['branching', String(projectId)]) {
        const roots = yield* op(branch, 'list_root_blocks', {}, project);
        const parentId = (JSON.parse(roots.out) as { blocks: { name: string }[] }).blocks[0]!.name;
        const born = yield* op(branch, 'create_block', { title: 'branch-local', tags: ['idea'], parentId }, project);
        expect(born.code, born.out).toBe(0);
        names.push((JSON.parse(born.out) as { block: { name: string } }).block.name);
      }
      const local = yield* op(branch, 'search_blocks', { query: 'branch-local' });
      expect(local.code, local.out).toBe(0);
      expect((JSON.parse(local.out) as { blocks: { name: string }[] }).blocks.map((block) => block.name).sort()).toEqual(names.sort());
      const main = yield* op(root, 'search_blocks', { query: 'branch-local' }, 'branching');
      expect(main.code, main.out).toBe(0);
      expect(JSON.parse(main.out)).toMatchObject({ blocks: [] });
      const other = yield* world.checkout();
      const otherRoots = yield* op(branch, 'list_root_blocks', {}, other.name);
      const otherRoot = (JSON.parse(otherRoots.out) as { blocks: { name: string }[] }).blocks[0]!.name;
      const foreign = yield* op(branch, 'create_block', { title: 'explicit-destination', tags: ['idea'], parentId: otherRoot }, other.name);
      expect(foreign.code, foreign.out).toBe(0);
      const named = yield* op(other.root, 'search_blocks', { query: 'explicit-destination' });
      expect(named.code, named.out).toBe(0);
      expect(JSON.parse(named.out)).toMatchObject({ blocks: [{ name: JSON.parse(foreign.out).block.name }] });
    }),
  );
});
