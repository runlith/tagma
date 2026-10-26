import { lstat, readdir, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { Clock, Effect } from 'effect';
import { type Capacity, HEAVY } from '../../platform/contract/service/capacity.js';
import type { StandingSweep } from '../../platform/contract/service/maintenance.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { FileRoots } from '../../workspace/contract/service/roots.js';
import { codeOf } from '../entries/record.js';
import { type GitDirs, type TrashActs, manifestAt, trashIn } from './place.js';

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const FREE_SHARE = 10;

const ROOTS_AT_ONCE = 2;

type Act = { readonly home: string; readonly at: number };

const vanished = (cause: unknown): boolean => codeOf(cause) === 'ENOENT';

const sizeOf = async (path: string): Promise<number> => {
  try {
    const entry = await lstat(path);
    if (!entry.isDirectory()) return entry.size;
    let total = entry.size;
    for (const name of await readdir(path)) total += await sizeOf(join(path, name));
    return total;
  } catch (cause) {
    if (vanished(cause)) return 0;
    throw cause;
  }
};

const actsIn = async (trash: string): Promise<readonly string[]> => {
  try {
    return await readdir(trash);
  } catch (cause) {
    if (vanished(cause)) return [];
    throw cause;
  }
};

const bornAt = async (home: string): Promise<number | null> => {
  try {
    return (await lstat(home)).mtimeMs;
  } catch (cause) {
    if (vanished(cause)) return null;
    throw cause;
  }
};

export type Swept = { readonly kept: number; readonly removed: number };

export const sweptTrash = Effect.fnUntraced(function* (trash: string, now: number, acts: TrashActs) {
  const names = yield* Effect.tryPromise(() => actsIn(trash));
  const found: Act[] = [];
  for (const name of names) {
    const home = join(trash, name);
    if (acts.busy(home)) continue;
    const kept = yield* manifestAt(home);
    const at = kept.kind === 'kept' ? kept.manifest.at : yield* Effect.tryPromise(() => bornAt(home));
    if (at !== null) found.push({ home, at });
  }
  if (found.length === 0) return { kept: 0, removed: 0 };
  found.sort((left, right) => right.at - left.at);
  const disk = yield* Effect.tryPromise(() => statfs(trash));
  const budget = (disk.bavail * disk.bsize) / FREE_SHARE;
  let held = 0;
  let removed = 0;
  for (const act of found) {
    if (acts.busy(act.home)) continue;
    if (act.at >= now - RETENTION_MS && held <= budget) {
      held += yield* Effect.tryPromise(() => sizeOf(act.home));
      if (held <= budget) continue;
    }
    yield* Effect.tryPromise(() => rm(act.home, { recursive: true, force: true }));
    removed += 1;
  }
  return { kept: found.length - removed, removed };
});

const SWEEP = { name: 'CheckoutTrash.sweep', class: 'background', needs: [{ pool: HEAVY, units: 1 }] } as const;

export const trashSweep = (roots: FileRoots['Service'], gitDirs: GitDirs, acts: TrashActs, capacity: Capacity['Service']): StandingSweep =>
  Effect.fn('CheckoutTrash.sweep')(function* (moment: string) {
    yield* Effect.annotateCurrentSpan({ moment });
    const listed = yield* Effect.result(roots.active());
    if (listed._tag === 'Failure') {
      yield* Effect.logWarning(`the checkout trash could not be swept (${moment}): the roots could not be listed`, {
        reason: listed.failure.message,
      });
      return;
    }
    const now = yield* Clock.currentTimeMillis;
    const swept = yield* Effect.forEach(
      listed.success,
      (root) =>
        Effect.flatMap(
          Effect.result(
            capacity.ticket(
              SWEEP,
              Effect.flatMap(root.git === null ? gitDirs.of(root.path) : Effect.succeed(root.git.gitDirectory.path), (gitDir) =>
                sweptTrash(trashIn(gitDir), now, acts),
              ),
            ),
          ),
          (one) => {
            if (one._tag === 'Success') return Effect.succeed(one.success.removed);
            if (one.failure instanceof GateRefusal && one.failure.code === 'git-refused') {
              return Effect.as(Effect.logDebug('a checkout root is not a git repository; its trash is skipped', { root: root.path }), 0);
            }
            return Effect.as(Effect.logWarning('a checkout trash was left unswept', { root: root.path, reason: String(one.failure) }), 0);
          },
        ),
      { concurrency: ROOTS_AT_ONCE },
    );
    yield* Effect.annotateCurrentSpan({ roots: listed.success.length, removed: swept.reduce((sum, one) => sum + one, 0) });
  });
