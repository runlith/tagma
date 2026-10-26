import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Git } from '@runlith/git/Git';
import { Context, Effect, Result } from 'effect';
import type { Maintenance } from '../../platform/contract/service/maintenance.js';
import { GRANT_VARIABLE } from '../../platform/contract/service/credentials.js';
import { CLI_ENTRY, CURRENT, RUNTIME_PART } from '../../installation/contract/wire/layout.js';
import { CHAINED, chaining, gateStanding, type GateStanding, MARK, OWN_EXIT, OWNER_LINE } from '../contract/wire/gateHook.js';
import { driverStanding, registerMergeDriver, unregisterMergeDriver } from './mergeDriver.js';

export const NO_COMMIT_HOOKS: CommitHooks['Service'] = {
  install: () => Effect.void,
  sweep: () => Effect.void,
  uninstall: () => Effect.void,
};

export const COMMIT_HOOKS = ['pre-commit', 'pre-merge-commit', 'prepare-commit-msg', 'post-commit', 'post-merge'] as const;
export type CommitHook = (typeof COMMIT_HOOKS)[number];

export type HookWrite = 'written' | 'chained' | 'updated' | 'current' | 'held' | 'foreign';

export type HooksInstalled =
  | { readonly root: string; readonly at: string; readonly hooks: readonly { readonly hook: CommitHook; readonly write: HookWrite }[] }
  | { readonly root: string; readonly outside: string }
  | { readonly root: string; readonly unread: string };

export type HookCli = { readonly runtime: string; readonly entry: string; readonly server: string; readonly owner: string };

export const installedCli = (installations: string, server: string, owner: string): HookCli => ({
  runtime: `${installations}/${CURRENT}/${RUNTIME_PART}`,
  entry: `${installations}/${CURRENT}/${CLI_ENTRY}`,
  server,
  owner,
});

const quoted = (value: string): string => `'${value.split("'").join(`'\\''`)}'`;

const bodies = (cli: HookCli): Readonly<Record<CommitHook, string>> => {
  const tagma = `runtime=${quoted(cli.runtime)}\nentry=${quoted(cli.entry)}`;
  const standing = '[ -x "$runtime" ] && [ -f "$entry" ]';
  const check = (args: string): string => `TAGMA_SERVER_URL=${quoted(cli.server)} "$runtime" "$entry" check${args}`;
  const person = (hook: CommitHook) =>
    [
      chaining(hook, ' || exit $?'),
      OWN_EXIT,
      `[ -n "$${GRANT_VARIABLE}" ] && exit 0`,
      tagma,
      `${standing} || { echo "tagma: no Tagma stands at $entry, so nothing judged this commit" >&2; exit 0; }`,
      `[ "$(${check(' --gate')})" != refused ]`,
    ].join('\n');
  const landed = (hook: CommitHook, merged: boolean) =>
    [
      chaining(hook, ''),
      OWN_EXIT,
      ...(merged ? ['git rev-parse -q --verify HEAD^2 >/dev/null || exit 0'] : []),
      tagma,
      `${standing} || exit 0`,
      check(' --landed "$(git rev-parse HEAD)"'),
      'exit 0',
    ].join('\n');
  return {
    'pre-commit': person('pre-commit'),
    'pre-merge-commit': person('pre-merge-commit'),
    'prepare-commit-msg': [
      chaining('prepare-commit-msg', ' || exit $?'),
      OWN_EXIT,
      `[ -z "$${GRANT_VARIABLE}" ] && exit 0`,
      tagma,
      `${standing} || { echo "tagma: no Tagma stands at $entry, and an agent's commit is judged or refused" >&2; exit 1; }`,
      `[ "$(${check(' --gate')})" = clean ]`,
    ].join('\n'),
    'post-commit': landed('post-commit', false),
    'post-merge': landed('post-merge', true),
  };
};

export const hookText = (hook: CommitHook, cli: HookCli): string => `#!/bin/sh\n${MARK}\n${OWNER_LINE}${cli.owner}\n${bodies(cli)[hook]}\n`;

const inside = (path: string, dir: string): boolean => {
  const at = relative(dir, path);
  return at !== '..' && !at.startsWith(`..${sep}`) && !isAbsolute(at);
};

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const asked = (git: Git['Service'], root: string, args: readonly string[]) =>
  Effect.flatMap(git.run(['-C', root, ...args]), (answer) =>
    answer.status === 0
      ? Effect.succeed(answer.stdout.trim())
      : Effect.fail(new Error(answer.stderr.trim() || `git ${args.join(' ')} ended ${answer.status}`)),
  );

type Placed = { readonly top: string; readonly hooks: string; readonly common: string };

const placedAt = Effect.fnUntraced(function* (git: Git['Service'], root: string) {
  const [top = '', common = '', hooks = ''] = (yield* asked(git, root, [
    'rev-parse',
    '--show-toplevel',
    '--git-common-dir',
    '--git-path',
    'hooks',
  ])).split('\n');
  return { top: real(top), common: real(resolve(root, common)), hooks: real(resolve(root, hooks)) } satisfies Placed;
});

const tracked = (git: Git['Service'], top: string, path: string) =>
  Effect.map(git.run(['-C', top, 'ls-files', '--error-unmatch', '--', relative(top, path)]), (answer) => answer.status === 0);

const written = (path: string, text: string) => {
  writeFileSync(path, text, { mode: 0o755 });
  chmodSync(path, 0o755);
};

const placing = (path: string, text: string, owner: string, reclaim: boolean): HookWrite => {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) {
    written(path, text);
    return 'written';
  }
  if (!stat.isFile()) return 'held';
  const stood = readFileSync(path, 'utf8');
  const standing = gateStanding(stood, owner, existsSync);
  if (standing === 'foreign') return 'foreign';
  if (standing !== 'not-ours') {
    if (stood === text) return 'current';
    written(path, text);
    return 'updated';
  }
  if (!reclaim && existsSync(`${path}${CHAINED}`)) return 'held';
  renameSync(path, `${path}${CHAINED}`);
  written(path, text);
  return 'chained';
};

