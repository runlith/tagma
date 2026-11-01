import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { spawnedEffect } from '../../platform/testing/spawn.js';

const producer = `
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const shared = process.env.SOURCE_CHECKOUT;
const install = process.env.TAGMA_INSTALL_ROOT;
const original = readFileSync(join(shared, 'value.ts'), 'utf8');
writeFileSync(join(shared, 'value.ts'), 'console.log("transient peer code");\\n');
try {
  if (process.env.MOVE_HEAD === '1') {
    writeFileSync(join(shared, 'peer-commit.txt'), 'a commit during the build\\n');
    for (const args of [['add', 'peer-commit.txt'], ['commit', '-q', '--only', '-m', 'peer commit', '--', 'peer-commit.txt']]) {
      const child = Bun.spawn(['git', '-C', shared, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
      if (await child.exited !== 0) throw new Error('the peer commit failed');
    }
  }
  const root = join(install, 'v1');
  mkdirSync(root, { recursive: true });
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'value.ts')], outdir: root, target: 'bun' });
  if (!built.success) throw new Error(String(built.logs));
  const ignored = join(import.meta.dir, 'skills/_probe-peer/SKILL.md');
  writeFileSync(join(root, 'skills.txt'), existsSync(ignored) ? readFileSync(ignored, 'utf8') : '');
  const child = Bun.spawn(['git', '-C', import.meta.dir, 'rev-parse', 'HEAD'], { stdout: 'pipe' });
  const head = (await new Response(child.stdout).text()).trim();
  if (await child.exited !== 0) throw new Error('the built HEAD could not be read');
  writeFileSync(join(root, 'source.json'), JSON.stringify({ head, root: import.meta.dir }));
  symlinkSync('v1', join(install, 'current'));
} finally {
  writeFileSync(join(shared, 'value.ts'), original);
}
`;

it.live(
  'the build entry installs one committed generation, leaving staged, untracked and ignored peer inputs outside it even when HEAD moves during production',
  () =>
    Effect.gen(function* () {
      const tree = yield* Effect.acquireRelease(
        Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'tagma-source-')))),
        (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
      );
      const checkout = join(tree, 'checkout');
      mkdirSync(checkout);
      const git = Effect.fnUntraced(function* (...args: string[]) {
        const ran = yield* spawnedEffect(['git', '-C', checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
        expect(ran.exitCode).toBe(0);
        return new TextDecoder().decode(ran.stdout).trim();
      });
      writeFileSync(join(checkout, 'package.json'), JSON.stringify({ scripts: { 'tagma:build': 'bun build.ts' } }));
      writeFileSync(join(checkout, 'build.ts'), 'await import("./producer.ts");\n');
      writeFileSync(join(checkout, 'build.command'), `${JSON.stringify(process.execPath)} producer.ts`);
      writeFileSync(join(checkout, 'producer.ts'), producer);
      writeFileSync(join(checkout, 'value.ts'), 'console.log("committed code");\n');
      writeFileSync(join(checkout, '.gitignore'), 'skills/_probe-*\n');
      yield* git('init', '-q');
      yield* git('add', '.');
      yield* git('commit', '-q', '-m', 'committed source');
      const head = yield* git('rev-parse', 'HEAD');
      writeFileSync(
        join(checkout, 'build.ts'),
        `import { runSourceBuild } from ${JSON.stringify(join(import.meta.dir, '../testing/sourceBuild.ts'))};\nawait runSourceBuild(import.meta.dir, process.argv.slice(2));\n`,
      );
      const working = 'console.log("uncommitted peer code");\n';
      writeFileSync(join(checkout, 'value.ts'), working);
      yield* git('add', 'value.ts');
      writeFileSync(join(checkout, 'new.ts'), 'untracked peer input\n');
      mkdirSync(join(checkout, 'skills/_probe-peer'), { recursive: true });
      writeFileSync(join(checkout, 'skills/_probe-peer/SKILL.md'), 'ignored peer skill\n');
      mkdirSync(join(checkout, '.tagma'));
      writeFileSync(join(checkout, '.tagma/graph'), 'uncommitted graph storage\n');
      const runBuild = (name: string, args: readonly string[], more: Record<string, string> = {}) =>
        spawnedEffect([process.execPath, 'run', 'tagma:build', '--no-restart', ...args], {
          cwd: checkout,
          env: { ...process.env, TAGMA_INSTALL_ROOT: join(tree, name), SOURCE_CHECKOUT: checkout, ...more },
        });
      const deliberate = yield* runBuild('tree', ['--tree']);
      expect(deliberate.exitCode).toBe(0);
      const treeProgram = yield* spawnedEffect([process.execPath, join(tree, 'tree/current/value.js')]);
      expect(new TextDecoder().decode(treeProgram.stdout).trim()).toBe('transient peer code');
      expect(readFileSync(join(tree, 'tree/current/skills.txt'), 'utf8')).toBe('ignored peer skill\n');

      writeFileSync(join(checkout, 'producer.ts'), 'throw new Error("unfinished working composition");\n');
      const built = yield* runBuild('head', [], { MOVE_HEAD: '1' });
      expect(built.exitCode).toBe(0);
      const program = yield* spawnedEffect([process.execPath, join(tree, 'head/current/value.js')]);
      expect(new TextDecoder().decode(program.stdout).trim()).toBe('committed code');
      expect(readFileSync(join(tree, 'head/current/skills.txt'), 'utf8')).toBe('');
      const selected = JSON.parse(readFileSync(join(tree, 'head/current/source.json'), 'utf8')) as { head: string; root: string };
      expect(selected.head).toBe(head);
      expect(yield* git('rev-parse', 'HEAD')).not.toBe(head);
      expect(readFileSync(join(checkout, 'value.ts'), 'utf8')).toBe(working);
      expect(existsSync(selected.root)).toBe(false);
      expect((yield* git('worktree', 'list', '--porcelain')).split('\n').filter((line) => line.startsWith('worktree '))).toHaveLength(1);
      const diagnostics = new TextDecoder().decode(built.stderr);
      expect(diagnostics).toContain('left out value.ts');
      expect(diagnostics).toContain('left out new.ts');
      expect(diagnostics).toContain('left out producer.ts');
    }),
);

