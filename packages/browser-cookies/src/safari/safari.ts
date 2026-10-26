import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import type { Reading } from '../cookie.js';
import { type CookieSource, ProfileMissing, SourceUnreadable } from '../source.js';
import { offLoop } from '../worker.js';

const WORKER = new URL('./safari.worker.ts', import.meta.url);

export const SAFARI_PROFILE = 'default';

export const makeSafariSource = Effect.fnUntraced(function* (input: { readonly home: string }) {
  const files = yield* FileSystem.FileSystem;
  const candidates = [
    join(input.home, 'Library', 'Containers', 'com.apple.Safari', 'Data', 'Library', 'Cookies', 'Cookies.binarycookies'),
    join(input.home, 'Library', 'Cookies', 'Cookies.binarycookies'),
  ];
  const standing = (file: string) =>
    files.stat(file).pipe(
      Effect.as(true),
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(false)),
      Effect.catchReason('PlatformError', 'PermissionDenied', () => Effect.succeed(true)),
      Effect.mapError(
        (failure) =>
          new SourceUnreadable({ message: `the Safari cookies could not be found: ${failure.message}`, unblock: ['list again'] }),
      ),
    );
  const profiles = Effect.map(Effect.forEach(candidates, standing), (found) =>
    found.includes(true) ? [{ id: SAFARI_PROFILE, name: 'Safari' }] : [],
  );
  return {
    id: 'safari',
    title: 'Safari',
    access: 'full-disk',
    profiles,
    read: Effect.fn('safari.read')(function* (profile: string) {
      if (profile !== SAFARI_PROFILE) return yield* new ProfileMissing({ message: `Safari keeps one profile, ${SAFARI_PROFILE}` });
      return yield* offLoop<readonly string[], Reading>(WORKER, candidates, 'the Safari cookies');
    }),
  } satisfies CookieSource;
});
