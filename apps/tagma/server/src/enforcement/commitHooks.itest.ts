import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Git } from '@runlith/git/Git';
import { Effect } from 'effect';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GRANT_VARIABLE, OWN_GIT_VARIABLE } from '../platform/contract/service/credentials.js';
import { spawnedEffect } from '../platform/testing/spawn.js';
import { COMMIT_HOOKS, type HookCli, installCommitHooks, uninstallCommitHooks } from './commits/hooks.js';
import { CHAINED } from './contract/wire/gateHook.js';
import { testGit } from './programs/fixture.js';

const OWNER = '/tagma-commit-hooks-owner';
const ABSENT: HookCli = { runtime: '/tagma-absent/bun', entry: '/tagma-absent/cli.ts', server: 'http://127.0.0.1:9', owner: OWNER };

const person = Object.fromEntries(
  Object.entries({ ...process.env, [GRANT_VARIABLE]: undefined, [OWN_GIT_VARIABLE]: undefined, TAGMA_ALLOW: undefined }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);

const ran = Effect.fnUntraced(function* (cwd: string, ...args: readonly string[]) {
  const result = yield* Effect.orDie(
    spawnedEffect(['git', '-c', 'user.name=hooks', '-c', 'user.email=hooks@test', ...args], { cwd, env: person, stdin: 'ignore' }),
  );
  return { code: result.exitCode, out: result.stdout.toString().trim() };
});

const directory = Effect.acquireRelease(
  Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'commit-hooks-')))),
  (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
);