it.live('a HEAD build carries each submodule at the commit its parent pins, taken from the checkout’s own submodule repository', () =>
  Effect.gen(function* () {
    const tree = yield* Effect.acquireRelease(
      Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'tagma-source-')))),
      (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
    );
    const git = Effect.fnUntraced(function* (at: string, ...args: string[]) {
      const ran = yield* spawnedEffect([
        'git',
        '-C',
        at,
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@t',
        '-c',
        'protocol.file.allow=always',
        ...args,
      ]);
      expect(ran.exitCode).toBe(0);
      return new TextDecoder().decode(ran.stdout).trim();
    });
    const library = join(tree, 'library');
    mkdirSync(library);
    writeFileSync(join(library, 'value.txt'), 'pinned\n');
    yield* git(library, 'init', '-q');
    yield* git(library, 'add', '.');
    yield* git(library, 'commit', '-q', '-m', 'pinned');
    const checkout = join(tree, 'checkout');
    mkdirSync(checkout);
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ scripts: { 'tagma:build': 'bun build.ts' } }));
    writeFileSync(
      join(checkout, 'build.ts'),
      `import { runSourceBuild } from ${JSON.stringify(join(import.meta.dir, '../testing/sourceBuild.ts'))};\nawait runSourceBuild(import.meta.dir, process.argv.slice(2));\n`,
    );
    writeFileSync(join(checkout, 'build.command'), `${JSON.stringify(process.execPath)} producer.ts`);
    writeFileSync(
      join(checkout, 'producer.ts'),
      `import { copyFileSync, mkdirSync } from 'node:fs';\nimport { join } from 'node:path';\nmkdirSync(process.env.TAGMA_INSTALL_ROOT, { recursive: true });\ncopyFileSync(join(import.meta.dir, 'lib/value.txt'), join(process.env.TAGMA_INSTALL_ROOT, 'value.txt'));\n`,
    );
    yield* git(checkout, 'init', '-q');
    yield* git(checkout, 'submodule', 'add', '-q', library, 'lib');
    yield* git(checkout, 'config', '--file', '.gitmodules', 'submodule.lib.url', join(tree, 'gone'));
    yield* git(checkout, 'add', '.');
    yield* git(checkout, 'commit', '-q', '-m', 'parent pins the library');
    const submodule = join(checkout, 'lib');
    writeFileSync(join(submodule, 'value.txt'), 'moved past the pin\n');
    yield* git(submodule, 'commit', '-q', '-am', 'moved past the pin');
    const built = yield* spawnedEffect([process.execPath, 'run', 'tagma:build', '--no-restart'], {
      cwd: checkout,
      env: { ...process.env, TAGMA_INSTALL_ROOT: join(tree, 'head') },
    });
    expect(built.exitCode).toBe(0);
    expect(readFileSync(join(tree, 'head/value.txt'), 'utf8')).toBe('pinned\n');
    for (const repository of [checkout, submodule])
      expect(
        (yield* git(repository, 'worktree', 'list', '--porcelain')).split('\n').filter((line) => line.startsWith('worktree ')),
      ).toHaveLength(1);
  }),
);
