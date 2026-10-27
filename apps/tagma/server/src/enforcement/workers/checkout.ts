import type { Installed } from '@runlith/code-facts/tree';
import { Effect, FileSystem } from 'effect';
import { isAbsolute, join, relative } from 'node:path';
import { Unread } from './unread.js';

export const checkoutText = Effect.fn('inspecting.checkoutText')(function* (root: string, path: string) {
  const files = yield* FileSystem.FileSystem;
  return yield* files.readFileString(`${root}/${path}`).pipe(
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
    Effect.mapError((failure) => new Unread({ cause: 'source', reason: `${path}: ${failure.message}` })),
  );
});

export const checkoutAt = Effect.fn('inspecting.checkoutAt')(function* (root: string) {
  const files = yield* FileSystem.FileSystem;
  const real = yield* files
    .realPath(root)
    .pipe(Effect.mapError((failure) => new Unread({ cause: 'source', reason: `${root}: ${failure.message}` })));
  return { real, depth: real.split(/[\\/]/).filter((part) => part !== '').length };
});

export const checkoutFile = Effect.fn('inspecting.checkoutFile')(
  function* (real: string, path: string) {
    const files = yield* FileSystem.FileSystem;
    const at = join(real, path);
    const found = yield* files.stat(at).pipe(
      Effect.map((info) => info.type === 'File'),
      Effect.catchReasons('PlatformError', { NotFound: () => Effect.succeed(false), BadResource: () => Effect.succeed(false) }),
    );
    if (!found) return null;
    const text = yield* files.readFileString(at);
    const lies = relative(real, yield* files.realPath(at)).replaceAll('\\', '/');
    return { text, at: isAbsolute(lies) ? path : lies } satisfies Installed;
  },
  (effect, _real, path) => Effect.mapError(effect, (failure) => new Unread({ cause: 'source', reason: `${path}: ${failure.message}` })),
);
