import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect, FiberSet, FileSystem, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import { COMMIT_HOOKS, commitHooks, installCommitHooks, installedCli, type HookCli, uninstallCommitHooks } from './commits/hooks.js';
import { CHAINED } from './contract/wire/gateHook.js';
import { driverText } from './commits/mergeDriver.js';
import { decodeBlockFile, encodeBlockFile } from '../graph/tree/blockFile.js';
import type { CountedDebt } from './contract/wire/document.js';
import { liveGitLayer } from '../composition/testing/liveGit.js';

const CLI = join(import.meta.dir, '../composition/entries/cli.ts');
const FILE = '.tagma/demo/files-stay-small.md';

const git = (cwd: string, args: readonly string[]) => {
  const ran = Bun.spawnSync(['git', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { code: ran.exitCode, out: `${ran.stdout.toString()}${ran.stderr.toString()}` };
};

const temp = (prefix: string) => Effect.flatMap(FileSystem.FileSystem, (files) => files.makeTempDirectoryScoped({ prefix }));

const ruleFile = (debt: readonly CountedDebt[]) =>
  encodeBlockFile({
    frontmatter: {
      id: '0198c3d4-7b2a-7f00-8000-3f9ac2b41e7a',
      title: 'Files stay small',
      ord: 1,
      tags: ['rule'],
      fields: {
        enforcement: {
          strictness: 'gate',
          on: [{ op: 'submit_work', phase: 'before' }],
          inspection: 'size',
          debt,
          escaped: [],
        },
      },
    },
    body: 'A file stays under 650 lines.\n',
  });

const committed = (root: string, debt: readonly CountedDebt[], message: string) => {
  mkdirSync(dirname(join(root, FILE)), { recursive: true });
  writeFileSync(join(root, FILE), ruleFile(debt));
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message]);
};

const debtAt = (root: string) =>
  Effect.map(
    decodeBlockFile(readFileSync(join(root, FILE), 'utf8')),
    (read) => (read.frontmatter.fields?.enforcement as { debt: CountedDebt[] }).debt,
  );

const STANDING: readonly CountedDebt[] = [
  { fingerprint: 'F4 core/a.ts', owner: 'aaaaaaaa', value: 900 },
  { fingerprint: 'F4 core/b.ts', owner: 'aaaaaaaa', value: 700 },
];

