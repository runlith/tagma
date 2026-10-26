import { isAbsolute, join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import type { Reading } from '../cookie.js';
import { type CookieSource, ProfileMissing, type SourceProfile, SourceUnreadable } from '../source.js';
import { offLoop } from '../worker.js';

const WORKER = new URL('./firefox.worker.ts', import.meta.url);

type Listed = SourceProfile & { readonly file: string };

export const profilesIni = (text: string, root: string): readonly Listed[] => {
  const sections: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      current = /^\[Profile\d+\]$/u.test(line) ? {} : null;
      if (current !== null) sections.push(current);
      continue;
    }
    const at = line.indexOf('=');
    if (current !== null && at > 0) current[line.slice(0, at)] = line.slice(at + 1);
  }
  return sections.flatMap((section) => {
    const path = section.Path;
    if (path === undefined || path === '') return [];
    const folder = section.IsRelative === '0' || isAbsolute(path) ? path : join(root, path);
    return [{ id: path, name: section.Name ?? path, file: join(folder, 'cookies.sqlite') }];
  });
};

export const makeFirefoxSource = Effect.fnUntraced(function* (input: { readonly home: string }) {
  const files = yield* FileSystem.FileSystem;
  const root = join(input.home, 'Library', 'Application Support', 'Firefox');
  const ini = join(root, 'profiles.ini');

  const unreadable = (what: string) => (failure: { readonly message: string }) =>
    new SourceUnreadable({ message: `${what} could not be read: ${failure.message}`, unblock: ['import again'] });

  const listed = Effect.gen(function* () {
    if (!(yield* files.exists(ini).pipe(Effect.mapError(unreadable(ini))))) return [];
    const kept: Listed[] = [];
    for (const profile of profilesIni(yield* files.readFileString(ini).pipe(Effect.mapError(unreadable(ini))), root)) {
      if (yield* files.exists(profile.file).pipe(Effect.mapError(unreadable(profile.file)))) kept.push(profile);
    }
    return kept;
  }).pipe(Effect.withSpan('firefox.profiles'));

  return {
    id: 'firefox',
    title: 'Firefox',
    access: null,
    profiles: Effect.map(listed, (kept) => kept.map(({ id, name }) => ({ id, name }))),
    read: Effect.fn('firefox.read')(function* (profile: string) {
      const found = (yield* listed).find((held) => held.id === profile);
      if (found === undefined) return yield* new ProfileMissing({ message: `Firefox keeps no profile ${profile} with cookies` });
      return yield* offLoop<string, Reading>(WORKER, found.file, `the Firefox profile ${found.name}`);
    }),
  } satisfies CookieSource;
});
