import { join, relative, resolve } from 'node:path';
import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Layer, PlatformError } from 'effect';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { ensuredPath, runningWorld, writeLauncher } from './launcher.js';
import { besideEnv } from '../cut/beside.js';

const homeOf = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  return yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'tagma-launcher-' }));
});
const platform = { os: 'darwin', arch: 'arm64' } as const;
const shell = (home: string, path: string, name = '/bin/zsh'): NodeJS.ProcessEnv => ({ PATH: path, HOME: home, SHELL: name });

layer(BunFileSystem.layer, { excludeTestServices: true })('the launcher', (it) => {
  it.effect('is reached on a PATH that spells its directory first, even with a trailing slash', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      const path = join(home, '.tagma', 'bin', 'tagma');
      const env = shell(home, `${join(home, '.tagma', 'bin')}/:/usr/bin:/bin`);
      expect((yield* writeLauncher(join(home, '.tagma', 'install'), path, platform, env)).reach).toEqual({ _tag: 'Reached' });
    }),
  );

  it.effect('absent from the PATH, the profile is given the line that puts it first, once', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      const files = yield* FileSystem.FileSystem;
      const path = join(home, '.tagma', 'bin', 'tagma');
      const env = shell(home, `/usr/bin:${join(home, 'elsewhere')}:/bin`);
      const first = yield* writeLauncher(join(home, '.tagma', 'install'), path, platform, env);
      expect(first.reach).toEqual({ _tag: 'Profiled', profile: join(home, '.zshrc'), shadow: null });
      const profile = yield* files.readFileString(join(home, '.zshrc'));
      const again = yield* writeLauncher(join(home, '.tagma', 'install'), path, platform, env);
      expect(again.reach._tag).toBe('Profiled');
      expect(yield* files.readFileString(join(home, '.zshrc'))).toBe(profile);
    }),
  );

  it.effect('a line under the mark naming another directory is rewritten in place, and the rest of the profile stands', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      const files = yield* FileSystem.FileSystem;
      const path = join(home, '.tagma', 'bin', 'tagma');
      const env = shell(home, '/usr/bin:/bin');
      yield* files.writeFileString(
        join(home, '.zshrc'),
        'export A=1\n\n# tagma: the installed tagma comes first\nexport PATH="/tmp/gone/bin:$PATH"\nexport B=2\n',
      );
      const answered = yield* writeLauncher(join(home, '.tagma', 'install'), path, platform, env);
      expect(answered.reach).toEqual({ _tag: 'Profiled', profile: join(home, '.zshrc'), shadow: null });
      expect(yield* files.readFileString(join(home, '.zshrc'))).toBe(
        'export A=1\n\n# tagma: the installed tagma comes first\nexport PATH="$HOME/.tagma/bin:$PATH"\nexport B=2\n',
      );
    }),
  );

  it.effect('a tagma standing before it on the PATH is the shadow, named with what it points at', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      const files = yield* FileSystem.FileSystem;
      const path = join(home, '.tagma', 'bin', 'tagma');
      const other = join(home, 'other', 'bin');
      const checkout = join(home, 'checkout', 'main.ts');
      yield* files.makeDirectory(other, { recursive: true });
      yield* files.makeDirectory(join(home, 'checkout'), { recursive: true });
      yield* files.writeFileString(checkout, '');
      yield* files.symlink(checkout, join(other, 'tagma'));
      yield* files.chmod(checkout, 0o755);
      const answered = yield* writeLauncher(
        join(home, '.tagma', 'install'),
        path,
        platform,
        shell(home, `${other}:${join(home, '.tagma', 'bin')}:/bin`),
      );
      expect(answered.reach).toEqual({ _tag: 'Profiled', profile: join(home, '.zshrc'), shadow: `${join(other, 'tagma')} → ${checkout}` });
    }),
  );

  it.effect('two channels keep a line each, and neither rewrites the other’s', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      const env = shell(home, '/usr/bin:/bin');
      yield* writeLauncher(join(home, '.tagma', 'install'), join(home, '.tagma', 'bin', 'tagma'), platform, env);
      yield* writeLauncher(join(home, '.tagma-dev', 'install'), join(home, '.tagma-dev', 'bin', 'tagma-dev'), platform, env);
      yield* writeLauncher(join(home, '.tagma', 'install'), join(home, '.tagma', 'bin', 'tagma'), platform, env);
      const lines = (yield* (yield* FileSystem.FileSystem).readFileString(join(home, '.zshrc'))).split('\n');
      expect(lines.filter((line) => line.startsWith('export PATH='))).toEqual([
        'export PATH="$HOME/.tagma/bin:$PATH"',
        'export PATH="$HOME/.tagma-dev/bin:$PATH"',
      ]);
    }),
  );

  it.effect('the world of the installation names its own command tagma, whatever the channel calls it', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      const files = yield* FileSystem.FileSystem;
      const path = join(home, '.tagma-dev', 'bin', 'tagma-dev');
      yield* writeLauncher(join(home, '.tagma-dev', 'install'), path, platform, shell(home, '/usr/bin:/bin'));
      const world = runningWorld(undefined, join(home, '.tagma-dev', 'install'));
      const said = yield* spawnedEffect(['/bin/sh', '-c', 'command -v tagma'], {
        env: { PATH: ensuredPath('/usr/bin:/bin', world) ?? '' },
      });
      expect(yield* files.realPath(said.stdout.toString().trim())).toBe(yield* files.realPath(path));
    }),
  );

  it.effect('a failed replacement keeps the standing launcher and world command usable', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      const files = yield* FileSystem.FileSystem;
      const root = join(home, 'install');
      const path = join(home, 'bin', 'tagma');
      const alias = join(home, 'world', 'tagma');
      const env = shell(home, join(home, 'bin'));
      yield* writeLauncher(root, path, platform, env);
      const original = yield* files.readFileString(path);
      const failure = PlatformError.systemError({ _tag: 'PermissionDenied', module: 'FileSystem', method: 'write' });
      const brokenLink: FileSystem.FileSystem = { ...files, symlink: () => Effect.fail(failure) };
      expect(
        (yield* Effect.result(
          writeLauncher(root, path, platform, env).pipe(Effect.provide(Layer.succeed(FileSystem.FileSystem, brokenLink))),
        ))._tag,
      ).toBe('Failure');
      expect(yield* files.readFileString(path)).toBe(original);
      expect(yield* files.realPath(alias)).toBe(yield* files.realPath(path));
      const partial: FileSystem.FileSystem = {
        ...files,
        writeFileString: (target, _text, options) => files.writeFileString(target, '', options).pipe(Effect.andThen(Effect.fail(failure))),
      };
      expect(
        (yield* Effect.result(writeLauncher(root, path, platform, env).pipe(Effect.provide(Layer.succeed(FileSystem.FileSystem, partial)))))
          ._tag,
      ).toBe('Failure');
      expect(yield* files.readFileString(path)).toBe(original);
      expect(yield* files.realPath(alias)).toBe(yield* files.realPath(path));
    }),
  );

  it.effect('an x64 launcher runs under Rosetta on Apple silicon', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      const files = yield* FileSystem.FileSystem;
      const root = join(home, 'install');
      const path = join(home, 'bin', 'tagma');
      const tools = join(home, 'tools');
      yield* files.makeDirectory(join(root, 'current'), { recursive: true });
      yield* files.makeDirectory(tools, { recursive: true });
      yield* files.writeFileString(join(root, 'current', 'bun'), '#!/bin/sh\necho runtime-reached\n', { mode: 0o700 });
      yield* files.writeFileString(join(tools, 'uname'), '#!/bin/sh\nif [ "$1" = -s ]; then echo Darwin; else echo x86_64; fi\n', {
        mode: 0o700,
      });
      yield* files.writeFileString(join(tools, 'sysctl'), '#!/bin/sh\necho 1\n', { mode: 0o700 });
      yield* writeLauncher(root, path, { os: 'darwin', arch: 'x64' }, shell(home, join(home, 'bin')));
      const answer = yield* spawnedEffect([path], { env: { PATH: `${tools}:/usr/bin:/bin` } });
      expect(answer.exitCode).toBe(0);
      expect(answer.stdout.toString().trim()).toBe('runtime-reached');
      yield* files.writeFileString(join(tools, 'sysctl'), '#!/bin/sh\necho 0\n', { mode: 0o700 });
      yield* writeLauncher(root, path, { os: 'darwin', arch: 'arm64' }, shell(home, join(home, 'bin')));
      const incompatible = yield* spawnedEffect([path], { env: { PATH: `${tools}:/usr/bin:/bin` } });
      expect(incompatible.exitCode).toBe(1);
      expect(incompatible.stdout.toString()).toBe('');
    }),
  );

  it.effect('rebuilding a beside launcher keeps its own world and leaves the shell profile alone', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      const files = yield* FileSystem.FileSystem;
      const root = join(home, 'trial');
      const bindings = besideEnv(root, 47821);
      const install = bindings.TAGMA_INSTALL_ROOT!;
      const current = join(install, 'current');
      const path = join(root, 'bin', 'tagma-dev');
      yield* files.makeDirectory(current, { recursive: true });
      yield* files.writeFileString(join(current, 'bun'), '#!/bin/sh\nenv\n', { mode: 0o700 });
      const profile = join(home, '.zshrc');
      yield* files.writeFileString(profile, 'export PRESERVED=yes\n');
      const native = process.platform === 'darwin' ? yield* spawnedEffect(['/usr/sbin/sysctl', '-n', 'hw.optional.arm64']) : null;
      const target = { os: process.platform, arch: native?.stdout.toString().trim() === '1' ? 'arm64' : process.arch };
      yield* writeLauncher(install, path, target, { ...shell(home, '/usr/bin:/bin'), ...bindings });

      const answer = yield* spawnedEffect([path], { env: { PATH: '/usr/bin:/bin' } });
      expect(answer.exitCode).toBe(0);
      const actual = Object.fromEntries(
        answer.stdout
          .toString()
          .trim()
          .split('\n')
          .map((line) => {
            const at = line.indexOf('=');
            return [line.slice(0, at), line.slice(at + 1)];
          }),
      );
      for (const [key, value] of Object.entries(bindings)) expect(actual[key]).toBe(value);
      expect(yield* files.readFileString(profile)).toBe('export PRESERVED=yes\n');
    }),
  );

  it.effect('fish gets its own grammar in its own file', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      const answered = yield* writeLauncher(
        join(home, '.tagma', 'install'),
        join(home, '.tagma', 'bin', 'tagma'),
        platform,
        shell(home, '/usr/bin:/bin', '/opt/homebrew/bin/fish'),
      );
      expect(answered.reach._tag).toBe('Profiled');
      expect(yield* (yield* FileSystem.FileSystem).readFileString(join(home, '.config', 'fish', 'config.fish'))).toContain(
        'fish_add_path --prepend --move $HOME/.tagma/bin',
      );
    }),
  );
});

