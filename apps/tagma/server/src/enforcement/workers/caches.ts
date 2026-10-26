import { MEMO_BYTES } from '@tagma/inspection/node/memo';
import type { Git } from '@runlith/git/Git';
import { storeAt } from '@runlith/git/repository';
import { Effect, Result } from 'effect';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { openCache } from '../cache/store.js';
import { rest, woken } from './rest.js';
import { gitUnread, Unread } from './unread.js';

const JOBS_KEPT = 4;

export type InspectionCache = ReturnType<typeof openCache>;

const caches = new Map<string, InspectionCache>();
const awake = new Set<string>();

export const cacheAt = Effect.fn('inspecting.cacheAt')(function* (git: Git['Service'], root: string, cacheRoot?: string) {
  if (cacheRoot === undefined) return undefined;
  const common = yield* storeAt(git, root).pipe(Effect.mapError(gitUnread));
  const path = join(cacheRoot, `${createHash('sha256').update(common.commonDir).digest('hex')}.sqlite`);
  let cache = caches.get(path);
  if (cache === undefined) {
    try {
      cache = openCache(path, MEMO_BYTES, (cause) =>
        Effect.runSync(
          Effect.logWarning('the inspection cache degraded and answers as if empty until it recovers', {
            path,
            code: cause.code,
            detail: cause.detail,
          }),
        ),
      );
    } catch (error) {
      yield* Effect.logWarning('the inspection cache could not be opened, so inspections run without it', {
        path,
        cause: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
    caches.set(path, cache);
    while (caches.size > JOBS_KEPT) {
      const oldest = caches.entries().next().value!;
      oldest[1].close();
      caches.delete(oldest[0]);
    }
  } else {
    caches.delete(path);
    caches.set(path, cache);
  }
  if (!awake.has(root)) {
    awake.add(root);
    woken(cache.rest, root);
  }
  return cache;
});

export const rested = Effect.fn('inspecting.rest')(function* (git: Git['Service'], cacheRoot?: string) {
  const unkept: string[] = [];
  for (const root of [...awake]) {
    const cache = yield* Effect.result(cacheAt(git, root, cacheRoot));
    if (Result.isFailure(cache)) {
      awake.delete(root);
      unkept.push(`${root}: ${cache.failure.reason}`);
      continue;
    }
    if (cache.success !== undefined) {
      rest(cache.success.rest, root);
      cache.success.flush();
    }
  }
  if (unkept.length > 0)
    return yield* new Unread({ cause: 'git', reason: `the state of ${unkept.join('; ')} could not be kept; every other checkout's was` });
  return { worked: { rested: true as const }, read: [] as string[] };
});
