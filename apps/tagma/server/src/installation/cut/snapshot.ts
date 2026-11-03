import { lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Console, Data, Effect, FileSystem, type Scope } from 'effect';
import { Git } from '@runlith/git/Git';
import { commitOf, type GitAnswerInvalid, type GitRefused, type GitUnreadable, run, troubleOf } from '@runlith/git/repository';
import { cloneTree } from '../../platform/durable/clone.js';
import { measureSource, sourceInventory, type SourceInventory } from '../../platform/git/readings.js';

const UNCHANGED: SourceInventory = { entries: new Map(), modules: new Map() };
import type { CapturedSource } from '../contract/wire/capture.js';

export class SourceRefused extends Data.TaggedError('SourceRefused')<{
  readonly message: string;
  readonly unblock: readonly string[];
  readonly exited?: number;
}> {}

type SourceCapture = {
  readonly checkout: string;
  readonly kind: 'head' | 'tree';
  readonly inputs: readonly string[];
  readonly at?: string;
};

type SourceSnapshot = CapturedSource & { readonly root: string };

export const SUBMODULE_PATHS = ['config', '-z', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'] as const;

export const declaredSubmodules = (output: string): readonly string[] =>
  output.split('\0').flatMap((entry) => {
    const value = entry.slice(entry.indexOf('\n') + 1);
    return entry.includes('\n') && value !== '' ? [value] : [];
  });

export const captureSource = Effect.fn('installation.captureSource')(function* (input: SourceCapture) {
  const git = yield* Git;
  const files = yield* FileSystem.FileSystem;
  const failed = (message: string) => new SourceRefused({ message, unblock: ['restore the named source input, then build again'] });
  const command = (cwd: string, args: readonly string[]) =>
    run(git, cwd, args, undefined).pipe(Effect.mapError((failure) => failed(troubleOf(failure))));
  const disk = <A, R>(work: Effect.Effect<A, { readonly message: string }, R>) =>
    work.pipe(Effect.mapError((failure) => failed(failure.message)));
  const checkout = yield* disk(files.realPath(input.checkout));
  const head = yield* commitOf(git, checkout, 'HEAD').pipe(Effect.mapError((failure) => failed(troubleOf(failure))));
  if (input.kind === 'head' && head === null) return yield* failed(`${checkout} has no committed HEAD to build`);
  const root = input.at ?? join(yield* disk(files.makeTempDirectoryScoped({ prefix: 'tagma-source-' })), 'source');
  yield* disk(files.makeDirectory(dirname(root), { recursive: true }));

  const named = (path: string): string => relative(checkout, resolve(checkout, path));
  const inputs = input.inputs.map(named);
  if (inputs.some((path) => path === '' || path === '..' || path.startsWith('../'))) {
    return yield* failed('a declared source input is outside the checkout');
  }

  const linked = Effect.fn('installation.linkSource')(function* (from: string, to: string, link: string) {
    const target = resolve(dirname(from), link);
    const within = relative(checkout, target);
    if (isAbsolute(link) || within === '..' || within.startsWith('../'))
      return yield* failed(`${from} must link by a relative path inside the captured checkout`);
    yield* disk(files.makeDirectory(dirname(to), { recursive: true }));
    yield* disk(files.remove(to, { recursive: true, force: true }));
    yield* disk(files.symlink(link, to));
  });

  const copied = Effect.fn('installation.copySource')(function* (from: string, to: string) {
    const link = yield* Effect.result(files.readLink(from));
    if (link._tag === 'Success') return yield* linked(from, to, link.success);
    yield* disk(files.makeDirectory(dirname(to), { recursive: true }));
    yield* disk(files.remove(to, { recursive: true, force: true }));
    const info = yield* disk(files.stat(from));
    if (info.type !== 'File') return yield* failed(`${from} is not a regular source file`);
    const physical = relative(checkout, yield* disk(files.realPath(from)));
    if (physical === '..' || physical.startsWith('../')) return yield* failed(`${from} resolves outside the captured checkout`);
    yield* cloneTree(from, to, { times: true }).pipe(Effect.mapError((failure) => failed(failure.message)));
  });

  const repositories = Effect.fn('installation.sourceSubmodules')(function* (from: string) {
    const staged = yield* command(from, ['ls-files', '-z', '--stage']);
    return staged.split('\0').flatMap((entry) => {
      const linked = /^160000 ([0-9a-f]+) 0\t(.+)$/su.exec(entry);
      return linked?.[1] === undefined || linked[2] === undefined ? [] : [{ pinned: linked[1], path: linked[2] }];
    });
  });

  const materialized: (
    from: string,
    to: string,
    commit: string | null,
    inventory: SourceInventory | null,
  ) => Effect.Effect<void, SourceRefused, Scope.Scope> = Effect.fn('installation.headWorktree')(function* (
    from: string,
    to: string,
    commit: string | null,
    inventory: SourceInventory | null,
  ) {
    if (commit === null) {
      yield* disk(files.makeDirectory(to));
      yield* command(to, ['init', '-q']);
    } else {
      yield* Effect.acquireRelease(command(from, ['worktree', 'add', '--detach', '--end-of-options', to, commit]), () =>
        Effect.matchEffect(command(from, ['worktree', 'remove', '--force', '--force', to]), {
          onSuccess: () => Effect.void,
          onFailure: (failure) => Console.error(`[tagma] source cleanup failed: ${failure.message}; remove the worktree ${to}`),
        }),
      );
    }
    if (input.kind === 'head') {
      const staged = yield* command(to, ['ls-files', '-z', '--stage']);
      for (const entry of staged.split('\0')) {
        const link = /^120000 [0-9a-f]+ 0\t(.+)$/su.exec(entry)?.[1];
        if (link !== undefined) yield* linked(join(from, link), join(to, link), yield* disk(files.readLink(join(to, link))));
      }
    }
    const modules = yield* repositories(input.kind === 'head' ? to : from);
    const submodules = new Set(modules.map((one) => one.path));
    if (inventory !== null) {
      const standing: string[] = [];
      for (const path of inventory.entries.keys()) {
        if (submodules.has(path)) continue;
        const leaf = yield* Effect.promise(() =>
          lstat(join(from, path)).then(
            (info) => info.isFile() || info.isSymbolicLink(),
            () => false,
          ),
        );
        if (leaf) standing.push(path);
        else yield* disk(files.remove(join(to, path), { recursive: true, force: true }));
      }
      for (const path of standing) yield* copied(join(from, path), join(to, path));
    }
    for (const { path, pinned } of modules) {
      const source = join(from, path);
      const top = (yield* command(source, ['rev-parse', '--show-toplevel'])).trim();
      if (top !== (yield* disk(files.realPath(source)))) return yield* failed(`${source} is not the checkout of its submodule`);
      const chosen =
        input.kind === 'head'
          ? pinned
          : yield* commitOf(git, source, 'HEAD').pipe(Effect.mapError((failure) => failed(troubleOf(failure))));
      yield* disk(files.remove(join(to, path), { recursive: true, force: true }));
      yield* disk(files.makeDirectory(dirname(join(to, path)), { recursive: true }));
      yield* materialized(
        source,
        join(to, path),
        chosen,
        inventory === null ? null : (inventory.modules.get(path)?.inventory ?? UNCHANGED),
      );
      if (input.kind === 'tree' && chosen !== null)
        yield* command(to, ['update-index', '--add', '--cacheinfo', `160000,${chosen},${path}`]);
    }
  });

  const trouble = (failure: GitUnreadable | GitRefused | GitAnswerInvalid) => failed(troubleOf(failure));
  for (const path of input.kind === 'tree' ? inputs : []) {
    if (!(yield* disk(files.exists(join(checkout, path)))))
      return yield* failed(`${join(checkout, path)}, a declared source input, does not stand`);
  }
  const inventory = input.kind === 'tree' ? yield* sourceInventory(git, checkout, head, inputs).pipe(Effect.mapError(trouble)) : null;
  yield* materialized(checkout, root, head, inventory);
  const physical = yield* disk(files.realPath(root));
  if (inventory === null) return { root: physical, head, dirty: false, tree: null, inputs: [] } satisfies SourceSnapshot;
  const tree = yield* measureSource(git, physical, inventory).pipe(Effect.mapError(trouble));
  return { root: physical, head, dirty: tree.changed > 0, tree: tree.fingerprint, inputs } satisfies SourceSnapshot;
});
