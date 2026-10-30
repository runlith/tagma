import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { entryLine, entryPath } from '../../../installation/contract/wire/junction.js';

const FOREIGN = { hooks: [{ type: 'command', command: 'echo foreign' }] };
const OLD = '"/Users/x/.tagma/install/current/bun" "/Users/x/.tagma/install/current/bin/cli/main.js"';
const SEED: readonly (readonly [string, Record<string, unknown>])[] = [
  [
    '.claude/settings.json',
    {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: `${OLD} hook session-start` }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'command -v tagma >/dev/null 2>&1 || exit 0; exec tagma hook stop' }] }],
        PreToolUse: [FOREIGN],
      },
    },
  ],
  [
    '.codex/hooks.json',
    {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: `${OLD} hook session-start --harness codex` }] }],
        Stop: [FOREIGN],
      },
    },
  ],
  [
    '.gemini/settings.json',
    {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: 't=$(command -v tagma || command -v tagma-dev) || exit 0; exec "$t" hook session-start --harness gemini',
              },
            ],
          },
        ],
        AfterAgent: [FOREIGN],
      },
    },
  ],
];

const commandsOf = (doc: unknown): string[] =>
  Object.values((doc as { hooks: Record<string, { hooks: { command: string }[] }[]> }).hooks).flatMap((groups) =>
    groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
  );

it.live(
  'a server start leaves its own home hooks and MCP on the entry point line, keeps foreign ones, and changes nothing the second time',
  () =>
    Effect.gen(function* () {
      const disk = yield* FileSystem.FileSystem;
      const home = yield* disk.makeTempDirectoryScoped({ prefix: 'homes-' });
      const bin = join(home, 'bin');
      mkdirSync(bin);
      for (const binary of ['claude', 'codex', 'gemini', 'grok']) {
        writeFileSync(join(bin, binary), `#!/bin/sh\necho '${binary}' >> '${join(home, 'cli.log')}'\necho '${binary} 1.0.0'\n`);
        chmodSync(join(bin, binary), 0o755);
      }
      for (const [file, doc] of SEED) {
        const target = join(home, ...file.split('/'));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, JSON.stringify(doc));
      }
      const driver = join(home, 'drive-homes.ts');
      const homes = fileURLToPath(new URL('../../../external-harnesses/installs/skillInstall.ts', import.meta.url));
      const junction = fileURLToPath(new URL('../../../installation/contract/wire/junction.ts', import.meta.url));
      const sections = fileURLToPath(new URL('../../../platform/contract/service/sections.ts', import.meta.url));
      const graph = fileURLToPath(new URL('../../doctrine.ts', import.meta.url));
      const installed = fileURLToPath(new URL('../../../external-harnesses/birth/installed.ts', import.meta.url));
      const adapters = fileURLToPath(new URL('./shipped.ts', import.meta.url));
      const environment = fileURLToPath(new URL('../../../installation/process/userEnvironment.ts', import.meta.url));
      const userEnvironment = fileURLToPath(new URL('../../../installation/contract/service/userEnvironment.ts', import.meta.url));
      writeFileSync(
        driver,
        [
          `import { Effect, Layer } from ${JSON.stringify(import.meta.resolve('effect'))};`,
          `import * as BunFileSystem from ${JSON.stringify(import.meta.resolve('@effect/platform-bun/BunFileSystem'))};`,
          `import { installHomes } from ${JSON.stringify(homes)};`,
          `import { entryCommand } from ${JSON.stringify(junction)};`,
          `import { Doctrine } from ${JSON.stringify(sections)};`,
          `import { doctrine } from ${JSON.stringify(graph)};`,
          `import { installedHarnessesLayer } from ${JSON.stringify(installed)};`,
          `import { shippedAdaptersLayer } from ${JSON.stringify(adapters)};`,
          `import { makeUserEnvironment } from ${JSON.stringify(environment)};`,
          `import { UserEnvironment } from ${JSON.stringify(userEnvironment)};`,
          `import { readFileSync } from 'node:fs';`,
          `const files = ${JSON.stringify([...SEED.map(([file]) => join(home, ...file.split('/'))), join(home, '.codex', 'config.toml'), ...['tagma-hooks.json', 'plugins/tagma/index.ts', 'plugins/tagma/package.json', 'opencode.json'].map((file) => join(home, '.config', 'opencode', ...file.split('/')))])};`,
          `const users = makeUserEnvironment({ shell: null, env: process.env, world: null, home: null });`,
          `const installs = installedHarnessesLayer.pipe(Layer.provide(Layer.merge(BunFileSystem.layer, Layer.succeed(UserEnvironment, users))), Layer.provideMerge(shippedAdaptersLayer));`,
          `const run = () => Effect.runPromise(Effect.provide(installHomes(entryCommand(process.env)), Layer.mergeAll(Layer.effect(Doctrine, doctrine), installs, BunFileSystem.layer)));`,
          `const first = await run();`,
          `const between = files.map((file) => readFileSync(file, 'utf8'));`,
          `const second = await run();`,
          `console.log(JSON.stringify([first, second, between, files.map((file) => readFileSync(file, 'utf8'))]));`,
        ].join('\n'),
      );
      const { CODEX_HOME: _codex, CLAUDE_CONFIG_DIR: _claude, OPENCODE_CONFIG_DIR: _opencode, ...inherited } = process.env;
      const ran = yield* spawnedEffect([process.execPath, driver], {
        env: { ...inherited, HOME: home, PATH: `${bin}:/usr/bin:/bin` },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(ran.exitCode).toBe(0);
      expect(existsSync(join(home, 'cli.log'))).toBe(false);
      const [first, second, between, after] = JSON.parse(ran.stdout.toString()) as [
        { harness: string; failed?: string }[],
        { harness: string; failed?: string }[],
        string[],
        string[],
      ];

      expect(first?.map((done) => [done.harness, done.failed ?? null]).sort()).toEqual([
        ['claude-code', null],
        ['codex', null],
        ['gemini', null],
        ['grok', null],
        ['opencode', null],
      ]);
      for (const [file] of SEED) {
        const commands = commandsOf(JSON.parse(readFileSync(join(home, ...file.split('/')), 'utf8')));
        expect(commands).toContain('echo foreign');
        for (const command of commands.filter((said) => said !== 'echo foreign')) expect(command.startsWith(entryLine('hook '))).toBe(true);
      }
      const claude = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
      expect(claude.hooks.SessionStart).toEqual([
        { hooks: [{ type: 'command', command: entryLine('hook session-start --harness claude-code') }] },
      ]);
      expect(claude.hooks.PreToolUse).toContainEqual(FOREIGN);
      expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toContain(JSON.stringify(entryPath({ HOME: home })));
      expect(second.map((done) => done.failed ?? null)).toEqual([null, null, null, null, null]);
      expect(after).toEqual(between);
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