const branched = Effect.fnUntraced(function* (left: readonly CountedDebt[], right: readonly CountedDebt[]) {
  const liveGit = yield* Git;
  const root = yield* temp('merge-driver-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'tagma@test']);
  git(root, ['config', 'user.name', 'tagma']);
  committed(root, STANDING, 'the rule is enforced');
  yield* installCommitHooks(liveGit, root, {
    runtime: process.execPath,
    entry: CLI,
    server: 'http://127.0.0.1:9',
    owner: '/merge-driver-test',
  });
  git(root, ['checkout', '-qb', 'right']);
  committed(root, right, 'the right branch re-measures');
  git(root, ['checkout', '-q', 'main']);
  committed(root, left, 'the left branch re-measures');
  return root;
});

const forked = Effect.fnUntraced(function* (left: readonly CountedDebt[], right: readonly CountedDebt[]) {
  const root = yield* branched(left, right);
  return { root, merged: git(root, ['merge', '-q', '--no-edit', 'right']) };
});

const hooksOver = Effect.fnUntraced(function* (cli: HookCli) {
  const liveGit = yield* Git;
  const fibers = yield* FiberSet.make<void, never>();
  const fork = yield* FiberSet.runtime(fibers)();
  return commitHooks(liveGit, cli, { opened: Effect.void, isOpen: Effect.succeed(true) }, (work) => {
    fork(work);
  });
});

layer(Layer.merge(BunFileSystem.layer, liveGitLayer), { excludeTestServices: true })('graph merge driver', (it) => {
  it.effect('a second installation preserves the owner’s merge driver and startup repairs its own driver', () =>
    Effect.gen(function* () {
      const liveGit = yield* Git;
      const root = yield* temp('merge-driver-owner-');
      git(root, ['init', '-q', '-b', 'main']);
      const owner = join(root, 'main-data');
      const other = join(root, 'try-data');
      mkdirSync(owner);
      mkdirSync(other);
      const main: HookCli = { runtime: process.execPath, entry: CLI, server: 'http://127.0.0.1:9', owner };
      const beside: HookCli = { ...main, entry: join(other, 'cli.js'), owner: other };
      const script = join(root, '.git', 'tagma', 'merge-driver');
      const attributes = join(root, '.git', 'info', 'attributes');
      yield* installCommitHooks(liveGit, root, main);
      const standing = readFileSync(script, 'utf8');
      const attributed = readFileSync(attributes, 'utf8');
      const configured = git(root, ['config', '--local', '--get', 'merge.tagma-graph.driver']).out;
      const configWritten = () => statSync(join(root, '.git', 'config'), { bigint: true }).mtimeNs;
      const unchanged = configWritten();
      yield* installCommitHooks(liveGit, root, main);
      expect(configWritten()).toBe(unchanged);

      const registered = yield* installCommitHooks(liveGit, root, beside);
      expect('hooks' in registered && registered.hooks.every((hook) => hook.write === 'foreign')).toBe(true);
      expect(readFileSync(script, 'utf8')).toBe(standing);
      yield* uninstallCommitHooks(liveGit, root, other);
      expect(readFileSync(script, 'utf8')).toBe(standing);
      expect(readFileSync(attributes, 'utf8')).toBe(attributed);
      expect(git(root, ['config', '--local', '--get', 'merge.tagma-graph.driver']).out).toBe(configured);

      writeFileSync(script, driverText(beside));
      yield* (yield* hooksOver(main)).sweep([root]);
      expect(readFileSync(script, 'utf8')).toBe(standing);

      rmSync(owner, { recursive: true });
      yield* installCommitHooks(liveGit, root, beside);
      expect(readFileSync(script, 'utf8')).toBe(driverText(beside));
      yield* uninstallCommitHooks(liveGit, root, other);
      expect(existsSync(script)).toBe(false);
      expect(git(root, ['config', '--local', '--get', 'merge.tagma-graph.driver']).code).toBe(1);

      mkdirSync(owner);
      const external = yield* temp('merge-driver-hooks-');
      for (const hooksPath of [external, join(root, 'absent-hooks')]) {
        git(root, ['config', '--local', 'core.hooksPath', hooksPath]);
        yield* installCommitHooks(liveGit, root, main);
        const owned = readFileSync(script, 'utf8');
        const configured = git(root, ['config', '--local', '--get', 'merge.tagma-graph.driver']).out;
        yield* installCommitHooks(liveGit, root, beside);
        expect(readFileSync(script, 'utf8')).toBe(owned);
        yield* uninstallCommitHooks(liveGit, root, other);
        expect(readFileSync(script, 'utf8')).toBe(owned);
        expect(git(root, ['config', '--local', '--get', 'merge.tagma-graph.driver']).out).toBe(configured);
        yield* uninstallCommitHooks(liveGit, root, owner);
        expect(existsSync(script)).toBe(false);
      }
    }),
  );

  it.effect(
    'gates a hooks manager wrote over are taken back by their owner with the rewrite chained, and never by a second installation',
    () =>
      Effect.gen(function* () {
        const liveGit = yield* Git;
        const root = yield* temp('merge-driver-rewritten-');
        git(root, ['init', '-q', '-b', 'main']);
        const owner = join(root, 'main-data');
        const other = join(root, 'try-data');
        mkdirSync(owner);
        mkdirSync(other);
        const main: HookCli = { runtime: process.execPath, entry: CLI, server: 'http://127.0.0.1:9', owner };
        const beside: HookCli = { ...main, owner: other };
        const hooks = join(root, '.git', 'hooks');
        const script = join(root, '.git', 'tagma', 'merge-driver');
        for (const hook of COMMIT_HOOKS) writeFileSync(join(hooks, hook), `#!/bin/sh\necho ${hook}\n`, { mode: 0o755 });
        yield* installCommitHooks(liveGit, root, main);
        const gates = COMMIT_HOOKS.map((hook) => readFileSync(join(hooks, hook), 'utf8'));
        const driver = readFileSync(script, 'utf8');
        const rewrites = COMMIT_HOOKS.map((hook) => `#!/bin/sh\necho ${hook} rewritten\n`);
        COMMIT_HOOKS.forEach((hook, at) => writeFileSync(join(hooks, hook), rewrites[at] ?? '', { mode: 0o755 }));

        const taken = yield* installCommitHooks(liveGit, root, beside);
        expect('hooks' in taken && taken.hooks.map((hook) => hook.write)).toEqual(COMMIT_HOOKS.map(() => 'held'));
        expect(COMMIT_HOOKS.map((hook) => readFileSync(join(hooks, hook), 'utf8'))).toEqual(rewrites);
        expect(readFileSync(script, 'utf8')).toBe(driver);

        const back = yield* installCommitHooks(liveGit, root, main);
        expect('hooks' in back && back.hooks.map((hook) => hook.write)).toEqual(COMMIT_HOOKS.map(() => 'chained'));
        expect(COMMIT_HOOKS.map((hook) => readFileSync(join(hooks, hook), 'utf8'))).toEqual(gates);
        expect(COMMIT_HOOKS.map((hook) => readFileSync(join(hooks, `${hook}${CHAINED}`), 'utf8'))).toEqual(rewrites);
      }),
  );

  it.effect('the owner’s startup installs the runtime and entry of its changed installation', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* temp('merge-driver-install-'));
      git(root, ['init', '-q', '-b', 'main']);
      const owner = join(root, 'data');
      mkdirSync(owner);
      const script = join(root, '.git', 'tagma', 'merge-driver');
      const args = ['base', 'ours', 'theirs', '7', FILE];
      for (const installation of ['first', 'next']) {
        const cli = installedCli(join(owner, installation), 'http://127.0.0.1:9', owner);
        mkdirSync(dirname(cli.entry), { recursive: true });
        symlinkSync(process.execPath, cli.runtime);
        writeFileSync(cli.entry, 'process.stdout.write(JSON.stringify({ entry: import.meta.path, args: process.argv.slice(2) }));\n');
        yield* (yield* hooksOver(cli)).sweep([root]);
        const invoked = Bun.spawnSync([script, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
        expect({ code: invoked.exitCode, stderr: invoked.stderr.toString() }).toEqual({ code: 0, stderr: '' });
        expect(JSON.parse(invoked.stdout.toString())).toEqual({ entry: cli.entry, args: ['merge-driver', ...args] });
        rmSync(cli.runtime);
      }
    }),
  );

  it.effect(
    'debt each branch only lowered or retired merges without a conflict to the lowest count, the re-measured value and the retirement',
    () =>
      Effect.gen(function* () {
        const { root, merged } = yield* forked(
          [
            { fingerprint: 'F4 core/a.ts', owner: 'aaaaaaaa', value: 880 },
            { fingerprint: 'F4 core/b.ts', owner: 'aaaaaaaa', value: 690 },
          ],
          [{ fingerprint: 'F4 core/a.ts', owner: 'aaaaaaaa', value: 860 }],
        );
        expect(merged.code).toBe(0);
        expect(yield* debtAt(root)).toEqual([{ fingerprint: 'F4 core/a.ts', owner: 'aaaaaaaa', value: 860 }]);
      }),
  );

  it.effect('the sides git handed the driver are removed when git died while the driver ran, and kept while it lives', () =>
    Effect.gen(function* () {
      const root = yield* branched([STANDING[0]!], [STANDING[0]!]);
      const script = join(root, '.git', 'tagma', 'merge-driver');
      const sides = ['.merge_file_O', '.merge_file_A', '.merge_file_B'];
      for (const side of sides) writeFileSync(join(root, side), ruleFile(STANDING));
      const live = Bun.spawnSync([script, ...sides, '7', FILE], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
      expect(live.exitCode).toBe(0);
      expect(sides.every((side) => existsSync(join(root, side)))).toBe(true);

      Bun.spawnSync(['sh', '-c', `'${script}' ${sides.join(' ')} 7 ${FILE} >/dev/null 2>&1 &`], { cwd: root });
      yield* Effect.repeat(
        Effect.andThen(
          Effect.sleep(50),
          Effect.sync(() => sides.some((side) => existsSync(join(root, side)))),
        ),
        { until: (remaining) => !remaining },
      );
      expect(sides.filter((side) => existsSync(join(root, side)))).toEqual([]);
    }),
  );

  it.effect('an owner each branch changed differently still conflicts', () =>
    Effect.gen(function* () {
      const { root, merged } = yield* forked(
        [{ fingerprint: 'F4 core/a.ts', owner: 'bbbbbbbb', value: 900 }, STANDING[1]!],
        [{ fingerprint: 'F4 core/a.ts', owner: 'cccccccc', value: 900 }, STANDING[1]!],
      );
      expect(merged.code).not.toBe(0);
      expect(readFileSync(join(root, FILE), 'utf8')).toContain('<<<<<<<');
    }),
  );
});
