import { isAbsolute, join, resolve } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { ScratchAreas } from '../contract/service/scratch.js';
import type { FileReach } from '../../platform/contract/wire/caller.js';

const THREAD_ID = /^[0-9a-zA-Z-]{1,64}$/;

export type ThreadScratch = ScratchAreas['Service'];

export const makeThreadScratch = Effect.fnUntraced(function* ({ root }: { readonly root: string }) {
  const files = yield* FileSystem.FileSystem;
  const directory = (threadId: string): string => {
    if (!THREAD_ID.test(threadId)) throw new Error(`Thread ${threadId} cannot name a scratch directory.`);
    return join(root, threadId);
  };

  const scope = (threadId: string): FileReach => {
    const path = directory(threadId);
    return { path, resolve: (candidate) => (isAbsolute(candidate) ? candidate : resolve(path, candidate)) };
  };

  const ensure = Effect.fn('ScratchAreas.ensure')(function* (threadId: string) {
    const path = directory(threadId);
    yield* files.makeDirectory(path, { recursive: true }).pipe(Effect.orDie);
    return path;
  });
  const release = Effect.fn('ScratchAreas.release')(function* (threadId: string) {
    yield* files.remove(directory(threadId), { recursive: true, force: true }).pipe(Effect.orDie);
  });
  return ScratchAreas.of({ directory, scope, ensure, release });
});