const seeded = Effect.gen(function* () {
  const root = yield* directory;
  yield* ran(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
  yield* ran(root, 'add', '-A');
  yield* ran(root, 'commit', '-qm', 'seed', '--no-verify');
  return root;
});

const committed = Effect.fnUntraced(function* (root: string) {
  writeFileSync(join(root, 'b.ts'), `export const b = ${Math.random()};\n`);
  yield* ran(root, 'add', 'b.ts');
  return (yield* ran(root, 'commit', '-qm', 'b')).code;
});

layer(testGit, { excludeTestServices: true })('commit hooks', (it) => {
  it.effect(
    'installing chains the hook that stood, installing again changes nothing, removing restores it, and a hooks path outside the repository is left alone',
    () =>
      Effect.gen(function* () {
        const git = yield* Git;
        const other = yield* seeded;
        const hooks = join(other, '.git', 'hooks');
        writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\ntouch "$(git rev-parse --git-dir)/chained-ran"\n', { mode: 0o755 });
        const standing = readFileSync(join(hooks, 'pre-commit'), 'utf8');
        expect(yield* installCommitHooks(git, other, ABSENT)).toMatchObject({
          hooks: COMMIT_HOOKS.map((hook) => ({ hook, write: hook === 'pre-commit' ? 'chained' : 'written' })),
        });
        const texts = COMMIT_HOOKS.map((hook) => readFileSync(join(hooks, hook), 'utf8'));
        expect(yield* installCommitHooks(git, other, ABSENT)).toMatchObject({
          hooks: COMMIT_HOOKS.map((hook) => ({ hook, write: 'current' })),
        });
        expect(COMMIT_HOOKS.map((hook) => readFileSync(join(hooks, hook), 'utf8'))).toEqual(texts);
        const edited = texts[COMMIT_HOOKS.indexOf('post-commit')]?.replace('fi\n', 'fi\nexit 0\n') ?? '';
        writeFileSync(join(hooks, 'post-commit'), edited);
        expect(yield* installCommitHooks(git, other, ABSENT)).toMatchObject({
          hooks: COMMIT_HOOKS.map((hook) => ({ hook, write: hook === 'post-commit' ? 'updated' : 'current' })),
        });
        expect(COMMIT_HOOKS.map((hook) => readFileSync(join(hooks, hook), 'utf8'))).toEqual(texts);

        expect(yield* committed(other)).toBe(0);
        expect(existsSync(join(other, '.git', 'chained-ran'))).toBe(true);

        const linked = join(yield* directory, 'tree');
        yield* ran(other, 'worktree', 'add', '-q', '--detach', linked);
        yield* uninstallCommitHooks(git, other, OWNER, [linked]);
        expect(COMMIT_HOOKS.map((hook) => readFileSync(join(hooks, hook), 'utf8'))).toEqual(texts);

        yield* uninstallCommitHooks(git, other, OWNER);
        expect(readFileSync(join(hooks, 'pre-commit'), 'utf8')).toBe(standing);
        expect([existsSync(join(hooks, `pre-commit${CHAINED}`)), existsSync(join(hooks, 'post-commit'))]).toEqual([false, false]);

        const outside = yield* directory;
        yield* ran(other, 'config', 'core.hooksPath', outside);
        expect(yield* installCommitHooks(git, other, ABSENT)).toEqual({ root: other, outside });
        expect(existsSync(join(outside, 'pre-commit'))).toBe(false);
      }),
  );

  it.effect(
    "a chained hook runs under the hook's own name and arguments, so a hooks manager dispatching by $0 reaches its user's script",
    () =>
      Effect.gen(function* () {
        const git = yield* Git;
        const other = yield* seeded;
        const managed = join(other, '.hooks', '_');
        mkdirSync(managed, { recursive: true });
        yield* ran(other, 'config', 'core.hooksPath', '.hooks/_');
        writeFileSync(
          join(managed, 'd'),
          '#!/usr/bin/env sh\nn=$(basename "$0")\ns=$(dirname "$(dirname "$0")")/$n\n[ -f "$s" ] || exit 0\nsh -e "$s" "$@"\n',
        );
        for (const hook of ['pre-commit', 'prepare-commit-msg']) {
          writeFileSync(join(managed, hook), '#!/usr/bin/env sh\n. "$(dirname "$0")/d"\n', { mode: 0o755 });
        }
        writeFileSync(join(other, '.hooks', 'pre-commit'), 'exit 1\n');
        writeFileSync(join(other, '.hooks', 'prepare-commit-msg'), 'printf %s "$1" > "$(git rev-parse --git-dir)/argument"\n');
        expect(yield* installCommitHooks(git, other, ABSENT)).toMatchObject({
          hooks: COMMIT_HOOKS.map((hook) => ({
            hook,
            write: hook === 'pre-commit' || hook === 'prepare-commit-msg' ? 'chained' : 'written',
          })),
        });
        const before = (yield* ran(other, 'rev-parse', 'HEAD')).out;

        expect(yield* committed(other)).not.toBe(0);
        expect((yield* ran(other, 'rev-parse', 'HEAD')).out).toBe(before);

        writeFileSync(join(other, '.hooks', 'pre-commit'), 'exit 0\n');
        expect(yield* committed(other)).toBe(0);
        expect(readFileSync(join(other, '.git', 'argument'), 'utf8')).toBe('.git/COMMIT_EDITMSG');
      }),
  );

  it.effect(
    'a sweep by another installation leaves a live installation’s hooks alone, reclaims hooks that name no owner and reclaims a vanished installation’s',
    () =>
      Effect.gen(function* () {
        const git = yield* Git;
        const other = yield* seeded;
        const hooks = join(other, '.git', 'hooks');
        const textsOf = () => COMMIT_HOOKS.map((hook) => readFileSync(join(hooks, hook), 'utf8'));
        const alive = yield* directory;
        expect(yield* installCommitHooks(git, other, { ...ABSENT, owner: alive })).toMatchObject({
          hooks: COMMIT_HOOKS.map((hook) => ({ hook, write: 'written' })),
        });
        const theirs = textsOf();

        expect(yield* installCommitHooks(git, other, ABSENT)).toMatchObject({
          hooks: COMMIT_HOOKS.map((hook) => ({ hook, write: 'foreign' })),
        });
        yield* uninstallCommitHooks(git, other, OWNER);
        expect(textsOf()).toEqual(theirs);

        const unowned = '#!/bin/sh\n# tagma commit gate\nexit 0\n';
        for (const hook of COMMIT_HOOKS) writeFileSync(join(hooks, hook), unowned, { mode: 0o755 });
        expect(yield* installCommitHooks(git, other, ABSENT)).toMatchObject({
          hooks: COMMIT_HOOKS.map((hook) => ({ hook, write: 'updated' })),
        });

        for (const hook of COMMIT_HOOKS)
          writeFileSync(join(hooks, hook), theirs[COMMIT_HOOKS.indexOf(hook)]?.replace(alive, `${alive}-gone`) ?? '', { mode: 0o755 });
        expect(yield* installCommitHooks(git, other, ABSENT)).toMatchObject({
          hooks: COMMIT_HOOKS.map((hook) => ({ hook, write: 'updated' })),
        });
        expect(yield* installCommitHooks(git, other, ABSENT)).toMatchObject({
          hooks: COMMIT_HOOKS.map((hook) => ({ hook, write: 'current' })),
        });
      }),
  );
});
