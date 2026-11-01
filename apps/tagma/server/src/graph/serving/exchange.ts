import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Clock, Effect, Exit, type Semaphore } from 'effect';
import { Git } from '@runlith/git/Git';
import { GateRefusal, type OpenRefusal } from '../../platform/contract/wire/refusal.js';
import { ProjectPolicy } from '../contract/service/serving.js';
import { NO_SIDE, type ExchangeHost } from '../contract/service/exchange.js';
import {
  graphHome,
  mirrorHome,
  resolveStorageLayout,
  setAsideHome,
  stealthBeside,
  storageHomes,
  type StorageLayout,
} from '../storage/layout.js';
import { baseOf, forwardBranch } from '../storage/tracking.js';
import { ShadowGit } from '../tree/shadow.js';
import { overShadow } from './permits.js';
import { refused } from './refusal.js';

type HostBindings = {
  readonly gates: (key: string) => Semaphore.Semaphore;
  readonly storePath: string;
  readonly moved: (gitDir: string) => Effect.Effect<void, GateRefusal<OpenRefusal>>;
  readonly exclusive: <A, E>(projectId: number, effect: Effect.Effect<A, E>) => Effect.Effect<A, E>;
  readonly release: (projectId: number) => Effect.Effect<void>;
  readonly open: (projectId: number) => Effect.Effect<void, GateRefusal<OpenRefusal>>;
  readonly reopen: (projectId: number) => Effect.Effect<void, GateRefusal<OpenRefusal>>;
};

export const stealthGitDir = (storePath: string, projectId: number, layout: StorageLayout, worktree: string): string =>
  layout.mode === 'stealth' ? layout.gitDir : stealthBeside(layout, { projectId, ...storageHomes(storePath), worktree }).gitDir;

const io = <A>(work: () => Promise<A>) =>
  Effect.tryPromise({
    try: work,
    catch: (cause) => new GateRefusal('graph-pool', `the graph could not be set aside: ${String(cause)}`, ['read the report and retry']),
  });

export const exchangeHost = Effect.fnUntraced(function* (bindings: HostBindings) {
  const git = yield* Git;
  const policy = yield* ProjectPolicy;
  const { appHome } = storageHomes(bindings.storePath);

  const gitDir = Effect.fnUntraced(function* (projectId: number) {
    const row = (yield* refused(policy.read([projectId]))).get(projectId);
    if (row === undefined)
      return yield* new GateRefusal('not-found', `project ${projectId} does not exist`, [
        'tagma project list — the projects this machine serves',
      ]);
    const layout = yield* refused(resolveStorageLayout({ mode: row.storage, projectId: row.id, appHome, worktree: row.rootPath }));
    return stealthGitDir(bindings.storePath, row.id, layout, row.rootPath);
  });

  const host: ExchangeHost = {
    gitDir,
    follow: Effect.fnUntraced(function* (gitDir, sides) {
      const behind: { readonly branch: string; readonly local: string; readonly tracked: string }[] = [];
      const diverged: string[] = [];
      for (const [branch, local] of sides.local) {
        const tracked = sides.tracked.get(branch);
        if (tracked === undefined || tracked === local) continue;
        const base = yield* baseOf(git, gitDir, local, tracked);
        if (base === local) behind.push({ branch, local, tracked });
        else if (base !== null && base !== tracked) diverged.push(branch);
      }
      if (behind.length === 0 && diverged.length === 0) return false;
      return yield* overShadow(
        bindings.gates,
        gitDir,
      )(
        Effect.gen(function* () {
          const held = yield* (yield* ShadowGit.open(gitDir, git, NO_SIDE)).heldBranches();
          let served = diverged.some((branch) => held.has(branch));
          for (const one of behind) {
            if (held.has(one.branch)) served = true;
            else yield* forwardBranch(git, gitDir, one.branch, one.tracked, one.local);
          }
          return served;
        }),
      );
    }),
    moved: bindings.moved,
    open: bindings.open,
    replace: Effect.fnUntraced(function* <A, E>(projectId: number, between: Effect.Effect<A, E>) {
      const aside = setAsideHome(appHome, projectId, new Date(yield* Clock.currentTimeMillis));
      const places = [
        [graphHome(appHome, projectId), join(aside, 'graph')],
        [mirrorHome(appHome, projectId), join(aside, 'mirror')],
      ] as const;
      return yield* bindings.exclusive(
        projectId,
        Effect.gen(function* () {
          yield* bindings.release(projectId);
          const moved: (readonly [string, string])[] = [];
          const attempt = Effect.gen(function* () {
            for (const [from, to] of places) {
              if (!existsSync(from)) continue;
              yield* io(() => mkdir(dirname(to), { recursive: true }));
              yield* io(() => rename(from, to));
              moved.push([from, to]);
            }
            const value = yield* between;
            yield* bindings.reopen(projectId);
            return value;
          });
          const ended = yield* Effect.exit(attempt);
          if (Exit.isSuccess(ended)) return { value: ended.value, aside };
          yield* bindings.release(projectId);
          for (const [from, to] of [...moved].reverse()) {
            yield* io(() => rm(from, { recursive: true, force: true }));
            yield* io(() => rename(to, from));
          }
          return yield* Effect.failCause(ended.cause);
        }),
      );
    }),
  };
  return host;
});
