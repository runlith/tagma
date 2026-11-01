import { join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem, PlatformError } from 'effect';
import { prepareHome } from './home.js';

const PLACE = { account: '/data/muse-code', config: '/thread/config' };

const prepared = (platform: NodeJS.Platform, env: Record<string, string>) => {
  const links: [string, string][] = [];
  const files = FileSystem.makeNoop({
    makeDirectory: () => Effect.void,
    readLink: () => Effect.fail(PlatformError.systemError({ _tag: 'NotFound', module: 'FileSystem', method: 'readLink' })),
    symlink: (target, path) => Effect.sync(() => void links.push([target, path])),
  });
  return Effect.map(Effect.provideService(prepareHome(PLACE, env, platform), FileSystem.FileSystem, files), (home) => ({ home, links }));
};

it.effect('macOS reaches the login file and the login keychain from the account home', () =>
  Effect.gen(function* () {
    const { home, links } = yield* prepared('darwin', { HOME: '/Users/me' });
    expect(links).toEqual([
      [join('/Users/me/.config', 'muse', 'auth.json'), join('/thread/config', 'muse', 'auth.json')],
      [join('/Users/me', 'Library', 'Keychains'), join('/data/muse-code', 'Library', 'Keychains')],
    ]);
    expect(home).toMatchObject({ HOME: '/data/muse-code', XDG_CONFIG_HOME: '/thread/config' });
  }),
);

it.effect('Linux reaches only the login file, under the user XDG config when it is set', () =>
  Effect.gen(function* () {
    const { links } = yield* prepared('linux', { HOME: '/home/me', XDG_CONFIG_HOME: '/home/me/cfg' });
    expect(links).toEqual([[join('/home/me/cfg', 'muse', 'auth.json'), join('/thread/config', 'muse', 'auth.json')]]);
  }),
);

it.effect('Windows finds the user home by USERPROFILE and moves both home variables to the account home', () =>
  Effect.gen(function* () {
    const { home, links } = yield* prepared('win32', { USERPROFILE: 'C:/Users/me' });
    expect(links).toEqual([[join('C:/Users/me/.config', 'muse', 'auth.json'), join('/thread/config', 'muse', 'auth.json')]]);
    expect(home).toMatchObject({ HOME: '/data/muse-code', USERPROFILE: '/data/muse-code' });
  }),
);

it.effect('a platform whose login is not established is refused with its name', () =>
  Effect.gen(function* () {
    const refusal = yield* Effect.flip(prepared('freebsd', { HOME: '/home/me' }));
    expect(refusal.message).toContain('freebsd');
  }),
);