const fakeInstall = Effect.fnUntraced(function* (home: string) {
  const files = yield* FileSystem.FileSystem;
  const bin = join(home, '.tagma', 'world');
  yield* files.makeDirectory(bin, { recursive: true });
  yield* files.writeFileString(join(bin, 'tagma'), '#!/bin/sh\necho fake-tagma\n', { mode: 0o755 });
  return { bin };
});
const resolved = Effect.fnUntraced(function* (path: string, cwd = process.cwd()) {
  const said = yield* spawnedEffect(['/bin/sh', '-c', 'command -v tagma'], { env: { ...process.env, PATH: path }, cwd });
  return { code: said.exitCode, out: said.stdout.toString().trim() };
});

layer(BunFileSystem.layer, { excludeTestServices: true })('the world of the installation on PATH', (it) => {
  const staleEntry = '/tmp/install-closure-dead/launched/bin';

  it.effect('a stale PATH gains the bin first, and the repaired environment resolves tagma', () =>
    Effect.gen(function* () {
      const { bin } = yield* fakeInstall(yield* homeOf);
      const repaired = ensuredPath(staleEntry, bin);
      expect(repaired).toBe(`${bin}:${staleEntry}`);
      expect((yield* resolved(staleEntry)).code).toBe(1);
      const proving = yield* resolved(repaired ?? '');
      expect(proving.code).toBe(0);
      expect(proving.out).toBe(join(bin, 'tagma'));
    }),
  );

  it.effect('a bin shadowed by another executable tagma moves first, and the repaired environment resolves the owned tagma', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      const files = yield* FileSystem.FileSystem;
      const foreign = join(home, 'foreign', 'bin');
      const { bin } = yield* fakeInstall(home);
      yield* files.makeDirectory(foreign, { recursive: true });
      yield* files.writeFileString(join(foreign, 'tagma'), '#!/bin/sh\necho foreign-tagma\n', { mode: 0o755 });
      const stale = `${foreign}:${bin}:/usr/bin:/bin`;
      const repaired = ensuredPath(stale, bin);
      const proving = yield* resolved(repaired ?? stale);
      expect(proving.code).toBe(0);
      expect(proving.out).toBe(join(bin, 'tagma'));
      expect(repaired).toBe(`${bin}:${foreign}:/usr/bin:/bin`);
    }),
  );

  it.effect('a leading empty entry does not shadow the bin: a child cwd holding tagma still resolves the owned one', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      const files = yield* FileSystem.FileSystem;
      const childDir = join(home, 'childcwd');
      const { bin } = yield* fakeInstall(home);
      yield* files.makeDirectory(childDir, { recursive: true });
      yield* files.writeFileString(join(childDir, 'tagma'), '#!/bin/sh\necho foreign-cwd-tagma\n', { mode: 0o755 });
      const stale = `:${bin}:/usr/bin:/bin`;
      expect(resolve((yield* resolved(stale, childDir)).out)).toBe(join(childDir, 'tagma'));
      const repaired = ensuredPath(stale, bin);
      const proving = yield* resolved(repaired ?? stale, childDir);
      expect(proving.code).toBe(0);
      expect(proving.out).toBe(join(bin, 'tagma'));
      expect(repaired).toBe(`${bin}::/usr/bin:/bin`);
    }),
  );

  it.effect('a PATH already led by the bin is untouched', () =>
    Effect.gen(function* () {
      const { bin } = yield* fakeInstall(yield* homeOf);
      expect(ensuredPath(`${bin}:/usr/bin:/bin`, bin)).toBeNull();
    }),
  );

  it.effect('with no launcher standing there nothing is prepended', () =>
    Effect.gen(function* () {
      expect(ensuredPath(staleEntry, join(yield* homeOf, 'nobin'))).toBeNull();
    }),
  );

  it.effect('an empty PATH keeps its empty entry behind the bin', () =>
    Effect.gen(function* () {
      const { bin } = yield* fakeInstall(yield* homeOf);
      expect(ensuredPath('', bin)).toBe(`${bin}:`);
    }),
  );

  it.effect('a relative entry resolving to the bin at boot cwd is kept, never removed', () =>
    Effect.gen(function* () {
      const { bin } = yield* fakeInstall(yield* homeOf);
      const rel = relative(process.cwd(), bin);
      expect(ensuredPath(`${rel}:/usr/bin:/bin`, bin)).toBe(`${bin}:${rel}:/usr/bin:/bin`);
    }),
  );

  it.effect('a relative configured bin is distributed absolute: a child cwd cannot retarget it', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      const { bin } = yield* fakeInstall(home);
      const childDir = join(home, 'elsewhere');
      yield* (yield* FileSystem.FileSystem).makeDirectory(childDir, { recursive: true });
      const repaired = ensuredPath('/usr/bin:/bin', relative(process.cwd(), bin));
      const proving = yield* resolved(repaired ?? '/usr/bin:/bin', childDir);
      expect(proving.code).toBe(0);
      expect(proving.out).toBe(join(bin, 'tagma'));
      expect(repaired).toBe(`${bin}:/usr/bin:/bin`);
    }),
  );

  it.effect('the running closure wins over the environment default', () =>
    Effect.gen(function* () {
      const home = yield* homeOf;
      expect(runningWorld(join(home, 'custom', 'install', 'v1'), join(home, '.tagma', 'install'))).toBe(join(home, 'custom', 'world'));
      expect(runningWorld(undefined, join(home, '.tagma', 'install'))).toBe(join(home, '.tagma', 'world'));
    }),
  );
});
