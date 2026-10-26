import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { entryPath } from '../../installation/contract/wire/junction.js';
import { installHooks } from './hookWrite.js';
import { ownPlaces } from './targets.js';

class Home extends Context.Service<Home, { readonly repo: string; readonly home: string; readonly bare: string }>()('test/hooks/Home') {}

const home = Layer.effect(
  Home,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'portable-hooks-' });
    const repo = join(root, 'repo');
    const home = join(root, 'other-home');
    yield* files.makeDirectory(home);
    yield* installHooks(repo);
    return { repo, home, bare: join(root, 'bare') };
  }),
).pipe(Layer.provideMerge(BunFileSystem.layer));

const read = (repo: string) =>
  Effect.flatMap(FileSystem.FileSystem, (files) => Effect.map(files.readFileString(join(repo, '.codex', 'hooks.json')), JSON.parse));

const SURFACES = [
  ['.claude', 'settings.json'],
  ['.codex', 'hooks.json'],
] as const;

layer(home, { excludeTestServices: true })('portable hooks', (it) => {
  it.effect('installed hooks are silent without the entry point and deliver stdin and exit status through it', () =>
    Effect.gen(function* () {
      const { repo, home } = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const command = (yield* read(repo)).hooks.PreToolUse[0].hooks[0].command;
      const run = (path: string) =>
        spawnSync('/bin/sh', ['-c', command], { env: { HOME: home, PATH: path }, input: 'payload', encoding: 'utf8' });
      const absent = run(home);
      expect([absent.status, absent.stdout, absent.stderr]).toEqual([0, '', '']);
      const entry = entryPath({ HOME: home })!;
      yield* files.makeDirectory(dirname(entry), { recursive: true });
      yield* files.writeFileString(
        entry,
        '#!/bin/sh\nprintf "%s\\n" "$HOME" "$@"\nwhile IFS= read -r line || [ -n "$line" ]; do printf "%s" "$line"; done\nexit 7\n',
        { mode: 0o755 },
      );
      const present = run(home);
      expect(present.status).toBe(7);
      expect(present.stdout).toBe(`${home}\nhook\npre-tool-use\n--harness\ncodex\npayload`);
      expect(present.stderr).toBe('');
    }),
  );

  it.effect('refresh replaces absolute hooks, preserves foreign commands and is idempotent', () =>
    Effect.gen(function* () {
      const { repo, bare } = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const file = join(repo, '.codex', 'hooks.json');
      const foreign = { type: 'command', command: 'printf other' };
      yield* files.writeFileString(
        file,
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                hooks: [
                  { type: 'command', command: '"/old/home/bun" "/old/home/bin/cli/main.js" hook pre-tool-use --harness codex' },
                  foreign,
                ],
              },
            ],
          },
        }),
      );
      yield* installHooks(repo);
      const document = yield* read(repo);
      expect(document.hooks.PreToolUse[0].hooks[1]).toEqual(foreign);
      expect(ownPlaces(document).filter((place) => place.event === 'PreToolUse')).toHaveLength(1);
      const command = document.hooks.PreToolUse[0].hooks[0].command;
      const absent = spawnSync('/bin/sh', ['-c', command], { env: { HOME: bare, PATH: repo }, encoding: 'utf8' });
      expect([absent.status, absent.stdout, absent.stderr]).toEqual([0, '', '']);
      expect((yield* installHooks(repo)).every((row) => row.write === 'current')).toBe(true);
    }),
  );

  it.effect('every retained duplicate is portable even when foreign positions prevent removal', () =>
    Effect.gen(function* () {
      const { repo, bare } = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const foreign = { type: 'command', command: 'printf other' };
      for (const [directory, file] of SURFACES) {
        const path = join(repo, directory, file);
        const stale = { type: 'command', command: '"/old/bun" "/old/bin/cli/main.js" hook stop' };
        yield* files.writeFileString(path, JSON.stringify({ hooks: { Stop: [{ hooks: [stale, stale, foreign] }] } }));
      }
      yield* installHooks(repo);
      for (const [directory, file] of SURFACES) {
        const doc = JSON.parse(yield* files.readFileString(join(repo, directory, file)));
        const handlers = doc.hooks.Stop[0].hooks;
        expect(handlers[2]).toEqual(foreign);
        expect(handlers).toHaveLength(3);
        for (const handler of handlers.slice(0, 2)) {
          const result = spawnSync('/bin/sh', ['-c', handler.command], { env: { HOME: bare, PATH: repo }, encoding: 'utf8' });
          expect([result.status, result.stdout, result.stderr]).toEqual([0, '', '']);
        }
      }
    }),
  );
});