const installOne = Effect.fnUntraced(function* (git: Git['Service'], place: Placed, hook: CommitHook, cli: HookCli, reclaim: boolean) {
  const path = join(place.hooks, hook);
  if (!inside(place.hooks, place.common) && (yield* tracked(git, place.top, path))) return 'held' as const;
  return yield* Effect.try(() => placing(path, hookText(hook, cli), cli.owner, reclaim));
});

export const installCommitHooks = (git: Git['Service'], root: string, cli: HookCli): Effect.Effect<HooksInstalled> =>
  Effect.map(
    Effect.result(
      Effect.gen(function* () {
        const place = yield* placedAt(git, root);
        const driver = (standing?: GateStanding) => registerMergeDriver(git, root, place.common, cli, standing);
        const kept = inside(place.hooks, place.common);
        if (!kept && !inside(place.hooks, place.top)) return yield* Effect.as(driver(), { root, outside: place.hooks });
        if (!existsSync(place.hooks)) {
          if (!kept)
            return yield* Effect.as(driver(), {
              root,
              unread: `core.hooksPath names ${place.hooks}, which does not exist, and the working tree is not Tagma's to add it to`,
            });
          yield* Effect.try(() => mkdirSync(place.hooks, { recursive: true }));
        }
        const reclaim = (yield* Effect.try(() => driverStanding(place.common, cli.owner))) !== 'foreign';
        const hooks = yield* Effect.forEach(COMMIT_HOOKS, (hook) =>
          Effect.map(installOne(git, place, hook, cli, reclaim), (write) => ({ hook, write })),
        );
        if (hooks.every((hook) => hook.write !== 'foreign')) {
          const owned = hooks.some((hook) => hook.write !== 'held');
          yield* driver(owned ? 'mine' : undefined);
        }
        return { root, at: place.hooks, hooks };
      }),
    ),
    (answer): HooksInstalled =>
      Result.isSuccess(answer)
        ? answer.success
        : { root, unread: answer.failure instanceof Error ? answer.failure.message : String(answer.failure) },
  );

export const uninstallCommitHooks = Effect.fnUntraced(
  function* (git: Git['Service'], root: string, owner: string, others: readonly string[] = []) {
    const place = yield* placedAt(git, root);
    for (const other of others) {
      const shared = yield* Effect.result(placedAt(git, other));
      if (Result.isFailure(shared)) {
        yield* Effect.logWarning('a checkout sharing commit hooks could not be read', { root: other, cause: String(shared.failure) });
        continue;
      }
      if (shared.success.hooks === place.hooks) return;
    }
    const removed = yield* Effect.try(() => {
      let hasForeign = false;
      let hadOwned = false;
      for (const hook of COMMIT_HOOKS) {
        const path = join(place.hooks, hook);
        const stat = lstatSync(path, { throwIfNoEntry: false });
        if (stat === undefined || !stat.isFile()) continue;
        const standing = gateStanding(readFileSync(path, 'utf8'), owner, existsSync);
        if (standing === 'foreign') {
          hasForeign = true;
          continue;
        }
        if (standing === 'not-ours') continue;
        hadOwned = true;
        rmSync(path, { force: true });
        if (existsSync(`${path}${CHAINED}`)) renameSync(`${path}${CHAINED}`, path);
      }
      return { foreign: hasForeign, owned: hadOwned };
    });
    if (!removed.foreign) yield* unregisterMergeDriver(git, root, place.common, owner, removed.owned ? 'mine' : undefined);
  },
  (effect, _git, root) =>
    Effect.catch(effect, (failure) =>
      Effect.logWarning('the commit gate could not be taken out of a checkout', { root, cause: String(failure) }),
    ),
);

export class CommitHooks extends Context.Service<
  CommitHooks,
  {
    install(root: string): Effect.Effect<void>;
    sweep(roots: readonly string[]): Effect.Effect<void>;
    uninstall(root: string, others: readonly string[]): Effect.Effect<void>;
  }
>()('tagma/enforcement/CommitHooks') {}

const told = (installed: HooksInstalled): Effect.Effect<void> => {
  if ('outside' in installed) {
    return Effect.logWarning('core.hooksPath points outside this repository, so Tagma did not install its commit gate there', installed);
  }
  if ('unread' in installed) return Effect.logWarning('the commit gate could not be installed', installed);
  const moved = installed.hooks.filter((one) => one.write !== 'current');
  return moved.length === 0
    ? Effect.void
    : Effect.logInfo('the commit gate stands in this checkout', { root: installed.root, at: installed.at, hooks: moved });
};

export class CommitGateCli extends Context.Service<CommitGateCli, HookCli>()('tagma/enforcement/CommitGateCli') {}

export const commitHooks = (
  git: Git['Service'],
  cli: HookCli,
  maintenance: Maintenance['Service'],
  fork: (effect: Effect.Effect<void>) => void,
): CommitHooks['Service'] => {
  const placed = (root: string) => Effect.flatMap(installCommitHooks(git, root, cli), told);
  return {
    install: (root) =>
      Effect.flatMap(maintenance.isOpen, (open) =>
        open ? placed(root) : Effect.sync(() => fork(maintenance.opened.pipe(Effect.andThen(placed(root))))),
      ),
    sweep: (roots) => maintenance.opened.pipe(Effect.andThen(Effect.forEach(roots, placed, { discard: true }))),
    uninstall: (root, others) => uninstallCommitHooks(git, root, cli.owner, others),
  };
};
