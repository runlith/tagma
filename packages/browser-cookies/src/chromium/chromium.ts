import { join } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import type { Reading } from '../cookie.js';
import { type CookieSource, ProfileMissing, SafeStorageKey, type SourceProfile, SourceUnreadable } from '../source.js';
import { offLoop } from '../worker.js';
import type { ChromiumAsk } from './read.js';

export type ChromiumBrowser = {
  readonly id: string;
  readonly title: string;
  readonly root: string;
  readonly service: string;
  readonly account: string;
};

export const CHROMIUM_BROWSERS: readonly ChromiumBrowser[] = [
  { id: 'chrome', title: 'Google Chrome', root: 'Google/Chrome', service: 'Chrome Safe Storage', account: 'Chrome' },
  { id: 'edge', title: 'Microsoft Edge', root: 'Microsoft Edge', service: 'Microsoft Edge Safe Storage', account: 'Microsoft Edge' },
  { id: 'arc', title: 'Arc', root: 'Arc/User Data', service: 'Arc Safe Storage', account: 'Arc' },
  { id: 'brave', title: 'Brave', root: 'BraveSoftware/Brave-Browser', service: 'Brave Safe Storage', account: 'Brave' },
  { id: 'comet', title: 'Comet', root: 'Comet', service: 'Comet Safe Storage', account: 'Comet' },
  { id: 'helium', title: 'Helium', root: 'net.imput.helium', service: 'Helium Storage Key', account: 'Helium' },
];

const WORKER = new URL('./chromium.worker.ts', import.meta.url);

const LocalState = Schema.Struct({
  profile: Schema.optional(
    Schema.Struct({ info_cache: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ name: Schema.optional(Schema.String) }))) }),
  ),
});

const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(LocalState));

const plainFolder = (name: string): boolean => name !== '' && name !== '.' && name !== '..' && !/[/\\\0]/u.test(name);

export const makeChromiumSources = Effect.fnUntraced(function* (input: { readonly home: string }) {
  const files = yield* FileSystem.FileSystem;
  const key = yield* SafeStorageKey;

  const unreadable = (what: string) => (failure: { readonly message: string }) =>
    new SourceUnreadable({ message: `${what} could not be read: ${failure.message}`, unblock: ['import again'] });

  const cookiesIn = Effect.fnUntraced(function* (root: string, folder: string) {
    for (const file of [join(root, folder, 'Network', 'Cookies'), join(root, folder, 'Cookies')]) {
      if (yield* files.exists(file).pipe(Effect.mapError(unreadable(file)))) return file;
    }
    return null;
  });

  const sourceOf = (browser: ChromiumBrowser): CookieSource => {
    const root = join(input.home, 'Library', 'Application Support', browser.root);

    const named = Effect.fnUntraced(function* () {
      const state = join(root, 'Local State');
      if (!(yield* files.exists(state).pipe(Effect.mapError(unreadable(state))))) return [{ id: 'Default', name: 'Default' }];
      const text = yield* files.readFileString(state).pipe(Effect.mapError(unreadable(state)));
      const decoded = yield* decodeState(text).pipe(Effect.mapError(unreadable(state)));
      const cache = decoded.profile?.info_cache ?? {};
      const listed = Object.entries(cache).filter(([folder]) => plainFolder(folder));
      return listed.length === 0 ? [{ id: 'Default', name: 'Default' }] : listed.map(([id, held]) => ({ id, name: held.name ?? id }));
    });

    const profiles = Effect.gen(function* () {
      if (!(yield* files.exists(root).pipe(Effect.mapError(unreadable(root))))) return [];
      const kept: SourceProfile[] = [];
      for (const profile of yield* named()) if ((yield* cookiesIn(root, profile.id)) !== null) kept.push(profile);
      return kept;
    }).pipe(Effect.withSpan('chromium.profiles', { attributes: { browser: browser.id } }));

    return {
      id: browser.id,
      title: browser.title,
      access: 'keychain',
      profiles,
      read: Effect.fn('chromium.read')(function* (profile: string) {
        const file = plainFolder(profile) ? yield* cookiesIn(root, profile) : null;
        if (file === null) return yield* new ProfileMissing({ message: `${browser.title} keeps no profile ${profile} with cookies` });
        const password = yield* key.read(browser.service, browser.account);
        return yield* offLoop<ChromiumAsk, Reading>(WORKER, { file, password }, `the ${browser.title} profile ${profile}`);
      }),
    } satisfies CookieSource;
  };

  return CHROMIUM_BROWSERS.map(sourceOf);
});
